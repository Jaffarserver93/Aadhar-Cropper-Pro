import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UploadCloud, Download, AlertCircle, CheckCircle2, X, ImageIcon, Loader2, Minus, Plus, RefreshCw,
} from 'lucide-react';
import { jsPDF } from 'jspdf';

// ── Layout (300 DPI A4) ─────────────────────────────────────────────────────
const A4_W     = 2480;
const A4_H     = 3508;
const MARGIN_L = 117;
const MARGIN_T = 90;
const MARGIN_B = 90;
const H_GAP    = 7;
const ROW_GAP  = 24;
const PER_ROW  = 5;
const PHOTO_W  = Math.floor((A4_W - 2 * MARGIN_L - (PER_ROW - 1) * H_GAP) / PER_ROW);
const PHOTO_H  = Math.round(PHOTO_W * 45 / 35);

let _max = 0;
while ((_max + 1) * PHOTO_H + _max * ROW_GAP <= A4_H - MARGIN_T - MARGIN_B) _max++;
const MAX_ROWS = _max;

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
    const best = faces.reduce((a: any, b: any) =>
      b.boundingBox.width * b.boundingBox.height > a.boundingBox.width * a.boundingBox.height ? b : a
    );
    return { box: best.boundingBox as FaceBox, origW, origH };
  } catch {
    return null;
  }
}

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
  if (bottom < 0 || right < 0) return null;
  return {
    top:    Math.round(top    / SCALE),
    bottom: Math.round(bottom / SCALE),
    left:   Math.round(left   / SCALE),
    right:  Math.round(right  / SCALE),
  };
}

// ── Smart passport crop ─────────────────────────────────────────────────────
async function makePassportCanvas(file: File, bgBlob: Blob): Promise<HTMLCanvasElement> {
  const faceResult = await detectFaceInOriginal(file);
  const bgBmp = await createImageBitmap(bgBlob);
  const srcW = bgBmp.width, srcH = bgBmp.height;

  try {
    let cropX = 0, cropY = 0, cropW = srcW, cropH = srcH;

    if (faceResult) {
      const { box, origW, origH } = faceResult;
      const sx = srcW / origW, sy = srcH / origH;
      const fX = box.x * sx, fY = box.y * sy;
      const fW = box.width * sx, fH = box.height * sy;
      const headH = fH * 1.35;
      const faceCX = fX + fW / 2;
      const eyeY   = fY + fH * 0.45;
      const scale  = (PHOTO_H * 0.75) / headH;
      cropW = PHOTO_W / scale;
      cropH = PHOTO_H / scale;
      cropY = eyeY - (PHOTO_H * 0.35) / scale;
      cropX = faceCX - cropW / 2;
    } else {
      const bbox = await scanPersonBbox(bgBmp);
      const MIN_HEAD_PX = 40;
      if (bbox) {
        const pW = Math.max(1, bbox.right  - bbox.left);
        const pH = Math.max(1, bbox.bottom - bbox.top);
        const cx = bbox.left + pW / 2;
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
      }
    }

    cropX = Math.max(0, Math.min(srcW - 1, cropX));
    cropY = Math.max(0, Math.min(srcH - 1, cropY));
    cropW = Math.max(1, Math.min(srcW - cropX, cropW));
    cropH = Math.max(1, Math.min(srcH - cropY, cropH));

    // 1 mm border at 300 DPI = 300/25.4 ≈ 12 px
    const BORDER = Math.round(300 / 25.4); // 12 px

    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_W; canvas.height = PHOTO_H;
    const ctx = canvas.getContext('2d')!;

    // Fill white background (whole 35×45 mm)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PHOTO_W, PHOTO_H);

    // Draw photo content inside the 1 mm border (33×43 mm inner area)
    ctx.drawImage(
      bgBmp,
      cropX, cropY, cropW, cropH,
      BORDER, BORDER, PHOTO_W - 2 * BORDER, PHOTO_H - 2 * BORDER,
    );

    // Draw 1 mm solid black border on top (cutting guide)
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, PHOTO_W, BORDER);                        // top
    ctx.fillRect(0, PHOTO_H - BORDER, PHOTO_W, BORDER);         // bottom
    ctx.fillRect(0, BORDER, BORDER, PHOTO_H - 2 * BORDER);      // left
    ctx.fillRect(PHOTO_W - BORDER, BORDER, BORDER, PHOTO_H - 2 * BORDER); // right

    return canvas;
  } finally {
    bgBmp.close();
  }
}

// ── A4 builder ──────────────────────────────────────────────────────────────
function buildA4Canvas(canvas: HTMLCanvasElement, rowCount: number): HTMLCanvasElement {
  const a4 = document.createElement('canvas');
  a4.width = A4_W; a4.height = A4_H;
  const ctx = a4.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, A4_W, A4_H);
  for (let row = 0; row < rowCount; row++) {
    const y = MARGIN_T + row * (PHOTO_H + ROW_GAP);
    for (let col = 0; col < PER_ROW; col++) {
      ctx.drawImage(canvas, MARGIN_L + col * (PHOTO_W + H_GAP), y, PHOTO_W, PHOTO_H);
    }
  }
  return a4;
}

