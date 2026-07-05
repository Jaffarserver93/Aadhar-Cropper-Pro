import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { username, password } = req.body as Record<string, string>;

  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required.' });

  const clean = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(clean))
    return res.status(400).json({
      error: 'Username must be 3–20 characters: letters, numbers, underscores only.',
    });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const { data: existing } = await supabase
    .from('app_users')
    .select('id')
    .eq('username', clean)
    .maybeSingle();

  if (existing)
    return res.status(409).json({ error: 'Username already taken. Please choose another.' });

  const { data: user, error } = await supabase
    .from('app_users')
    .insert({ username: clean, password_hash: sha256(password) })
    .select('id, username')
    .single();

  if (error || !user) return res.status(500).json({ error: 'Registration failed. Try again.' });

  return res.json({ user: { id: user.id, username: user.username } });
}
