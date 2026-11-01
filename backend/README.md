# ParkMate Backend (Node.js + Express + Supabase Postgres)

## Layout
```
docs/        api-contract.md, schema.md, VERIFICATION.md, DEPLOYMENT.md, BLOCKERS.md, evidence/
supabase/    schema.sql (snapshot of 001-006), migrations/001-006, seed.sql, tests/db_tests.sql
src/         server.js, app.js, env.js, auth.js, db.js, errors.js, routes/*, lib/*
tests/       validate.test.js (unit), api.test.js (live integration)
scripts/     run-db-tests.js, run-api-tests.js, health-evidence.js, secret-scan.sh
render.yaml  Render blueprint (secrets are set in the dashboard)
```

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill it (dev project only; use the **Session pooler** DB URL)
3. Database: see `docs/VERIFICATION.md` section 1
4. Optional demo data: `supabase/seed.sql` (see `docs/DEPLOYMENT.md`)
5. `npm run dev`

## Scripts
`npm run test:unit` · `test:db` · `test:api` · `test:health` · `scan:secrets` · `pack`

## Rules
- Never commit `.env` or any service-role key.
- Demo rows have `is_demo = true` and must be labelled as demonstration data in the UI.
- Routes and fields: `docs/api-contract.md`. Any change needs agreement with Nilesh (frontend).
