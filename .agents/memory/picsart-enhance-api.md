---
name: Picsart Ultra Enhance API contract
description: Endpoint/params for Picsart's enhance+upscale API, used by print-sahyogi's passport photo maker.
---

Endpoint: `POST https://api.picsart.io/tools/1.0/upscale/enhance`, auth via `x-picsart-api-key` header (not a query param or bearer token).

Multipart form fields: `image` (file) or `image_url` (mutually exclusive), `upscale_factor` (2-16, default 2), `format` (JPG/PNG/WEBP, default JPG).

Response is JSON (not raw image bytes) — `{ data: { url: <hosted result image URL> } }`. Must fetch that URL separately to get the actual image bytes.

**Why:** Easy to assume the API streams the image back directly like remove.bg does; it doesn't — always returns a JSON pointer to a hosted result.

**How to apply:** Any proxy calling this endpoint must parse the JSON response and do a second fetch for the image bytes before returning to the client.
