import React, { useState, useRef, useCallback, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  UploadCloud,
  Trash2,
  Copy,
  CheckCheck,
  FileType2,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Crosshair,
  Tag,
  Lock,
  Eye,
  EyeOff,
  X,
} from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

const RENDER_SCALE = 2;

interface Region {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

const COLORS = [
  '#f97316', '#3b82f6', '#22c55e', '#a855f7',
  '#ef4444', '#eab308', '#06b6d4', '#ec4899',
];

function colorIdx(regions: Region[]) {
  return COLORS[regions.length % COLORS.length];
}

interface DragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  active: boolean;
}

export default function DemoPDF() {
  const [pdfDataUrl, setPdfDataUrl]       = useState<string | null>(null);
  const [canvasDataUrl, setCanvasDataUrl] = useState<string | null>(null);
  const [canvasW, setCanvasW]             = useState(0);
  const [canvasH, setCanvasH]             = useState(0);
  const [numPages, setNumPages]           = useState(0);
  const [currentPage, setCurrentPage]     = useState(1);
  const [zoom, setZoom]                   = useState(1);
  const [regions, setRegions]             = useState<Region[]>([]);
  const [drag, setDrag]                   = useState<DragState | null>(null);
  const [editingId, setEditingId]         = useState<string | null>(null);
  const [copied, setCopied]               = useState<string | null>(null);
  const [loading, setLoading]             = useState(false);
  const [showSidebar, setShowSidebar]     = useState(false);

  // Password state
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword]           = useState('');
  const [showPw, setShowPw]               = useState(false);
  const [pwError, setPwError]             = useState('');
  const [pwLoading, setPwLoading]         = useState(false);
  const pendingBufferRef = useRef<ArrayBuffer | null>(null);

  const pdfRef     = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const fileRef    = useRef<HTMLInputElement>(null);
  const imgRef     = useRef<HTMLImageElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dropRef    = useRef<HTMLDivElement>(null);
  const pwInputRef = useRef<HTMLInputElement>(null);

  // ── Render a page ────────────────────────────────────────────────────────
  const renderPage = useCallback(async (pdf: pdfjsLib.PDFDocumentProxy, pageNum: number) => {
    setLoading(true);
    const page     = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    const ctx      = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    setCanvasDataUrl(canvas.toDataURL('image/png'));
    setCanvasW(viewport.width);
    setCanvasH(viewport.height);
    setLoading(false);
  }, []);

  // ── Load PDF from ArrayBuffer (with optional password) ──────────────────
  const loadPDF = useCallback(async (buffer: ArrayBuffer, pw?: string) => {
    setPwLoading(true);
    setPwError('');
    try {
      const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0), password: pw }).promise;
      pdfRef.current = pdf;
      setNumPages(pdf.numPages);
      setCurrentPage(1);
      setRegions([]);
      setNeedsPassword(false);
      setPassword('');
      setPwLoading(false);
      pendingBufferRef.current = null;
      await renderPage(pdf, 1);
    } catch (err: any) {
      setPwLoading(false);
      setLoading(false);
      if (err.name === 'PasswordException') {
        pendingBufferRef.current = buffer;
        if (pw) setPwError('Incorrect password. Please try again.');
        setNeedsPassword(true);
        setTimeout(() => pwInputRef.current?.focus(), 100);
      }
    }
  }, [renderPage]);

  useEffect(() => {
    if (pdfRef.current) renderPage(pdfRef.current, currentPage);
  }, [currentPage, renderPage]);

  const handleUnlock = () => {
    if (pendingBufferRef.current && password) {
      loadPDF(pendingBufferRef.current, password);
    }
  };

  // ── File handling ────────────────────────────────────────────────────────
  const handleFile = async (file: File) => {
    if (file.type !== 'application/pdf') return;
    setNeedsPassword(false);
    setPassword('');
    setPwError('');
    const buffer = await file.arrayBuffer();
    setPdfDataUrl(file.name);
    loadPDF(buffer);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleFile(e.target.files[0]);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dropRef.current?.classList.remove('border-blue-400', 'bg-blue-50');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    dropRef.current?.classList.add('border-blue-400', 'bg-blue-50');
  };
  const onDragLeave = () => {
    dropRef.current?.classList.remove('border-blue-400', 'bg-blue-50');
  };

  // ── Mouse/touch drawing ──────────────────────────────────────────────────
  const toCanvasCoords = (clientX: number, clientY: number) => {
    const rect = imgRef.current!.getBoundingClientRect();
    const scaleX = canvasW / rect.width;
    const scaleY = canvasH / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top)  * scaleY,
    };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!canvasDataUrl) return;
    e.preventDefault();
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    setDrag({ startX: x, startY: y, currentX: x, currentY: y, active: true });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag?.active) return;
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    setDrag((d) => d ? { ...d, currentX: x, currentY: y } : null);
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (!drag?.active) return;
    const { x, y } = toCanvasCoords(e.clientX, e.clientY);
    finishDrag(x, y);
  };

  const finishDrag = (x: number, y: number) => {
    if (!drag?.active) return;
    const rx = Math.min(drag.startX, x);
    const ry = Math.min(drag.startY, y);
    const rw = Math.abs(x - drag.startX);
    const rh = Math.abs(y - drag.startY);

    if (rw > 5 && rh > 5) {
      const id    = crypto.randomUUID();
      const color = colorIdx(regions);
      setRegions((prev) => [
        ...prev,
        { id, name: `Region ${prev.length + 1}`, x: rx, y: ry, w: rw, h: rh, color },
      ]);
      setEditingId(id);
    }
    setDrag(null);
  };

  // Touch events
  const onTouchStart = (e: React.TouchEvent) => {
    if (!canvasDataUrl) return;
    const t = e.touches[0];
    const { x, y } = toCanvasCoords(t.clientX, t.clientY);
    setDrag({ startX: x, startY: y, currentX: x, currentY: y, active: true });
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!drag?.active) return;
    e.preventDefault();
    const t = e.touches[0];
    const { x, y } = toCanvasCoords(t.clientX, t.clientY);
    setDrag((d) => d ? { ...d, currentX: x, currentY: y } : null);
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!drag?.active) return;
    const t = e.changedTouches[0];
    const { x, y } = toCanvasCoords(t.clientX, t.clientY);
    finishDrag(x, y);
  };

  // ── Drag overlay rect (in display px) ───────────────────────────────────
  const dragRect = (() => {
    if (!drag?.active || !imgRef.current) return null;
    const rect   = imgRef.current.getBoundingClientRect();
    const scaleX = rect.width  / canvasW;
    const scaleY = rect.height / canvasH;
    const x = Math.min(drag.startX, drag.currentX) * scaleX;
    const y = Math.min(drag.startY, drag.currentY) * scaleY;
    const w = Math.abs(drag.currentX - drag.startX) * scaleX;
    const h = Math.abs(drag.currentY - drag.startY) * scaleY;
    return { x, y, w, h };
  })();

  // ── Region display rect ──────────────────────────────────────────────────
  const toDisplayRect = (r: Region) => {
    if (!imgRef.current) return null;
    const rect   = imgRef.current.getBoundingClientRect();
    const scaleX = rect.width  / canvasW;
    const scaleY = rect.height / canvasH;
    return { left: r.x * scaleX, top: r.y * scaleY, width: r.w * scaleX, height: r.h * scaleY };
  };

  // ── Copy code ────────────────────────────────────────────────────────────
  const copyRegion = (r: Region) => {
    const code = `const ${r.name.replace(/\s+/g, '_').toUpperCase()} = {\n  x: ${r.x.toFixed(3)},\n  y: ${r.y.toFixed(3)},\n  w: ${r.w.toFixed(3)},\n  h: ${r.h.toFixed(3)},\n} as const;`;
    navigator.clipboard.writeText(code);
    setCopied(r.id);
    setTimeout(() => setCopied(null), 2000);
  };

  const copyAll = () => {
    const code = regions
      .map((r) => `const ${r.name.replace(/\s+/g, '_').toUpperCase()} = {\n  x: ${r.x.toFixed(3)},\n  y: ${r.y.toFixed(3)},\n  w: ${r.w.toFixed(3)},\n  h: ${r.h.toFixed(3)},\n} as const;`)
      .join('\n\n');
    navigator.clipboard.writeText(code);
    setCopied('all');
    setTimeout(() => setCopied(null), 2000);
  };

  const deleteRegion = (id: string) => {
    setRegions((prev) => prev.filter((r) => r.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const renameRegion = (id: string, name: string) => {
    setRegions((prev) => prev.map((r) => r.id === id ? { ...r, name } : r));
  };

  const updateRegionField = (id: string, field: 'x' | 'y' | 'w' | 'h', raw: string) => {
    const val = parseFloat(raw);
    if (isNaN(val) || val < 0) return;
    setRegions((prev) => prev.map((r) => r.id === id ? { ...r, [field]: val } : r));
  };

  // ── Image resize → recompute overlay positions ───────────────────────────
  useEffect(() => {
    const obs = new ResizeObserver(() => setZoom((z) => z));
    if (imgRef.current) obs.observe(imgRef.current);
    return () => obs.disconnect();
  }, [canvasDataUrl]);

  const resetFile = () => {
    setPdfDataUrl(null);
    setCanvasDataUrl(null);
    setRegions([]);
    setNeedsPassword(false);
    setPassword('');
    setPwError('');
    pdfRef.current = null;
    pendingBufferRef.current = null;
    setShowSidebar(false);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">

      {/* ── Password Modal ─────────────────────────────────────────────────── */}
      {needsPassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-indigo-600/20 p-2.5 rounded-xl">
                <Lock className="h-5 w-5 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">Password Protected PDF</h2>
                <p className="text-xs text-gray-400 mt-0.5">Enter the PDF password to open it</p>
              </div>
            </div>

            <div className="relative mb-3">
              <input
                ref={pwInputRef}
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                placeholder="Enter password…"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 pr-11 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-500 transition"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {pwError && (
              <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                {pwError}
              </p>
            )}

            <div className="flex gap-2">
              <button
                onClick={resetFile}
                className="flex-1 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-xl transition"
              >
                Cancel
              </button>
              <button
                onClick={handleUnlock}
                disabled={!password || pwLoading}
                className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition flex items-center justify-center gap-2"
              >
                {pwLoading ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
                Unlock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-gray-800 px-4 py-3 flex items-center gap-3 shrink-0">
        <Crosshair className="h-4 w-4 text-indigo-400 shrink-0" />
        <h1 className="text-sm font-semibold text-white">PDF Region Picker</h1>

        {canvasDataUrl && (
          <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
            {/* Page nav */}
            {numPages > 1 && (
              <div className="flex items-center gap-1 bg-gray-800 rounded-lg px-2 py-1">
                <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}
                  className="p-1 hover:text-white text-gray-400 disabled:opacity-30 transition">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs font-mono text-gray-300 px-1">{currentPage}/{numPages}</span>
                <button onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))} disabled={currentPage === numPages}
                  className="p-1 hover:text-white text-gray-400 disabled:opacity-30 transition">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Zoom */}
            <div className="hidden sm:flex items-center gap-1 bg-gray-800 rounded-lg px-2 py-1">
              <button onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))}
                className="p-1 hover:text-white text-gray-400 transition">
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-xs font-mono w-10 text-center text-gray-300">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(3, z + 0.1))}
                className="p-1 hover:text-white text-gray-400 transition">
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>

            {/* Regions toggle (mobile) */}
            {regions.length > 0 && (
              <button onClick={() => setShowSidebar((v) => !v)}
                className="sm:hidden flex items-center gap-1 text-xs px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition">
                <Tag className="h-3.5 w-3.5" />
                {regions.length}
              </button>
            )}

            {/* Copy all */}
            {regions.length > 0 && (
              <button onClick={copyAll}
                className="hidden sm:flex items-center gap-1.5 text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition">
                {copied === 'all' ? <CheckCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">Copy All</span>
              </button>
            )}

            {/* New file */}
            <button onClick={resetFile}
              className="text-xs px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition">
              New
            </button>
          </div>
        )}
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* ── PDF canvas area ─────────────────────────────────────────────── */}
        <div ref={wrapperRef}
          className="flex-1 overflow-auto bg-gray-900 flex items-start justify-center p-4 sm:p-6 min-h-0">

          {!canvasDataUrl ? (
            /* Upload zone */
            <div className="flex items-center justify-center w-full min-h-[60vh]">
              <div ref={dropRef}
                onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
                onClick={() => fileRef.current?.click()}
                className="w-full max-w-sm border-2 border-dashed border-gray-700 hover:border-blue-400 rounded-2xl p-10 sm:p-14 flex flex-col items-center gap-4 cursor-pointer transition-all text-center bg-gray-800/40 hover:bg-gray-800/70">
                <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={onFileChange} />
                <UploadCloud className="h-12 w-12 text-gray-500" />
                <div>
                  <p className="text-base font-medium text-gray-200">Drop PDF here or tap to upload</p>
                  <p className="text-xs text-gray-500 mt-1">Aadhaar, PAN, or any PDF — password-protected supported</p>
                </div>
              </div>
            </div>
          ) : (
            /* PDF view — A4 proportions, fits viewport width on mobile */
            <div
              className="relative select-none"
              style={{
                width: `min(${canvasW * zoom}px, 100%)`,
                aspectRatio: `${canvasW} / ${canvasH}`,
                flexShrink: 0,
              }}
            >
              {loading && (
                <div className="absolute inset-0 bg-gray-900/70 flex items-center justify-center z-30 rounded">
                  <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              {/* PDF image — fills its container */}
              <img
                ref={imgRef}
                src={canvasDataUrl!}
                alt="PDF page"
                draggable={false}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                style={{ width: '100%', height: '100%', cursor: 'crosshair', display: 'block' }}
                className="rounded shadow-2xl"
              />

              {/* Existing regions */}
              {regions.map((r) => {
                const d = toDisplayRect(r);
                if (!d) return null;
                return (
                  <div key={r.id}
                    className="absolute pointer-events-none"
                    style={{ left: d.left, top: d.top, width: d.width, height: d.height }}>
                    <div className="absolute inset-0 rounded-sm"
                      style={{ border: `2px solid ${r.color}`, backgroundColor: `${r.color}22` }} />
                    <span className="absolute -top-6 left-0 text-[10px] font-bold px-1.5 py-0.5 rounded-sm text-white whitespace-nowrap shadow"
                      style={{ backgroundColor: r.color }}>
                      {r.name}
                    </span>
                    {(['tl','tr','bl','br'] as const).map((c) => (
                      <div key={c} className="absolute w-3 h-3 rounded-sm"
                        style={{
                          backgroundColor: r.color,
                          ...(c === 'tl' ? { top: 0, left: 0 } : {}),
                          ...(c === 'tr' ? { top: 0, right: 0 } : {}),
                          ...(c === 'bl' ? { bottom: 0, left: 0 } : {}),
                          ...(c === 'br' ? { bottom: 0, right: 0 } : {}),
                        }} />
                    ))}
                  </div>
                );
              })}

              {/* Live drag rect */}
              {dragRect && (
                <div className="absolute pointer-events-none"
                  style={{ left: dragRect.x, top: dragRect.y, width: dragRect.w, height: dragRect.h,
                    border: '2px dashed #818cf8', backgroundColor: '#818cf822', borderRadius: 4 }} />
              )}
            </div>
          )}
        </div>

        {/* ── Sidebar — desktop always visible, mobile as overlay ──────────── */}
        {canvasDataUrl && (
          <>
            {/* Mobile overlay backdrop */}
            {showSidebar && (
              <div className="sm:hidden fixed inset-0 bg-black/50 z-20" onClick={() => setShowSidebar(false)} />
            )}

            <aside className={`
              ${showSidebar ? 'translate-x-0' : 'translate-x-full sm:translate-x-0'}
              fixed sm:relative right-0 top-0 sm:top-auto bottom-0 sm:bottom-auto
              w-72 sm:w-72 z-30 sm:z-auto
              border-l border-gray-800 bg-gray-900 flex flex-col shrink-0 overflow-y-auto
              transition-transform sm:transition-none
              pt-14 sm:pt-0
            `}>
              {/* Mobile close */}
              <button onClick={() => setShowSidebar(false)}
                className="sm:hidden absolute top-3 right-3 p-2 text-gray-400 hover:text-white transition">
                <X className="h-5 w-5" />
              </button>

              {/* File info */}
              <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
                <FileType2 className="h-4 w-4 text-gray-500 shrink-0" />
                <span className="text-xs text-gray-400 truncate">
                  Page {currentPage} · {canvasW}×{canvasH}px
                </span>
              </div>

              {/* Mobile: copy all + zoom */}
              <div className="sm:hidden flex items-center gap-2 px-3 py-2 border-b border-gray-800">
                <div className="flex items-center gap-1 bg-gray-800 rounded-lg px-2 py-1">
                  <button onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))}
                    className="p-1 hover:text-white text-gray-400 transition">
                    <ZoomOut className="h-4 w-4" />
                  </button>
                  <span className="text-xs font-mono w-10 text-center text-gray-300">{Math.round(zoom * 100)}%</span>
                  <button onClick={() => setZoom((z) => Math.min(3, z + 0.1))}
                    className="p-1 hover:text-white text-gray-400 transition">
                    <ZoomIn className="h-4 w-4" />
                  </button>
                </div>
                {regions.length > 0 && (
                  <button onClick={copyAll}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition">
                    {copied === 'all' ? <CheckCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    Copy All
                  </button>
                )}
              </div>

              {/* Instructions */}
              {regions.length === 0 && (
                <div className="p-4 text-xs text-gray-500 leading-relaxed">
                  <p className="font-semibold text-gray-400 mb-2">How to use:</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Drag on the PDF to draw a region</li>
                    <li>Name it (e.g. <span className="font-mono text-indigo-400">FRONT_CROP</span>)</li>
                    <li>Copy the coordinates into your code</li>
                  </ol>
                </div>
              )}

              {/* Region cards */}
              <div className="flex flex-col gap-2 p-3">
                {regions.map((r) => (
                  <div key={r.id} className="rounded-xl border border-gray-700 bg-gray-800 overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2" style={{ borderLeft: `3px solid ${r.color}` }}>
                      <Tag className="h-3.5 w-3.5 shrink-0" style={{ color: r.color }} />
                      {editingId === r.id ? (
                        <input
                          autoFocus
                          value={r.name}
                          onChange={(e) => renameRegion(r.id, e.target.value)}
                          onBlur={() => setEditingId(null)}
                          onKeyDown={(e) => e.key === 'Enter' && setEditingId(null)}
                          className="flex-1 bg-transparent text-xs font-semibold text-white outline-none border-b border-indigo-500 min-w-0"
                        />
                      ) : (
                        <span
                          className="flex-1 text-xs font-semibold text-white cursor-text truncate"
                          onClick={() => setEditingId(r.id)}
                          title="Click to rename"
                        >
                          {r.name}
                        </span>
                      )}
                      <button onClick={() => copyRegion(r)} title="Copy coordinates"
                        className="p-1 text-gray-400 hover:text-white transition shrink-0">
                        {copied === r.id ? <CheckCheck className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                      <button onClick={() => deleteRegion(r.id)} title="Delete region"
                        className="p-1 text-gray-400 hover:text-red-400 transition shrink-0">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Editable X Y W H inputs */}
                    <div className="px-3 py-2 bg-gray-950/60 grid grid-cols-2 gap-1.5">
                      {(['x', 'y', 'w', 'h'] as const).map((field) => (
                        <label key={field} className="flex items-center gap-1.5 bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 focus-within:border-indigo-500 transition">
                          <span className="text-[10px] font-bold uppercase text-gray-500 w-3 shrink-0">{field}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={parseFloat(r[field].toFixed(1))}
                            onChange={(e) => updateRegionField(r.id, field, e.target.value)}
                            className="w-full bg-transparent text-[11px] font-mono text-white outline-none min-w-0"
                          />
                          <span className="text-[9px] text-gray-600 shrink-0">px</span>
                        </label>
                      ))}
                    </div>

                    <div className="px-3 pb-2">
                      <pre className="text-[10px] text-indigo-300 bg-gray-950/80 rounded p-2 overflow-x-auto leading-relaxed whitespace-pre">{`const ${r.name.replace(/\s+/g,'_').toUpperCase()} = {\n  x: ${r.x.toFixed(3)},\n  y: ${r.y.toFixed(3)},\n  w: ${r.w.toFixed(3)},\n  h: ${r.h.toFixed(3)},\n} as const;`}</pre>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
