import { Router, type IRouter } from "express";
import multer from "multer";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

const REMOVEBG_URL = "https://api.remove.bg/v1.0/removebg";

router.post("/removebg", upload.single("image_file"), async (req, res) => {
  const apiKey = process.env["REMOVEBG_API_KEY"];
  if (!apiKey) {
    res.status(503).json({ error: "Background removal service is not configured." });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No image_file provided." });
    return;
  }

  try {
    const form = new FormData();
    form.append(
      "image_file",
      new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype }),
      req.file.originalname || "photo.jpg",
    );
    form.append("size", "auto");

    const rbRes = await fetch(REMOVEBG_URL, {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
      body: form,
    });

    if (!rbRes.ok) {
      let message = `remove.bg request failed (${rbRes.status}).`;
      try {
        const json: any = await rbRes.json();
        message = json?.errors?.[0]?.title || message;
      } catch { /* response wasn't JSON */ }
      const status = rbRes.status === 402 ? 402 : rbRes.status === 429 ? 429 : rbRes.status === 403 ? 401 : 502;
      res.status(status).json({ error: message });
      return;
    }

    const pngBuffer = Buffer.from(await rbRes.arrayBuffer());
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "private, no-store");
    res.send(pngBuffer);
  } catch (err: any) {
    logger.error({ err }, "remove.bg proxy error");
    res.status(502).json({ error: err?.message || "Could not reach background removal service." });
  }
});

export default router;
