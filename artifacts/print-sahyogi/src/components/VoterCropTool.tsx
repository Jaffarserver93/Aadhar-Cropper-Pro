import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UploadCloud,
  FileType2,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  Printer,
  Download,
  RefreshCw,
  AlertCircle,
  Scissors,
  CheckCircle2,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

// ── Wide format (standard e-EPIC landscape/wide PDF) ─────────────────────────
// Coordinates in RENDER_SCALE=2 canvas space
const FRONT_CROP_WIDE     = { x: 254,    y: 740, w: 1904, h: 1196 } as const;
const BACK_CROP_WIDE      = { x: 2544,   y: 740, w: 1904, h: 1196 } as const;
// PDF-unit coordinates for high-quality re-render
const FRONT_CROP_PDF_WIDE = { x: 127,    y: 370, w: 952,  h: 598  } as const;
const BACK_CROP_PDF_WIDE  = { x: 1272,   y: 370, w: 952,  h: 598  } as const;

// ── Portrait A4 format (595×842 PDF units — newer e-EPIC single-page layout) ─
// Card images placed at Im1(32.5,593) and Im2(327,593) with w=245 h=154 PDF units
// Screen coords (scale 2, top-left origin): y = (842−593−154)×2 = 190
const FRONT_CROP_PORT     = { x: 65,     y: 190, w: 490,  h: 308  } as const;
const BACK_CROP_PORT      = { x: 654,    y: 190, w: 490,  h: 308  } as const;
const FRONT_CROP_PDF_PORT = { x: 32.5,   y: 95,  w: 245,  h: 154  } as const;
const BACK_CROP_PDF_PORT  = { x: 327,    y: 95,  w: 245,  h: 154  } as const;

type CropSet = {
  front:    { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  back:     { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  frontPdf: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  backPdf:  { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
};

// Quality render scale for the crop output.
// Voter ID cards are ~3.8× wider in PDF space than Aadhaar (952 vs 248 PDF units).
// Scale 20 → 19 040 × 11 960 px per card (~228 M pixels), just within Chrome's 268 M limit.
// Scale 40 → 911 M pixels — exceeds browser canvas limits, produces a blank output.
const CROP_SCALE = 20;

type Step = 1 | 2 | 3 | 4 | 5;

// ── Crop-box overlay ──────────────────────────────────────────────────────────
function CropBox({ style, label, color }: {
  style: React.CSSProperties;
  label: string;
  color: 'orange' | 'blue';
}) {
  const ring   = color === 'orange' ? 'ring-orange-400' : 'ring-blue-400';
  const border = color === 'orange' ? 'border-orange-400' : 'border-blue-400';
  const bg     = color === 'orange' ? 'bg-orange-400' : 'bg-blue-500';
  return (
    <div className="absolute pointer-events-none" style={style}>
      <div className={`absolute inset-0 rounded-sm ring-2 ${ring} ring-offset-0 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]`} />
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <div key={c} className={`absolute w-4 h-4 ${border} border-[3px]
          ${c === 'tl' ? 'top-0 left-0 border-r-0 border-b-0 rounded-tl-sm' : ''}
          ${c === 'tr' ? 'top-0 right-0 border-l-0 border-b-0 rounded-tr-sm' : ''}
          ${c === 'bl' ? 'bottom-0 left-0 border-r-0 border-t-0 rounded-bl-sm' : ''}
          ${c === 'br' ? 'bottom-0 right-0 border-l-0 border-t-0 rounded-br-sm' : ''}`}
        />
      ))}
      <span className={`absolute -top-6 left-0 text-[11px] font-semibold ${bg} text-white px-2 py-0.5 rounded-sm whitespace-nowrap shadow`}>
        {label}
      </span>
    </div>
  );
}

