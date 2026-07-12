import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UploadCloud, Download, AlertCircle, CheckCircle2, X, Loader2, Plus, Minus, ArrowLeft, Sun, Droplets, SlidersHorizontal, Copy, Layers,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { useLocation } from 'wouter';
import { getSession, upsertSession, type HistoryRow } from '@/lib/passportHistory';

// ── Layout — exact 35×45 mm at 300 DPI ──────────────────────────────────────
const A4_W     = 2480;
const A4_H     = 3508;
const MARGIN_T = 90;
const MARGIN_B = 90;
const H_GAP    = 10;
const ROW_GAP  = 24;
const PER_ROW  = 5; // max photos in a single physical row
const PHOTO_W  = Math.round(35 * 300 / 25.4);   // 413 px = 35 mm
const PHOTO_H  = Math.round(45 * 300 / 25.4);   // 531 px = 45 mm
const MARGIN_L = Math.round((A4_W - PER_ROW * PHOTO_W - (PER_ROW - 1) * H_GAP) / 2);
const BORDER   = Math.round(300 / 25.4 * 0.5);  // 0.5 mm border ≈ 6 px

let _max = 0;
while ((_max + 1) * PHOTO_H + _max * ROW_GAP <= A4_H - MARGIN_T - MARGIN_B) _max++;
const MAX_ROWS = _max; // 6 — max physical rows on one A4 sheet

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

function buildFilterString(brightness: number, saturation: number, sharpness: number): string {
  const parts: string[] = [];
  if (brightness  !== 100) parts.push(`brightness(${brightness}%)`);
  if (saturation  !== 100) parts.push(`saturate(${saturation}%)`);
  if (sharpness   !== 100) parts.push(`contrast(${sharpness}%)`);
  return parts.length ? parts.join(' ') : 'none';
}

interface RenderSlot {
  canvas: HTMLCanvasElement;
  brightness: number;
  saturation: number;
  sharpness: number;
}

function buildA4Canvas(rows: { slots: RenderSlot[] }[]): HTMLCanvasElement {
  const a4 = document.createElement('canvas');
  a4.width = A4_W; a4.height = A4_H;
  const ctx = a4.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, A4_W, A4_H);
  rows.forEach((row, rowIdx) => {
    const y = MARGIN_T + rowIdx * (PHOTO_H + ROW_GAP);
    row.slots.forEach((slot, col) => {
      if (col >= PER_ROW) return;
      ctx.filter = buildFilterString(slot.brightness, slot.saturation, slot.sharpness);
      ctx.drawImage(slot.canvas, MARGIN_L + col * (PHOTO_W + H_GAP), y, PHOTO_W, PHOTO_H);
    });
  });
  ctx.filter = 'none';
  return a4;
}

function downloadPdf(rows: { slots: RenderSlot[] }[], totalPhotos: number) {
  const imgData = buildA4Canvas(rows).toDataURL('image/png');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false });
  pdf.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'NONE');
  pdf.save(`passport-photos-${rows.length}rows-${totalPhotos}photos.pdf`);
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

interface PhotoSlot {
  id: string;
  status: 'processing' | 'done' | 'error';
  canvas: HTMLCanvasElement | null;
  dataUrl: string | null;
  error: string | null;
  brightness: number;
  saturation: number;
  sharpness: number;
  copiesInRow: number; // how many times this photo repeats within its own row (1–5)
  totalCopies: number; // total copies of this photo across the whole sheet, 0 = off (5–30 step 5)
}

interface RowGroup {
  id: string;
  slots: PhotoSlot[]; // 1–5 independent photos rendered side by side in one physical row
}

const newSlot = (): PhotoSlot => ({
  id: crypto.randomUUID(), status: 'processing', canvas: null, dataUrl: null, error: null,
  brightness: 100, saturation: 100, sharpness: 100, copiesInRow: 1, totalCopies: 0,
});

// Expand a row's distinct slots into the physical tiles they occupy (1–5),
// repeating a slot `copiesInRow` times back-to-back, capped to PER_ROW total.
function expandRowVisual(slots: PhotoSlot[]): PhotoSlot[] {
  const out: PhotoSlot[] = [];
  for (const slot of slots) {
    const copies = slot.status === 'done' ? Math.max(1, Math.min(slot.copiesInRow, PER_ROW)) : 1;
    for (let i = 0; i < copies && out.length < PER_ROW; i++) out.push(slot);
  }
  return out;
}

