# ParkMate Backend (Node.js + Express + Supabase Postgres)

## Layout
```
docs/        api-contract.md, schema.md, VERIFICATION.md, DEPLOYMENT.md, BLOCKERS.md, evidence/
supabase/    schema.sql (snapshot of 001-010), migrations/001-010, seed.sql, tests/db_tests.sql
src/         server.js, app.js, env.js, auth.js, db.js, errors.js, supabaseAdmin.js, routes/* (listings, photos, bookings, provider, admin, alternatives), lib/* (validate, image, storage, photos, booking-check, listing-access, ...)
tests/       validate / parking-rescue / image / routes.mock (offline), api.test.js (live integration)
scripts/     purge-deleted-accounts.js (daily job), run-db-tests.js, run-api-tests.js, health-evidence.js, secret-scan.sh
render.yaml  Render blueprint (secrets are set in the dashboard)
```

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill it (dev project only; use the **Session pooler** DB URL)
3. Database: see `docs/VERIFICATION.md` section 1
4. Optional demo data: `supabase/seed.sql` (see `docs/DEPLOYMENT.md`)
5. `npm run dev`

## Scripts
`npm run test:unit` · `purge:accounts` · `test:db` · `test:api` · `test:health` · `scan:secrets` · `pack`

## Photos (needs `SUPABASE_SERVICE_ROLE_KEY` and migration 008)
Upload = raw image body to `POST /api/listings/:id/photos`. Files go to the private `listing-photos` bucket, metadata to `listing_photos`; EXIF/GPS is stripped; consumers only get signed URLs of approved photos. Details in `docs/api-contract.md`.

## Account deletion (needs migration 010 and `SUPABASE_SERVICE_ROLE_KEY`)
`DELETE /api/me` (instant) or `POST /api/me/deletion-request` (waits `DELETION_GRACE_DAYS`, default 30, can be cancelled). Both need a login from the last 5 minutes. A daily Render Cron Job runs `npm run purge:accounts` to finish the expired requests. Bookings other people made on a deleted host's listings are kept. See `docs/DEPLOYMENT.md` section 5.

## Rules
- Never commit `.env` or any service-role key.
- Demo rows have `is_demo = true` and must be labelled as demonstration data in the UI.
- Routes and fields: `docs/api-contract.md`. Any change needs agreement with Nilesh (frontend).
