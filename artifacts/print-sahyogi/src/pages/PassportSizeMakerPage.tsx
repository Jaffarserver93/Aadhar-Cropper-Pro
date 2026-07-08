import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UploadCloud, Download, AlertCircle, CheckCircle2, X, Loader2, Plus, Minus, ImageIcon, ArrowLeft,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { useLocation } from 'wouter';

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

// ── remove.bg proxy ──────────────────────────────────────────────────────────
async function removeBg(file: File, signal: AbortSignal): Promise<Blob> {
  const form = new FormData();
  form.append('image_file', file);
  const res = await fetch('/api/removebg', { method: 'POST', body: form, signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 402) throw new Error('remove.bg quota exhausted — try again later.');
    if (res.status === 429) throw new Error('Too many requests — wait a moment and retry.');
    throw new Error(body.error || `Server error ${res.status}`);
  }
  return res.blob();
}

// ── Passport resize ────────────────────────────────────────────────────────────
// No face/person detection, no cropping — the entire background-removed photo
// is simply resized to exactly fill the 35×45mm frame, so nothing from the
// original photo is ever cut off.
async function makePassportCanvas(_file: File, bgBlob: Blob): Promise<HTMLCanvasElement> {
  const bgBmp = await createImageBitmap(bgBlob);
  const srcW = bgBmp.width, srcH = bgBmp.height;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_W; canvas.height = PHOTO_H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PHOTO_W, PHOTO_H);
    ctx.drawImage(bgBmp, 0, 0, srcW, srcH, BORDER, BORDER, PHOTO_W - 2 * BORDER, PHOTO_H - 2 * BORDER);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, PHOTO_W, BORDER);
    ctx.fillRect(0, PHOTO_H - BORDER, PHOTO_W, BORDER);
    ctx.fillRect(0, BORDER, BORDER, PHOTO_H - 2 * BORDER);
    ctx.fillRect(PHOTO_W - BORDER, BORDER, BORDER, PHOTO_H - 2 * BORDER);
    return canvas;
  } finally { bgBmp.close(); }
}

function buildA4Canvas(entries: { canvas: HTMLCanvasElement; copies: number }[]): HTMLCanvasElement {
  const a4 = document.createElement('canvas');
  a4.width = A4_W; a4.height = A4_H;
  const ctx = a4.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, A4_W, A4_H);
  let rowIdx = 0;
  for (const { canvas, copies } of entries) {
    for (let c = 0; c < copies; c++) {
      const y = MARGIN_T + rowIdx * (PHOTO_H + ROW_GAP);
      for (let col = 0; col < PER_ROW; col++)
        ctx.drawImage(canvas, MARGIN_L + col * (PHOTO_W + H_GAP), y, PHOTO_W, PHOTO_H);
      rowIdx++;
    }
  }
  return a4;
}

function downloadPdf(entries: { canvas: HTMLCanvasElement; copies: number }[], totalRows: number) {
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

interface PhotoRow {
  id: string;
  status: 'processing' | 'done' | 'error';
  canvas: HTMLCanvasElement | null;
  dataUrl: string | null;
  error: string | null;
  copies: number;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PassportSizeMakerPage() {
  const [rows,       setRows]       = useState<PhotoRow[]>([]);
  const [a4DataUrl,  setA4DataUrl]  = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [, navigate] = useLocation();

  const addFileRef   = useRef<HTMLInputElement>(null);
  const retryFileRef = useRef<HTMLInputElement>(null);
  const abortMap     = useRef<Map<string, AbortController>>(new Map());

  const totalCopies = rows.reduce((s, r) => s + r.copies, 0);
  const canAdd      = totalCopies < MAX_ROWS;
  const doneRows    = rows.filter(r => r.status === 'done');

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
      if (idx >= 0) { const n = [...prev]; n[idx] = { ...n[idx], ...processing, copies: n[idx].copies }; return n; }
      return [...prev, processing];
    });

    try {
      const bgBlob = await removeBg(file, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const canvas = await makePassportCanvas(file, bgBlob);
      if (ctrl.signal.aborted) return;
      const done: PhotoRow = { id, status: 'done', canvas, dataUrl: canvas.toDataURL('image/png'), error: null, copies: 1 };
      setRows(prev => prev.map(r => r.id === id ? { ...done, copies: r.copies } : r));
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      const error: PhotoRow = { id, status: 'error', canvas: null, dataUrl: null, error: friendlyError(err), copies: 1 };
      setRows(prev => prev.map(r => r.id === id ? { ...error, copies: r.copies } : r));
    } finally { abortMap.current.delete(id); }
  }, []);

  const removeRow = (id: string) => { abortMap.current.get(id)?.abort(); setRows(prev => prev.filter(r => r.id !== id)); };
  const retryRow  = (id: string) => { retryFileRef.current?.setAttribute('data-row-id', id); retryFileRef.current?.click(); };

  const setCopies = (id: string, delta: number) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const others = prev.filter(x => x.id !== id).reduce((s, x) => s + x.copies, 0);
      return { ...r, copies: Math.min(MAX_ROWS - others, Math.max(1, r.copies + delta)) };
    }));
  };

  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop      = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f && canAdd) processFile(f); };

  const handleDownload = () => {
    const entries = rows.filter(r => r.canvas).map(r => ({ canvas: r.canvas!, copies: r.copies }));
    if (entries.length) downloadPdf(entries, totalCopies);
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Navbar />

      {/* ── Hero / Page header ── */}
      <section className="bg-gray-50 border-b border-gray-100 py-10 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-primary transition-colors mb-4"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Home
          </button>
          <div className="inline-flex items-center gap-2 bg-accent/10 text-accent text-xs font-semibold px-3 py-1 rounded-full mb-3">
            <ImageIcon className="w-3.5 h-3.5" /> Passport Size Photo Maker
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-primary leading-tight">
            Print-Ready Passport Photos
          </h1>
          <p className="mt-3 text-gray-500 max-w-xl mx-auto text-base">
            Upload a photo — we remove the background, resize it to exact <strong>35×45 mm</strong> Indian passport standard,
            and arrange up to <strong>{MAX_ROWS * PER_ROW} copies</strong> on an A4 sheet. All inside your browser.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {[
              '✦ Exact 35×45 mm',
              '✦ White background',
              '✦ 300 DPI lossless PDF',
              `✦ Up to ${MAX_ROWS} rows / ${MAX_ROWS * PER_ROW} photos`,
            ].map(f => (
              <span key={f} className="text-xs font-medium bg-white border border-gray-200 text-gray-600 px-3 py-1 rounded-full shadow-sm">{f}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Tool ── */}
      <section className="flex-1 py-8 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto flex flex-col lg:flex-row gap-6 items-start">

          {/* ── Left: Controls ── */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">

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
                          <span>Removing background &amp; resizing…</span>
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
                                <img src={row.dataUrl!} alt="" className="w-full h-full object-cover block" style={{ background: '#fff' }} />
                              </div>
                            ))}
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
              { n: '2', t: 'Auto-process', d: 'We remove the background and resize your photo to passport standard.' },
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
