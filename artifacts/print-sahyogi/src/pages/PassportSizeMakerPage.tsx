import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UploadCloud, Download, AlertCircle, CheckCircle2, X, Loader2, Plus, Minus, ImageIcon, ArrowLeft, Sun,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { useLocation } from 'wouter';
import { getSession, upsertSession } from '@/lib/passportHistory';

// ── Layout — exact 35×45 mm at 300 DPI ──────────────────────────────────────
const A4_W     = 2480;
const A4_H     = 3508;
const MARGIN_T = 90;
const MARGIN_B = 90;
const H_GAP    = 10;
const ROW_GAP  = 24;
const PER_ROW  = 5;
const PHOTO_W  = Math.round(35 * 300 / 25.4);   // 413 px = 35 mm
const PHOTO_H  = Math.round(45 * 300 / 25.4);   // 531 px = 45 mm
const MARGIN_L = Math.round((A4_W - PER_ROW * PHOTO_W - (PER_ROW - 1) * H_GAP) / 2);
const BORDER   = Math.round(300 / 25.4 * 0.5);  // 0.5 mm border ≈ 6 px

let _max = 0;
while ((_max + 1) * PHOTO_H + _max * ROW_GAP <= A4_H - MARGIN_T - MARGIN_B) _max++;
const MAX_ROWS = _max; // 6

// ── PicWish HD background removal proxy ────────────────────────────────────
async function removeBg(file: File, signal: AbortSignal): Promise<Blob> {
  const form = new FormData();
  form.append('image_file', file);
  const res = await fetch('/api/removebg', { method: 'POST', body: form, signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 402) throw new Error('Background removal quota exhausted — try again later.');
    if (res.status === 429) throw new Error('Too many requests — wait a moment and retry.');
    throw new Error(body.error || `Server error ${res.status}`);
  }
  return res.blob();
}

