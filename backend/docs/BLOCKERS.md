# Status and open items

## Verification status
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
- `/health` vs `/api/health` (both work; delete one line in `src/app.js` when decided).
- All contract additions in `docs/api-contract.md`: cancel, alternatives (login required), listings/mine, availability (inline on create or separate `PUT`; omitted = open 24x7), confirm, admin queue, `/api/me`, `403` when booking your own listing, re-review behaviour on edits, `last_confirmed_at` / `is_demo` fields.
- Booking max length 24 h, cancel not allowed after start, opening hours in Asia/Kolkata.
- Auth redirect paths for email verification / password reset (see `docs/DEPLOYMENT.md` section 3).

## Known limits
- The backend DB role bypasses RLS; the real protection for backend traffic is the code checks (covered by `tests/api.test.js`). RLS protects direct Supabase access.
- No admin UI: admins are set by SQL.
- Not built: payments, rate limiting, photo upload (only `evidence_urls`), CI.
- Free Render services sleep when idle (first request is slow).