import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'crypto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function headers() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = (req.body ?? {}) as Record<string, string>;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required.' });

  const base = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)!;
  const clean = username.trim().toLowerCase();

  const r = await fetch(
    `${base}/rest/v1/app_users?username=eq.${encodeURIComponent(clean)}&select=id,username,password_hash,role&limit=1`,
    { headers: headers() },
  );
  const rows = (await r.json()) as { id: string; username: string; password_hash: string; role: string }[];
  const user = rows[0];

  if (!user || user.password_hash !== sha256(password))
    return res.status(401).json({ error: 'Invalid username or password.' });

  return res.json({ user: { id: user.id, username: user.username, role: user.role } });
}