// ── Main tool ─────────────────────────────────────────────────────────────────
export function VoterCropTool() {
  const [step, setStep]               = useState<Step>(1);
  const [file, setFile]               = useState<File | null>(null);
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [password, setPassword]       = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const [pagePreviewDataUrl, setPagePreviewDataUrl] = useState<string | null>(null);
  const [pageCanvasWidth, setPageCanvasWidth]       = useState(0);

  const [frontImage, setFrontImage]   = useState<string | null>(null);
  const [backImage, setBackImage]     = useState<string | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);

  const fileInputRef      = useRef<HTMLInputElement>(null);
  const dropZoneRef       = useRef<HTMLDivElement>(null);
  const pdfDocRef         = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const pageCanvasRef     = useRef<HTMLCanvasElement | null>(null);
  const previewWrapperRef = useRef<HTMLDivElement>(null);
  // Holds the active crop coordinates — set synchronously on PDF load before any rendering
  const activeCropRef = useRef<CropSet>({
    front: FRONT_CROP_WIDE, back: BACK_CROP_WIDE,
    frontPdf: FRONT_CROP_PDF_WIDE, backPdf: BACK_CROP_PDF_WIDE,
  });

  type CropBoxes = { front: React.CSSProperties; back: React.CSSProperties } | null;
  const [cropBoxes, setCropBoxes] = useState<CropBoxes>(null);

  const updateOverlay = useCallback(() => {
    if (!previewWrapperRef.current || pageCanvasWidth === 0) return;
    const scale = previewWrapperRef.current.clientWidth / pageCanvasWidth;
    const c = activeCropRef.current;
    setCropBoxes({
      front: { left: c.front.x * scale, top: c.front.y * scale, width: c.front.w * scale, height: c.front.h * scale },
      back:  { left: c.back.x  * scale, top: c.back.y  * scale, width: c.back.w  * scale, height: c.back.h  * scale },
    });
  }, [pageCanvasWidth]);

  useEffect(() => {
    if (step !== 3) return;
    window.addEventListener('resize', updateOverlay);
    return () => window.removeEventListener('resize', updateOverlay);
  }, [step, updateOverlay]);

  // ── Drag & Drop ───────────────────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    dropZoneRef.current?.classList.add('border-accent', 'bg-accent/5');
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dropZoneRef.current?.classList.remove('border-accent', 'bg-accent/5');
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    handleDragLeave(e);
    await processFileSelection(e.dataTransfer.files[0]);
  };
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) await processFileSelection(f);
  };
  const processFileSelection = async (selectedFile: File) => {
    setError(null);
    if (selectedFile.type !== 'application/pdf') {
      setError('Please upload a valid PDF file.');
      return;
    }
    setFile(selectedFile);
    setArrayBuffer(await selectedFile.arrayBuffer());
  };

  // ── PDF rendering ─────────────────────────────────────────────────────────────
  const RENDER_SCALE = 2;

  const renderPageToCanvas = async (page: pdfjsLib.PDFPageProxy, scale = RENDER_SCALE) => {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d')!;
    canvas.width  = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    return canvas;
  };

  // Crop directly from the already-rendered preview canvas (used for overlay preview).
  const cropFromCanvas = (
    src: HTMLCanvasElement,
    crop: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  ) => {
    const sx = Math.round(crop.x), sy = Math.round(crop.y);
    const sw = Math.round(crop.w), sh = Math.round(crop.h);
    const out = document.createElement('canvas');
    out.width = sw; out.height = sh;
    const ctx = out.getContext('2d', { alpha: false })!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    return out;
  };

  // High-quality crop: renders ONLY the crop region at CROP_SCALE via viewport
  // offset — the full page is never allocated, so the canvas stays small.
  const renderCropRegion = async (
    page: pdfjsLib.PDFPageProxy,
    cropPdf: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  ) => {
    const pw = Math.ceil(cropPdf.w * CROP_SCALE);
    const ph = Math.ceil(cropPdf.h * CROP_SCALE);
    const offsetX = -Math.floor(cropPdf.x * CROP_SCALE);
    const offsetY = -Math.floor(cropPdf.y * CROP_SCALE);
    const viewport = page.getViewport({ scale: CROP_SCALE, offsetX, offsetY });
    const canvas = document.createElement('canvas');
    canvas.width = pw; canvas.height = ph;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pw, ph);
    await page.render({ canvasContext: ctx, canvas, viewport, intent: 'print' }).promise;
    return canvas;
  };

  const attemptLoadPDF = async (pdfPassword?: string) => {
    if (!arrayBuffer) return;
    setError(null);
    setIsProcessing(true);
    try {
      const pdf  = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0), password: pdfPassword }).promise;
      pdfDocRef.current = pdf;
      const page = await pdf.getPage(1);
      // Detect portrait A4 (≤700 PDF units wide) vs wide/landscape format
      const vp1 = page.getViewport({ scale: 1 });
      activeCropRef.current = vp1.width <= 700
        ? { front: FRONT_CROP_PORT, back: BACK_CROP_PORT, frontPdf: FRONT_CROP_PDF_PORT, backPdf: BACK_CROP_PDF_PORT }
        : { front: FRONT_CROP_WIDE, back: BACK_CROP_WIDE, frontPdf: FRONT_CROP_PDF_WIDE, backPdf: BACK_CROP_PDF_WIDE };
      const canvas = await renderPageToCanvas(page);
      pageCanvasRef.current = canvas;
      setPageCanvasWidth(canvas.width);
      setPagePreviewDataUrl(canvas.toDataURL('image/png'));
      setIsProcessing(false);
      setStep(3);
    } catch (err: any) {
      setIsProcessing(false);
      if (err.name === 'PasswordException') {
        if (pdfPassword) setError('Incorrect password, please try again.');
        setStep(2);
      } else {
        setError(err.message || 'Error processing PDF');
      }
    }
  };

  const handleConfirmCrop = async () => {
    if (!pdfDocRef.current) return;
    setIsProcessing(true);
    setStep(4);
    await processPDFPages(pdfDocRef.current);
  };

  // ── Canvas helpers ────────────────────────────────────────────────────────────
  const autoCropCanvas = (sourceCanvas: HTMLCanvasElement): HTMLCanvasElement => {
    const ctx = sourceCanvas.getContext('2d');
    if (!ctx) return sourceCanvas;
    const { width, height } = sourceCanvas;
    const { data } = ctx.getImageData(0, 0, width, height);
    const isContent = (i: number) => data[i + 3] >= 10 && (data[i] < 230 || data[i + 1] < 230 || data[i + 2] < 230);
    const ROW_MIN = Math.max(4, Math.round(width * 0.01));
    const COL_MIN = Math.max(4, Math.round(height * 0.01));
    const rowHasContent = (y: number) => { let n = 0; for (let x = 0; x < width; x++) if (isContent((y * width + x) * 4) && ++n >= ROW_MIN) return true; return false; };
    const colHasContent = (x: number) => { let n = 0; for (let y = 0; y < height; y++) if (isContent((y * width + x) * 4) && ++n >= COL_MIN) return true; return false; };
    let topRow = 0, bottomRow = height - 1, leftCol = 0, rightCol = width - 1;
    for (let y = 0; y < height; y++)      { if (rowHasContent(y)) { topRow = y; break; } }
    for (let y = height - 1; y >= 0; y--) { if (rowHasContent(y)) { bottomRow = y; break; } }
    for (let x = 0; x < width; x++)       { if (colHasContent(x)) { leftCol = x; break; } }
    for (let x = width - 1; x >= 0; x--) { if (colHasContent(x)) { rightCol = x; break; } }
    const PAD = 40;
    const minX = Math.max(0, leftCol - PAD), minY = Math.max(0, topRow - PAD);
    const maxX = Math.min(width, rightCol + PAD), maxY = Math.min(height, bottomRow + PAD);
    const out = document.createElement('canvas');
    out.width = maxX - minX; out.height = maxY - minY;
    out.getContext('2d')?.drawImage(sourceCanvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  };

  const extractSinglePageCards = async () => {
    const page = await pdfDocRef.current!.getPage(1);
    const { frontPdf, backPdf } = activeCropRef.current;
    const [front, back] = await Promise.all([
      renderCropRegion(page, frontPdf),
      renderCropRegion(page, backPdf),
    ]);
    return [front.toDataURL('image/png'), back.toDataURL('image/png')];
  };

  const processPDFPages = async (pdf: pdfjsLib.PDFDocumentProxy) => {
    try {
      const images: string[] = [];
      if (pdf.numPages === 1) {
        images.push(...(await extractSinglePageCards()));
      } else {
        for (let i = 1; i <= Math.min(pdf.numPages, 2); i++) {
          const page = await pdf.getPage(i);
          const canvas = await renderPageToCanvas(page, RENDER_SCALE);
          images.push(autoCropCanvas(canvas).toDataURL('image/png'));
        }
      }
      if (images[0]) setFrontImage(images[0]);
      if (images[1]) setBackImage(images[1]);
      await generateA4Preview(images);
      setIsProcessing(false);
      setStep(5);
    } catch (err: any) {
      setError('Failed to process images. ' + err.message);
      setIsProcessing(false);
      setStep(1);
    }
  };

  // ── A4 layout ─────────────────────────────────────────────────────────────────
  const generateA4Preview = (images: string[]): Promise<string> =>
    new Promise((resolve) => {
      const A4_W = 2382, A4_H = 3369;
      const a4Canvas = document.createElement('canvas');
      a4Canvas.width = A4_W; a4Canvas.height = A4_H;
      const ctx = a4Canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, A4_W, A4_H);

      const loadImg = (src: string) => new Promise<HTMLImageElement>((res) => {
        const img = new Image(); img.onload = () => res(img); img.src = src;
      });

      (async () => {
        const MARGIN = 90, GAP = 60;
        const slotH = Math.floor((A4_H - MARGIN * 2 - GAP * (images.length - 1)) / images.length);
        const slotW = A4_W - MARGIN * 2;
        for (let i = 0; i < images.length; i++) {
          const img = await loadImg(images[i]);
          const scale = Math.min(slotW / img.naturalWidth, slotH / img.naturalHeight);
          const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
          ctx.drawImage(img, MARGIN + (slotW - w) / 2, MARGIN + i * (slotH + GAP) + (slotH - h) / 2, w, h);
        }
        const dataUrl = a4Canvas.toDataURL('image/png');
        setPreviewDataUrl(dataUrl);
        resolve(dataUrl);
      })();
    });

  // ── Utilities ─────────────────────────────────────────────────────────────────
  const baseName = `EZONE_VoterID_${file?.name.replace(/\.pdf$/i, '') || 'card'}`;
  const triggerDownload = (dataUrl: string, filename: string) => {
    const link = document.createElement('a');
    link.href = dataUrl; link.download = filename;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleDownload      = () => { if (previewDataUrl) triggerDownload(previewDataUrl, `${baseName}_A4.png`); };
  const handleDownloadFront = () => { if (frontImage)     triggerDownload(frontImage,     `${baseName}_Front.png`); };
  const handleDownloadBack  = () => { if (backImage)      triggerDownload(backImage,      `${baseName}_Back.png`); };

  const resetTool = () => {
    setStep(1); setFile(null); setArrayBuffer(null); setPassword(''); setError(null);
    setFrontImage(null); setBackImage(null); setPreviewDataUrl(null);
    setPagePreviewDataUrl(null); setPageCanvasWidth(0); setCropBoxes(null);
    pdfDocRef.current = null; pageCanvasRef.current = null;
  };

  // ── Step renderers ────────────────────────────────────────────────────────────
  const renderStep1 = () => (
    <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
      className="flex flex-col items-center justify-center space-y-6">
      <div ref={dropZoneRef} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`w-full max-w-xl p-12 border-2 border-dashed rounded-3xl cursor-pointer transition-all duration-300 flex flex-col items-center justify-center text-center group ${
          file ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-accent hover:bg-gray-50'}`}>
        <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="application/pdf" className="hidden" />
        {file ? (
          <>
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <FileType2 className="h-8 w-8 text-green-600" />
            </div>
            <p className="text-lg font-medium text-gray-900">{file.name}</p>
            <p className="text-sm text-gray-500 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-accent/20 group-hover:scale-110 transition-all">
              <UploadCloud className="h-8 w-8 text-gray-500 group-hover:text-accent" />
            </div>
            <p className="text-lg font-medium text-gray-900 mb-2">Click to upload or drag and drop</p>
            <div className="inline-flex items-center px-3 py-1 rounded-full bg-gray-100 text-xs font-medium text-gray-600">PDF Files Only</div>
          </>
        )}
      </div>
      {error && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex items-center text-red-600 bg-red-50 px-4 py-2 rounded-lg">
          <AlertCircle className="h-5 w-5 mr-2" /><span className="text-sm font-medium">{error}</span>
        </motion.div>
      )}
      {file && (
        <button onClick={() => attemptLoadPDF()} disabled={isProcessing}
          className="bg-primary text-white px-8 py-3 rounded-xl font-medium shadow-md hover:bg-primary/90 transition-colors w-full max-w-xs disabled:opacity-60 flex items-center justify-center gap-2">
          {isProcessing ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Continue'}
        </button>
      )}
    </motion.div>
  );

  const renderStep2 = () => (
    <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
      className="flex flex-col items-center justify-center space-y-6 w-full max-w-md mx-auto">
      <div className="w-20 h-20 bg-amber-100 rounded-2xl flex items-center justify-center mb-2 shadow-inner">
        <Lock className="h-10 w-10 text-amber-600" />
      </div>
      <div className="text-center">
        <h3 className="text-2xl font-bold text-gray-900">Protected PDF</h3>
        <p className="text-gray-600 mt-2">Enter the password to unlock your Voter ID PDF.</p>
      </div>
      <div className="w-full relative">
        <input type={showPassword ? 'text' : 'password'} value={password}
          onChange={(e) => setPassword(e.target.value)} placeholder="Enter password..."
          className="w-full px-4 py-4 pr-12 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-accent focus:border-accent transition-all outline-none text-lg"
          onKeyDown={(e) => e.key === 'Enter' && attemptLoadPDF(password)} />
        <button onClick={() => setShowPassword(!showPassword)}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
          {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
      {error && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-red-500 text-sm font-medium">
          {error}
        </motion.div>
      )}
      <button onClick={() => attemptLoadPDF(password)} disabled={!password || isProcessing}
        className="w-full bg-primary text-white px-8 py-4 rounded-xl font-semibold shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center">
        {isProcessing ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Unlock PDF'}
      </button>
      <button onClick={resetTool} className="text-sm text-gray-500 hover:text-primary">Cancel and start over</button>
    </motion.div>
  );

  const renderStep3 = () => (
    <motion.div key="step3" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
      className="flex flex-col items-center w-full gap-6">
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 w-full max-w-2xl text-sm text-amber-800">
        <Scissors className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
        <span>
          Both crop areas are marked below —{' '}
          <strong className="text-orange-600">Front</strong> and{' '}
          <strong className="text-blue-600">Back</strong>. Confirm to crop both.
        </span>
      </div>
      <div className="w-full max-w-2xl bg-gray-100 rounded-2xl p-3 md:p-6 shadow-inner">
        <div ref={previewWrapperRef} className="relative w-full overflow-hidden rounded-lg shadow">
          {pagePreviewDataUrl && (
            <>
              <img src={pagePreviewDataUrl} alt="Voter ID PDF preview" className="w-full block" onLoad={updateOverlay} />
              {cropBoxes && (
                <>
                  <CropBox style={cropBoxes.front} label="Front" color="orange" />
                  <CropBox style={cropBoxes.back}  label="Back"  color="blue" />
                </>
              )}
            </>
          )}
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-2xl">
        <button onClick={handleConfirmCrop}
          className="flex-1 flex items-center justify-center gap-2 bg-primary text-white px-8 py-3 rounded-xl font-semibold shadow-md hover:bg-primary/90 transition-colors">
          <Scissors className="h-4 w-4" />Crop Now
        </button>
        <button onClick={resetTool}
          className="flex items-center justify-center gap-2 px-6 py-3 border-2 border-gray-200 text-gray-600 rounded-xl font-medium hover:bg-gray-50 transition">
          <RefreshCw className="h-4 w-4" />Start Over
        </button>
      </div>
    </motion.div>
  );

  const renderStep4 = () => (
    <motion.div key="step4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-12">
      <Loader2 className="h-16 w-16 text-accent animate-spin mb-6" />
      <h3 className="text-2xl font-bold text-gray-900">Processing Document</h3>
      <p className="text-gray-600 mt-2">Cropping and optimising for print…</p>
    </motion.div>
  );

  const renderStep5 = () => (
    <motion.div key="step5" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center w-full">
      {/* Actions row */}
      <div className="flex flex-col w-full max-w-4xl mb-6 gap-3 print:hidden">
        <div className="flex flex-col sm:flex-row justify-between gap-3">
          <div className="flex items-center space-x-3 text-green-600 font-semibold bg-green-50 px-4 py-2 rounded-lg">
            <CheckCircle2 className="h-5 w-5" /><span>Ready to Print!</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => window.print()}
              className="flex items-center px-5 py-2 bg-primary text-white rounded-lg font-medium shadow-sm hover:bg-primary/90 transition">
              <Printer className="h-4 w-4 mr-2" />Print A4
            </button>
            <button onClick={handleDownload} disabled={!previewDataUrl}
              className="flex items-center px-5 py-2 border-2 border-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed">
              <Download className="h-4 w-4 mr-2" />Save A4
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleDownloadFront} disabled={!frontImage}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 bg-orange-50 border-2 border-orange-200 text-orange-700 rounded-lg font-medium hover:bg-orange-100 transition disabled:opacity-50 disabled:cursor-not-allowed">
            <Download className="h-4 w-4" />Download Front
          </button>
          <button onClick={handleDownloadBack} disabled={!backImage}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-50 border-2 border-blue-200 text-blue-700 rounded-lg font-medium hover:bg-blue-100 transition disabled:opacity-50 disabled:cursor-not-allowed">
            <Download className="h-4 w-4" />Download Back
          </button>
        </div>
      </div>

      {/* A4 print preview */}
      <div className="w-full max-w-2xl bg-gray-100 p-4 md:p-8 rounded-2xl print:p-0 print:bg-white print:max-w-none">
        <div id="print-layout"
          className="bg-white shadow-xl mx-auto flex flex-col items-center justify-center print:shadow-none print:mx-0 overflow-hidden"
          style={{ aspectRatio: '794/1123', width: '100%', maxWidth: '794px' }}>
          {frontImage && (
            <img src={frontImage} alt="Voter ID Front" className="w-[85%] object-contain mt-12 mb-6" />
          )}
          {backImage && (
            <img src={backImage} alt="Voter ID Back" className="w-[85%] object-contain mb-12" />
          )}
        </div>
      </div>

      <div className="mt-10 print:hidden">
        <button onClick={resetTool} className="flex items-center text-gray-500 hover:text-primary font-medium">
          <RefreshCw className="h-4 w-4 mr-2" />Process Another Document
        </button>
      </div>
    </motion.div>
  );

  // ── Layout ────────────────────────────────────────────────────────────────────
  const STEP_LABELS = ['Upload', 'Unlock', 'Preview'];

  return (
    <section id="tools" className="py-24 bg-white min-h-[80vh] flex flex-col">
      <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 print:p-0">
        {step <= 3 && (
          <div className="mb-12 print:hidden">
            <h2 className="text-3xl font-bold text-center text-primary mb-8">Crop Tool</h2>
            <div className="flex items-center justify-center max-w-md mx-auto relative">
              <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-gray-100 -z-10" />
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-colors ${
                    step >= i ? 'bg-primary text-white shadow-md' : 'bg-white text-gray-300 border-2 border-gray-100'}`}>
                    {i}
                  </div>
                  <span className={`text-xs font-medium ${step >= i ? 'text-primary' : 'text-gray-300'}`}>
                    {STEP_LABELS[i - 1]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="w-full flex justify-center">
          <AnimatePresence mode="wait">
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 3 && renderStep3()}
            {step === 4 && renderStep4()}
            {step === 5 && renderStep5()}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
