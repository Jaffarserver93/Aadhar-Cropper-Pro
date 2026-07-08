import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UploadCloud, Download, AlertCircle, CheckCircle2, X, ImageIcon, Loader2, Plus, Minus,
} from 'lucide-react';
import { jsPDF } from 'jspdf';

// ── Layout — exact 35×45 mm at 300 DPI ──────────────────────────────────────
const A4_W     = 2480;          // 210 mm @ 300 DPI
const A4_H     = 3508;          // 297 mm @ 300 DPI
const MARGIN_T = 90;
const MARGIN_B = 90;
const H_GAP    = 10;            // gap between photos in a row (px @ 300 DPI)
const ROW_GAP  = 24;            // vertical gap between rows (px @ 300 DPI)
const PER_ROW  = 5;

// Exact passport dimensions at 300 DPI
const PHOTO_W  = Math.round(35 * 300 / 25.4);   // 413 px = 35 mm
const PHOTO_H  = Math.round(45 * 300 / 25.4);   // 531 px = 45 mm

// Centre the 5-photo row on A4
const MARGIN_L = Math.round((A4_W - PER_ROW * PHOTO_W - (PER_ROW - 1) * H_GAP) / 2); // 188 px

// Max rows that fit (= 6)
let _max = 0;
while ((_max + 1) * PHOTO_H + _max * ROW_GAP <= A4_H - MARGIN_T - MARGIN_B) _max++;
const MAX_ROWS = _max; // 6

// ── 0.5 mm border at 300 DPI ─────────────────────────────────────────────────
const BORDER = Math.round(300 / 25.4 * 0.5); // ≈ 6 px

// ── remove.bg proxy ──────────────────────────────────────────────────────────
async function removeBg(file: File, signal: AbortSignal): Promise<Blob> {
  const form = new FormData();
  form.append('image_file', file);
  const res = await fetch('/api/removebg', { method: 'POST', body: form, signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 402) throw new Error('remove.bg quota exhausted — try again later.');
    if (res.status === 429) throw new Error('Too many requests — wait a moment and retry.');
    if (res.status === 503) throw new Error('Background removal not configured.');
    throw new Error(body.error || `Server error ${res.status}`);
  }
  return res.blob();
}