// ── Smart alpha-channel head detection ────────────────────────────────────────
// Scans the top 18% of the person's bounding box to measure head width,
// avoiding shoulder-width inflation. Works for all source photo types
// (headshots, half-body, full standing).
function analyzePersonAlpha(
  srcW: number, srcH: number,
  pixels: Uint8ClampedArray,
  sampledW: number, sampledH: number,
): { headTop: number; centerX: number; headHeight: number } | null {
  let minY = sampledH, maxY = 0, minX = sampledW, maxX = 0;
  for (let y = 0; y < sampledH; y++) {
    for (let x = 0; x < sampledW; x++) {
      if (pixels[(y * sampledW + x) * 4 + 3] > 30) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  if (minY >= maxY || minX >= maxX) return null;

  // Scan top 18% of person height — captures skull, avoids shoulder width
  const headScanBottom = Math.round(minY + (maxY - minY) * 0.18);
  let headMinX = sampledW, headMaxX = 0;
  for (let y = minY; y <= headScanBottom; y++) {
    for (let x = 0; x < sampledW; x++) {
      if (pixels[(y * sampledW + x) * 4 + 3] > 30) {
        if (x < headMinX) headMinX = x;
        if (x > headMaxX) headMaxX = x;
      }
    }
  }
  if (headMinX >= headMaxX) { headMinX = minX; headMaxX = maxX; }

  const sx = srcW / sampledW, sy = srcH / sampledH;
  const headTop      = minY * sy;
  const headWidthSrc = (headMaxX - headMinX) * sx;
  const centerX      = ((headMinX + headMaxX) / 2) * sx;
  const headHeight   = headWidthSrc * 1.25; // face aspect ratio h:w ≈ 1.25

  return { headTop, centerX, headHeight };
}

async function makePassportCanvas(_file: File, bgBlob: Blob): Promise<HTMLCanvasElement> {
  const bgBmp = await createImageBitmap(bgBlob);
  const srcW = bgBmp.width, srcH = bgBmp.height;
  try {
    // Scan at reduced resolution for speed
    const SCAN_MAX = 500;
    const scaleF   = Math.min(1, SCAN_MAX / Math.max(srcW, srcH));
    const sampledW = Math.round(srcW * scaleF);
    const sampledH = Math.round(srcH * scaleF);
    const scanCanvas = document.createElement('canvas');
    scanCanvas.width = sampledW; scanCanvas.height = sampledH;
    const scanCtx = scanCanvas.getContext('2d')!;
    scanCtx.drawImage(bgBmp, 0, 0, sampledW, sampledH);
    const pixels = scanCtx.getImageData(0, 0, sampledW, sampledH).data;

    const info = analyzePersonAlpha(srcW, srcH, pixels, sampledW, sampledH);

    // Layout: 7% above head | 55% head (vertical) | 38% neck+shoulders
    //         head fills 58% of frame width (wider = more side space)
    const HEAD_SPACE  = 0.07;
    const FACE_FILL_V = 0.55;
    const FACE_FILL_H = 0.58;

    let cropX: number, cropY: number, cropW: number, cropH: number;
    if (info) {
      const headWidthSrc = info.headHeight / 1.25;
      cropH = info.headHeight / FACE_FILL_V;
      cropW = headWidthSrc / FACE_FILL_H;
      cropY = info.headTop - HEAD_SPACE * cropH;
      cropX = info.centerX - cropW / 2;
    } else {
      // Fallback: center cover-fit
      const targetAr = PHOTO_W / PHOTO_H;
      const srcAr    = srcW / srcH;
      cropX = 0; cropY = 0; cropW = srcW; cropH = srcH;
      if (srcAr > targetAr) { cropW = srcH * targetAr; cropX = (srcW - cropW) / 2; }
      else                  { cropH = srcW / targetAr; cropY = (srcH - cropH) / 2; }
    }

    cropX = Math.max(0, Math.min(srcW - cropW, cropX));
    cropY = Math.max(0, Math.min(srcH - cropH, cropY));
    cropW = Math.min(cropW, srcW - cropX);
    cropH = Math.min(cropH, srcH - cropY);

    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_W; canvas.height = PHOTO_H;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PHOTO_W, PHOTO_H);
    ctx.drawImage(bgBmp, cropX, cropY, cropW, cropH, BORDER, BORDER, PHOTO_W - 2 * BORDER, PHOTO_H - 2 * BORDER);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, PHOTO_W, BORDER);
    ctx.fillRect(0, PHOTO_H - BORDER, PHOTO_W, BORDER);
    ctx.fillRect(0, BORDER, BORDER, PHOTO_H - 2 * BORDER);
    ctx.fillRect(PHOTO_W - BORDER, BORDER, BORDER, PHOTO_H - 2 * BORDER);
    return canvas;
  } finally { bgBmp.close(); }
}

function buildA4Canvas(entries: { canvas: HTMLCanvasElement; copies: number; brightness: number }[]): HTMLCanvasElement {
  const a4 = document.createElement('canvas');
  a4.width = A4_W; a4.height = A4_H;
  const ctx = a4.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, A4_W, A4_H);
  let rowIdx = 0;
  for (const { canvas, copies, brightness } of entries) {
    ctx.filter = brightness === 100 ? 'none' : `brightness(${brightness}%)`;
    for (let c = 0; c < copies; c++) {
      const y = MARGIN_T + rowIdx * (PHOTO_H + ROW_GAP);
      for (let col = 0; col < PER_ROW; col++)
        ctx.drawImage(canvas, MARGIN_L + col * (PHOTO_W + H_GAP), y, PHOTO_W, PHOTO_H);
      rowIdx++;
    }
  }
  ctx.filter = 'none';
  return a4;
}

function downloadPdf(entries: { canvas: HTMLCanvasElement; copies: number; brightness: number }[], totalRows: number) {
  const imgData = buildA4Canvas(entries).toDataURL('image/png');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false });
  pdf.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'NONE');
  pdf.save(`passport-photos-${totalRows}rows-${totalRows * PER_ROW}copies.pdf`);
}

function friendlyError(err: unknown): string {
  if ((err as DOMException)?.name === 'AbortError') return '';
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) return 'Network error — check your connection.';
  return (err as Error)?.message || 'Something went wrong.';
}

