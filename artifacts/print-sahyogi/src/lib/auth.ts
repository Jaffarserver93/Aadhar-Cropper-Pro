import { supabase } from './supabase';
import type { Session, User } from '@supabase/supabase-js';

export interface AppUser {
  id: string;
  username: string;
  role: 'user' | 'admin';
}

// Supabase Auth requires an email internally, but this app is username-only.
// We synthesize a stable, non-routable email from the username so users
// never see or enter an email address anywhere in the UI.
const EMAIL_DOMAIN = 'users.ezone-helper.local';
function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}

function toAppUser(user: User | null | undefined): AppUser | null {
  if (!user) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    id: user.id,
    username: (meta.username as string) ?? (user.email?.split('@')[0] ?? 'user'),
    role: (meta.role as 'user' | 'admin') ?? 'user',
  };
}

export function sessionToUser(session: Session | null): AppUser | null {
  return toAppUser(session?.user);
}

// ── Auth actions (Supabase built-in Auth, username-only UX) ────────────────
export async function signInWithPassword(
  username: string,
  password: string,
): Promise<{ user: AppUser | null; error: string | null }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });

  if (error) return { user: null, error: 'Invalid username or password.' };
  return { user: toAppUser(data.user), error: null };
}

export async function signUpWithPassword(
  username: string,
  password: string,
): Promise<{ user: AppUser | null; needsEmailConfirmation: boolean; error: string | null }> {
  const clean = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(clean)) {
    return {
      user: null,
      needsEmailConfirmation: false,
      error: 'Username must be 3–20 characters: letters, numbers, underscores only.',
    };
  }

  const { data, error } = await supabase.auth.signUp({
    email: usernameToEmail(clean),
    password,
    options: {
      data: { username: clean, role: 'user' },
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes('already registered')) {
      return { user: null, needsEmailConfirmation: false, error: 'Username already taken. Please choose another.' };
    }
    return { user: null, needsEmailConfirmation: false, error: error.message };
  }

  // If Supabase requires email confirmation, no session is returned yet.
  const needsEmailConfirmation = !data.session;
  return { user: toAppUser(data.user), needsEmailConfirmation, error: null };
}

export async function signOut() {
  await supabase.auth.signOut();
}
