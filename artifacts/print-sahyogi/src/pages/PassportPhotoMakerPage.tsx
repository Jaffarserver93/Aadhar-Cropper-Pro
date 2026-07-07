import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UploadCloud, Download, AlertCircle, CheckCircle2, Plus, X, ImageIcon, Loader2,
} from 'lucide-react';

// ── Layout (300 DPI A4) ─────────────────────────────────────────────────────
const A4_W     = 2480;
const A4_H     = 3508;
const MARGIN_L = 60;
const MARGIN_T = 80;
const MARGIN_B = 80;
const PHOTO_W  = 413;   // 35 mm @ 300 DPI
const PHOTO_H  = 531;   // 45 mm @ 300 DPI
const PER_ROW  = 5;
const ROW_GAP  = 20;
const H_GAP    = Math.round((A4_W - MARGIN_L * 2 - PER_ROW * PHOTO_W) / (PER_ROW - 1));

let _max = 0;
while ((_max + 1) * PHOTO_H + _max * ROW_GAP <= A4_H - MARGIN_T - MARGIN_B) _max++;
const MAX_ROWS = _max; // 6

// ── remove.bg proxy ─────────────────────────────────────────────────────────
async function removeBg(file: File, signal: AbortSignal): Promise<Blob> {
  const form = new FormData();
  form.append('image_file', file);
  const res = await fetch('/api/removebg', { method: 'POST', body: form, signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 402) throw new Error('remove.bg quota exhausted — try again later.');
    if (res.status === 429) throw new Error('Too many requests — wait a moment and retry.');
    if (res.status === 503) throw new Error('Background removal service unavailable.');
    throw new Error(body.error || `Server error ${res.status}`);
  }
  return res.blob();
}

// ── Face detection ──────────────────────────────────────────────────────────
interface FaceBox { x: number; y: number; width: number; height: number }

/** Try browser FaceDetector API (Chrome/Android). Returns null if unsupported. */
async function detectFaceInOriginal(file: File): Promise<{ box: FaceBox; origW: number; origH: number } | null> {
  if (!('FaceDetector' in window)) return null;
  try {
    const bmp = await createImageBitmap(file);
    const origW = bmp.width, origH = bmp.height;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detector = new (window as any).FaceDetector({ fastMode: false, maxDetectedFaces: 3 });
    const faces: any[] = await detector.detect(bmp);
    bmp.close();
    if (!faces.length) return null;
    // Largest face wins
    const best = faces.reduce((a: any, b: any) =>
      b.boundingBox.width * b.boundingBox.height > a.boundingBox.width * a.boundingBox.height ? b : a
    );
    return { box: best.boundingBox as FaceBox, origW, origH };
  } catch {
    return null;
  }
}

/** Scan transparent PNG for the bounding box of non-transparent pixels (the subject).
 *  Returns null when no subject is found (fully transparent image). */
async function scanPersonBbox(bmp: ImageBitmap): Promise<{ top: number; bottom: number; left: number; right: number } | null> {
  const SCALE = 0.15;
  const sw = Math.max(1, Math.round(bmp.width * SCALE));
  const sh = Math.max(1, Math.round(bmp.height * SCALE));
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, sw, sh);
  const { data } = ctx.getImageData(0, 0, sw, sh);
  let top = sh, bottom = -1, left = sw, right = -1;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (data[(y * sw + x) * 4 + 3] > 20) {
        if (y < top)    top    = y;
        if (y > bottom) bottom = y;
        if (x < left)   left   = x;
        if (x > right)  right  = x;
      }
    }
  }
  if (bottom < 0 || right < 0) return null; // no subject found
  return {
    top:    Math.round(top    / SCALE),
    bottom: Math.round(bottom / SCALE),
    left:   Math.round(left   / SCALE),
    right:  Math.round(right  / SCALE),
  };
}

// ── Smart passport crop ─────────────────────────────────────────────────────
/**
 * ICAO passport crop:
 *  - Head height = 70-80 % of frame height (target 75 %)
 *  - Between-eyes (eye-line) at ~35 % from top
 *  - Subject horizontally centred
 */