function canvasFromDataUrl(dataUrl: string): Promise<HTMLCanvasElement> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = PHOTO_W; c.height = PHOTO_H;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PHOTO_W, PHOTO_H);
      ctx.drawImage(img, 0, 0, PHOTO_W, PHOTO_H);
      resolve(c);
    };
    img.src = dataUrl;
  });
}

interface PhotoRow {
  id: string;
  status: 'processing' | 'done' | 'error';
  canvas: HTMLCanvasElement | null;
  dataUrl: string | null;
  error: string | null;
  copies: number;
  brightness: number;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PassportSizeMakerPage() {
  const [rows,        setRows]        = useState<PhotoRow[]>([]);
  const [a4DataUrl,   setA4DataUrl]   = useState<string | null>(null);
  const [isDragging,  setIsDragging]  = useState(false);
  const [useWhiteBg,  setUseWhiteBg]  = useState(true);
  const [location, navigate] = useLocation();

  const addFileRef   = useRef<HTMLInputElement>(null);
  const retryFileRef = useRef<HTMLInputElement>(null);
  const abortMap     = useRef<Map<string, AbortController>>(new Map());
  const restoredRef  = useRef(false);

  // Extract session ID from URL: /passport-size-maker/{id}
  const sessionId = (() => {
    const m = location.match(/\/passport-size-maker\/([^/]+)/);
    return m?.[1] ?? null;
  })();

  const totalCopies = rows.reduce((s, r) => s + r.copies, 0);
  const canAdd      = totalCopies < MAX_ROWS;
  const doneRows    = rows.filter(r => r.status === 'done');

  // Rebuild A4 preview whenever rows change
  useEffect(() => {
    const entries = rows.filter(r => r.status === 'done' && r.canvas).map(r => ({ canvas: r.canvas!, copies: r.copies, brightness: r.brightness }));
    if (!entries.length) { setA4DataUrl(null); return; }
    setA4DataUrl(buildA4Canvas(entries).toDataURL('image/png'));
  }, [rows]);

  // If no session ID in URL, redirect to a new UUID session
  useEffect(() => {
    if (!sessionId) {
      navigate(`/passport-size-maker/${crypto.randomUUID()}`, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore existing session from localStorage on first mount
  useEffect(() => {
    if (!sessionId || restoredRef.current) return;
    restoredRef.current = true;
    const session = getSession(sessionId);
    if (!session?.photos.length) return;
    Promise.all(
      session.photos.map(async p => {
        const canvas = await canvasFromDataUrl(p.dataUrl);
        return { id: crypto.randomUUID(), status: 'done' as const, canvas, dataUrl: p.dataUrl, error: null, copies: p.copies, brightness: p.brightness };
      })
    ).then(restored => setRows(restored));
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save to localStorage whenever done rows change
  useEffect(() => {
    if (!sessionId || doneRows.length === 0) return;
    const existing = getSession(sessionId);
    upsertSession({
      id: sessionId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      photos: doneRows.map(r => ({ dataUrl: r.dataUrl!, brightness: r.brightness, copies: r.copies })),
    });
  }, [doneRows, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => abortMap.current.forEach(c => c.abort()), []);

  const processFile = useCallback(async (file: File, rowId?: string, whiteBgOverride?: boolean) => {
    if (!file.type.startsWith('image/')) return;
    const id = rowId ?? crypto.randomUUID();
    abortMap.current.get(id)?.abort();
    const ctrl = new AbortController();
    abortMap.current.set(id, ctrl);

    const processing: PhotoRow = { id, status: 'processing', canvas: null, dataUrl: null, error: null, copies: 1, brightness: 100 };
    setRows(prev => {
      const idx = prev.findIndex(r => r.id === id);
      if (idx >= 0) { const n = [...prev]; n[idx] = { ...n[idx], ...processing, copies: n[idx].copies, brightness: n[idx].brightness }; return n; }
      return [...prev, processing];
    });

    try {
      // When whiteBg is ON → call remove.bg; when OFF → use original file (saves credits)
      const shouldRemoveBg = whiteBgOverride !== undefined ? whiteBgOverride : useWhiteBg;
      const bgBlob: Blob = shouldRemoveBg
        ? await removeBg(file, ctrl.signal)
        : file;
      if (ctrl.signal.aborted) return;
      const canvas = await makePassportCanvas(file, bgBlob);
      if (ctrl.signal.aborted) return;
      const done: PhotoRow = { id, status: 'done', canvas, dataUrl: canvas.toDataURL('image/png'), error: null, copies: 1, brightness: 100 };
      setRows(prev => prev.map(r => r.id === id ? { ...done, copies: r.copies, brightness: r.brightness } : r));
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      const error: PhotoRow = { id, status: 'error', canvas: null, dataUrl: null, error: friendlyError(err), copies: 1, brightness: 100 };
      setRows(prev => prev.map(r => r.id === id ? { ...error, copies: r.copies, brightness: r.brightness } : r));
    } finally { abortMap.current.delete(id); }
  }, [useWhiteBg]);

  const removeRow = (id: string) => { abortMap.current.get(id)?.abort(); setRows(prev => prev.filter(r => r.id !== id)); };
  const retryRow  = (id: string) => { retryFileRef.current?.setAttribute('data-row-id', id); retryFileRef.current?.click(); };

  const setCopies = (id: string, delta: number) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const others = prev.filter(x => x.id !== id).reduce((s, x) => s + x.copies, 0);
      return { ...r, copies: Math.min(MAX_ROWS - others, Math.max(1, r.copies + delta)) };
    }));
  };

  const setBrightness = (id: string, value: number) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, brightness: value } : r));

  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop      = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f && canAdd) processFile(f); };

  const handleDownload = () => {
    const entries = rows.filter(r => r.canvas).map(r => ({ canvas: r.canvas!, copies: r.copies, brightness: r.brightness }));
    if (entries.length) downloadPdf(entries, totalCopies);
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Navbar />

      {/* Breadcrumb / back bar */}
      <div className="bg-gray-50 border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-2 text-sm text-gray-500">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 hover:text-primary transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            All Tools
          </button>
          <span className="text-gray-300">/</span>
          <span className="text-primary font-semibold">Passport Size Photo Maker</span>
        </div>
      </div>

      {/* Page header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-primary">
            Passport Size Photo Maker
          </h1>
          <p className="text-gray-500 mt-1 text-sm sm:text-base">
            Upload a photo — we remove the background, crop your face to exact <strong>35×45 mm</strong> Indian passport standard,
            and arrange up to <strong>{MAX_ROWS * PER_ROW} copies</strong> on an A4 sheet. All inside your browser.
          </p>
        </div>
      </div>

      {/* ── Tool ── */}
      <section className="flex-1 py-8 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto flex flex-col lg:flex-row gap-6 items-start">

          {/* ── Left: Controls ── */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">

            {/* Background removal toggle */}
            <div className="flex items-center justify-between bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-primary">AI White Background</span>
                <span className="text-xs text-gray-400 mt-0.5">
                  {useWhiteBg
                    ? 'ON — AI removes background in HD (uses API credit)'
                    : 'OFF — original photo cropped as-is (no credit used)'}
                </span>
              </div>
              <button
                role="switch"
                aria-checked={useWhiteBg}
                onClick={() => setUseWhiteBg(v => !v)}
                className={`relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent shrink-0
                  ${useWhiteBg ? 'bg-primary' : 'bg-gray-200'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200
                  ${useWhiteBg ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </div>

            {/* Upload zone */}
            {rows.length === 0 && (
              <div
                role="button" tabIndex={0}
                onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
                onClick={() => addFileRef.current?.click()}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && addFileRef.current?.click()}
                aria-label="Upload photo — click or press Enter to browse"
                className={`border-2 border-dashed rounded-2xl p-10 sm:p-14 flex flex-col items-center gap-4 cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent
                  ${isDragging ? 'border-accent bg-accent/5' : 'border-gray-200 hover:border-accent/50 hover:bg-gray-50'}`}
              >
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-colors
                  ${isDragging ? 'bg-accent/10' : 'bg-gray-100'}`}>
                  <UploadCloud className={`w-8 h-8 ${isDragging ? 'text-accent' : 'text-gray-400'}`} />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-primary text-base">Drop photo here or tap to browse</p>
                  <p className="text-sm text-gray-400 mt-1">JPG · PNG · WEBP — front-facing, well-lit</p>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); addFileRef.current?.click(); }}
                  className="mt-1 bg-primary text-white text-sm font-semibold px-6 py-2.5 rounded-full shadow-sm hover:bg-primary/90 transition-all"
                >
                  Choose Photo
                </button>
              </div>
            )}

            {/* Row cards */}
            <AnimatePresence initial={false}>
              {rows.map((row, idx) => {
                const othersTotal = rows.filter(r => r.id !== row.id).reduce((s, r) => s + r.copies, 0);
                const canInc = othersTotal + row.copies < MAX_ROWS;
                const canDec = row.copies > 1;
                return (
                  <motion.div key={row.id}
                    initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8, scale: 0.97 }} transition={{ duration: 0.2 }}
                    className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden"
                  >
                    {/* Card header */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50/60">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {idx + 1}
                      </div>
                      <span className="text-sm font-semibold text-primary flex-1">
                        Photo {idx + 1}
                        {row.status === 'done' && (
                          <span className="ml-2 text-xs font-normal text-gray-400">{row.copies} row{row.copies !== 1 ? 's' : ''} · {row.copies * PER_ROW} copies</span>
                        )}
                      </span>
                      <button onClick={() => removeRow(row.id)} aria-label={`Remove photo ${idx + 1}`}
                        className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-red-50 flex items-center justify-center text-gray-400 hover:text-red-400 transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Card body */}
                    <div className="px-4 py-4 flex flex-col gap-4">
                      {/* Processing */}
                      {row.status === 'processing' && (
                        <div className="flex items-center gap-3 text-gray-500 text-sm py-2">
                          <Loader2 className="w-5 h-5 animate-spin text-accent shrink-0" />
                          <span>Removing background &amp; cropping face…</span>
                        </div>
                      )}

                      {/* Done */}
                      {row.status === 'done' && row.dataUrl && (
                        <>
                          {/* 5 thumbnails */}
                          <div className="flex gap-2 overflow-hidden">
                            {Array.from({ length: PER_ROW }, (_, i) => (
                              <div key={i}
                                className="flex-1 rounded-lg overflow-hidden border border-gray-200 shadow-sm"
                                style={{ aspectRatio: '35/45', background: '#fff' }}>
                                <img
                                  src={row.dataUrl!} alt=""
                                  className="w-full h-full object-cover block"
                                  style={{ background: '#fff', filter: row.brightness !== 100 ? `brightness(${row.brightness}%)` : undefined }}
                                />
                              </div>
                            ))}
                          </div>

                          {/* Brightness slider */}
                          <div className="flex items-center gap-3">
                            <Sun className="w-4 h-4 text-gray-400 shrink-0" />
                            <input
                              type="range" min={50} max={160} step={1}
                              value={row.brightness}
                              onChange={e => setBrightness(row.id, Number(e.target.value))}
                              className="flex-1 h-1.5 rounded-full accent-primary cursor-pointer"
                            />
                            <button
                              onClick={() => setBrightness(row.id, 100)}
                              className="text-[11px] text-gray-400 hover:text-primary transition-colors w-8 text-right shrink-0"
                            >
                              {row.brightness}%
                            </button>
                          </div>

                          {/* Copies counter */}
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setCopies(row.id, -1)} disabled={!canDec}
                              className="w-10 h-10 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 active:scale-95 flex items-center justify-center text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
                            >
                              <Minus className="w-4 h-4" />
                            </button>

                            <div className="flex-1 max-w-[180px] bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-center select-none">
                              <motion.p key={row.copies} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                                className="text-xl font-bold text-primary">
                                {row.copies}
                              </motion.p>
                              <p className="text-[11px] text-gray-400 mt-0.5">
                                {row.copies === 1 ? 'row' : 'rows'} · {row.copies * PER_ROW} photos
                              </p>
                            </div>

                            <button
                              onClick={() => setCopies(row.id, +1)} disabled={!canInc}
                              className="w-10 h-10 rounded-xl bg-primary hover:bg-primary/90 active:scale-95 flex items-center justify-center text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
                            >
                              <Plus className="w-4 h-4" />
                            </button>

                            <div className="flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                              <span className="text-xs text-gray-400">{totalCopies}/{MAX_ROWS} rows</span>
                            </div>
                          </div>
                        </>
                      )}

                      {/* Error */}
                      {row.status === 'error' && (
                        <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span className="flex-1 truncate">{row.error}</span>
                          <button onClick={() => retryRow(row.id)}
                            className="shrink-0 text-xs font-medium text-primary hover:underline">
                            Retry
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {/* Add row */}
            {rows.length > 0 && (
              <div>
                {canAdd ? (
                  <button onClick={() => addFileRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-gray-200 hover:border-accent/60 hover:bg-accent/5 text-gray-400 hover:text-accent text-sm font-medium transition-all">
                    <Plus className="w-4 h-4" />
                    Add photo {rows.length + 1} — different person
                    <span className="text-gray-300 text-xs">({totalCopies}/{MAX_ROWS} rows used)</span>
                  </button>
                ) : (
                  <p className="text-center text-xs text-gray-400 py-2">
                    A4 sheet full — {MAX_ROWS} rows / {MAX_ROWS * PER_ROW} photos maximum
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Right: A4 Preview ── */}
          {(doneRows.length > 0 || rows.some(r => r.status === 'processing')) && (
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              className="w-full lg:w-64 xl:w-72 shrink-0 flex flex-col gap-4"
            >
              {/* Preview card */}
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-primary">A4 Preview</p>
                  <p className="text-[11px] text-gray-400">
                    {doneRows.length}/{rows.length} ready
                  </p>
                </div>

                {/* A4 210:297 */}
                <div
                  className="rounded-lg overflow-hidden border border-gray-200 shadow-inner mx-auto w-full"
                  style={{ aspectRatio: '210/297', background: '#fff' }}
                >
                  {a4DataUrl
                    ? <img src={a4DataUrl} alt="A4 preview" className="w-full h-full object-contain block" style={{ background: '#fff' }} />
                    : <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs bg-gray-50">Building…</div>
                  }
                </div>

                <p className="text-[10px] text-gray-400 text-center">{A4_W}×{A4_H} px · 300 DPI · Lossless</p>
              </div>

              {/* Download button */}
              <button
                onClick={handleDownload} disabled={doneRows.length === 0}
                className="flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold bg-primary text-white hover:bg-primary/90 shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                Download A4 PDF
              </button>
              <p className="text-[10px] text-gray-400 text-center -mt-2">
                {totalCopies} row{totalCopies !== 1 ? 's' : ''} · {totalCopies * PER_ROW} photos · Print at 100%
              </p>
            </motion.div>
          )}
        </div>
      </section>

      {/* ── How it works strip ── */}
      <section className="bg-gray-50 border-t border-gray-100 py-10 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-center text-lg font-bold text-primary mb-6">How it works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {[
              { n: '1', t: 'Upload', d: 'Select a clear, front-facing photo in JPG, PNG or WEBP format.' },
              { n: '2', t: 'Auto-process', d: 'We remove the background and crop your face to passport standard.' },
              { n: '3', t: 'Set copies', d: 'Use − and + to choose how many rows (5 photos each) you need.' },
              { n: '4', t: 'Download', d: 'Get a 300 DPI lossless A4 PDF, ready to print and cut.' },
            ].map(s => (
              <div key={s.n} className="bg-white border border-gray-100 rounded-xl p-4 text-center shadow-sm">
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center mx-auto mb-2">{s.n}</div>
                <p className="font-semibold text-primary text-sm mb-1">{s.t}</p>
                <p className="text-xs text-gray-400 leading-relaxed">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />

      {/* Hidden file inputs */}
      <input ref={addFileRef}   type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''; }} />
      <input ref={retryFileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; const id = retryFileRef.current?.getAttribute('data-row-id'); if (f && id) processFile(f, id); e.target.value = ''; }} />
    </div>
  );
}
