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

  const { data: user } = await supabase
    .from('app_users')
    .select('id, username, password_hash')
    .eq('username', username.trim().toLowerCase())
    .maybeSingle();

  if (!user || user.password_hash !== sha256(password))
    return res.status(401).json({ error: 'Invalid username or password.' });

  return res.json({ user: { id: user.id, username: user.username, role: user.role } });
}