// ── Picsart enhance proxy ─────────────────────────────────────────────────────
// Runs after the white-background passport composite is built: upscales +
// sharpens the final crop, which is then downsampled back to the exact print
// size for a cleaner, less noisy result. Non-fatal — falls back to the
// unenhanced composite if the service is unavailable.
async function enhanceImage(blob: Blob, signal: AbortSignal): Promise<Blob> {
  const form = new FormData();
  form.append('image', blob, 'photo.png');
  form.append('upscale_factor', '2');
  form.append('format', 'PNG');
  const res = await fetch('/api/enhance', { method: 'POST', body: form, signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Enhance server error ${res.status}`);
  }
  return res.blob();
}

async function drawScaledToCanvas(blob: Blob, width: number, height: number): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0, width, height);
    return canvas;
  } finally {
    bmp.close();
  }
}

// ── Smart bounding-box scan (downsampled for speed) ───────────────────────────
function findPersonBounds(srcW: number, srcH: number, pixels: Uint8ClampedArray, sampledW: number, sampledH: number) {
  let minY = sampledH, maxY = 0, minX = sampledW, maxX = 0;
  for (let y = 0; y < sampledH; y++) {
    for (let x = 0; x < sampledW; x++) {
      const alpha = pixels[(y * sampledW + x) * 4 + 3];
      if (alpha > 30) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  if (minY >= maxY || minX >= maxX) return null;
  // Scale back to source coordinates
  const sx = srcW / sampledW, sy = srcH / sampledH;
  return { top: minY * sy, bottom: maxY * sy, left: minX * sx, right: maxX * sx };
}

// ── Passport crop ─────────────────────────────────────────────────────────────
// Scans the alpha channel of the background-removed image to find the person's
// exact bounding box, then positions the crop so:
//   - ~8% blank space above the top of the head  (≈ 3.6 mm on a 45 mm frame)
//   - person (head → shoulders) fills ≈ 82% of the frame height
//   - horizontally centred on the person
async function makePassportCanvas(_file: File, bgBlob: Blob): Promise<HTMLCanvasElement> {
  const bgBmp = await createImageBitmap(bgBlob);
  const srcW = bgBmp.width, srcH = bgBmp.height;

  try {
    // ── Step 1: scan at reduced resolution to find person bounds quickly ──────
    const SCAN_MAX = 400;
    const scale    = Math.min(1, SCAN_MAX / Math.max(srcW, srcH));
    const sampledW = Math.round(srcW * scale);
    const sampledH = Math.round(srcH * scale);

    const scanCanvas = document.createElement('canvas');
    scanCanvas.width = sampledW; scanCanvas.height = sampledH;
    const scanCtx = scanCanvas.getContext('2d')!;
    scanCtx.drawImage(bgBmp, 0, 0, sampledW, sampledH);
    const pixels = scanCtx.getImageData(0, 0, sampledW, sampledH).data;

    const bounds = findPersonBounds(srcW, srcH, pixels, sampledW, sampledH);

    // ── Step 2: compute crop region ───────────────────────────────────────────
    // Passport standard: 8% blank above head, person fills 82% of frame height
    const HEAD_SPACE = 0.08;   // fraction of PHOTO_H above head
    const PERSON_FILL = 0.82;  // fraction of PHOTO_H the person should span

    let cropX: number, cropY: number, cropW: number, cropH: number;

    if (bounds) {
      const personH = bounds.bottom - bounds.top;
      const personCX = (bounds.left + bounds.right) / 2;

      // Source pixels that map to PHOTO_H
      cropH = personH / PERSON_FILL;
      cropW = cropH * (PHOTO_W / PHOTO_H);

      // Top of crop = head top minus the blank-space margin
      cropY = bounds.top - HEAD_SPACE * cropH;
      cropX = personCX - cropW / 2;
    } else {
      // Fallback: simple center cover-fit
      const targetAr = PHOTO_W / PHOTO_H;
      const srcAr = srcW / srcH;
      cropX = 0; cropY = 0; cropW = srcW; cropH = srcH;
      if (srcAr > targetAr) { cropW = srcH * targetAr; cropX = (srcW - cropW) / 2; }
      else                  { cropH = srcW / targetAr; cropY = (srcH - cropH) / 2; }
    }

    // Clamp so we never go out of bounds
    cropX = Math.max(0, Math.min(srcW - cropW, cropX));
    cropY = Math.max(0, Math.min(srcH - cropH, cropY));
    cropW = Math.min(cropW, srcW - cropX);
    cropH = Math.min(cropH, srcH - cropY);

    // ── Step 3: draw final canvas ─────────────────────────────────────────────
    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_W; canvas.height = PHOTO_H;
    const ctx = canvas.getContext('2d')!;

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PHOTO_W, PHOTO_H);

    // Photo content inside 0.5 mm border
    ctx.drawImage(bgBmp, cropX, cropY, cropW, cropH, BORDER, BORDER, PHOTO_W - 2 * BORDER, PHOTO_H - 2 * BORDER);

    // 0.5 mm black border
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, PHOTO_W, BORDER);
    ctx.fillRect(0, PHOTO_H - BORDER, PHOTO_W, BORDER);
    ctx.fillRect(0, BORDER, BORDER, PHOTO_H - 2 * BORDER);
    ctx.fillRect(PHOTO_W - BORDER, BORDER, BORDER, PHOTO_H - 2 * BORDER);

    return canvas;
  } finally {
    bgBmp.close();
  }
}

// ── A4 builder — each entry repeated by its copies count ─────────────────────
function buildA4Canvas(entries: { canvas: HTMLCanvasElement; copies: number }[]): HTMLCanvasElement {
  const a4 = document.createElement('canvas');
  a4.width = A4_W; a4.height = A4_H;
  const ctx = a4.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, A4_W, A4_H);
  let rowIdx = 0;
  for (const { canvas, copies } of entries) {
    for (let c = 0; c < copies; c++) {
      const y = MARGIN_T + rowIdx * (PHOTO_H + ROW_GAP);
      for (let col = 0; col < PER_ROW; col++) {
        ctx.drawImage(canvas, MARGIN_L + col * (PHOTO_W + H_GAP), y, PHOTO_W, PHOTO_H);
      }
      rowIdx++;
    }
  }
  return a4;
}

function downloadA4AsPdf(entries: { canvas: HTMLCanvasElement; copies: number }[], totalRows: number) {
  const imgData = buildA4Canvas(entries).toDataURL('image/png');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false });
  pdf.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'NONE');
  pdf.save(`passport-sheet-${totalRows}rows-${totalRows * PER_ROW}photos.pdf`);
}

function downloadSingleAsPng(canvas: HTMLCanvasElement, rowIdx: number) {
  const a = document.createElement('a');
  a.download = `passport-row${rowIdx + 1}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
}

function friendlyError(err: unknown): string {
  if ((err as DOMException)?.name === 'AbortError') return '';
  if (err instanceof TypeError && /fetch|network/i.test(err.message))
    return 'Network error — check your connection and try again.';
  return (err as Error)?.message || 'Something went wrong.';
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface PhotoRow {
  id: string;
  status: 'processing' | 'done' | 'error';
  canvas: HTMLCanvasElement | null;
  dataUrl: string | null;
  error: string | null;
  copies: number; // how many A4 rows this photo occupies (default 1)
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PassportPhotoMakerPage() {
  const [rows,       setRows]       = useState<PhotoRow[]>([]);
  const [a4DataUrl,  setA4DataUrl]  = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const addFileInputRef = useRef<HTMLInputElement>(null);
  const retryInputRef   = useRef<HTMLInputElement>(null);
  const abortMap        = useRef<Map<string, AbortController>>(new Map());

  // Total A4 rows used across all photos
  const totalCopies = rows.reduce((s, r) => s + r.copies, 0);
  const canAdd      = totalCopies < MAX_ROWS;

  // Rebuild A4 preview whenever rows change
  useEffect(() => {
    const entries = rows.filter(r => r.status === 'done' && r.canvas).map(r => ({ canvas: r.canvas!, copies: r.copies }));
    if (!entries.length) { setA4DataUrl(null); return; }
    setA4DataUrl(buildA4Canvas(entries).toDataURL('image/png'));
  }, [rows]);

  useEffect(() => () => abortMap.current.forEach(c => c.abort()), []);

  const processFile = useCallback(async (file: File, rowId?: string) => {
    if (!file.type.startsWith('image/')) return;
    const id = rowId ?? crypto.randomUUID();
    abortMap.current.get(id)?.abort();
    const ctrl = new AbortController();
    abortMap.current.set(id, ctrl);

    const processing: PhotoRow = { id, status: 'processing', canvas: null, dataUrl: null, error: null, copies: 1 };
    setRows(prev => {
      const idx = prev.findIndex(r => r.id === id);
      if (idx >= 0) { const next = [...prev]; next[idx] = { ...next[idx], ...processing, copies: next[idx].copies }; return next; }
      return [...prev, processing];
    });

    try {
      const bgBlob = await removeBg(file, ctrl.signal);
      if (ctrl.signal.aborted) return;
      let canvas = await makePassportCanvas(file, bgBlob);
      if (ctrl.signal.aborted) return;

      // Enhance the white-background composite, then downsample back to the
      // exact print size. If the enhance service is unavailable, keep going
      // with the unenhanced composite rather than failing the whole row.
      try {
        const compositeBlob: Blob = await new Promise((resolve, reject) =>
          canvas!.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png'));
        const enhancedBlob = await enhanceImage(compositeBlob, ctrl.signal);
        if (ctrl.signal.aborted) return;
        canvas = await drawScaledToCanvas(enhancedBlob, PHOTO_W, PHOTO_H);
      } catch (enhanceErr) {
        if ((enhanceErr as DOMException)?.name === 'AbortError') return;
        console.warn('Photo enhance skipped:', enhanceErr);
      }

      const done: PhotoRow = { id, status: 'done', canvas, dataUrl: canvas.toDataURL('image/png'), error: null, copies: 1 };
      setRows(prev => prev.map(r => r.id === id ? { ...done, copies: r.copies } : r));
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      const error: PhotoRow = { id, status: 'error', canvas: null, dataUrl: null, error: friendlyError(err), copies: 1 };
      setRows(prev => prev.map(r => r.id === id ? { ...error, copies: r.copies } : r));
    } finally {
      abortMap.current.delete(id);
    }
  }, []);

  const removeRow = (id: string) => {
    abortMap.current.get(id)?.abort();
    setRows(prev => prev.filter(r => r.id !== id));
  };

  const retryRow = (id: string) => {
    retryInputRef.current?.setAttribute('data-row-id', id);
    retryInputRef.current?.click();
  };

  const setCopies = (id: string, delta: number) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const others = prev.filter(x => x.id !== id).reduce((s, x) => s + x.copies, 0);
      const next = Math.min(MAX_ROWS - others, Math.max(1, r.copies + delta));
      return { ...r, copies: next };
    }));
  };

  const onAddFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
    e.target.value = '';
  };

  const onRetryFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    const id = retryInputRef.current?.getAttribute('data-row-id');
    if (f && id) processFile(f, id);
    e.target.value = '';
  };

  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop      = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && canAdd) processFile(f);
  };

  const handleDownloadA4 = () => {
    const entries = rows.filter(r => r.canvas).map(r => ({ canvas: r.canvas!, copies: r.copies }));
    if (entries.length) downloadA4AsPdf(entries, totalCopies);
  };

  const doneRows = rows.filter(r => r.status === 'done');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white flex flex-col">

      {/* ── Header ── */}
      <div className="border-b border-white/10 bg-slate-900/60 backdrop-blur-sm px-4 sm:px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shrink-0">
            <ImageIcon className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-sm">Passport Photo Maker</h1>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Exact 35×45 mm · 300 DPI · White BG · 0.5 mm border · Up to {MAX_ROWS} rows · A4
            </p>
          </div>
        </div>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">Beta</span>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-auto">

        {/* ── Left: Row manager ── */}
        <div className="flex-1 flex flex-col px-4 sm:px-6 py-6 gap-4 min-w-0 overflow-y-auto">

          {/* Empty state */}
          <AnimatePresence>
            {rows.length === 0 && (
              <motion.div key="empty"
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-6 py-8"
              >
                <div className="text-center space-y-2">
                  <h2 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
                    Upload your first photo
                  </h2>
                  <p className="text-slate-400 text-sm max-w-sm">
                    Each row = one photo × 5 copies. Upload up to {MAX_ROWS} different photos — one per row on A4.
                  </p>
                </div>

                <div
                  onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
                  onClick={() => addFileInputRef.current?.click()}
                  className={`w-full max-w-md border-2 border-dashed rounded-2xl p-10 sm:p-12 flex flex-col items-center gap-3 cursor-pointer transition-all
                    ${isDragging ? 'border-blue-400 bg-blue-500/10' : 'border-white/20 hover:border-white/40 bg-white/5 hover:bg-white/[0.08]'}`}
                >
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${isDragging ? 'bg-blue-500/30' : 'bg-white/10'}`}>
                    <UploadCloud className={`w-7 h-7 ${isDragging ? 'text-blue-300' : 'text-slate-400'}`} />
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-white text-sm">Drop photo here or tap to browse</p>
                    <p className="text-xs text-slate-500 mt-1">JPG · PNG · WEBP — front-facing, well-lit</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 max-w-md w-full">
                  {[
                    { t: 'Exact 35×45 mm', d: 'Indian passport standard' },
                    { t: '300 DPI lossless', d: 'Zoom without pixel break' },
                    { t: `${MAX_ROWS} rows / ${MAX_ROWS * PER_ROW} photos`, d: 'Mix different photos' },
                  ].map(c => (
                    <div key={c.t} className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                      <p className="text-xs font-semibold">{c.t}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{c.d}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Row cards */}
          <AnimatePresence initial={false}>
            {rows.map((row, idx) => {
              const othersTotal = rows.filter(r => r.id !== row.id).reduce((s, r) => s + r.copies, 0);
              const canInc = othersTotal + row.copies < MAX_ROWS;
              const canDec = row.copies > 1;
              return (
                <motion.div key={row.id}
                  initial={{ opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col gap-3"
                >
                  {/* Top row: number + status + delete */}
                  <div className="flex items-center gap-3">
                    <div className="shrink-0 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-xs font-bold text-slate-300">
                      {idx + 1}
                    </div>

                    <div className="flex-1 flex items-center gap-2 min-w-0 overflow-hidden">
                      {row.status === 'processing' && (
                        <div className="flex items-center gap-3 text-slate-400 text-sm">
                          <Loader2 className="w-5 h-5 animate-spin text-blue-400 shrink-0" />
                          <span className="truncate">Removing background &amp; cropping…</span>
                        </div>
                      )}

                      {row.status === 'done' && row.dataUrl && (
                        <>
                          {/* 5 thumbnail copies */}
                          <div className="flex gap-1 overflow-hidden">
                            {Array.from({ length: PER_ROW }, (_, i) => (
                              <div key={i}
                                className="shrink-0 rounded overflow-hidden border border-black/40"
                                style={{ width: 38, height: 49, background: '#fff' }}>
                                <img src={row.dataUrl!} alt="" className="w-full h-full object-cover block" style={{ background: '#fff' }} />
                              </div>
                            ))}
                          </div>
                          <div className="ml-1 shrink-0 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                            <button onClick={() => downloadSingleAsPng(row.canvas!, idx)}
                              className="text-xs text-slate-400 hover:text-white underline underline-offset-2 transition-colors whitespace-nowrap">
                              PNG
                            </button>
                          </div>
                        </>
                      )}

                      {row.status === 'error' && (
                        <div className="flex items-center gap-2 text-sm text-red-300 min-w-0">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span className="truncate">{row.error}</span>
                          <button onClick={() => retryRow(row.id)}
                            className="shrink-0 text-xs underline underline-offset-2 text-slate-400 hover:text-white">
                            Retry
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Delete */}
                    <button onClick={() => removeRow(row.id)}
                      className="shrink-0 w-7 h-7 rounded-lg bg-white/10 hover:bg-red-500/20 flex items-center justify-center text-slate-400 hover:text-red-300 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Copies counter — only shown when photo is done */}
                  {row.status === 'done' && (
                    <div className="flex items-center gap-3 pl-11">
                      {/* − */}
                      <button
                        onClick={() => setCopies(row.id, -1)}
                        disabled={!canDec}
                        className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/15 active:scale-95 flex items-center justify-center text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        aria-label="Remove copy"
                      >
                        <Minus className="w-4 h-4" />
                      </button>

                      {/* Counter */}
                      <div className="flex-1 max-w-[140px] bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-center select-none">
                        <motion.p key={row.copies} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                          className="text-lg font-bold text-white leading-none">
                          {row.copies}
                        </motion.p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {row.copies === 1 ? 'row' : 'rows'} · {row.copies * PER_ROW} photos
                        </p>
                      </div>

                      {/* + */}
                      <button
                        onClick={() => setCopies(row.id, +1)}
                        disabled={!canInc}
                        className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 active:scale-95 flex items-center justify-center text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-md shadow-blue-900/30"
                        aria-label="Add copy"
                      >
                        <Plus className="w-4 h-4" />
                      </button>

                      <p className="text-[10px] text-slate-600 ml-1">
                        {totalCopies}/{MAX_ROWS} rows used
                      </p>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Add row button */}
          {rows.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {canAdd ? (
                <button onClick={() => addFileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-dashed border-white/20 hover:border-blue-400/60 hover:bg-blue-500/5 text-slate-400 hover:text-blue-300 text-sm font-medium transition-all">
                  <Plus className="w-4 h-4" />
                  Add row {rows.length + 1} — upload different photo
                  <span className="text-slate-600 text-xs">({rows.length}/{MAX_ROWS})</span>
                </button>
              ) : (
                <p className="text-center text-xs text-slate-600 py-2">
                  Maximum {MAX_ROWS} rows reached ({MAX_ROWS * PER_ROW} photos on A4)
                </p>
              )}
            </motion.div>
          )}

        </div>

        {/* ── A4 Preview — below on mobile, sidebar on desktop ── */}
        {(doneRows.length > 0 || rows.some(r => r.status === 'processing')) && (
          <div className="flex flex-col shrink-0 border-t lg:border-t-0 lg:border-l border-white/10 p-5 gap-4 w-full lg:w-72 xl:w-80">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-300">A4 Preview</p>
              <p className="text-[11px] text-slate-500">
                {doneRows.length}/{rows.length} row{rows.length !== 1 ? 's' : ''} ready
              </p>
            </div>

            {/* A4 ratio 210:297 — constrained height on mobile so it doesn't dominate */}
            <div
              className="rounded-lg shadow-2xl overflow-hidden mx-auto w-full"
              style={{ aspectRatio: '210/297', maxWidth: 260, background: '#fff' }}
            >
              {a4DataUrl
                ? <img src={a4DataUrl} alt="A4 preview" className="w-full h-full object-contain block" style={{ background: '#fff' }} />
                : <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs" style={{ background: '#fff' }}>Building…</div>
              }
            </div>

            <p className="text-[10px] text-slate-600 text-center">
              {A4_W}×{A4_H} px · 300 DPI · Lossless PNG
            </p>

            <button onClick={handleDownloadA4} disabled={doneRows.length === 0}
              className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-lg shadow-blue-900/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              <Download className="w-4 h-4" />
              Download A4 PDF · {totalCopies} row{totalCopies !== 1 ? 's' : ''} · {totalCopies * PER_ROW} photos
            </button>

            <p className="text-[10px] text-slate-600 text-center">Print at 300 DPI · A4 · No scaling</p>
          </div>
        )}
      </div>

      {/* Hidden file inputs */}
      <input ref={addFileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onAddFileChange} />
      <input ref={retryInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onRetryFileChange} />
    </div>
  );
}
