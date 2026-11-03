# Status and open items

## Added 2026-11-01 (Tasks A–D) — what is and is not verified yet
| Check | Status |
|---|---|
| `node --check` on every changed file, `npm run test:unit` (validators, image sanitiser, offline route tests with a fake DB/auth/Storage) | pass (see the count printed by the command) |
| Migrations `007`, `008`, `009` and the new checks in `supabase/tests/db_tests.sql` | **written but NOT run**: needs your dev Supabase project (`npm run test:db`) |
| New live tests in `tests/api.test.js` (location, availability-check, booking reasons, photo upload/review/EXIF) | **written but NOT run**: needs the dev project + a running server (`npm run test:api`) |
| Photo upload against real Supabase Storage | **not run**: needs `SUPABASE_SERVICE_ROLE_KEY` and migration `008` (it creates the private `listing-photos` bucket) |
| The evidence files in `docs/evidence/` | **older than migrations 007–009**; re-run `npm run test:db` / `test:api` to refresh them |

## Verification status (before 2026-11-01)
| Check | Status |
|---|---|
| Syntax check of every file (`node --check`) | pass |
| Unit tests `npm run test:unit` | 12/12 pass |
| Secret scan `npm run scan:secrets` | clean; also tested against a planted secret, a tracked `.env` and an untracked `.env` |
| CORS origin matching (localhost, Vercel URL, `*.vercel.app`, rejects others) | checked with a script |
| DB tests `npm run test:db` (overlap constraint, price rules, bookable rules, opening hours, RLS, review rules) | **64/64 passed** on the dev project, migrations 001–005 (`docs/evidence/db-test-results.txt`) |
| `/health` connected vs disconnected | **verified**: `200 db:up` / `503 db:down` on `/health` and `/api/health` (`docs/evidence/health-results.md`) |
| Live API tests `npm run test:api` (auth, ownership, admin permissions, booking flow, 10 simultaneous bookings, search, alternatives, new rules) | **24/24 passed** against the dev Supabase project (`docs/evidence/api-test-results.txt`) |
| Deployed API (Render) | **not deployed yet** |

## To do by you (cannot be done in code)
1. Remove the API test data from the dev database (SQL in `docs/VERIFICATION.md` section 5).
2. **Reset the database password** (Supabase → Project Settings → Database) and update `.env`.
3. Commit and push; share the repo link (`npm run scan:secrets` and `git status` first; `npm run pack` makes a clean zip of committed files only).
4. Deploy: follow `docs/DEPLOYMENT.md` (Render, CORS with the Vercel URL, schema + seed + admin on the live database, Supabase Auth URLs), then test `/health` on the public URL.

## Decisions to confirm with Nilesh
- Task B endpoint names (table in `docs/api-contract.md`): `PUT /listings/:id/location`, `GET /listings/:id/availability-check`, photo routes under `/listings/:id/photos`, `GET /bookings/:id`, `reason` on error bodies. Photo upload sends the **raw file** as the body (not multipart).
- Field names: the API keeps `owner_id` (= provider_id) and `status` (= listing_status); say if the frontend needs the other names as aliases.
- Whether a listing should need at least one approved photo before it can be approved.
- `/health` vs `/api/health` (both work; delete one line in `src/app.js` when decided).
- All contract additions in `docs/api-contract.md`: cancel, alternatives (login required), listings/mine, availability (inline on create or separate `PUT`; omitted = open 24x7), confirm, admin queue, `/api/me`, `403` when booking your own listing, re-review behaviour on edits, `last_confirmed_at` / `is_demo` fields.
- Booking max length 24 h, cancel not allowed after start, opening hours in Asia/Kolkata.
- Auth redirect paths for email verification / password reset (see `docs/DEPLOYMENT.md` section 3).

## Known limits
- The backend DB role bypasses RLS; the real protection for backend traffic is the code checks (covered by `tests/api.test.js`). RLS protects direct Supabase access.
- No admin UI: admins are set by SQL.
- Not built: payments (only the separate `payment_status` column exists), CI, a `draft` listing status, photo thumbnails/resizing, a malware scan of uploads (type, size and structure are validated and metadata is stripped).
- Free Render services sleep when idle (first request is slow).