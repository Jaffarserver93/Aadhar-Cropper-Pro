import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { api: { bodyParser: false } };

const PICSART_URL = 'https://api.picsart.io/tools/1.0/upscale/enhance';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env['PICSART_API_KEY'];
  if (!apiKey) return res.status(503).json({ error: 'Image enhancement service is not configured.' });

  const contentType = req.headers['content-type'] ?? '';

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const rawBody = Buffer.concat(chunks);

  try {
    const upstream = await fetch(PICSART_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'x-picsart-api-key': apiKey,
        'Content-Type': contentType,
      },
      body: rawBody,
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      const status = upstream.status === 402 ? 402 : upstream.status === 429 ? 429 : 502;
      return res.status(status).json({ error: `Picsart: ${text}` });
    }

    const json: any = await upstream.json();
    const resultUrl = json?.data?.url || json?.data?.image?.url;
    if (!resultUrl) return res.status(502).json({ error: 'Picsart: no result image returned.' });

    const resultImage = await fetch(resultUrl);
    if (!resultImage.ok) return res.status(502).json({ error: 'Could not download enhanced image.' });

    const pngBuffer = Buffer.from(await resultImage.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pngBuffer);
  } catch (err: any) {
    console.error('enhance proxy error:', err);
    res.status(502).json({ error: 'Could not reach image enhancement service.' });
  }
}
