import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env['REMOVEBG_API_KEY'];
  if (!apiKey) return res.status(503).json({ error: 'Background removal service is not configured.' });

  const contentType = req.headers['content-type'] ?? '';

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const rawBody = Buffer.concat(chunks);

  try {
    const upstream = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': contentType,
      },
      body: rawBody,
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      const status = upstream.status === 402 ? 402 : upstream.status === 429 ? 429 : 502;
      return res.status(status).json({ error: `remove.bg: ${text}` });
    }

    const pngBuffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pngBuffer);
  } catch (err: any) {
    console.error('removebg proxy error:', err);
    res.status(502).json({ error: 'Could not reach background removal service.' });
  }
}
