# ParkMate database schema

PostgreSQL on Supabase. Source of truth: `supabase/migrations/` (run in order). `supabase/schema.sql` is a generated snapshot of 001–005 for a fresh project. **Never run both on the same database.**

| File | What it does |
|---|---|
| `001_init.sql` | tables, enums, booking overlap constraint (original draft) |
| `002_contract_alignment.sql` | `lat/lng` → `latitude/longitude`, `is_reviewer` → `is_admin`, adds `listings.is_active`, range checks |
| `003_booking_guard_and_rls.sql` | booking triggers, `listing_is_open()`, `is_admin()`, RLS policies |
| `004_grants.sql` | table privileges for `anon`/`authenticated` (RLS then filters rows) |
| `005_rules_and_resubmit.sql` | block booking your own listing, re-review when an approved listing moves / a rejected one is edited, clients can't fake `last_confirmed_at` |
| `supabase/seed.sql` | demo listings only (`is_demo = true`) |
| `supabase/tests/db_tests.sql` | 64 automated checks of constraint, triggers, RLS |

## Tables
**profiles** `id` (= auth.users.id), `full_name`, `phone`, `is_admin`, `created_at`. Admins are promoted by SQL only: `UPDATE profiles SET is_admin = true WHERE id = '<uuid>';`

**listings** `id`, `owner_id → profiles`, `title`, `description`, `rules`, `address`, `latitude`, `longitude`, `price_per_hour` (> 0), `vehicle_type`, `evidence_urls[]`, `status` (`pending|approved|rejected`), `is_active`, `review_note`, `reviewed_by`, `last_confirmed_at`, `is_demo`, `created_at`. **Bookable = `status='approved' AND is_active`.**

**availability** `listing_id`, `day_of_week` (0 = Sunday), `open_time`, `close_time`. No rows = open 24x7. Times are Asia/Kolkata.

**bookings** `id`, `listing_id`, `user_id`, `start_time`, `end_time`, `total_price`, `status` (`confirmed|cancelled`), `created_at`.

## Booking guarantees (enforced in the database)
- `EXCLUDE USING gist (listing_id WITH =, tstzrange(start_time,end_time) WITH &&) WHERE status='confirmed'` → overlap raises `23P01` even for simultaneous requests. Ranges are half-open, so back-to-back bookings are fine; cancelled bookings don't block.
- `CHECK (end_time > start_time)`.
- `BEFORE INSERT` trigger: listing must exist (`P0002`), be approved + active and open at that time (`P0001 LISTING_NOT_BOOKABLE`); it **computes `total_price`** and forces `status='confirmed'`.
- `BEFORE UPDATE` trigger: after creation only `status` can change (`P0003` otherwise).
- A user cannot book their own listing (`P0004`).

## Listing review rules (database triggers)
- Approved listing: changing address/latitude/longitude → `pending` again. Rejected listing: editing its content → `pending` (resubmitted, `review_note` kept). An explicit admin decision is never overridden.
- Clients using the Supabase key cannot change `status`, `reviewed_by`, `review_note`, `is_demo`, `last_confirmed_at` or `owner_id`; only the backend/admin can.

## RLS (protects direct Supabase access with the anon / user key)
The Express backend connects as the table owner, which bypasses RLS, so it enforces the same rules in code. RLS is the safety net for anything else.

| Table | anon | authenticated |
|---|---|---|
| profiles | – | read/update own; insert own with `is_admin=false`; admin reads all; `is_admin` can't be changed from a client |
| listings | read `approved` | read approved + own (+ all for admin); insert own as `pending`; update own (not status/review fields); admin may review; no delete |
| availability | read for visible listings | owner manages own listing's hours |
| bookings | – | read own bookings and bookings on own listings; **no client writes** |
