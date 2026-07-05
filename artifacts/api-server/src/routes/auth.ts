import { Router, type IRouter } from "express";
import { createHash } from "crypto";
import { db, appUsers } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

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

  const existing = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.username, clean)).limit(1);
  if (existing.length > 0)
    return res.status(409).json({ error: "Username already taken. Please choose another." });

  const [user] = await db
    .insert(appUsers)
    .values({ username: clean, passwordHash: sha256(password) })
    .returning({ id: appUsers.id, username: appUsers.username });

  return res.json({ user: { id: user.id, username: user.username } });
});

// POST /api/auth/login
router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body as Record<string, string>;

  if (!username || !password)
    return res.status(400).json({ error: "Username and password are required." });

  const [user] = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.username, username.trim().toLowerCase()))
    .limit(1);

  if (!user || user.passwordHash !== sha256(password))
    return res.status(401).json({ error: "Invalid username or password." });

  return res.json({ user: { id: user.id, username: user.username } });
});

export default router;
