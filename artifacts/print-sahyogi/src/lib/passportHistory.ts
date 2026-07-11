const HISTORY_KEY = 'ezone_passport_history';
const MAX_SESSIONS = 8;

export interface HistoryPhoto {
  dataUrl: string;
  brightness: number;
  saturation: number;
  sharpness: number;
}

export interface HistoryRow {
  slots: HistoryPhoto[]; // 1–5 independent photos in one physical row
}

export interface HistorySession {
  id: string;
  createdAt: string;
  rows: HistoryRow[];
}

export function getAllSessions(): HistorySession[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'); }
  catch { return []; }
}

export function getSession(id: string): HistorySession | null {
  return getAllSessions().find(s => s.id === id) ?? null;
}

export function upsertSession(session: HistorySession): void {
  try {
    const all = getAllSessions().filter(s => s.id !== session.id);
    all.unshift(session);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all.slice(0, MAX_SESSIONS)));
  } catch (e) {
    console.warn('Could not save passport session:', e);
  }
}

export function deleteSession(id: string): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(getAllSessions().filter(s => s.id !== id)));
  } catch {}
}

export function clearAllSessions(): void {
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
}

export function estimateStorageKB(): number {
  try { return Math.round((localStorage.getItem(HISTORY_KEY) ?? '').length * 2 / 1024); }
  catch { return 0; }
}
