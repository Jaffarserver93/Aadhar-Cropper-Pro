// Vercel serverless function — proxies image uploads to the Picsart
// Ultra Enhance API (upscale + enhance), keeping the API key server-side.
//
// The client sends a multipart form with fields `image`, `upscale_factor`,
// and `format` — the exact shape Picsart's API expects — so this function
// can forward the raw body untouched instead of re-parsing multipart data.

export const config = {
  api: {
    bodyParser: false,
  },
};

const PICSART_ENHANCE_URL = 'https://api.picsart.io/tools/1.0/upscale/enhance';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.PICSART_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'Image enhancement service is not configured.' });
    return;
  }

  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const rawBody = Buffer.concat(chunks);
  const contentType = req.headers['content-type'] || '';

  try {
    const upstream = await fetch(PICSART_ENHANCE_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'x-picsart-api-key': apiKey,
        'Content-Type': contentType,
      },
      body: rawBody,
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      const status = upstream.status === 402 ? 402 : upstream.status === 429 ? 429 : 502;
      res.status(status).json({ error: `Picsart enhance: ${text}` });
      return;
    }

    const json = await upstream.json();
    const resultUrl = json?.data?.url || json?.data?.image?.url;
    if (!resultUrl) {
      res.status(502).json({ error: 'Picsart enhance: no result image returned.' });
      return;
    }

    const resultImage = await fetch(resultUrl);
    if (!resultImage.ok) {
      res.status(502).json({ error: 'Could not download enhanced image.' });
      return;
    }
    const pngBuffer = Buffer.from(await resultImage.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pngBuffer);
  } catch (err) {
    console.error('Picsart enhance proxy error:', err);
    res.status(502).json({ error: 'Could not reach image enhancement service.' });
  }
}
