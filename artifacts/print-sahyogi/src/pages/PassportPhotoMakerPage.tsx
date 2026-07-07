import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UploadCloud,
  Loader2,
  Download,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Plus,
  Minus,
  ImageIcon,
  WifiOff,
} from 'lucide-react';

// ── Layout constants (300 DPI A4) ──────────────────────────────────────────
const A4_W      = 2480;
const A4_H      = 3508;
const MARGIN_L  = 60;
const MARGIN_T  = 80;
const MARGIN_B  = 80;
const PHOTO_W   = 413;   // 35mm @ 300 DPI
const PHOTO_H   = 531;   // 45mm @ 300 DPI
const PER_ROW   = 5;
const ROW_GAP   = 20;
const H_GAP = Math.round((A4_W - MARGIN_L * 2 - PER_ROW * PHOTO_W) / (PER_ROW - 1));

// How many rows actually fit inside the A4 margins
let _maxRows = 0;
while ((_maxRows + 1) * PHOTO_H + _maxRows * ROW_GAP <= A4_H - MARGIN_T - MARGIN_B) _maxRows++;
export const MAX_ROWS = _maxRows; // ≈ 6

// ── remove.bg proxy (API key lives only on the server) ─────────────────────
async function removeBg(file: File, signal: AbortSignal): Promise<Blob> {
  const form = new FormData();
  form.append('image_file', file);
  const res = await fetch('/api/removebg', { method: 'POST', body: form, signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 402) throw new Error('remove.bg quota exhausted. Please try again later.');
    if (res.status === 429) throw new Error('Too many requests. Please wait a moment and try again.');
    if (res.status === 503) throw new Error('Background removal service is not available right now.');
    throw new Error(body.error || `Server error ${res.status}`);
  }
  return res.blob();
}

// ── Canvas helpers ──────────────────────────────────────────────────────────
/** Centre-crop to 35:45, white background, output at PHOTO_W × PHOTO_H */
async function makePassportCanvas(sourceBlob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(sourceBlob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width  = PHOTO_W;
    canvas.height = PHOTO_H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PHOTO_W, PHOTO_H);

    const targetRatio = PHOTO_W / PHOTO_H;
    const srcRatio    = bmp.width / bmp.height;
    let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
    if (srcRatio > targetRatio) {
      sw = Math.round(bmp.height * targetRatio);
      sx = Math.round((bmp.width - sw) / 2);
    } else {
      sh = Math.round(bmp.width / targetRatio);
      sy = Math.round((bmp.height - sh) / 2);
    }
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, PHOTO_W, PHOTO_H);

    // 1 mm black border (cut guide) — standard for Indian passport photos
    // 1 mm @ 300 DPI = 11.81 px ≈ 12 px. strokeRect is centred on the path,
    // so offset by half lineWidth (6 px) to keep the stroke fully inside the canvas.
    const BORDER_PX = 12; // 1 mm at 300 DPI
    ctx.strokeStyle = '#000000';
    ctx.lineWidth   = BORDER_PX;
    ctx.strokeRect(BORDER_PX / 2, BORDER_PX / 2, PHOTO_W - BORDER_PX, PHOTO_H - BORDER_PX);

    return canvas;
  } finally {
    bmp.close(); // release GPU resources
  }
}

/** Build the full A4 canvas with N rows of the passport photo */
function buildA4Canvas(photoCanvas: HTMLCanvasElement, rows: number): HTMLCanvasElement {
  const a4 = document.createElement('canvas');
  a4.width  = A4_W;
  a4.height = A4_H;
  const ctx = a4.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, A4_W, A4_H);
  for (let row = 0; row < rows; row++) {
    const y = MARGIN_T + row * (PHOTO_H + ROW_GAP);
    for (let col = 0; col < PER_ROW; col++) {
      const x = MARGIN_L + col * (PHOTO_W + H_GAP);
      ctx.drawImage(photoCanvas, x, y, PHOTO_W, PHOTO_H);
    }
  }
  return a4;
}

function downloadCanvas(canvas: HTMLCanvasElement, name: string) {
  const link = document.createElement('a');
  link.download = name;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// ── Error message prettifier ────────────────────────────────────────────────
function friendlyError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') return '';
  if (err instanceof TypeError && /fetch|network/i.test(err.message))
    return 'Network error — please check your connection and try again.';
  return (err as Error).message || 'Something went wrong. Please try again.';
}

// ── UI ──────────────────────────────────────────────────────────────────────
type Stage = 'upload' | 'processing' | 'preview';