function downloadA4AsPdf(canvas: HTMLCanvasElement, rowCount: number) {
  const imgData = canvas.toDataURL('image/jpeg', 1.0);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false });
  pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
  pdf.save(`passport-sheet-${rowCount}rows-${rowCount * PER_ROW}photos.pdf`);
}

function friendlyError(err: unknown): string {
  if ((err as DOMException)?.name === 'AbortError') return '';
  if (err instanceof TypeError && /fetch|network/i.test(err.message))
    return 'Network error — check your connection and try again.';
  return (err as Error)?.message || 'Something went wrong.';
}

// ── Types ────────────────────────────────────────────────────────────────────
interface PhotoState {
  status: 'processing' | 'done' | 'error';
  canvas: HTMLCanvasElement | null;
  dataUrl: string | null;
  error: string | null;
}

// ── Component ────────────────────────────────────────────────────────────────
export default function PassportPhotoMakerPage() {
  const [photo,      setPhoto]      = useState<PhotoState | null>(null);
  const [rowCount,   setRowCount]   = useState(1);
  const [a4DataUrl,  setA4DataUrl]  = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef     = useRef<AbortController | null>(null);

  // Rebuild A4 whenever photo or rowCount changes
  useEffect(() => {
    if (!photo?.canvas) { setA4DataUrl(null); return; }
    setA4DataUrl(buildA4Canvas(photo.canvas, rowCount).toDataURL('image/jpeg', 0.92));
  }, [photo, rowCount]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const processFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setPhoto({ status: 'processing', canvas: null, dataUrl: null, error: null });
    setRowCount(1);

    try {
      const bgBlob = await removeBg(file, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const canvas = await makePassportCanvas(file, bgBlob);
      if (ctrl.signal.aborted) return;
      setPhoto({ status: 'done', canvas, dataUrl: canvas.toDataURL('image/png'), error: null });
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      setPhoto({ status: 'error', canvas: null, dataUrl: null, error: friendlyError(err) });
    }
  }, []);

  const clearPhoto = () => {
    abortRef.current?.abort();
    setPhoto(null);
    setRowCount(1);
    setA4DataUrl(null);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
    e.target.value = '';
  };

  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop      = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  };

  const decrement = () => setRowCount(c => Math.max(1, c - 1));
  const increment = () => setRowCount(c => Math.min(MAX_ROWS, c + 1));

  const handleDownload = () => {
    if (!photo?.canvas) return;
    downloadA4AsPdf(buildA4Canvas(photo.canvas, rowCount), rowCount);
  };

  const isDone       = photo?.status === 'done';
  const isProcessing = photo?.status === 'processing';

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
            <p className="text-[11px] text-slate-400 hidden sm:block">35×45 mm · White BG · 1 px border · Face-aware crop · A4 print</p>
          </div>
        </div>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">Beta</span>
      </div>

      {/* ── Body: stacks vertically on mobile, side-by-side on desktop ── */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-auto">

        {/* ── Left / Top: Controls ── */}
        <div className="flex-1 flex flex-col items-center justify-start px-4 sm:px-6 py-6 gap-6 min-w-0">

          {/* Upload zone — shown when no photo loaded */}
          <AnimatePresence>
            {!photo && (
              <motion.div key="upload"
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
                className="w-full max-w-lg flex flex-col items-center gap-5"
              >
                <div className="text-center space-y-1">
                  <h2 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
                    Upload your photo
                  </h2>
                  <p className="text-slate-400 text-sm">
                    We'll remove the background, crop your face, and arrange copies on A4.
                  </p>
                </div>

                <div
                  className={`w-full border-2 border-dashed rounded-2xl p-10 sm:p-14 flex flex-col items-center gap-3 cursor-pointer transition-all
                    ${isDragging ? 'border-blue-400 bg-blue-500/10' : 'border-white/20 hover:border-white/40 bg-white/5 hover:bg-white/[0.08]'}`}
                  onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${isDragging ? 'bg-blue-500/30' : 'bg-white/10'}`}>
                    <UploadCloud className={`w-7 h-7 ${isDragging ? 'text-blue-300' : 'text-slate-400'}`} />
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-white text-sm">Drop photo here or tap to browse</p>
                    <p className="text-xs text-slate-500 mt-1">JPG · PNG · WEBP — front-facing, well-lit</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 w-full">
                  {[
                    { t: 'Face detection', d: 'Auto-zooms & centres' },
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

          {/* Processing state */}
          <AnimatePresence>
            {isProcessing && (
              <motion.div key="processing"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 py-8"
              >
                <div className="w-16 h-16 rounded-2xl bg-blue-500/20 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
                </div>
                <div className="text-center">
                  <p className="font-medium text-white text-sm">Processing your photo…</p>
                  <p className="text-xs text-slate-400 mt-1">Removing background &amp; cropping face</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error state */}
          <AnimatePresence>
            {photo?.status === 'error' && (
              <motion.div key="error"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="w-full max-w-md bg-red-500/10 border border-red-500/30 rounded-2xl p-5 flex flex-col items-center gap-3 text-center"
              >
                <AlertCircle className="w-8 h-8 text-red-400" />
                <p className="text-sm text-red-300">{photo.error}</p>
                <div className="flex gap-2 mt-1">
                  <button onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-sm text-white transition-colors">
                    <RefreshCw className="w-3.5 h-3.5" /> Try again
                  </button>
                  <button onClick={clearPhoto}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm text-slate-400 transition-colors">
                    <X className="w-3.5 h-3.5" /> Clear
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Done state: photo strip + row counter */}
          <AnimatePresence>
            {isDone && photo?.dataUrl && (
              <motion.div key="done"
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="w-full max-w-lg flex flex-col gap-5"
              >

                {/* Photo thumbnails — rowCount rows of 5 */}
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                      <span className="text-sm font-medium text-slate-200">Your photo</span>
                    </div>
                    <button onClick={clearPhoto}
                      className="w-7 h-7 rounded-lg bg-white/10 hover:bg-red-500/20 flex items-center justify-center text-slate-400 hover:text-red-300 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* All rows of thumbnails */}
                  <div className="flex flex-col gap-2">
                    {Array.from({ length: rowCount }, (_, rowIdx) => (
                      <motion.div
                        key={rowIdx}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.18 }}
                        className="flex gap-1.5"
                      >
                        {Array.from({ length: PER_ROW }, (_, colIdx) => (
                          <div key={colIdx}
                            className="flex-1 rounded overflow-hidden border border-black/30"
                            style={{ aspectRatio: '35/45' }}>
                            <img src={photo.dataUrl!} alt="" className="w-full h-full object-cover" />
                          </div>
                        ))}
                      </motion.div>
                    ))}
                  </div>
                </div>

                {/* ── Row counter: − count + ── */}
                <div className="flex items-center justify-center gap-4">
                  {/* Minus */}
                  <button
                    onClick={decrement}
                    disabled={rowCount <= 1}
                    className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/10 hover:bg-white/15 active:scale-95 flex items-center justify-center text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg"
                    aria-label="Remove row"
                  >
                    <Minus className="w-5 h-5 sm:w-6 sm:h-6" />
                  </button>

                  {/* Counter display */}
                  <div className="flex-1 max-w-[180px] bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-center select-none">
                    <motion.p
                      key={rowCount}
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-2xl font-bold text-white"
                    >
                      {rowCount}
                    </motion.p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {rowCount === 1 ? 'row' : 'rows'} · {rowCount * PER_ROW} photos
                    </p>
                  </div>

                  {/* Plus */}
                  <button
                    onClick={increment}
                    disabled={rowCount >= MAX_ROWS}
                    className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 active:scale-95 flex items-center justify-center text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-900/30"
                    aria-label="Add row"
                  >
                    <Plus className="w-5 h-5 sm:w-6 sm:h-6" />
                  </button>
                </div>

                <p className="text-center text-[11px] text-slate-500">
                  Max {MAX_ROWS} rows ({MAX_ROWS * PER_ROW} photos) on A4
                </p>

                {/* Download — visible here on mobile, also in preview panel on desktop */}
                <button onClick={handleDownload}
                  className="lg:hidden flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-semibold bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-lg shadow-blue-900/30 transition-all">
                  <Download className="w-4 h-4" />
                  Download A4 PDF · {rowCount} row{rowCount !== 1 ? 's' : ''} · {rowCount * PER_ROW} photos
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Right: A4 Preview (desktop only sidebar) ── */}
        <AnimatePresence>
          {(isDone || isProcessing) && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              className="hidden lg:flex w-72 xl:w-80 shrink-0 border-l border-white/10 flex-col p-5 gap-4"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-300">A4 Preview</p>
                <p className="text-[11px] text-slate-500">
                  {isDone ? `${rowCount} row${rowCount !== 1 ? 's' : ''} · ${rowCount * PER_ROW} photos` : 'Processing…'}
                </p>
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

              <button onClick={handleDownload} disabled={!isDone}
                className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-lg shadow-blue-900/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                <Download className="w-4 h-4" />
                Download A4 PDF
              </button>

              <p className="text-[10px] text-slate-600 text-center">Print at 300 DPI · A4 · No scaling</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFileChange} />
    </div>
  );
}
