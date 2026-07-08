import { Router, type IRouter } from "express";
import multer from "multer";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

const PICSART_ENHANCE_URL = "https://api.picsart.io/tools/1.0/upscale/enhance";

router.post("/enhance", upload.single("image"), async (req, res) => {
  const apiKey = process.env["PICSART_API_KEY"];
  if (!apiKey) {
    res.status(503).json({ error: "Image enhancement service is not configured." });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No image provided." });
    return;
  }

  try {
    const form = new FormData();
    form.append(
      "image",
      new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype }),
      req.file.originalname || "photo.png",
    );
    form.append("upscale_factor", (req.body?.upscale_factor as string) || "2");
    form.append("format", (req.body?.format as string) || "PNG");

    const upstream = await fetch(PICSART_ENHANCE_URL, {
      method: "POST",
      headers: { accept: "application/json", "x-picsart-api-key": apiKey },
      body: form,
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      logger.warn({ status: upstream.status, body: text }, "Picsart enhance error");
      const status = upstream.status === 402 ? 402 : upstream.status === 429 ? 429 : 502;
      res.status(status).json({ error: `Picsart enhance: ${text}` });
      return;
    }

    const json: any = await upstream.json();
    const resultUrl = json?.data?.url || json?.data?.image?.url;
    if (!resultUrl) {
      res.status(502).json({ error: "Picsart enhance: no result image returned." });
      return;
    }

    const resultImage = await fetch(resultUrl);
    if (!resultImage.ok) {
      res.status(502).json({ error: "Could not download enhanced image." });
      return;
    }

    const pngBuffer = Buffer.from(await resultImage.arrayBuffer());
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "private, no-store");
    res.send(pngBuffer);
  } catch (err: any) {
    logger.error({ err }, "Picsart enhance proxy fetch error");
    res.status(502).json({ error: "Could not reach image enhancement service." });
  }
});

export default router;
