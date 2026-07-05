const AUTH_KEY = 'ezone_auth';

export interface AppUser {
  id: string;
  username: string;
  role: 'user' | 'admin';
}

// ── Storage ───────────────────────────────────────────────────────────────────
export function getStoredUser(): AppUser | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as AppUser) : null;
  } catch {
    return null;
  }
}
export function storeUser(user: AppUser) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
}
export function clearStoredUser() {
  localStorage.removeItem(AUTH_KEY);
}

// ── API base (relative — works via Replit proxy routing) ──────────────────────
const BASE = '/api';

async function apiPost<T>(path: string, body: object): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error ?? 'Unexpected error.' };
    return { data: json as T, error: null };
  } catch {
    return { data: null, error: 'Could not reach server. Please try again.' };
  }
}

// ── Auth actions ──────────────────────────────────────────────────────────────
export async function customSignIn(
  username: string,
  password: string,
): Promise<{ user: AppUser | null; error: string | null }> {
  const { data, error } = await apiPost<{ user: AppUser }>('/auth/login', { username, password });
  if (error || !data) return { user: null, error: error ?? 'Login failed.' };
  storeUser(data.user);
  return { user: data.user, error: null };
}

export async function customRegister(
  username: string,
  password: string,
): Promise<{ user: AppUser | null; error: string | null }> {
  const { data, error } = await apiPost<{ user: AppUser }>('/auth/register', { username, password });
  if (error || !data) return { user: null, error: error ?? 'Registration failed.' };
  storeUser(data.user);
  return { user: data.user, error: null };
}

export function customSignOut() {
  clearStoredUser();
}
