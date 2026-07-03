import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UploadCloud, FileType2, Lock, Eye, EyeOff, Loader2, Printer, Download, RefreshCw, AlertCircle } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

// Configure pdfjs worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

type Step = 1 | 2 | 3 | 4;

export function AadhaarCropTool() {
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Handle Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (dropZoneRef.current) {
      dropZoneRef.current.classList.add('border-accent', 'bg-accent/5');
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (dropZoneRef.current) {
      dropZoneRef.current.classList.remove('border-accent', 'bg-accent/5');
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    handleDragLeave(e);
    const droppedFile = e.dataTransfer.files[0];
    await processFileSelection(droppedFile);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      await processFileSelection(selectedFile);
    }
  };

  const processFileSelection = async (selectedFile: File) => {
    setError(null);
    if (selectedFile.type !== 'application/pdf') {
      setError('Please upload a valid PDF file.');
      return;
    }
    
    setFile(selectedFile);
    const buffer = await selectedFile.arrayBuffer();
    setArrayBuffer(buffer);
  };

  const attemptLoadPDF = async (pdfPassword?: string) => {
    if (!arrayBuffer) return;
    
    setError(null);
    setIsProcessing(true);

    try {
      // Slice a fresh copy each attempt — pdfjs transfers/detaches the original buffer to its worker
      const loadingTask = pdfjsLib.getDocument({ 
        data: arrayBuffer.slice(0),
        password: pdfPassword
      });

      const pdf = await loadingTask.promise;
      // Success! Move to processing
      setStep(3);
      await processPDFPages(pdf);
    } catch (err: any) {
      setIsProcessing(false);
      
      // Checking for password exception
      if (err.name === 'PasswordException') {
        if (pdfPassword) {
          setError('Incorrect password, please try again.');
        }
        setStep(2);
      } else {
        setError(err.message || 'Error processing PDF');
      }
    }
  };

  const processPDFPages = async (pdf: pdfjsLib.PDFDocumentProxy) => {
    try {
      const numPages = Math.min(pdf.numPages, 2);
      const images: string[] = [];

      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 }); // High res rendering
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        // Render PDF page to canvas (pdfjs-dist v6 requires canvas field)
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        
        // Auto Crop using pixel data
        const croppedCanvas = autoCropCanvas(canvas);
        images.push(croppedCanvas.toDataURL('image/png'));
      }

      if (images.length > 0) setFrontImage(images[0]);
      if (images.length > 1) setBackImage(images[1]);

      await generateA4Preview(images);
      
      setIsProcessing(false);
      setStep(4);
    } catch (err: any) {
      setError('Failed to process images. ' + err.message);
      setIsProcessing(false);
      setStep(1);
    }
  };

  // Auto-crop: find card boundaries using DENSITY scanning.
  // A row/column only counts as "content" when ≥ 1% of its pixels are non-white,
  // so lone anti-aliased edge pixels never trick the scanner into cutting the card short.
  const autoCropCanvas = (sourceCanvas: HTMLCanvasElement): HTMLCanvasElement => {
    const ctx = sourceCanvas.getContext('2d');
    if (!ctx) return sourceCanvas;

    const width  = sourceCanvas.width;
    const height = sourceCanvas.height;
    const { data } = ctx.getImageData(0, 0, width, height);

    // pixel is "content" when it is clearly not white/transparent
    // threshold 230 catches Aadhaar orange, saffron, blue, red, and grey elements
    const isContent = (i: number): boolean => {
      if (data[i + 3] < 10) return false;
      return data[i] < 230 || data[i + 1] < 230 || data[i + 2] < 230;
    };

    // Minimum number of content pixels needed in a row or column to be called "content row/col".
    // 1% of the dimension — a single stray pixel is never enough.
    const ROW_MIN = Math.max(4, Math.round(width  * 0.01));
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

    // Scan from each edge inward
    let topRow = 0;
    for (let y = 0; y < height; y++) { if (rowHasContent(y)) { topRow = y; break; } }

    let bottomRow = height - 1;
    for (let y = height - 1; y >= 0; y--) { if (rowHasContent(y)) { bottomRow = y; break; } }

    let leftCol = 0;
    for (let x = 0; x < width; x++) { if (colHasContent(x)) { leftCol = x; break; } }

    let rightCol = width - 1;
    for (let x = width - 1; x >= 0; x--) { if (colHasContent(x)) { rightCol = x; break; } }

    // Generous padding — never let a card border pixel get clipped
    const PAD = 40;
    const minX = Math.max(0, leftCol  - PAD);
    const minY = Math.max(0, topRow   - PAD);
    const maxX = Math.min(width,  rightCol  + PAD);
    const maxY = Math.min(height, bottomRow + PAD);

    const cropW = maxX - minX;
    const cropH = maxY - minY;

    const out = document.createElement('canvas');
    out.width  = cropW;
    out.height = cropH;
    out.getContext('2d')?.drawImage(sourceCanvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
    return out;
  };

  // Generate an A4 size canvas layout for download — returns a Promise<string>
  const generateA4Preview = (images: string[]): Promise<string> => {
    return new Promise((resolve) => {
      // A4 size at 96 DPI
      const A4_WIDTH = 794;
      const A4_HEIGHT = 1123;
      
      const a4Canvas = document.createElement('canvas');
      a4Canvas.width = A4_WIDTH;
      a4Canvas.height = A4_HEIGHT;
      const ctx = a4Canvas.getContext('2d');
      
      if (!ctx) { resolve(''); return; }
      
      // Fill white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);
      
      const loadImg = (src: string): Promise<HTMLImageElement> => {
        return new Promise((res) => {
          const img = new Image();
          img.onload = () => res(img);
          img.src = src;
        });
      };

      const drawImages = async () => {
        // Layout constants
        const MARGIN   = 30;  // outer margin px
        const GAP      = 20;  // gap between the two cards
        const numCards = images.length;

        // Each card gets an equal vertical slot
        const slotH = Math.floor((A4_HEIGHT - MARGIN * 2 - GAP * (numCards - 1)) / numCards);
        const slotW = A4_WIDTH - MARGIN * 2;

        // "contain" an image inside a slot — scale to fit without stretching
        const containDraw = (img: HTMLImageElement, slotX: number, slotY: number) => {
          const scale = Math.min(slotW / img.naturalWidth, slotH / img.naturalHeight);
          const w = img.naturalWidth  * scale;
          const h = img.naturalHeight * scale;
          const dx = slotX + (slotW - w) / 2;
          const dy = slotY + (slotH - h) / 2;
          ctx.drawImage(img, dx, dy, w, h);
        };

        for (let i = 0; i < images.length; i++) {
          const img = await loadImg(images[i]);
          const slotY = MARGIN + i * (slotH + GAP);
          containDraw(img, MARGIN, slotY);
        }

        const dataUrl = a4Canvas.toDataURL('image/png');
        setPreviewDataUrl(dataUrl);
        resolve(dataUrl);
      };
      
      drawImages();
    });
  };

  const handleDownload = () => {
    if (previewDataUrl) {
      const link = document.createElement('a');
      link.href = previewDataUrl;
      link.download = `Print_Sahyogi_${file?.name.replace('.pdf', '') || 'Aadhaar'}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
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
  };

  // Step Content Renderers
  const renderStep1 = () => (
    <motion.div
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
          file ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-accent hover:bg-gray-50'
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
            <p className="text-sm text-gray-500 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-accent/20 group-hover:scale-110 transition-all">
              <UploadCloud className="h-8 w-8 text-gray-500 group-hover:text-accent" />
            </div>
            <p className="text-lg font-medium text-gray-900 mb-2">Click to upload or drag and drop</p>
            <div className="inline-flex items-center px-3 py-1 rounded-full bg-gray-100 text-xs font-medium text-gray-600">
              PDF Files Only
            </div>
          </>
        )}
      </div>

      {error && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center text-red-600 bg-red-50 px-4 py-2 rounded-lg">
          <AlertCircle className="h-5 w-5 mr-2" />
          <span className="text-sm font-medium">{error}</span>
        </motion.div>
      )}

      {file && (
        <button
          onClick={() => attemptLoadPDF()}
          className="bg-primary text-white px-8 py-3 rounded-xl font-medium shadow-md hover:bg-primary/90 transition-colors w-full max-w-xs"
        >
          Continue
        </button>
      )}
    </motion.div>
  );

  const renderStep2 = () => (
    <motion.div
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
        <p className="text-xs text-gray-400 mt-1">Usually the first 4 letters of your name + birth year (e.g. AMIT1990)</p>
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
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-red-500 text-sm font-medium">
          {error}
        </motion.div>
      )}

      <button
        onClick={() => attemptLoadPDF(password)}
        disabled={!password || isProcessing}
        className="w-full bg-primary text-white px-8 py-4 rounded-xl font-semibold shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center"
      >
        {isProcessing ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Unlock PDF'}
      </button>
      
      <button onClick={resetTool} className="text-sm text-gray-500 hover:text-primary">
        Cancel and start over
      </button>
    </motion.div>
  );

  const renderStep3 = () => (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-12"
    >
      <Loader2 className="h-16 w-16 text-accent animate-spin mb-6" />
      <h3 className="text-2xl font-bold text-gray-900">Processing Document</h3>
      <p className="text-gray-600 mt-2">Cropping and optimizing for print...</p>
    </motion.div>
  );

  const renderStep4 = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center w-full"
    >
      <div className="flex flex-col sm:flex-row justify-between w-full max-w-4xl mb-8 gap-4 print:hidden">
        <div className="flex items-center space-x-3 text-green-600 font-semibold bg-green-50 px-4 py-2 rounded-lg">
          <AlertCircle className="h-5 w-5" />
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

      {/* A4 Preview Container */}
      <div className="w-full max-w-2xl bg-gray-100 p-4 md:p-8 rounded-2xl print:p-0 print:bg-white print:max-w-none">
        <div 
          id="print-layout"
          className="bg-white shadow-xl mx-auto flex flex-col items-center justify-center print:shadow-none print:mx-0 overflow-hidden"
          style={{ 
            aspectRatio: '794/1123', 
            width: '100%', 
            maxWidth: '794px' // A4 max width for screen viewing
          }}
        >
          {frontImage && (
            <img src={frontImage} alt="Aadhaar Front" className="w-[85%] object-contain mt-12 mb-6" />
          )}
          {backImage && (
            <img src={backImage} alt="Aadhaar Back" className="w-[85%] object-contain mb-12" />
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

  return (
    <section id="tools" className="py-24 bg-white min-h-[80vh] flex flex-col">
      <div className="max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 print:p-0">
        
        {/* Progress header (hidden in print) */}
        {step < 4 && (
          <div className="mb-12 print:hidden">
            <h2 className="text-3xl font-bold text-center text-primary mb-8">Crop Tool</h2>
            <div className="flex items-center justify-center max-w-md mx-auto relative">
              <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-gray-100 -z-10" />
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex-1 flex justify-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-colors ${
                    step >= i ? 'bg-primary text-white shadow-md' : 'bg-white text-gray-300 border-2 border-gray-100'
                  }`}>
                    {i}
                  </div>
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
          </AnimatePresence>
        </div>

      </div>
    </section>
  );
}
