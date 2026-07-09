import { Router, type IRouter } from "express";
import multer from "multer";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

const PICWISH_TASK_URL = "https://techhk.aoscdn.com/api/tasks/visual/segmentation";
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30_000;

async function createPicwishTask(apiKey: string, file: Express.Multer.File): Promise<string> {
  const form = new FormData();
  form.append(
    "image_file",
    new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
    file.originalname || "photo.jpg",
  );
  form.append("sync", "0");
  form.append("type", "hd");

  const res = await fetch(PICWISH_TASK_URL, {
    method: "POST",
    headers: { "X-API-KEY": apiKey },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`PicWish: ${text}`), { status: res.status });
  }

  const json: any = await res.json();
  const taskId = json?.data?.task_id;
  if (!taskId) {
    throw Object.assign(new Error(json?.message || "PicWish: no task_id returned."), { status: 502 });
  }
  return taskId;
}

async function pollPicwishTask(apiKey: string, taskId: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const res = await fetch(`${PICWISH_TASK_URL}/${taskId}`, {
      headers: { "X-API-KEY": apiKey },
    });
    if (!res.ok) continue;
    const json: any = await res.json();
    const state = json?.data?.state;
    if (state === 1 && json?.data?.image) {
      return json.data.image;
    }
    if (state === -1) {
      throw Object.assign(new Error(json?.data?.error || "PicWish processing failed."), { status: 502 });
    }
  }
  throw Object.assign(new Error("PicWish: processing timed out."), { status: 504 });
}

router.post("/removebg", upload.single("image_file"), async (req, res) => {
  const apiKey = process.env["PICWISH_API_KEY"];
  if (!apiKey) {
    res.status(503).json({ error: "Background removal service is not configured." });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No image_file provided." });
    return;
  }

  try {
    const taskId = await createPicwishTask(apiKey, req.file);
    const resultUrl = await pollPicwishTask(apiKey, taskId);

    const resultImage = await fetch(resultUrl);
    if (!resultImage.ok) {
      res.status(502).json({ error: "Could not download processed image." });
      return;
    }

    const pngBuffer = Buffer.from(await resultImage.arrayBuffer());
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "private, no-store");
    res.send(pngBuffer);
  } catch (err: any) {
    logger.error({ err }, "PicWish proxy error");
    const status = err?.status === 402 ? 402 : err?.status === 429 ? 429 : err?.status === 504 ? 504 : 502;
    res.status(status).json({ error: err?.message || "Could not reach background removal service." });
  }
});

export default router;