export default function PassportPhotoMakerPage() {
  const [stage,        setStage]        = useState<Stage>('upload');
  const [error,        setError]        = useState<string | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [a4DataUrl,    setA4DataUrl]    = useState<string | null>(null);
  const [rows,         setRows]         = useState(2);
  const [isDragging,   setIsDragging]   = useState(false);

  const fileInputRef    = useRef<HTMLInputElement>(null);
  const photoCanvasRef  = useRef<HTMLCanvasElement | null>(null);
  const abortRef        = useRef<AbortController | null>(null);

  // Cancel any in-flight request when component unmounts
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const processFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (JPG, PNG, WEBP, etc.).');
      return;
    }
    // Cancel previous in-flight request if any
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setError(null);
    setStage('processing');
    try {
      const bgRemoved    = await removeBg(file, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const passportCanvas = await makePassportCanvas(bgRemoved);
      if (ctrl.signal.aborted) return;
      photoCanvasRef.current = passportCanvas;
      setPhotoDataUrl(passportCanvas.toDataURL('image/png'));
      const a4 = buildA4Canvas(passportCanvas, 2);
      setA4DataUrl(a4.toDataURL('image/jpeg', 0.92));
      setRows(2);
      setStage('preview');
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      setError(friendlyError(err));
      setStage('upload');
    }
  }, []);

  const handleRowChange = (newRows: number) => {
    if (!photoCanvasRef.current) return;
    const clamped = Math.max(1, Math.min(MAX_ROWS, newRows));
    setRows(clamped);
    setA4DataUrl(buildA4Canvas(photoCanvasRef.current, clamped).toDataURL('image/jpeg', 0.92));
  };

  const handleDownload = () => {
    if (!photoCanvasRef.current) return;
    downloadCanvas(buildA4Canvas(photoCanvasRef.current, rows), `passport-photos-${rows}rows.png`);
  };

  const handleDownloadSingle = () => {
    if (photoCanvasRef.current) downloadCanvas(photoCanvasRef.current, 'passport-photo-35x45mm.png');
  };

  const reset = () => {
    abortRef.current?.abort();
    setStage('upload');
    setPhotoDataUrl(null);
    setA4DataUrl(null);
    setError(null);
    photoCanvasRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true);  };
  const onDragLeave = ()                    => setIsDragging(false);
  const onDrop      = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f); };
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) processFile(f); };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white">

      {/* ── Header ── */}
      <div className="border-b border-white/10 bg-slate-900/60 backdrop-blur-sm px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow">
            <ImageIcon className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-white text-sm">Passport Photo Maker</h1>
            <p className="text-[11px] text-slate-400">35 × 45 mm · White background · A4 print sheet</p>
          </div>
        </div>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
          Beta
        </span>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-10">
        <AnimatePresence mode="wait">

          {/* ── Upload ── */}
          {stage === 'upload' && (
            <motion.div key="upload"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
              className="flex flex-col items-center gap-6"
            >
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
                  Upload Your Photo
                </h2>
                <p className="text-slate-400 text-sm max-w-md">
                  We'll automatically remove the background, crop to 35×45 mm, and place your photos on an A4 print sheet.
                </p>
              </div>

              {/* Drop zone */}
              <div
                className={`relative w-full max-w-lg border-2 border-dashed rounded-2xl p-14 flex flex-col items-center gap-4 cursor-pointer transition-all duration-200
                  ${isDragging
                    ? 'border-blue-400 bg-blue-500/10'
                    : 'border-white/20 hover:border-white/40 bg-white/5 hover:bg-white/[0.08]'}`}
                onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-colors ${isDragging ? 'bg-blue-500/30' : 'bg-white/10'}`}>
                  <UploadCloud className={`w-8 h-8 transition-colors ${isDragging ? 'text-blue-300' : 'text-slate-400'}`} />
                </div>
                <div className="text-center">
                  <p className="font-medium text-white">Drop photo here</p>
                  <p className="text-sm text-slate-400 mt-1">or click to browse</p>
                </div>
                <p className="text-xs text-slate-500">JPG · PNG · WEBP — face should be front-facing &amp; well-lit</p>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
              </div>

              {/* Error */}
              {error && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="flex items-start gap-3 bg-red-500/15 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-300 max-w-lg w-full">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </motion.div>
              )}

              {/* Info cards */}
              <div className="grid grid-cols-3 gap-4 max-w-lg w-full mt-2">
                {[
                  { label: 'Auto BG removal', desc: 'AI removes background instantly' },
                  { label: '35 × 45 mm', desc: 'Standard passport photo size' },
                  { label: `Up to ${MAX_ROWS} rows / A4`, desc: `${MAX_ROWS * PER_ROW} photos on one sheet` },
                ].map(c => (
                  <div key={c.label} className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
                    <p className="text-xs font-semibold text-white">{c.label}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{c.desc}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Processing ── */}
          {stage === 'processing' && (
            <motion.div key="processing"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-6 py-24"
            >
              <div className="relative w-20 h-20">
                <div className="absolute inset-0 rounded-full border-4 border-blue-500/20" />
                <div className="absolute inset-0 rounded-full border-4 border-t-blue-400 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                <Loader2 className="absolute inset-0 m-auto w-8 h-8 text-blue-400 opacity-0" />
                <ImageIcon className="absolute inset-0 m-auto w-8 h-8 text-blue-400" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-white">Removing background…</p>
                <p className="text-sm text-slate-400 mt-1">Powered by remove.bg AI</p>
              </div>
              <button onClick={reset}
                className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors">
                Cancel
              </button>
            </motion.div>
          )}

          {/* ── Preview ── */}
          {stage === 'preview' && photoDataUrl && a4DataUrl && (
            <motion.div key="preview"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-8"
            >
              {/* Top bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-green-400">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-semibold text-white">Photo ready</span>
                </div>
                <button onClick={reset}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors">
                  <RefreshCw className="w-3.5 h-3.5" />
                  New photo
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-8">

                {/* ── Left panel ── */}
                <div className="flex flex-col gap-5">

                  {/* Single photo preview */}
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col items-center gap-4">
                    <p className="text-sm font-medium text-slate-300 self-start">Passport Photo (35×45 mm)</p>
                    <div className="relative shadow-xl rounded-lg overflow-hidden"
                      style={{
                        width: 140, height: Math.round(140 * PHOTO_H / PHOTO_W),
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='8' height='8' fill='%23aaa'/%3E%3Crect x='8' y='8' width='8' height='8' fill='%23aaa'/%3E%3Crect x='8' y='0' width='8' height='8' fill='%23eee'/%3E%3Crect x='0' y='8' width='8' height='8' fill='%23eee'/%3E%3C/svg%3E")`,
                        backgroundSize: '16px',
                      }}>
                      <img src={photoDataUrl} alt="Passport photo" className="w-full h-full object-cover" />
                    </div>
                    <button onClick={handleDownloadSingle}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-white/10 hover:bg-white/15 border border-white/15 text-white transition-colors">
                      <Download className="w-4 h-4" />
                      Download Single Photo
                    </button>
                  </div>

                  {/* Row selector */}
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col gap-4">
                    <div>
                      <p className="text-sm font-medium text-slate-300">Rows on A4 sheet</p>
                      <p className="text-xs text-slate-500 mt-0.5">Max {MAX_ROWS} rows · {PER_ROW} photos per row</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <button onClick={() => handleRowChange(rows - 1)} disabled={rows <= 1}
                        className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                        <Minus className="w-4 h-4" />
                      </button>
                      <div className="flex-1 text-center">
                        <span className="text-3xl font-bold text-white">{rows}</span>
                        <p className="text-xs text-slate-400 mt-0.5">{rows * PER_ROW} photos total</p>
                      </div>
                      <button onClick={() => handleRowChange(rows + 1)} disabled={rows >= MAX_ROWS}
                        className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    {/* Row pip track */}
                    <div className="flex gap-1.5">
                      {Array.from({ length: MAX_ROWS }, (_, i) => (
                        <button key={i} onClick={() => handleRowChange(i + 1)}
                          className={`flex-1 h-1.5 rounded-full transition-all ${i < rows ? 'bg-blue-400' : 'bg-white/15'}`} />
                      ))}
                    </div>
                  </div>

                  {/* Download A4 */}
                  <button onClick={handleDownload}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white shadow-lg shadow-blue-900/40 transition-all">
                    <Download className="w-4 h-4" />
                    Download A4 Sheet ({rows} rows · {rows * PER_ROW} photos)
                  </button>
                  <p className="text-xs text-slate-500 text-center -mt-2">
                    Print at 300 DPI · A4 paper · No scaling · Cut along edges
                  </p>
                </div>

                {/* ── A4 preview ── */}
                <div className="flex flex-col gap-3">
                  <p className="text-sm font-medium text-slate-300">A4 Sheet Preview</p>
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-start justify-center">
                    {/* A4 ratio: 210:297 */}
                    <div className="relative bg-white rounded-md shadow-2xl overflow-hidden"
                      style={{ width: '100%', maxWidth: 400, aspectRatio: '210/297' }}>
                      <img src={a4DataUrl} alt="A4 sheet preview" className="w-full h-full object-contain" />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 text-center">
                    Preview · Actual output is {A4_W}×{A4_H} px (300 DPI)
                  </p>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
