import { Router, type IRouter } from "express";
import multer from "multer";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

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

    const upstream = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
      body: form,
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      logger.warn({ status: upstream.status, body: text }, "remove.bg error");
      const status = upstream.status === 402 ? 402 : upstream.status === 429 ? 429 : 502;
      res.status(status).json({ error: `remove.bg: ${text}` });
      return;
    }

    const pngBuffer = Buffer.from(await upstream.arrayBuffer());
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "private, no-store");
    res.send(pngBuffer);
  } catch (err: any) {
    logger.error({ err }, "remove.bg proxy fetch error");
    res.status(502).json({ error: "Could not reach background removal service." });
  }
});

export default router;
