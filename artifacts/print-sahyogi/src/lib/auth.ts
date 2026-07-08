import { supabase } from './supabase';

const AUTH_KEY = 'ezone_auth';

export interface AppUser {
  id: string;
  username: string;
  role: 'user' | 'admin';
}

// ── Browser-compatible SHA-256 ─────────────────────────────────────────────────
async function sha256(message: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
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

// ── Auth actions ──────────────────────────────────────────────────────────────
export async function customSignIn(
  username: string,
  password: string,
): Promise<{ user: AppUser | null; error: string | null }> {
  try {
    const clean = username.trim().toLowerCase();
    const hash = await sha256(password);

    const { data, error } = await supabase
      .from('app_users')
      .select('id, username, role')
      .eq('username', clean)
      .eq('password_hash', hash)
      .maybeSingle();

    if (error) return { user: null, error: 'Login failed. Please try again.' };
    if (!data) return { user: null, error: 'Invalid username or password.' };

    const user: AppUser = { id: data.id, username: data.username, role: data.role };
    storeUser(user);
    return { user, error: null };
  } catch {
    return { user: null, error: 'Could not connect to database. Please try again.' };
  }
}

export async function customRegister(
  username: string,
  password: string,
): Promise<{ user: AppUser | null; error: string | null }> {
  try {
    const clean = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(clean))
      return { user: null, error: 'Username must be 3–20 characters: letters, numbers, underscores only.' };
    if (password.length < 6)
      return { user: null, error: 'Password must be at least 6 characters.' };

    const hash = await sha256(password);

    // Check for existing username
    const { data: existing } = await supabase
      .from('app_users')
      .select('id')
      .eq('username', clean)
      .maybeSingle();

    if (existing) return { user: null, error: 'Username already taken. Please choose another.' };

    // Insert new user
    const { data, error } = await supabase
      .from('app_users')
      .insert({ username: clean, password_hash: hash })
      .select('id, username, role')
      .single();

    if (error || !data) return { user: null, error: 'Registration failed. Try again.' };

    const user: AppUser = { id: data.id, username: data.username, role: data.role };
    storeUser(user);
    return { user, error: null };
  } catch {
    return { user: null, error: 'Could not connect to database. Please try again.' };
  }
}

export function customSignOut() {
  clearStoredUser();
}
