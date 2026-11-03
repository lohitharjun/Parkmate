# ParkMate database schema

PostgreSQL on Supabase. Source of truth: `supabase/migrations/` (run in order). `supabase/schema.sql` is a generated snapshot of 001–009 for a fresh project. **Never run both on the same database.**

| File | What it does |
|---|---|
| `001_init.sql` | tables, enums, booking overlap constraint (original draft) |
| `002_contract_alignment.sql` | `lat/lng` → `latitude/longitude`, `is_reviewer` → `is_admin`, adds `listings.is_active`, range checks |
| `003_booking_guard_and_rls.sql` | booking triggers, `listing_is_open()`, `is_admin()`, RLS policies |
| `004_grants.sql` | table privileges for `anon`/`authenticated` (RLS then filters rows) |
| `005_rules_and_resubmit.sql` | block booking your own listing, re-review when an approved listing moves / a rejected one is edited, clients can't fake `last_confirmed_at` |
| `006_listing_freshness.sql` | add `updated_at` and maintain it for listing changes independently of provider confirmations |
| `007_listing_location.sql` | adds `location_label`, `location_verified`, `location_updated_at`; location bookkeeping trigger; clients cannot touch the verification fields |
| `008_listing_photos.sql` | `listing_photos` table, guards (owner only, max 10, always starts `pending`), RLS with no client access, private `listing-photos` Storage bucket |
| `009_booking_payment_state.sql` | `bookings.payment_status` (separate from `bookings.status`), always `unpaid` on creation |
| `supabase/seed.sql` | demo listings only (`is_demo = true`) |
| `supabase/tests/db_tests.sql` | automated checks of constraint, triggers, RLS, freshness, location fields, photos and payment state (the file's final SELECT lists every check; run it to get the count) |

## Tables
**profiles** `id` (= auth.users.id), `full_name`, `phone`, `is_admin`, `created_at`. Admins are promoted by SQL only: `UPDATE profiles SET is_admin = true WHERE id = '<uuid>';`

**listings** `id`, `owner_id → profiles`, `title`, `description`, `rules`, `address`, `latitude`, `longitude`, `price_per_hour` (> 0), `vehicle_type`, `evidence_urls[]`, `status` (`pending|approved|rejected`), `is_active`, `review_note`, `reviewed_by`, `last_confirmed_at`, `is_demo`, `created_at`, `updated_at`, `location_label`, `location_verified`, `location_updated_at`. **Bookable = `status='approved' AND is_active`.**

`updated_at` tracks changes to listing details/status. An owner availability confirmation changes only `last_confirmed_at`, so confirmation is not inferred from listing freshness. Existing rows get `created_at` as their migration baseline; rows without a creation timestamp remain unknown. This conservative baseline does not claim that a listing was recently edited before the migration.

**availability** `listing_id`, `day_of_week` (0 = Sunday), `open_time`, `close_time`. No rows = open 24x7. Times are Asia/Kolkata.

**bookings** `id`, `listing_id`, `user_id`, `start_time`, `end_time`, `total_price`, `status` (`confirmed|cancelled`), `payment_status` (`unpaid|pending|paid|failed|refunded`, independent of `status`), `created_at`.

**listing_photos** `id`, `listing_id → listings (cascade)`, `uploaded_by → profiles`, `storage_path` (unique, inside the private bucket), `content_type`, `size_bytes`, `capture_latitude/longitude` (both or neither; reported by the device with permission, never read from EXIF), `captured_at`, `uploaded_at`, `review_status` (`pending|approved|rejected`), `review_note`, `reviewed_by`, `reviewed_at`, `is_primary` (at most one per listing). RLS is on and anon/authenticated have no privileges: only the backend reads or writes it.

## Booking guarantees (enforced in the database)
- `EXCLUDE USING gist (listing_id WITH =, tstzrange(start_time,end_time) WITH &&) WHERE status='confirmed'` → overlap raises `23P01` even for simultaneous requests. Ranges are half-open, so back-to-back bookings are fine; cancelled bookings don't block.
- `CHECK (end_time > start_time)`.
- `BEFORE INSERT` trigger: listing must exist (`P0002`), be approved + active and open at that time (`P0001 LISTING_NOT_BOOKABLE`); it **computes `total_price`** and forces `status='confirmed'`.
- `BEFORE UPDATE` trigger: after creation only `status` can change (`P0003` otherwise).
- A user cannot book their own listing (`PK001`).

## Location rules (database triggers)
- Changing `address`/`latitude`/`longitude` stamps `location_updated_at` and clears `location_verified` (an approved listing also returns to `pending`). Approving a listing sets `location_verified = true`; rejecting or un-approving sets it back to `false`.
- A client with the Supabase key cannot set `location_verified` or `location_updated_at`, and a listing a client creates always starts unverified.
- `(0,0)` is rejected for new/changed coordinates.

## Photo rules (database triggers)
- Insert: the uploader must own the listing (`PH001`), max 10 photos per listing (`PH002`), always starts `pending`, the first photo becomes the main one (serialised with an advisory lock so parallel uploads cannot create two).
- Update: storage path, uploader, listing, size and capture data are immutable (`P0003`); a rejected photo is never the main photo.
- Files: private bucket `listing-photos`, 5 MB, JPEG/PNG only; no `storage.objects` policies, so only the backend (service-role key) can read/write them.

## Listing review rules (database triggers)
- Approved listing: changing address/latitude/longitude → `pending` again. Rejected listing: editing its content → `pending` (resubmitted, `review_note` kept). An explicit admin decision is never overridden.
- Clients using the Supabase key cannot change `status`, `reviewed_by`, `review_note`, `is_demo`, `last_confirmed_at` or `owner_id`; only the backend/admin can. `updated_at` is maintained by a database trigger.

## RLS (protects direct Supabase access with the anon / user key)
The Express backend connects as the table owner, which bypasses RLS, so it enforces the same rules in code. RLS is the safety net for anything else.

| Table | anon | authenticated |
|---|---|---|
| profiles | – | read/update own; insert own with `is_admin=false`; admin reads all; `is_admin` can't be changed from a client |
| listings | read `approved` | read approved + own (+ all for admin); insert own as `pending`; update own (not status/review fields); admin may review; no delete |
| availability | read for visible listings | owner manages own listing's hours |
| bookings | – | read own bookings and bookings on own listings; **no client writes** |

## 010: account deletion
- `profiles.deletion_requested_at timestamptz`: set while the account waits for its deletion date (clients cannot change it).
- `listings.paused_for_deletion boolean`: true for listings that the deletion request paused (so "restore" re-activates only those).
- `bookings.listing_id` is now nullable (`ON DELETE SET NULL`) and `bookings.listing_snapshot jsonb` keeps `{title, address, price_per_hour, listing_removed}`; a check constraint requires one of the two.
- `account_deletion_log(id, user_id, method immediate|grace_period, requested_at, cancelled_at, completed_at)`: audit trail, no foreign key, no client access.
