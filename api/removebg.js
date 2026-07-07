// Vercel serverless function — proxies image uploads to remove.bg
// keeping the API key server-side.

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.REMOVEBG_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'Background removal service is not configured.' });
    return;
  }

  // Stream the raw multipart body so we can forward it as-is to remove.bg
  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const rawBody = Buffer.concat(chunks);
  const contentType = req.headers['content-type'] || '';

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
      res.status(status).json({ error: `remove.bg: ${text}` });
      return;
    }

    const pngBuffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pngBuffer);
  } catch (err) {
    console.error('remove.bg proxy error:', err);
    res.status(502).json({ error: 'Could not reach background removal service.' });
  }
}
