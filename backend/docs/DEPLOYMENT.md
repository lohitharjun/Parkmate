# Deployment guide (Render + Supabase + Vercel)

Nothing here can be done from the code alone: it needs your Render, Supabase and Vercel accounts. Do the steps in order.

## 0. Before you share or push anything
1. **Reset the database password** (it was in a `.env` / `DATABASE_URL` you have used while the zip was shared): Supabase → Project Settings → Database → *Reset database password*. Update your local `.env`.
2. Make sure `.env` and `node_modules` are never committed: `git status` must not list them (`.gitignore` already covers both).
3. `npm run scan:secrets` must say `clean (tracked files)` (it only checks files tracked by git).
4. To share a zip without `.env` / `node_modules`: after committing run `npm run pack` (uses `git archive`, which only contains committed files).

## 1. Which database will the live site use?
Use a **separate production Supabase project** (recommended) or, for a demo, your dev project. On whichever one the live site uses, in the SQL editor:
1. Fresh project: run `supabase/schema.sql` once. (If tables from the old 001 already exist: run missing migrations `002`…`009` in order, never `schema.sql` on top.)
2. Run `supabase/migrations/004_grants.sql` content only if you ran migrations separately (it is already inside `schema.sql`).
3. Optional demo data: create one user in Authentication → Users, `INSERT INTO profiles (id) SELECT id FROM auth.users LIMIT 1;`, then run `supabase/seed.sql`. Demo rows have `is_demo = true`; the frontend must label them as demonstration data.
4. Promote an admin (after that person has signed up):
   `INSERT INTO profiles (id, is_admin) SELECT id, true FROM auth.users WHERE email = 'ADMIN_EMAIL' ON CONFLICT (id) DO UPDATE SET is_admin = true;`
5. Verify: `npm run test:db` against that database (it creates and removes its own `@parkmate.test` users; only run it on dev/staging, not on a database with real users).

## 2. Deploy the backend on Render
1. Push the repo to GitHub.
2. Render → **New + → Blueprint** → pick the repo (it reads `render.yaml`), or **New + → Web Service** with: build `npm install`, start `npm start`, health check path `/health`.
3. Environment variables (Render dashboard → Environment):

| Key | Value |
|---|---|
| `DATABASE_URL` | Supabase **Session pooler** URI of the database from step 1 |
| `SUPABASE_URL` | `https://<ref>.supabase.co` of the same project |
| `SUPABASE_ANON_KEY` | anon / publishable key of the same project (never the service-role key) |
| `CORS_ORIGINS` | `http://localhost:5173,https://<your-app>.vercel.app,*.vercel.app` |
| `DB_SSL` | `true` |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key of the same project. **Server only, never in the frontend.** Needed for photo upload/signed URLs and account deletion. Without it the photo routes answer `503 NOT_CONFIGURED` |
| `PHOTO_BUCKET` | optional, default `listing-photos` (created private by migration `008`) |
| `PHOTO_URL_TTL_SECONDS` | optional, default `3600` (signed photo links; 60 to 86400) |
| `MAX_PHOTO_BYTES` | optional, default `5242880` (5 MB; keep it at or below the bucket limit set in `008`) |

   `PORT` is set by Render automatically.
4. After the first deploy, test the public URL:
```bash
curl -i https://<service>.onrender.com/health        # 200 {"status":"ok","db":"up"}
curl -i https://<service>.onrender.com/api/listings   # 200 {"data":[...]}
curl -i -X POST https://<service>.onrender.com/api/bookings -H "Content-Type: application/json" -d "{}"   # 401
```
5. Free Render services sleep after inactivity: the first request can take ~30 s. Tell the team before a demo.
6. CORS check from a browser origin: `curl -i -H "Origin: https://<your-app>.vercel.app" https://<service>.onrender.com/health` must contain `access-control-allow-origin`; with `Origin: https://evil.com` it must not.

### Photo storage check (after migration `008`)
1. Supabase → Storage: a bucket named `listing-photos` must exist and be marked **Private** (migration `008` creates it; do not add public policies).
2. With a provider token: `curl -i -X POST "https://<service>.onrender.com/api/listings/<id>/photos" -H "Authorization: Bearer <token>" -H "Content-Type: image/jpeg" --data-binary @photo.jpg` → `201`. The returned `url` should open the picture; the same path without the signed token must fail.
3. Orphans: if a delete ever fails half-way a private file can remain in the bucket; it is not reachable by anyone and can be removed in the Storage UI.

## 3. Supabase Auth settings (Nilesh needs these)
Supabase → Authentication → **URL Configuration**:
- **Site URL:** the Vercel production URL, e.g. `https://<your-app>.vercel.app`
- **Redirect URLs:** add `https://<your-app>.vercel.app/**`, `https://*-<team>.vercel.app/**` (previews), `http://localhost:5173/**`
- Email verification and password-reset links use the Site URL, so the pages they land on (e.g. `/auth/callback`, `/reset-password`) must exist in the frontend. Agree the paths with Nilesh.
- Authentication → Providers → Email: keep *Confirm email* on for production. For the free tier, the built-in mailer is rate limited (a few emails per hour); configure custom SMTP before a real launch.

## 4. Hand-off checklist for Nilesh
- API base URL: `https://<service>.onrender.com/api` · health: `/health` (and `/api/health`)
- Contract: `docs/api-contract.md` (errors, codes, fields, new endpoints)
- Supabase project URL + anon key for his sign-in code (anon key is public by design; the service-role key must never leave the server)

## 5. Account deletion (migration 010)
1. **Database first:** run `supabase/migrations/010_account_deletion.sql` in the Supabase SQL editor *before* deploying this version of the backend. The login code reads `profiles.deletion_requested_at`, so the new code fails on a database without it.
2. Web service env vars (optional): `DELETION_GRACE_DAYS` (default 30, max 90) and `REAUTH_WINDOW_SECONDS` (default 300; `0` turns the fresh-login check off, only for local testing).
3. **Daily purge job.** Render → New + → **Cron Job**, same repo and branch. Build command `npm install`, command `npm run purge:accounts`, schedule `0 21 * * *` (UTC; 02:30 IST). Give it the same environment variables as the web service (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DELETION_GRACE_DAYS`). It prints one JSON line, e.g. `{"due":1,"deleted":1,"skipped":[],"failed":[]}`, and exits with code 1 if any account failed. Accounts that still have upcoming bookings on their listings are `skipped` and retried the next day.
4. Check the fresh-login rule once: decode a real access token (jwt.io, or `echo <token> | cut -d. -f2 | base64 -d`). It should contain an `amr` array with a `timestamp`. If it does not, the server falls back to `iat`.
5. Keep `account_deletion_log` only as long as you need it (it holds user ids). Decide a retention period and delete older rows, e.g. `DELETE FROM account_deletion_log WHERE completed_at < now() - interval '12 months';`.