async function makePassportCanvas(file: File, bgBlob: Blob): Promise<HTMLCanvasElement> {
  // 1 — attempt face detection on the original (before bg removal)
  const faceResult = await detectFaceInOriginal(file);

  // 2 — render bg-removed bitmap
  const bgBmp = await createImageBitmap(bgBlob);
  const srcW = bgBmp.width, srcH = bgBmp.height;

  try {
    let cropX = 0, cropY = 0, cropW = srcW, cropH = srcH;

    if (faceResult) {
      // ── Path A: FaceDetector gave us an accurate bounding box ────────────
      const { box, origW, origH } = faceResult;
      // Scale face box to bg-removed dimensions (remove.bg may resize)
      const sx = srcW / origW, sy = srcH / origH;
      const fX = box.x * sx, fY = box.y * sy;
      const fW = box.width * sx, fH = box.height * sy;

      // Extend face box upward ~30 % to include forehead → estimate head height
      const headH = fH * 1.35;
      const faceCX = fX + fW / 2;
      const eyeY   = fY + fH * 0.45; // mid-eyes ≈ 45 % down the face box

      // Scale: head fills 75 % of PHOTO_H
      const scale = (PHOTO_H * 0.75) / headH;
      cropW = PHOTO_W / scale;
      cropH = PHOTO_H / scale;

      // Eye-line at 35 % from top of passport frame
      cropY = eyeY - (PHOTO_H * 0.35) / scale;
      cropX = faceCX - cropW / 2;

    } else {
      // ── Path B: heuristic — scan transparent silhouette bounding box ──────
      const bbox = await scanPersonBbox(bgBmp);
      const MIN_HEAD_PX = 40; // prevent divide-by-near-zero zoom

      if (bbox) {
        const pW = Math.max(1, bbox.right  - bbox.left);
        const pH = Math.max(1, bbox.bottom - bbox.top);
        const cx = bbox.left + pW / 2;

        // Guess head fraction from aspect ratio (taller body → smaller fraction)
        const ar = pH / pW;
        const headFrac = ar > 3.0 ? 0.15 : ar > 1.8 ? 0.25 : ar > 1.0 ? 0.38 : 0.65;
        const headH = Math.max(MIN_HEAD_PX, pH * headFrac);

        const scale  = (PHOTO_H * 0.75) / headH;
        cropW = Math.max(1, PHOTO_W / scale);
        cropH = Math.max(1, PHOTO_H / scale);

        const headTopY = bbox.top;
        const headCY   = headTopY + headH * 0.50;
        cropY = headCY - (PHOTO_H * 0.35) / scale;
        cropX = cx - cropW / 2;
        // else: bbox null (fully transparent) → keep default full-frame centre crop
      }
    }

    // Clamp within source bounds — ensure positive, in-bounds dimensions
    cropX = Math.max(0, Math.min(srcW - 1, cropX));
    cropY = Math.max(0, Math.min(srcH - 1, cropY));
    cropW = Math.max(1, Math.min(srcW - cropX, cropW));
    cropH = Math.max(1, Math.min(srcH - cropY, cropH));

    // 3 — render onto passport canvas
    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_W; canvas.height = PHOTO_H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PHOTO_W, PHOTO_H);
    ctx.drawImage(bgBmp, cropX, cropY, cropW, cropH, 0, 0, PHOTO_W, PHOTO_H);

    // 1 px hairline black border (cut guide)
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, PHOTO_W - 1, PHOTO_H - 1);

    return canvas;
  } finally {
    bgBmp.close();
  }
}

// ── A4 builder (each row can be a different photo) ──────────────────────────
function buildA4Canvas(canvases: HTMLCanvasElement[]): HTMLCanvasElement {
  const a4 = document.createElement('canvas');
  a4.width = A4_W; a4.height = A4_H;
  const ctx = a4.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, A4_W, A4_H);
  canvases.forEach((pc, rowIdx) => {
    const y = MARGIN_T + rowIdx * (PHOTO_H + ROW_GAP);
    for (let col = 0; col < PER_ROW; col++) {
      ctx.drawImage(pc, MARGIN_L + col * (PHOTO_W + H_GAP), y, PHOTO_W, PHOTO_H);
    }
  });
  return a4;
}

function downloadCanvas(canvas: HTMLCanvasElement, name: string) {
  const a = document.createElement('a');
  a.download = name;
  a.href = canvas.toDataURL('image/png');
  a.click();
}

function friendlyError(err: unknown): string {
  if ((err as DOMException)?.name === 'AbortError') return '';
  if (err instanceof TypeError && /fetch|network/i.test(err.message))
    return 'Network error — check your connection and try again.';
  return (err as Error)?.message || 'Something went wrong.';
}

