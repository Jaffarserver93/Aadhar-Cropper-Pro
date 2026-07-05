---
name: EZONE custom auth architecture
description: How auth works in EZONE Helper — no email, no Supabase auth, username+password only.
---

## Rule
Do NOT use Supabase Auth for user sign-in/registration. It was removed due to email rate limits.

**Why:** Supabase email-based auth kept triggering rate limit errors. Replaced with fully custom username+password flow.

## How it works
- `app_users` table in Replit Postgres (Drizzle schema at `lib/db/src/schema/appUsers.ts`): `id uuid PK, username text UNIQUE, password_hash text, created_at timestamptz`
- Passwords hashed with SHA-256 (`crypto.createHash('sha256')`) in the API server — no bcrypt, kept simple intentionally.
- API routes in `artifacts/api-server/src/routes/auth.ts`: `POST /api/auth/register` and `POST /api/auth/login`
- Frontend `lib/auth.ts` calls these via relative `/api/auth/...` URLs — the Replit proxy routes them to the API server at `/api`.
- Session is stored in `localStorage` as JSON (`ezone_auth` key); no JWT, no session table.
- `isAdmin` is computed as `user.username === 'admin'` in AuthContext.

## Supabase is still used for
- `registration_codes` table: invite code validation and marking used — done in frontend with anon key.
- `supabase.ts` file stays as-is.

## How to apply
- Any new auth feature (password reset, roles) must go through the API server + Replit Postgres, never Supabase Auth.
- Admin access: register a user with username `admin`.