// Build the full sheet: expand in-row copies, then append extra full/partial
// rows (up to MAX_ROWS overall) so any slot with `totalCopies` set reaches
// that many total instances across the whole A4 sheet.
function expandSheet(rows: RowGroup[]): RowGroup[] {
  const stepOne = rows.map(row => ({ ...row, slots: expandRowVisual(row.slots) }));

  const countMap = new Map<string, number>();
  stepOne.forEach(r => r.slots.forEach(s => countMap.set(s.id, (countMap.get(s.id) ?? 0) + 1)));

  const extraRows: RowGroup[] = [];
  let totalRowCount = stepOne.length;

  for (const row of rows) {
    for (const slot of row.slots) {
      if (slot.status !== 'done' || !slot.totalCopies) continue;
      let achieved = countMap.get(slot.id) ?? 0;
      while (achieved < slot.totalCopies && totalRowCount < MAX_ROWS) {
        const take = Math.min(PER_ROW, slot.totalCopies - achieved);
        extraRows.push({ id: `auto-${slot.id}-${totalRowCount}`, slots: Array.from({ length: take }, () => slot) });
        achieved += take;
        totalRowCount++;
      }
      countMap.set(slot.id, achieved);
    }
  }

  return [...stepOne, ...extraRows];
}

// Small inline -/+ stepper used for the copy-count controls.
function Stepper({
  value, min, max, step, onChange, format,
}: {
  value: number; min: number; max: number; step: number;
  onChange: (n: number) => void; format?: (n: number) => string;
}) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - step))}
        disabled={value <= min}
        aria-label="Decrease"
        className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:border-accent hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <span className="text-sm font-bold text-primary w-9 text-center tabular-nums">
        {format ? format(value) : value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + step))}
        disabled={value >= max}
        aria-label="Increase"
        className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:border-accent hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PassportSizeMakerPage() {
  const [rows,        setRows]        = useState<RowGroup[]>([]);
  const [a4DataUrl,   setA4DataUrl]   = useState<string | null>(null);
  const [isDragging,  setIsDragging]  = useState(false);
  const [useWhiteBg,  setUseWhiteBg]  = useState(true);
  const [location, navigate] = useLocation();

  const newRowFileRef  = useRef<HTMLInputElement>(null);
  const addSlotFileRef = useRef<HTMLInputElement>(null);
  const retryFileRef   = useRef<HTMLInputElement>(null);
  const abortMap        = useRef<Map<string, AbortController>>(new Map());
  const restoredRef     = useRef(false);

  // Extract session ID from URL: /passport-size-maker/{id}
  const sessionId = (() => {
    const m = location.match(/\/passport-size-maker\/([^/]+)/);
    return m?.[1] ?? null;
  })();

  const allSlots    = rows.flatMap(r => r.slots);
  const doneSlots    = allSlots.filter(s => s.status === 'done');
  const canAddRow    = rows.length < MAX_ROWS;

  // Expand manual rows into the full printable sheet: in-row copies + any
  // auto-filled extra rows requested via "total copies on sheet".
  const sheetRows    = useMemo(() => expandSheet(rows), [rows]);
  const totalPhotos  = sheetRows.reduce((sum, r) => sum + r.slots.filter(s => s.status === 'done' && s.canvas).length, 0);

  // Rebuild A4 preview whenever the sheet changes
  useEffect(() => {
    const renderRows = sheetRows.map(r => ({
      slots: r.slots.filter(s => s.status === 'done' && s.canvas)
        .map(s => ({ canvas: s.canvas!, brightness: s.brightness, saturation: s.saturation, sharpness: s.sharpness })),
    }));
    if (!renderRows.some(r => r.slots.length)) { setA4DataUrl(null); return; }
    setA4DataUrl(buildA4Canvas(renderRows).toDataURL('image/png'));
  }, [sheetRows]);

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
    if (!session?.rows?.length) return;
    Promise.all(
      session.rows.map(async (row): Promise<RowGroup> => ({
        id: crypto.randomUUID(),
        slots: await Promise.all(row.slots.map(async (p): Promise<PhotoSlot> => ({
          id: crypto.randomUUID(), status: 'done', canvas: await canvasFromDataUrl(p.dataUrl), dataUrl: p.dataUrl, error: null,
          brightness: p.brightness ?? 100, saturation: p.saturation ?? 100, sharpness: p.sharpness ?? 100,
          copiesInRow: p.copiesInRow ?? 1, totalCopies: p.totalCopies ?? 0,
        }))),
      })),
    ).then(restored => setRows(restored));
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save to localStorage whenever done slots change
  useEffect(() => {
    if (!sessionId || doneSlots.length === 0) return;
    const existing = getSession(sessionId);
    const rowsForSave: HistoryRow[] = rows
      .map(r => ({
        slots: r.slots.filter(s => s.status === 'done' && s.dataUrl)
          .map(s => ({
            dataUrl: s.dataUrl!, brightness: s.brightness, saturation: s.saturation, sharpness: s.sharpness,
            copiesInRow: s.copiesInRow, totalCopies: s.totalCopies,
          })),
      }))
      .filter(r => r.slots.length > 0);
    if (!rowsForSave.length) return;
    upsertSession({
      id: sessionId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      rows: rowsForSave,
    });
  }, [rows, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => abortMap.current.forEach(c => c.abort()), []);

  const processFile = useCallback(async (file: File, rowId: string, slotId: string, whiteBgOverride?: boolean) => {
    if (!file.type.startsWith('image/')) return;
    abortMap.current.get(slotId)?.abort();
    const ctrl = new AbortController();
    abortMap.current.set(slotId, ctrl);

    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      return { ...r, slots: r.slots.map(s => s.id === slotId ? { ...s, status: 'processing', error: null } : s) };
    }));

    try {
      // When whiteBg is ON → call remove.bg; when OFF → use original file (saves credits)
      const shouldRemoveBg = whiteBgOverride !== undefined ? whiteBgOverride : useWhiteBg;
      const bgBlob: Blob = shouldRemoveBg
        ? await removeBg(file, ctrl.signal)
        : file;
      if (ctrl.signal.aborted) return;
      const canvas = await makePassportCanvas(file, bgBlob);
      if (ctrl.signal.aborted) return;
      const dataUrl = canvas.toDataURL('image/png');
      setRows(prev => prev.map(r => {
        if (r.id !== rowId) return r;
        return { ...r, slots: r.slots.map(s => s.id === slotId ? { ...s, status: 'done', canvas, dataUrl, error: null } : s) };
      }));
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      const error = friendlyError(err);
      setRows(prev => prev.map(r => {
        if (r.id !== rowId) return r;
        return { ...r, slots: r.slots.map(s => s.id === slotId ? { ...s, status: 'error', canvas: null, error } : s) };
      }));
    } finally { abortMap.current.delete(slotId); }
  }, [useWhiteBg]);

  // Start a brand-new physical row from an uploaded file (first photo in that row)
  const addNewRow = (file: File) => {
    if (!canAddRow) return;
    const slot = newSlot();
    const rowId = crypto.randomUUID();
    setRows(prev => [...prev, { id: rowId, slots: [slot] }]);
    processFile(file, rowId, slot.id);
  };

  // Add another (independent) photo into an existing row — up to 5 physical slots per row
  const addSlotToRow = (rowId: string, file: File) => {
    const row = rows.find(r => r.id === rowId);
    if (!row || expandRowVisual(row.slots).length >= PER_ROW) return;
    const slot = newSlot();
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, slots: [...r.slots, slot] } : r));
    processFile(file, rowId, slot.id);
  };

  const removeSlot = (rowId: string, slotId: string) => {
    abortMap.current.get(slotId)?.abort();
    setRows(prev => prev
      .map(r => r.id === rowId ? { ...r, slots: r.slots.filter(s => s.id !== slotId) } : r)
      .filter(r => r.slots.length > 0));
  };

  // Clicking the X on a *duplicate* tile (a repeated copy within its row)
  // just removes one copy instead of deleting the whole photo.
  const decrementRowCopy = (rowId: string, slotId: string) => {
    setRows(prev => prev.map(r => r.id !== rowId ? r : {
      ...r, slots: r.slots.map(s => s.id === slotId ? { ...s, copiesInRow: Math.max(1, s.copiesInRow - 1) } : s),
    }));
  };

  const removeRow = (rowId: string) => {
    const row = rows.find(r => r.id === rowId);
    row?.slots.forEach(s => abortMap.current.get(s.id)?.abort());
    setRows(prev => prev.filter(r => r.id !== rowId));
  };

  const retrySlot = (rowId: string, slotId: string) => {
    if (retryFileRef.current) {
      retryFileRef.current.setAttribute('data-row-id', rowId);
      retryFileRef.current.setAttribute('data-slot-id', slotId);
      retryFileRef.current.click();
    }
  };

  const setSlotProp = (rowId: string, slotId: string, patch: Partial<Pick<PhotoSlot, 'brightness' | 'saturation' | 'sharpness' | 'totalCopies'>>) =>
    setRows(prev => prev.map(r => r.id !== rowId ? r : {
      ...r, slots: r.slots.map(s => s.id === slotId ? { ...s, ...patch } : s),
    }));

  // "Copies in this row" — repeats a photo within its own row, capped so the
  // row never exceeds PER_ROW physical slots shared with its other photos.
  const setCopiesInRow = (rowId: string, slotId: string, next: number) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const others = r.slots.filter(s => s.id !== slotId)
        .reduce((sum, s) => sum + Math.max(1, Math.min(s.copiesInRow, PER_ROW)), 0);
      const max = Math.max(1, PER_ROW - others);
      const clamped = Math.max(1, Math.min(next, max));
      return { ...r, slots: r.slots.map(s => s.id === slotId ? { ...s, copiesInRow: clamped } : s) };
    }));
  };

  // "Total copies on sheet" — auto-fills extra rows elsewhere on the sheet
  // so this specific photo reaches the requested total (0 = off, 5–30 step 5).
  const setTotalCopies = (rowId: string, slotId: string, next: number) => {
    const clamped = Math.max(0, Math.min(MAX_ROWS * PER_ROW, Math.round(next / 5) * 5));
    setSlotProp(rowId, slotId, { totalCopies: clamped });
  };

  const onDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop      = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f && canAddRow) addNewRow(f); };

  const handleDownload = () => {
    const renderRows = sheetRows.map(r => ({
      slots: r.slots.filter(s => s.canvas)
        .map(s => ({ canvas: s.canvas!, brightness: s.brightness, saturation: s.saturation, sharpness: s.sharpness })),
    })).filter(r => r.slots.length > 0);
    if (renderRows.length) downloadPdf(renderRows, totalPhotos);
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
            Upload photos — we remove backgrounds and crop faces to exact <strong>35×45 mm</strong> Indian passport standard.
            Choose 1–5 photos per row and mix different people freely, across up to <strong>{MAX_ROWS} rows</strong> on one A4 sheet.
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
                onClick={() => newRowFileRef.current?.click()}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && newRowFileRef.current?.click()}
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
                  onClick={e => { e.stopPropagation(); newRowFileRef.current?.click(); }}
                  className="mt-1 bg-primary text-white text-sm font-semibold px-6 py-2.5 rounded-full shadow-sm hover:bg-primary/90 transition-all"
                >
                  Choose Photo
                </button>
              </div>
            )}

            {/* Row groups */}
            <AnimatePresence initial={false}>
              {rows.map((row, rowIdx) => (
                <motion.div key={row.id}
                  initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }} transition={{ duration: 0.2 }}
                  className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden"
                >
                  {/* Row header */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50/60">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                      {rowIdx + 1}
                    </div>
                    <span className="text-sm font-semibold text-primary flex-1">
                      Row {rowIdx + 1}
                      <span className="ml-2 text-xs font-normal text-gray-400">{expandRowVisual(row.slots).length}/{PER_ROW} slots filled in this row</span>
                    </span>
                    <button onClick={() => removeRow(row.id)} aria-label={`Remove row ${rowIdx + 1}`}
                      className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-red-50 flex items-center justify-center text-gray-400 hover:text-red-400 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Slot tiles — up to 5 physical slots side by side; a photo with
                      "copies in this row" > 1 fills consecutive slots with itself */}
                  <div className="px-4 py-4 flex flex-col gap-4">
                    {(() => {
                      const visual = expandRowVisual(row.slots);
                      const firstOccurrence = new Map<string, number>();
                      visual.forEach((s, idx) => { if (!firstOccurrence.has(s.id)) firstOccurrence.set(s.id, idx); });
                      return (
                        <div className="grid grid-cols-5 gap-2">
                          {Array.from({ length: PER_ROW }, (_, col) => {
                            const slot = visual[col];
                            if (!slot) {
                              const isNextOpenSlot = col === visual.length;
                              return (
                                <button
                                  key={col}
                                  disabled={!isNextOpenSlot}
                                  onClick={() => {
                                    if (!isNextOpenSlot) return;
                                    addSlotFileRef.current?.setAttribute('data-row-id', row.id);
                                    addSlotFileRef.current?.click();
                                  }}
                                  aria-label="Add another photo to this row"
                                  className={`rounded-lg border-2 border-dashed flex items-center justify-center transition-all
                                    ${isNextOpenSlot ? 'border-gray-200 hover:border-accent/60 hover:bg-accent/5 text-gray-300 hover:text-accent cursor-pointer' : 'border-gray-100 text-gray-100 cursor-not-allowed'}`}
                                  style={{ aspectRatio: '35/45' }}
                                >
                                  <Plus className="w-5 h-5" />
                                </button>
                              );
                            }
                            const isDuplicateTile = firstOccurrence.get(slot.id) !== col;
                            return (
                              <div key={`${slot.id}-${col}`} className="relative rounded-lg overflow-hidden border border-gray-200 shadow-sm group" style={{ aspectRatio: '35/45', background: '#fff' }}>
                                {slot.status === 'processing' && (
                                  <div className="w-full h-full flex items-center justify-center bg-gray-50">
                                    <Loader2 className="w-5 h-5 animate-spin text-accent" />
                                  </div>
                                )}
                                {slot.status === 'error' && (
                                  <button onClick={() => retrySlot(row.id, slot.id)}
                                    className="w-full h-full flex flex-col items-center justify-center gap-1 bg-red-50 text-red-400 text-[10px] font-medium px-1 text-center">
                                    <AlertCircle className="w-4 h-4" />
                                    Retry
                                  </button>
                                )}
                                {slot.status === 'done' && slot.dataUrl && (
                                  <img
                                    src={slot.dataUrl} alt=""
                                    className="w-full h-full object-cover block"
                                    style={{ background: '#fff', filter: buildFilterString(slot.brightness, slot.saturation, slot.sharpness) === 'none' ? undefined : buildFilterString(slot.brightness, slot.saturation, slot.sharpness) }}
                                  />
                                )}
                                {isDuplicateTile && (
                                  <span className="absolute bottom-1 left-1 bg-black/50 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-md">
                                    copy
                                  </span>
                                )}
                                <button
                                  onClick={() => isDuplicateTile ? decrementRowCopy(row.id, slot.id) : removeSlot(row.id, slot.id)}
                                  aria-label={isDuplicateTile ? 'Remove this copy' : 'Remove this photo'}
                                  className="absolute top-1 right-1 w-5 h-5 rounded-md bg-black/50 hover:bg-red-500 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {expandRowVisual(row.slots).length < PER_ROW && (
                      <button
                        onClick={() => { addSlotFileRef.current?.setAttribute('data-row-id', row.id); addSlotFileRef.current?.click(); }}
                        className="flex items-center justify-center gap-2 py-2 rounded-xl border-2 border-dashed border-gray-200 hover:border-accent/60 hover:bg-accent/5 text-gray-400 hover:text-accent text-xs font-medium transition-all"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add another photo to this row ({expandRowVisual(row.slots).length}/{PER_ROW})
                      </button>
                    )}

                    {/* Per-photo adjustment controls */}
                    {row.slots.filter(s => s.status === 'done').map((slot, i) => {
                      const rowMax = Math.max(1, PER_ROW - row.slots.filter(s => s.id !== slot.id)
                        .reduce((sum, s) => sum + Math.max(1, Math.min(s.copiesInRow, PER_ROW)), 0));
                      return (
                      <div key={slot.id} className="flex flex-col gap-3 pt-3 border-t border-gray-100 first:border-t-0 first:pt-0">
                        <p className="text-[11px] font-semibold text-gray-400">Photo {i + 1} adjustments</p>

                        {/* Copies within this row */}
                        <div className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Copy className="w-4 h-4 text-gray-400 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-primary">Copies in this row</p>
                              <p className="text-[10px] text-gray-400">Repeat this photo in Row {rowIdx + 1} (max {rowMax})</p>
                            </div>
                          </div>
                          <Stepper value={slot.copiesInRow} min={1} max={rowMax} step={1}
                            onChange={n => setCopiesInRow(row.id, slot.id, n)} />
                        </div>

                        <div className="flex items-center gap-3">
                          <Sun className="w-4 h-4 text-gray-400 shrink-0" />
                          <input
                            type="range" min={50} max={160} step={1}
                            value={slot.brightness}
                            onChange={e => setSlotProp(row.id, slot.id, { brightness: Number(e.target.value) })}
                            className="flex-1 h-1.5 rounded-full accent-primary cursor-pointer"
                          />
                          <button
                            onClick={() => setSlotProp(row.id, slot.id, { brightness: 100 })}
                            className="text-[11px] text-gray-400 hover:text-primary transition-colors w-8 text-right shrink-0"
                          >
                            {slot.brightness}%
                          </button>
                        </div>
                        <div className="flex items-center gap-3">
                          <Droplets className="w-4 h-4 text-gray-400 shrink-0" />
                          <input
                            type="range" min={0} max={200} step={1}
                            value={slot.saturation}
                            onChange={e => setSlotProp(row.id, slot.id, { saturation: Number(e.target.value) })}
                            className="flex-1 h-1.5 rounded-full accent-primary cursor-pointer"
                          />
                          <button
                            onClick={() => setSlotProp(row.id, slot.id, { saturation: 100 })}
                            className="text-[11px] text-gray-400 hover:text-primary transition-colors w-8 text-right shrink-0"
                          >
                            {slot.saturation}%
                          </button>
                        </div>
                        <div className="flex items-center gap-3">
                          <SlidersHorizontal className="w-4 h-4 text-gray-400 shrink-0" />
                          <input
                            type="range" min={90} max={140} step={1}
                            value={slot.sharpness}
                            onChange={e => setSlotProp(row.id, slot.id, { sharpness: Number(e.target.value) })}
                            className="flex-1 h-1.5 rounded-full accent-primary cursor-pointer"
                          />
                          <button
                            onClick={() => setSlotProp(row.id, slot.id, { sharpness: 100 })}
                            className="text-[11px] text-gray-400 hover:text-primary transition-colors w-8 text-right shrink-0"
                          >
                            {slot.sharpness}%
                          </button>
                        </div>

                        {/* Total copies across the whole sheet */}
                        <div className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-3 py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Layers className="w-4 h-4 text-gray-400 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-primary">Total copies on sheet</p>
                              <p className="text-[10px] text-gray-400">
                                {slot.totalCopies > 0 ? `Auto-fills extra rows to reach ${slot.totalCopies} total` : 'Off — uses only this row'}
                              </p>
                            </div>
                          </div>
                          <Stepper value={slot.totalCopies} min={0} max={MAX_ROWS * PER_ROW} step={5}
                            onChange={n => setTotalCopies(row.id, slot.id, n)}
                            format={n => n === 0 ? 'Off' : String(n)} />
                        </div>
                      </div>
                      );
                    })}

                    {row.slots.some(s => s.status === 'done') && (
                      <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                        {row.slots.filter(s => s.status === 'done').length}/{row.slots.length} photos ready in this row
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Add new row */}
            {rows.length > 0 && (
              <div>
                {canAddRow ? (
                  <button onClick={() => newRowFileRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-gray-200 hover:border-accent/60 hover:bg-accent/5 text-gray-400 hover:text-accent text-sm font-medium transition-all">
                    <Plus className="w-4 h-4" />
                    Add row {rows.length + 1}
                    <span className="text-gray-300 text-xs">({rows.length}/{MAX_ROWS} rows used)</span>
                  </button>
                ) : (
                  <p className="text-center text-xs text-gray-400 py-2">
                    A4 sheet full — {MAX_ROWS} rows / up to {MAX_ROWS * PER_ROW} photos maximum
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Right: A4 Preview ── */}
          {(doneSlots.length > 0 || rows.some(r => r.slots.some(s => s.status === 'processing'))) && (
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              className="w-full lg:w-64 xl:w-72 shrink-0 flex flex-col gap-4"
            >
              {/* Preview card */}
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-primary">A4 Preview</p>
                  <p className="text-[11px] text-gray-400">
                    {doneSlots.length}/{totalPhotos} ready
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
                onClick={handleDownload} disabled={doneSlots.length === 0}
                className="flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold bg-primary text-white hover:bg-primary/90 shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                Download A4 PDF
              </button>
              <p className="text-[10px] text-gray-400 text-center -mt-2">
                {rows.length} row{rows.length !== 1 ? 's' : ''} · {totalPhotos} photo{totalPhotos !== 1 ? 's' : ''} · Print at 100%
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
              { n: '3', t: 'Build rows', d: 'Choose 1–5 photos per row — mix different people and add more anytime.' },
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
      <input ref={newRowFileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) addNewRow(f); e.target.value = ''; }} />
      <input ref={addSlotFileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          const rowId = addSlotFileRef.current?.getAttribute('data-row-id');
          if (f && rowId) addSlotToRow(rowId, f);
          e.target.value = '';
        }} />
      <input ref={retryFileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          const rowId = retryFileRef.current?.getAttribute('data-row-id');
          const slotId = retryFileRef.current?.getAttribute('data-slot-id');
          if (f && rowId && slotId) processFile(f, rowId, slotId);
          e.target.value = '';
        }} />
    </div>
  );
}