// ── Types ────────────────────────────────────────────────────────────────────
interface PhotoRow {
  id: string;
  status: 'processing' | 'done' | 'error';
  canvas: HTMLCanvasElement | null;
  dataUrl: string | null;
  error: string | null;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function PassportPhotoMakerPage() {
  const [rows,       setRows]       = useState<PhotoRow[]>([]);
  const [a4DataUrl,  setA4DataUrl]  = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const addFileInputRef = useRef<HTMLInputElement>(null);
  const abortMap        = useRef<Map<string, AbortController>>(new Map());

  // ── Deterministic A4 rebuild: fires on every rows change ──────────────────
  useEffect(() => {
    const canvases = rows.filter(r => r.status === 'done' && r.canvas).map(r => r.canvas!);
    if (!canvases.length) { setA4DataUrl(null); return; }
    setA4DataUrl(buildA4Canvas(canvases).toDataURL('image/jpeg', 0.92));
  }, [rows]);

  // Cleanup all in-flight requests on unmount
  useEffect(() => () => abortMap.current.forEach(c => c.abort()), []);

  // ── Process a file into a new or existing row ──────────────────────────────
  const processFile = useCallback(async (file: File, rowId?: string) => {
    if (!file.type.startsWith('image/')) return;

    const id = rowId ?? crypto.randomUUID();
    // Abort any prior in-flight request for this row (handles retry safely)
    abortMap.current.get(id)?.abort();
    const ctrl = new AbortController();
    abortMap.current.set(id, ctrl);

    // Insert or update row as "processing"
    const processingRow: PhotoRow = { id, status: 'processing', canvas: null, dataUrl: null, error: null };
    setRows(prev => {
      const idx = prev.findIndex(r => r.id === id);
      if (idx >= 0) { const next = [...prev]; next[idx] = processingRow; return next; }
      return [...prev, processingRow];
    });

    try {
      const bgBlob = await removeBg(file, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const canvas = await makePassportCanvas(file, bgBlob);
      if (ctrl.signal.aborted) return;
      const doneRow: PhotoRow = { id, status: 'done', canvas, dataUrl: canvas.toDataURL('image/png'), error: null };
      setRows(prev => prev.map(r => r.id === id ? doneRow : r));
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      const errorRow: PhotoRow = { id, status: 'error', canvas: null, dataUrl: null, error: friendlyError(err) };
      setRows(prev => prev.map(r => r.id === id ? errorRow : r));
    } finally {
      abortMap.current.delete(id);
    }
  }, []);

  const removeRow = (id: string) => {
    abortMap.current.get(id)?.abort();
    setRows(prev => prev.filter(r => r.id !== id));
  };

  const handleDownloadA4 = () => {
    const canvases = rows.filter(r => r.canvas).map(r => r.canvas!);
    if (!canvases.length) return;
    downloadCanvas(buildA4Canvas(canvases), `passport-sheet-${canvases.length}rows.png`);
  };

  const handleDownloadSingle = (row: PhotoRow) => {
    if (row.canvas) downloadCanvas(row.canvas, `passport-photo-row${rows.indexOf(row) + 1}.png`);
  };

  const openAddPicker = () => addFileInputRef.current?.click();

  const onAddFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
    e.target.value = '';
  };

  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true);  };
  const onDragLeave = ()                    => setIsDragging(false);
  const onDrop      = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && rows.length < MAX_ROWS) processFile(f);
  };

  const doneRows = rows.filter(r => r.status === 'done');
  const canAdd   = rows.length < MAX_ROWS;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white flex flex-col">

      {/* ── Header ── */}
      <div className="border-b border-white/10 bg-slate-900/60 backdrop-blur-sm px-6 py-3.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
            <ImageIcon className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-sm">Passport Photo Maker</h1>
            <p className="text-[11px] text-slate-400">35×45 mm · White BG · 1 px border · Face-aware crop · A4 print</p>
          </div>
        </div>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">Beta</span>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: Row manager ── */}
        <div className="flex-1 flex flex-col overflow-y-auto px-6 py-6 gap-4 min-w-0">

          <AnimatePresence>
            {rows.length === 0 && (
              <motion.div key="empty"
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-16 gap-6"
              >
                <div className="text-center space-y-2">
                  <h2 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
                    Upload your first photo
                  </h2>
                  <p className="text-slate-400 text-sm max-w-sm">
                    We'll detect your face, remove the background, add a white background, and lay 5 copies on each row of an A4 sheet.
                  </p>
                </div>

                {/* Drop zone */}
                <div
                  className={`w-full max-w-md border-2 border-dashed rounded-2xl p-12 flex flex-col items-center gap-3 cursor-pointer transition-all
                    ${isDragging ? 'border-blue-400 bg-blue-500/10' : 'border-white/20 hover:border-white/40 bg-white/5 hover:bg-white/[0.08]'}`}
                  onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
                  onClick={openAddPicker}
                >
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${isDragging ? 'bg-blue-500/30' : 'bg-white/10'}`}>
                    <UploadCloud className={`w-7 h-7 ${isDragging ? 'text-blue-300' : 'text-slate-400'}`} />
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-white text-sm">Drop photo here or click to browse</p>
                    <p className="text-xs text-slate-500 mt-1">JPG · PNG · WEBP — front-facing, well-lit</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 max-w-md w-full">
                  {[
                    { t: 'Face detection', d: 'Auto-zooms & centres your face' },
                    { t: '35 × 45 mm', d: 'Indian passport standard' },
                    { t: `Up to ${MAX_ROWS} rows`, d: `${MAX_ROWS * PER_ROW} photos on A4` },
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
            {rows.map((row, idx) => (
              <motion.div key={row.id}
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ duration: 0.22 }}
                className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center gap-4"
              >
                {/* Row label */}
                <div className="shrink-0 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-xs font-bold text-slate-300">
                  {idx + 1}
                </div>

                {/* Thumbnails / status */}
                <div className="flex-1 flex items-center gap-2 min-w-0 overflow-hidden">
                  {row.status === 'processing' && (
                    <div className="flex items-center gap-3 text-slate-400 text-sm">
                      <Loader2 className="w-5 h-5 animate-spin text-blue-400 shrink-0" />
                      <span>Removing background &amp; cropping face…</span>
                    </div>
                  )}

                  {row.status === 'done' && row.dataUrl && (
                    <>
                      {/* 5 thumbnail copies */}
                      <div className="flex gap-1.5 overflow-hidden">
                        {Array.from({ length: PER_ROW }, (_, i) => (
                          <div key={i}
                            className="shrink-0 rounded overflow-hidden border border-black/30"
                            style={{ width: 44, height: 57 }}>
                            <img src={row.dataUrl!} alt="" className="w-full h-full object-cover" />
                          </div>
                        ))}
                      </div>
                      <div className="ml-2 flex items-center gap-2 shrink-0">
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                        <button onClick={() => handleDownloadSingle(row)}
                          className="text-xs text-slate-400 hover:text-white underline underline-offset-2 transition-colors">
                          Save single
                        </button>
                      </div>
                    </>
                  )}

                  {row.status === 'error' && (
                    <div className="flex items-center gap-2 text-sm text-red-300">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span className="truncate">{row.error}</span>
                    </div>
                  )}
                </div>

                {/* Delete */}
                <button onClick={() => removeRow(row.id)}
                  className="shrink-0 w-7 h-7 rounded-lg bg-white/10 hover:bg-red-500/20 flex items-center justify-center text-slate-400 hover:text-red-300 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Add Row button */}
          {rows.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {canAdd ? (
                <button onClick={openAddPicker}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-white/20 hover:border-blue-400/60 hover:bg-blue-500/5 text-slate-400 hover:text-blue-300 text-sm font-medium transition-all">
                  <Plus className="w-4 h-4" />
                  Add row {rows.length + 1} — upload different photo
                  <span className="text-slate-600 text-xs">({rows.length}/{MAX_ROWS} rows)</span>
                </button>
              ) : (
                <p className="text-center text-xs text-slate-600 py-2">Maximum {MAX_ROWS} rows on A4 reached</p>
              )}
            </motion.div>
          )}
        </div>

        {/* ── Right: A4 Preview ── */}
        {(doneRows.length > 0 || rows.some(r => r.status === 'processing')) && (
          <div className="w-72 xl:w-80 shrink-0 border-l border-white/10 flex flex-col p-5 gap-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-300">A4 Preview</p>
              <p className="text-[11px] text-slate-500">{doneRows.length} of {rows.length} row{rows.length > 1 ? 's' : ''} ready</p>
            </div>

            {/* A4 aspect 210:297 */}
            <div className="bg-white rounded-lg shadow-2xl overflow-hidden" style={{ aspectRatio: '210/297' }}>
              {a4DataUrl
                ? <img src={a4DataUrl} alt="A4 preview" className="w-full h-full object-contain" />
                : <div className="w-full h-full bg-white flex items-center justify-center text-slate-300 text-xs">Building…</div>
              }
            </div>

            <p className="text-[10px] text-slate-600 text-center">
              Preview · Output: {A4_W}×{A4_H} px (300 DPI)
            </p>

            <button onClick={handleDownloadA4} disabled={doneRows.length === 0}
              className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-lg shadow-blue-900/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
              <Download className="w-4 h-4" />
              Download A4 ({doneRows.length} row{doneRows.length !== 1 ? 's' : ''} · {doneRows.length * PER_ROW} photos)
            </button>

            <p className="text-[10px] text-slate-600 text-center">Print at 300 DPI · A4 · No scaling</p>
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input ref={addFileInputRef} type="file" accept="image/*" className="hidden" onChange={onAddFileChange} />
    </div>
  );
}
