import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function headers(extra?: Record<string, string>) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = (req.body ?? {}) as Record<string, string>;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required.' });

  const clean = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(clean))
    return res.status(400).json({ error: 'Username must be 3–20 characters: letters, numbers, underscores only.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const base = process.env.SUPABASE_URL!;

  // Check existing
  const checkRes = await fetch(
    `${base}/rest/v1/app_users?username=eq.${encodeURIComponent(clean)}&select=id&limit=1`,
    { headers: headers() },
  );
  const existing = (await checkRes.json()) as { id: string }[];
  if (existing.length > 0)
    return res.status(409).json({ error: 'Username already taken. Please choose another.' });

  // Insert
  const insertRes = await fetch(`${base}/rest/v1/app_users`, {
    method: 'POST',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify({ username: clean, password_hash: sha256(password) }),
  });
  const rows = (await insertRes.json()) as { id: string; username: string; role: string }[];
  const user = rows[0];

  if (!user) return res.status(500).json({ error: 'Registration failed. Try again.' });

  return res.json({ user: { id: user.id, username: user.username, role: user.role } });
}
