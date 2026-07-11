---
name: print-sahyogi auth architecture
description: Auth approach for the EZONE Helper (print-sahyogi) app — Supabase built-in Auth, anon key only, no Replit DB/Auth.
---

The user explicitly wants this app to run entirely on their own Supabase project, using only the two secrets they set themselves (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) — not Replit's built-in Postgres/Drizzle or Replit Auth, and not a custom backend requiring `SUPABASE_SERVICE_ROLE_KEY`.

**Decision:** auth uses Supabase's built-in Auth (`supabase.auth.signUp` / `signInWithPassword` / `onAuthStateChange`), callable directly from the browser with the anon key. Username and role are stored in `user_metadata` at signup (no separate `profiles`/`app_users` table, no service-role secret).

**Username-only UX (no email field anywhere):** the user explicitly rejected an email-based login UI ("only username and password, not emails at all"). Since Supabase Auth requires an email internally, the frontend synthesizes a stable non-routable email as `username@users.ezone-helper.local` behind the scenes — never shown to the user, never collected as a separate field. Keep this synthetic-email approach if Supabase auth is touched again; do not reintroduce a visible email input.

**Why:** an earlier iteration had a custom `app_users` table (client-side sha256 password hashing) plus a duplicate Express `/api/auth` route requiring `SUPABASE_SERVICE_ROLE_KEY` — the user rejected introducing that extra secret/backend-privileged pattern in favor of Supabase's own auth primitives.

**How to apply:** if asked to add roles/admin features, prefer `user_metadata` (or a table the user creates themselves via the Supabase dashion, since this agent has no service-role key or SQL migration access) over introducing a service-role secret. Promoting a user to admin currently requires manual edit in the Supabase dashboard (no admin API available without service role key).
