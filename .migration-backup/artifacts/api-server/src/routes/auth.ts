import { Router, type IRouter } from "express";
import { createHash } from "crypto";

const router: IRouter = Router();

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function supabaseHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    "Content-Type": "application/json",
    "apikey": key,
    "Authorization": `Bearer ${key}`,
  };
}

function supabaseUrl(path: string) {
  const base = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL)!;
  return `${base}/rest/v1/${path}`;
}

// POST /api/auth/register
router.post("/auth/register", async (req, res) => {
  const { username, password } = req.body as Record<string, string>;

  if (!username || !password)
    return res.status(400).json({ error: "Username and password are required." });

  const clean = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(clean))
    return res.status(400).json({
      error: "Username must be 3–20 characters: letters, numbers, underscores only.",
    });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be at least 6 characters." });

  // Check existing
  const checkRes = await fetch(
    supabaseUrl(`app_users?username=eq.${encodeURIComponent(clean)}&select=id&limit=1`),
    { headers: supabaseHeaders() }
  );
  const existing = await checkRes.json() as { id: string }[];
  if (existing.length > 0)
    return res.status(409).json({ error: "Username already taken. Please choose another." });

  // Insert user
  const insertRes = await fetch(supabaseUrl("app_users"), {
    method: "POST",
    headers: { ...supabaseHeaders(), "Prefer": "return=representation" },
    body: JSON.stringify({ username: clean, password_hash: sha256(password) }),
  });
  const [user] = await insertRes.json() as { id: string; username: string; role: string }[];

  if (!user) return res.status(500).json({ error: "Registration failed. Try again." });

  return res.json({ user: { id: user.id, username: user.username, role: user.role } });
});

// POST /api/auth/login
router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body as Record<string, string>;

  if (!username || !password)
    return res.status(400).json({ error: "Username and password are required." });

  const clean = username.trim().toLowerCase();

  const fetchRes = await fetch(
    supabaseUrl(`app_users?username=eq.${encodeURIComponent(clean)}&select=id,username,password_hash,role&limit=1`),
    { headers: supabaseHeaders() }
  );
  const [user] = await fetchRes.json() as {
    id: string; username: string; password_hash: string; role: string;
  }[];

  if (!user || user.password_hash !== sha256(password))
    return res.status(401).json({ error: "Invalid username or password." });

  return res.json({ user: { id: user.id, username: user.username, role: user.role } });
});

export default router;
