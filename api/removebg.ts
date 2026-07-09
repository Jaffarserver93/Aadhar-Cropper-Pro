import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { api: { bodyParser: false } };

const PICWISH_TASK_URL = 'https://techhk.aoscdn.com/api/tasks/visual/segmentation';
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30_000;

async function pollPicwishTask(apiKey: string, taskId: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const res = await fetch(`${PICWISH_TASK_URL}/${taskId}`, {
      headers: { 'X-API-KEY': apiKey },
    });
    if (!res.ok) continue;
    const json: any = await res.json();
    const state = json?.data?.state;
    if (state === 1 && json?.data?.image) {
      return json.data.image;
    }
    if (state === -1) {
      throw Object.assign(new Error(json?.data?.error || 'PicWish processing failed.'), { status: 502 });
    }
  }
  throw Object.assign(new Error('PicWish: processing timed out.'), { status: 504 });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env['PICWISH_API_KEY'];
  if (!apiKey) return res.status(503).json({ error: 'Background removal service is not configured.' });

  const contentType = req.headers['content-type'] ?? '';

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const rawBody = Buffer.concat(chunks);

  try {
    const createRes = await fetch(`${PICWISH_TASK_URL}?sync=0&output_type=1`, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': contentType,
      },
      body: rawBody,
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      const status = createRes.status === 402 ? 402 : createRes.status === 429 ? 429 : 502;
      return res.status(status).json({ error: `PicWish: ${text}` });
    }

    const createJson: any = await createRes.json();
    const taskId = createJson?.data?.task_id;
    if (!taskId) {
      return res.status(502).json({ error: createJson?.message || 'PicWish: no task_id returned.' });
    }

    const resultUrl = await pollPicwishTask(apiKey, taskId);

    const resultImage = await fetch(resultUrl);
    if (!resultImage.ok) {
      return res.status(502).json({ error: 'Could not download processed image.' });
    }

    const pngBuffer = Buffer.from(await resultImage.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pngBuffer);
  } catch (err: any) {
    console.error('removebg proxy error:', err);
    const status = err?.status === 504 ? 504 : 502;
    res.status(status).json({ error: err?.message || 'Could not reach background removal service.' });
  }
}
