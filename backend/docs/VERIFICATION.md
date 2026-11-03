# How to verify everything (DEV Supabase project only)

## 0. Setup
```powershell
npm install
copy .env.example .env      # Mac/Linux: cp .env.example .env
```
Fill `.env` (DATABASE_URL = **Session pooler** URI, SUPABASE_URL, SUPABASE_ANON_KEY, TEST_PASSWORD). The server refuses to start and tells you which variable is missing or still a `YOUR_...` placeholder.

## 1. Database / migrations (Supabase → SQL Editor)
Fresh project: run `supabase/schema.sql` once. Existing dev project: run the missing files of `supabase/migrations/` in order (`002` … `009`). Never both ways on the same database.

## 2. DB tests (booking constraint, triggers, price, availability, RLS, review rules)
```powershell
npm run test:db
```
Expected: every row `PASS` (the last line prints `N/N passed`; the file now also covers location fields, photos and payment state, so N is higher than before). Output is also saved (UTF-8) to `docs/evidence/db-test-results.txt`.

## 3. Unit tests (no DB needed)
```powershell
npm run test:unit        # validators, Parking Rescue, image sanitiser, offline route tests; expected: 0 failures
```

## 4. Health, DB connected and disconnected
```powershell
npm run test:health      # writes docs/evidence/health-results.md
```
Expected: connected → `200 {"status":"ok","db":"up"}`; disconnected → `503 {"status":"error","db":"down"}`, on both `/health` and `/api/health`.

## 5. Auth, permissions, listings, bookings, concurrency (live API)
1. Supabase → Authentication → Users → add `owner@parkmate.test`, `consumer@parkmate.test`, `admin@parkmate.test` (same password, auto-confirm). Put the password in `.env` as `TEST_PASSWORD`.
2. SQL editor: `INSERT INTO profiles (id, is_admin) SELECT id, true FROM auth.users WHERE email='admin@parkmate.test' ON CONFLICT (id) DO UPDATE SET is_admin = true;`
3. Terminal 1: `npm start`. Terminal 2: `npm run test:api` (saves `docs/evidence/api-test-results.txt`).
   Expected: every test `✔`, including "10 SIMULTANEOUS requests → exactly one 201, nine 409", "booking your own listing → 403", "moving an approved listing → pending" and "alternatives never include my own listings".
4. Clean up the test data (SQL editor): `DELETE FROM bookings WHERE listing_id IN (SELECT id FROM listings WHERE title LIKE 'TEST %'); DELETE FROM availability WHERE listing_id IN (SELECT id FROM listings WHERE title LIKE 'TEST %'); DELETE FROM listings WHERE title LIKE 'TEST %';`

### Photos in the live API test
`npm run test:api` includes a photo upload test. It needs `SUPABASE_SERVICE_ROLE_KEY` in the server's `.env` and migration `008` applied; if the server answers `503 NOT_CONFIGURED` that one test is reported as skipped. The test uploads a synthetic JPEG that contains fake GPS/XMP/IPTC strings and checks they are not in the file returned to consumers.

## 6. Secrets and sharing
```powershell
npm run scan:secrets     # expected: secret-scan: clean (tracked files)
git status               # .env and node_modules must NOT be listed
npm run pack             # clean zip of committed files only (no .env / node_modules)
```
Then reset the database password (see `docs/DEPLOYMENT.md` section 0).

## 7. Deployed API
Follow `docs/DEPLOYMENT.md`; the public checks are `curl -i https://<service>.onrender.com/health` and the CORS check in section 2 there.
