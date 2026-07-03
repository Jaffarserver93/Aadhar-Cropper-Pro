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

// Configure pdfjs worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

/**
 * Fixed crop coordinates for the FRONT card (right side of the Aadhaar PDF).
 * These are canvas pixel coordinates at RENDER_SCALE = 2.
 */
const FRONT_CROP = {
  x: 101.404,
  y: 1149.72,
  w: 497.067,
  h: 313.6,
} as const;

// 1=Upload  2=Password  3=Preview (crop overlay)  4=Processing  5=Result
type Step = 1 | 2 | 3 | 4 | 5;

export function AadhaarCropTool() {
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Preview step state
  const [pagePreviewDataUrl, setPagePreviewDataUrl] = useState<string | null>(null);
  const [pageCanvasWidth, setPageCanvasWidth] = useState(0);

  // Result state
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const pageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewWrapperRef = useRef<HTMLDivElement>(null);

  // Overlay position in display pixels (computed after image renders)
  const [overlayStyle, setOverlayStyle] = useState<React.CSSProperties>({});

  const updateOverlay = useCallback(() => {
    if (!previewWrapperRef.current || pageCanvasWidth === 0) return;
    const displayW = previewWrapperRef.current.clientWidth;
    const scale = displayW / pageCanvasWidth;
    setOverlayStyle({
      left: FRONT_CROP.x * scale,
      top: FRONT_CROP.y * scale,
      width: FRONT_CROP.w * scale,
      height: FRONT_CROP.h * scale,
    });
  }, [pageCanvasWidth]);

  // Recompute overlay on window resize
  useEffect(() => {
    if (step !== 3) return;
    window.addEventListener('resize', updateOverlay);
    return () => window.removeEventListener('resize', updateOverlay);
  }, [step, updateOverlay]);

  // ── Drag & Drop ─────────────────────────────────────────────────────────────
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

  // ── PDF Loading ──────────────────────────────────────────────────────────────
  const RENDER_SCALE = 2;

  const renderPageToCanvas = async (
    page: pdfjsLib.PDFPageProxy,
  ): Promise<HTMLCanvasElement> => {
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    return canvas;
  };

  const attemptLoadPDF = async (pdfPassword?: string) => {
    if (!arrayBuffer) return;
    setError(null);
    setIsProcessing(true);

    try {
      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer.slice(0),
        password: pdfPassword,
      });

      const pdf = await loadingTask.promise;
      pdfDocRef.current = pdf;

      // Render page 1 for the crop-preview step
      const page = await pdf.getPage(1);
      const canvas = await renderPageToCanvas(page);
      pageCanvasRef.current = canvas;
      setPageCanvasWidth(canvas.width);
      setPagePreviewDataUrl(canvas.toDataURL('image/png'));

      setIsProcessing(false);
      setStep(3); // → Preview step
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

  // Called when user clicks "Crop Now" in the preview step
  const handleConfirmCrop = async () => {
    if (!pdfDocRef.current) return;
    setIsProcessing(true);
    setStep(4); // → Processing spinner
    await processPDFPages(pdfDocRef.current);
  };

  // ── Canvas helpers ───────────────────────────────────────────────────────────
  const sliceCanvas = (
    src: HTMLCanvasElement,
    x: number,
    y: number,
    w: number,
    h: number,
  ): HTMLCanvasElement => {
    const sx = Math.max(0, Math.floor(x));
    const sy = Math.max(0, Math.floor(y));
    const sw = Math.min(Math.ceil(w), src.width - sx);
    const sh = Math.min(Math.ceil(h), src.height - sy);
    if (sw <= 0 || sh <= 0) return src;
    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    out.getContext('2d')?.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    return out;
  };

  const autoCropCanvas = (sourceCanvas: HTMLCanvasElement): HTMLCanvasElement => {
    const ctx = sourceCanvas.getContext('2d');
    if (!ctx) return sourceCanvas;
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;
    const { data } = ctx.getImageData(0, 0, width, height);

    const isContent = (i: number): boolean => {
      if (data[i + 3] < 10) return false;
      return data[i] < 230 || data[i + 1] < 230 || data[i + 2] < 230;
    };

    const ROW_MIN = Math.max(4, Math.round(width * 0.01));
    const COL_MIN = Math.max(4, Math.round(height * 0.01));

    const rowHasContent = (y: number): boolean => {
      let n = 0;
      for (let x = 0; x < width; x++) {
        if (isContent((y * width + x) * 4) && ++n >= ROW_MIN) return true;
      }
      return false;
    };
    const colHasContent = (x: number): boolean => {
      let n = 0;
      for (let y = 0; y < height; y++) {
        if (isContent((y * width + x) * 4) && ++n >= COL_MIN) return true;
      }
      return false;
    };

    let topRow = 0;
    for (let y = 0; y < height; y++) { if (rowHasContent(y)) { topRow = y; break; } }
    let bottomRow = height - 1;
    for (let y = height - 1; y >= 0; y--) { if (rowHasContent(y)) { bottomRow = y; break; } }
    let leftCol = 0;
    for (let x = 0; x < width; x++) { if (colHasContent(x)) { leftCol = x; break; } }
    let rightCol = width - 1;
    for (let x = width - 1; x >= 0; x--) { if (colHasContent(x)) { rightCol = x; break; } }

    const PAD = 40;
    const minX = Math.max(0, leftCol - PAD);
    const minY = Math.max(0, topRow - PAD);
    const maxX = Math.min(width, rightCol + PAD);
    const maxY = Math.min(height, bottomRow + PAD);

    const out = document.createElement('canvas');
    out.width = maxX - minX;
    out.height = maxY - minY;
    out.getContext('2d')?.drawImage(
      sourceCanvas,
      minX, minY, out.width, out.height,
      0, 0, out.width, out.height,
    );
    return out;
  };

  // ── Card extraction ──────────────────────────────────────────────────────────
  /**
   * Single-page PDF: the front (right) card uses the fixed FRONT_CROP coordinates.
   * The back (left) card uses dynamic gap detection.
   * Returns [frontImage, backImage].
   */
  const extractSinglePageCards = async (
    page: pdfjsLib.PDFPageProxy,
  ): Promise<string[]> => {
    // Reuse cached canvas from the preview render if available
    let canvas = pageCanvasRef.current;
    if (!canvas) {
      canvas = await renderPageToCanvas(page);
      pageCanvasRef.current = canvas;
    }

    // ── Front card: fixed coordinates ────────────────────────────────────────
    const frontCanvas = sliceCanvas(
      canvas,
      FRONT_CROP.x, FRONT_CROP.y,
      FRONT_CROP.w, FRONT_CROP.h,
    );

    // ── Back card: dynamic gap detection ─────────────────────────────────────
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    const { data } = ctx.getImageData(0, 0, W, H);

    const isContent = (i: number): boolean => {
      if (data[i + 3] < 10) return false;
      return data[i] < 230 || data[i + 1] < 230 || data[i + 2] < 230;
    };

    // Find the band where both halves have content simultaneously
    const halfW = Math.floor(W / 2);
    const MIN_DENSITY = 0.01;
    const rowBothSides: boolean[] = new Array(H).fill(false);
    for (let y = 0; y < H; y++) {
      let leftCnt = 0, rightCnt = 0;
      for (let x = 0; x < W; x++) {
        if (isContent((y * W + x) * 4)) {
          if (x < halfW) leftCnt++; else rightCnt++;
        }
      }
      rowBothSides[y] =
        leftCnt / halfW > MIN_DENSITY &&
        rightCnt / (W - halfW) > MIN_DENSITY;
    }

    let bestStart = 0, bestLen = 0, curStart = 0, curLen = 0;
    for (let y = 0; y < H; y++) {
      if (rowBothSides[y]) {
        if (curLen === 0) curStart = y;
        curLen++;
        if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
      } else { curLen = 0; }
    }

    const PAD = 20;
    const bandY = bestLen > 50 ? Math.max(0, bestStart - PAD) : 0;
    const bandH = bestLen > 50 ? Math.min(H - bandY, bestLen + PAD * 2) : H;

    // Find minimum-density column (gap between cards)
    const scanL = Math.floor(W * 0.30);
    const scanR = Math.floor(W * 0.70);
    let minPx = Infinity, gapX = Math.floor(W / 2);
    for (let x = scanL; x < scanR; x++) {
      let cnt = 0;
      for (let y = bandY; y < bandY + bandH; y++) {
        if (isContent((y * W + x) * 4)) cnt++;
      }
      if (cnt < minPx) { minPx = cnt; gapX = x; }
    }

    // Back card occupies the opposite horizontal half
    const backCanvas = sliceCanvas(canvas, 0, bandY, gapX, bandH);

    return [
      autoCropCanvas(frontCanvas).toDataURL('image/png'),  // front (right side)
      autoCropCanvas(backCanvas).toDataURL('image/png'),   // back  (left side)
    ];
  };

  // ── PDF page processing ──────────────────────────────────────────────────────
  const processPDFPages = async (pdf: pdfjsLib.PDFDocumentProxy) => {
    try {
      const images: string[] = [];

      if (pdf.numPages === 1) {
        const page = await pdf.getPage(1);
        const cards = await extractSinglePageCards(page);
        images.push(...cards);
      } else {
        for (let i = 1; i <= Math.min(pdf.numPages, 2); i++) {
          const page = await pdf.getPage(i);
          const canvas = await renderPageToCanvas(page);
          images.push(autoCropCanvas(canvas).toDataURL('image/png'));
        }
      }

      if (images.length > 0) setFrontImage(images[0]);
      if (images.length > 1) setBackImage(images[1]);

      await generateA4Preview(images);
      setIsProcessing(false);
      setStep(5); // → Result
    } catch (err: any) {
      setError('Failed to process images. ' + err.message);
      setIsProcessing(false);
      setStep(1);
    }
  };

  // ── A4 layout generation ─────────────────────────────────────────────────────
  // Front card goes on TOP, back card below — full A4 width, no cutting.
  const generateA4Preview = (images: string[]): Promise<string> => {
    return new Promise((resolve) => {
      const A4_WIDTH = 794;
      const A4_HEIGHT = 1123;

      const a4Canvas = document.createElement('canvas');
      a4Canvas.width = A4_WIDTH;
      a4Canvas.height = A4_HEIGHT;
      const ctx = a4Canvas.getContext('2d');
      if (!ctx) { resolve(''); return; }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);

      const loadImg = (src: string): Promise<HTMLImageElement> =>
        new Promise((res) => {
          const img = new Image();
          img.onload = () => res(img);
          img.src = src;
        });

      const drawImages = async () => {
        const MARGIN = 30;
        const GAP = 20;
        const numCards = images.length;
        const slotH = Math.floor((A4_HEIGHT - MARGIN * 2 - GAP * (numCards - 1)) / numCards);
        const slotW = A4_WIDTH - MARGIN * 2;

        const containDraw = (img: HTMLImageElement, slotX: number, slotY: number) => {
          const scale = Math.min(slotW / img.naturalWidth, slotH / img.naturalHeight);
          const w = img.naturalWidth * scale;
          const h = img.naturalHeight * scale;
          ctx.drawImage(img, slotX + (slotW - w) / 2, slotY + (slotH - h) / 2, w, h);
        };

        for (let i = 0; i < images.length; i++) {
          const img = await loadImg(images[i]);
          containDraw(img, MARGIN, MARGIN + i * (slotH + GAP));
        }

        const dataUrl = a4Canvas.toDataURL('image/png');
        setPreviewDataUrl(dataUrl);
        resolve(dataUrl);
      };

      drawImages();
    });
  };

  // ── Utilities ────────────────────────────────────────────────────────────────
  const handleDownload = () => {
    if (!previewDataUrl) return;
    const link = document.createElement('a');
    link.href = previewDataUrl;
    link.download = `Print_Sahyogi_${file?.name.replace('.pdf', '') || 'Aadhaar'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const resetTool = () => {
    setStep(1);
    setFile(null);
    setArrayBuffer(null);
    setPassword('');
    setError(null);
    setFrontImage(null);
    setBackImage(null);
    setPreviewDataUrl(null);
    setPagePreviewDataUrl(null);
    setPageCanvasWidth(0);
    setOverlayStyle({});
    pdfDocRef.current = null;
    pageCanvasRef.current = null;
  };

  // ── Step renderers ───────────────────────────────────────────────────────────

  // Step 1 — Upload
  const renderStep1 = () => (
    <motion.div
      key="step1"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col items-center justify-center space-y-6"
    >
      <div
        ref={dropZoneRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`w-full max-w-xl p-12 border-2 border-dashed rounded-3xl cursor-pointer transition-all duration-300 flex flex-col items-center justify-center text-center group ${
          file
            ? 'border-green-400 bg-green-50'
            : 'border-gray-300 hover:border-accent hover:bg-gray-50'
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="application/pdf"
          className="hidden"
        />
        {file ? (
          <>
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <FileType2 className="h-8 w-8 text-green-600" />
            </div>
            <p className="text-lg font-medium text-gray-900">{file.name}</p>
            <p className="text-sm text-gray-500 mt-1">
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-accent/20 group-hover:scale-110 transition-all">
              <UploadCloud className="h-8 w-8 text-gray-500 group-hover:text-accent" />
            </div>
            <p className="text-lg font-medium text-gray-900 mb-2">
              Click to upload or drag and drop
            </p>
            <div className="inline-flex items-center px-3 py-1 rounded-full bg-gray-100 text-xs font-medium text-gray-600">
              PDF Files Only
            </div>
          </>
        )}
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center text-red-600 bg-red-50 px-4 py-2 rounded-lg"
        >
          <AlertCircle className="h-5 w-5 mr-2" />
          <span className="text-sm font-medium">{error}</span>
        </motion.div>
      )}

      {file && (
        <button
          onClick={() => attemptLoadPDF()}
          disabled={isProcessing}
          className="bg-primary text-white px-8 py-3 rounded-xl font-medium shadow-md hover:bg-primary/90 transition-colors w-full max-w-xs disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {isProcessing ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Continue'}
        </button>
      )}
    </motion.div>
  );

  // Step 2 — Password
  const renderStep2 = () => (
    <motion.div
      key="step2"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col items-center justify-center space-y-6 w-full max-w-md mx-auto"
    >
      <div className="w-20 h-20 bg-amber-100 rounded-2xl flex items-center justify-center mb-2 shadow-inner">
        <Lock className="h-10 w-10 text-amber-600" />
      </div>
      <div className="text-center">
        <h3 className="text-2xl font-bold text-gray-900">Protected PDF</h3>
        <p className="text-gray-600 mt-2">Enter the password to unlock your Aadhaar.</p>
        <p className="text-xs text-gray-400 mt-1">
          Usually the first 4 letters of your name + birth year (e.g. AMIT1990)
        </p>
      </div>

      <div className="w-full relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password..."
          className="w-full px-4 py-4 pr-12 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-accent focus:border-accent transition-all outline-none text-lg"
          onKeyDown={(e) => e.key === 'Enter' && attemptLoadPDF(password)}
        />
        <button
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-red-500 text-sm font-medium"
        >
          {error}
        </motion.div>
      )}

      <button
        onClick={() => attemptLoadPDF(password)}
        disabled={!password || isProcessing}
        className="w-full bg-primary text-white px-8 py-4 rounded-xl font-semibold shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center"
      >
        {isProcessing ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          'Unlock PDF'
        )}
      </button>

      <button
        onClick={resetTool}
        className="text-sm text-gray-500 hover:text-primary"
      >
        Cancel and start over
      </button>
    </motion.div>
  );

  // Step 3 — Preview with crop-box overlay
  const renderStep3 = () => (
    <motion.div
      key="step3"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      className="flex flex-col items-center w-full gap-6"
    >
      {/* Info banner */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 w-full max-w-2xl text-sm text-amber-800">
        <Scissors className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
        <span>
          The <strong>orange box</strong> marks where the{' '}
          <strong>front card (right side)</strong> will be cropped from your
          Aadhaar PDF. Confirm to proceed, or go back to upload a different file.
        </span>
      </div>

      {/* PDF page preview with overlay */}
      <div
        className="w-full max-w-2xl bg-gray-100 rounded-2xl p-3 md:p-6 shadow-inner"
      >
        <div
          ref={previewWrapperRef}
          className="relative w-full overflow-hidden rounded-lg shadow"
        >
          {pagePreviewDataUrl && (
            <>
              <img
                src={pagePreviewDataUrl}
                alt="Aadhaar PDF preview"
                className="w-full block"
                onLoad={updateOverlay}
              />

              {/* Crop-box overlay — drawn only when overlay is computed */}
              {overlayStyle.width && (
                <div
                  className="absolute pointer-events-none"
                  style={overlayStyle}
                >
                  {/* Outer glow / shadow */}
                  <div className="absolute inset-0 rounded-sm ring-2 ring-orange-400 ring-offset-0 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />

                  {/* Corner markers */}
                  {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
                    <div
                      key={corner}
                      className={`absolute w-4 h-4 border-orange-400 border-[3px]
                        ${corner === 'tl' ? 'top-0 left-0 border-r-0 border-b-0 rounded-tl-sm' : ''}
                        ${corner === 'tr' ? 'top-0 right-0 border-l-0 border-b-0 rounded-tr-sm' : ''}
                        ${corner === 'bl' ? 'bottom-0 left-0 border-r-0 border-t-0 rounded-bl-sm' : ''}
                        ${corner === 'br' ? 'bottom-0 right-0 border-l-0 border-t-0 rounded-br-sm' : ''}
                      `}
                    />
                  ))}

                  {/* Label */}
                  <span className="absolute -top-6 left-0 text-[11px] font-semibold bg-orange-400 text-white px-2 py-0.5 rounded-sm whitespace-nowrap shadow">
                    Front Card
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-2xl">
        <button
          onClick={handleConfirmCrop}
          className="flex-1 flex items-center justify-center gap-2 bg-primary text-white px-8 py-3 rounded-xl font-semibold shadow-md hover:bg-primary/90 transition-colors"
        >
          <Scissors className="h-4 w-4" />
          Crop Now
        </button>
        <button
          onClick={resetTool}
          className="flex items-center justify-center gap-2 px-6 py-3 border-2 border-gray-200 text-gray-600 rounded-xl font-medium hover:bg-gray-50 transition"
        >
          <RefreshCw className="h-4 w-4" />
          Start Over
        </button>
      </div>
    </motion.div>
  );

  // Step 4 — Processing spinner
  const renderStep4 = () => (
    <motion.div
      key="step4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-12"
    >
      <Loader2 className="h-16 w-16 text-accent animate-spin mb-6" />
      <h3 className="text-2xl font-bold text-gray-900">Processing Document</h3>
      <p className="text-gray-600 mt-2">Cropping and optimising for print…</p>
    </motion.div>
  );

  // Step 5 — Result (A4 print layout)
  const renderStep5 = () => (
    <motion.div
      key="step5"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center w-full"
    >
      <div className="flex flex-col sm:flex-row justify-between w-full max-w-4xl mb-8 gap-4 print:hidden">
        <div className="flex items-center space-x-3 text-green-600 font-semibold bg-green-50 px-4 py-2 rounded-lg">
          <CheckCircle2 className="h-5 w-5" />
          <span>Ready to Print!</span>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={() => window.print()}
            className="flex items-center px-6 py-2 bg-primary text-white rounded-lg font-medium shadow-sm hover:bg-primary/90 transition"
          >
            <Printer className="h-4 w-4 mr-2" />
            Print Now
          </button>
          <button
            onClick={handleDownload}
            disabled={!previewDataUrl}
            className="flex items-center px-6 py-2 border-2 border-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="h-4 w-4 mr-2" />
            Save PNG
          </button>
        </div>
      </div>

      {/* A4 Preview — front on top, back below */}
      <div className="w-full max-w-2xl bg-gray-100 p-4 md:p-8 rounded-2xl print:p-0 print:bg-white print:max-w-none">
        <div
          id="print-layout"
          className="bg-white shadow-xl mx-auto flex flex-col items-center justify-center print:shadow-none print:mx-0 overflow-hidden"
          style={{ aspectRatio: '794/1123', width: '100%', maxWidth: '794px' }}
        >
          {frontImage && (
            <img
              src={frontImage}
              alt="Aadhaar Front"
              className="w-[85%] object-contain mt-12 mb-6"
            />
          )}
          {backImage && (
            <img
              src={backImage}
              alt="Aadhaar Back"
              className="w-[85%] object-contain mb-12"
            />
          )}
        </div>
      </div>

      <div className="mt-10 print:hidden">
        <button
          onClick={resetTool}
          className="flex items-center text-gray-500 hover:text-primary font-medium"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Process Another Document
        </button>
      </div>
    </motion.div>
  );

  // ── Layout ───────────────────────────────────────────────────────────────────
  // Progress stepper labels (shown for steps 1-3)
  const STEP_LABELS = ['Upload', 'Unlock', 'Preview'];

  return (
    <section id="tools" className="py-24 bg-white min-h-[80vh] flex flex-col">
      <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 print:p-0">

        {/* Progress header */}
        {step <= 3 && (
          <div className="mb-12 print:hidden">
            <h2 className="text-3xl font-bold text-center text-primary mb-8">
              Crop Tool
            </h2>
            <div className="flex items-center justify-center max-w-md mx-auto relative">
              <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-gray-100 -z-10" />
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-colors ${
                      step >= i
                        ? 'bg-primary text-white shadow-md'
                        : 'bg-white text-gray-300 border-2 border-gray-100'
                    }`}
                  >
                    {i}
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      step >= i ? 'text-primary' : 'text-gray-300'
                    }`}
                  >
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
