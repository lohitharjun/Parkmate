-- supabase/schema.sql: CONSOLIDATED SNAPSHOT = migrations 001-009 (generated). For a fresh project run this ONE file,
-- or run the files in supabase/migrations/ in order. Do not run both on the same database.

-- ===== supabase/migrations/001_init.sql =====
-- ParkMate schema draft (PostgreSQL / Supabase)
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE listing_status AS ENUM ('pending','approved','rejected');
CREATE TYPE booking_status AS ENUM ('confirmed','cancelled');

CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone text,
  is_reviewer boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES profiles(id),
  title text NOT NULL,
  description text,
  rules text,
  address text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  price_per_hour numeric(8,2) NOT NULL CHECK (price_per_hour > 0),
  vehicle_type text,
  evidence_urls text[],
  status listing_status NOT NULL DEFAULT 'pending',
  review_note text,
  reviewed_by uuid REFERENCES profiles(id),
  last_confirmed_at timestamptz,
  is_demo boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time time NOT NULL,
  close_time time NOT NULL,
  CHECK (close_time > open_time)
);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id),
  user_id uuid NOT NULL REFERENCES profiles(id),
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  total_price numeric(10,2) NOT NULL,
  status booking_status NOT NULL DEFAULT 'confirmed',
  created_at timestamptz DEFAULT now(),
  CHECK (end_time > start_time),
  -- DB-level overlap guard: error code 23P01 on conflict
  EXCLUDE USING gist (
    listing_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  ) WHERE (status = 'confirmed')
);

CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_bookings_user ON bookings(user_id);

-- ===== supabase/migrations/002_contract_alignment.sql =====
-- 002: align the schema with API contract v1 (latitude/longitude, is_active, is_admin).
-- Safe to re-run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='listings' AND column_name='lat') THEN
    ALTER TABLE listings RENAME COLUMN lat TO latitude;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='listings' AND column_name='lng') THEN
    ALTER TABLE listings RENAME COLUMN lng TO longitude;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='is_reviewer') THEN
    ALTER TABLE profiles RENAME COLUMN is_reviewer TO is_admin;
  END IF;
END $$;

ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='listings_lat_range') THEN
    ALTER TABLE listings ADD CONSTRAINT listings_lat_range CHECK (latitude BETWEEN -90 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='listings_lng_range') THEN
    ALTER TABLE listings ADD CONSTRAINT listings_lng_range CHECK (longitude BETWEEN -180 AND 180);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_listings_owner ON listings(owner_id);
CREATE INDEX IF NOT EXISTS idx_bookings_listing ON bookings(listing_id);

-- ===== supabase/migrations/003_booking_guard_and_rls.sql =====
-- 003: booking guard triggers + Row Level Security. Safe to re-run.
-- The Express backend connects as the table owner (bypasses RLS) and enforces permissions in code.
-- RLS protects the data when the frontend talks to Supabase directly with the anon/authenticated key.

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT is_admin FROM profiles WHERE id = auth.uid()), false)
$$;

-- Weekly opening hours (Asia/Kolkata). No availability rows = open 24x7.
-- A booking with hours defined must sit inside one window on one local day.
CREATE OR REPLACE FUNCTION public.listing_is_open(p_listing uuid, p_start timestamptz, p_end timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE ls timestamp; le timestamp;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM availability WHERE listing_id = p_listing) THEN RETURN true; END IF;
  ls := p_start AT TIME ZONE 'Asia/Kolkata';
  le := p_end   AT TIME ZONE 'Asia/Kolkata';
  IF ls::date <> le::date THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM availability a
    WHERE a.listing_id = p_listing
      AND a.day_of_week = EXTRACT(DOW FROM ls)::smallint
      AND a.open_time <= ls::time AND a.close_time >= le::time);
END $$;

-- ---------- booking guards ----------
CREATE OR REPLACE FUNCTION public.bookings_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE l listings%ROWTYPE;
BEGIN
  SELECT * INTO l FROM listings WHERE id = NEW.listing_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LISTING_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF l.status <> 'approved' OR NOT l.is_active THEN
    RAISE EXCEPTION 'LISTING_NOT_BOOKABLE' USING ERRCODE = 'P0001', HINT = 'Listing is not approved or is paused';
  END IF;
  IF NOT public.listing_is_open(NEW.listing_id, NEW.start_time, NEW.end_time) THEN
    RAISE EXCEPTION 'LISTING_NOT_BOOKABLE' USING ERRCODE = 'P0001', HINT = 'Requested time is outside the listing''s available hours';
  END IF;
  -- price is always computed here; whatever the client/backend sent is ignored
  NEW.total_price := ROUND(l.price_per_hour * EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 3600.0, 2);
  NEW.status := 'confirmed';
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_before_insert ON bookings;
CREATE TRIGGER trg_bookings_before_insert BEFORE INSERT ON bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_before_insert();

-- after creation only the status may change (cancel)
CREATE OR REPLACE FUNCTION public.bookings_before_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.listing_id <> OLD.listing_id OR NEW.user_id <> OLD.user_id
     OR NEW.start_time <> OLD.start_time OR NEW.end_time <> OLD.end_time
     OR NEW.total_price <> OLD.total_price THEN
    RAISE EXCEPTION 'BOOKING_IMMUTABLE' USING ERRCODE = 'P0003';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_before_update ON bookings;
CREATE TRIGGER trg_bookings_before_update BEFORE UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_before_update();

-- ---------- column protection for direct (client) access ----------
-- auth.uid() is NULL for the backend/owner connection, so only client JWT sessions are restricted.
CREATE OR REPLACE FUNCTION public.listings_protect() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.owner_id <> OLD.owner_id THEN
    RAISE EXCEPTION 'FORBIDDEN: owner_id cannot change' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() AND (
       NEW.status <> OLD.status OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
    OR NEW.review_note IS DISTINCT FROM OLD.review_note OR NEW.is_demo IS DISTINCT FROM OLD.is_demo) THEN
    RAISE EXCEPTION 'FORBIDDEN: only an admin can change review fields' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_listings_protect ON listings;
CREATE TRIGGER trg_listings_protect BEFORE UPDATE ON listings
FOR EACH ROW EXECUTE FUNCTION public.listings_protect();

CREATE OR REPLACE FUNCTION public.profiles_protect() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'FORBIDDEN: is_admin cannot be changed from the client' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_profiles_protect ON profiles;
CREATE TRIGGER trg_profiles_protect BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_protect();

-- ---------- RLS ----------
ALTER TABLE profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select ON profiles;
DROP POLICY IF EXISTS profiles_insert ON profiles;
DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT USING (id = auth.uid() OR public.is_admin());
CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (id = auth.uid() AND is_admin = false);
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS listings_select ON listings;
DROP POLICY IF EXISTS listings_insert ON listings;
DROP POLICY IF EXISTS listings_update ON listings;
CREATE POLICY listings_select ON listings FOR SELECT
  USING (status = 'approved' OR owner_id = auth.uid() OR public.is_admin());
CREATE POLICY listings_insert ON listings FOR INSERT
  WITH CHECK (owner_id = auth.uid() AND status = 'pending');
CREATE POLICY listings_update ON listings FOR UPDATE
  USING (owner_id = auth.uid() OR public.is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.is_admin());
-- no DELETE policy: clients cannot delete listings

DROP POLICY IF EXISTS availability_select ON availability;
DROP POLICY IF EXISTS availability_write ON availability;
CREATE POLICY availability_select ON availability FOR SELECT
  USING (EXISTS (SELECT 1 FROM listings l WHERE l.id = availability.listing_id));
CREATE POLICY availability_write ON availability FOR ALL
  USING (EXISTS (SELECT 1 FROM listings l WHERE l.id = availability.listing_id AND l.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM listings l WHERE l.id = availability.listing_id AND l.owner_id = auth.uid()));

DROP POLICY IF EXISTS bookings_select ON bookings;
CREATE POLICY bookings_select ON bookings FOR SELECT
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM listings l WHERE l.id = bookings.listing_id AND l.owner_id = auth.uid()));
-- no INSERT/UPDATE/DELETE policies on bookings: all writes go through the backend (overlap + price checks)

-- ===== supabase/migrations/004_grants.sql =====
-- 004: table privileges for Supabase's client roles. Safe to re-run.
-- Without these, anon/authenticated get "permission denied" (42501) before RLS is even evaluated.
-- This matches Supabase's default; row access is then decided by the RLS policies from 003.
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON TABLE public.profiles, public.listings, public.availability, public.bookings TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- ===== supabase/migrations/005_rules_and_resubmit.sql =====
-- 005: own-listing booking block, approval bypass protection, confirmation protection. Safe to re-run.

-- 1) Booking guard (replaces 003's version): SECURITY DEFINER so the listing lookup works for any caller,
--    plus "you cannot book your own listing" (P0004).
CREATE OR REPLACE FUNCTION public.bookings_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l listings%ROWTYPE;
BEGIN
  SELECT * INTO l FROM listings WHERE id = NEW.listing_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LISTING_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF l.status <> 'approved' OR NOT l.is_active THEN
    RAISE EXCEPTION 'LISTING_NOT_BOOKABLE' USING ERRCODE = 'P0001', HINT = 'Listing is not approved or is paused';
  END IF;
  IF l.owner_id = NEW.user_id THEN
    RAISE EXCEPTION 'CANNOT_BOOK_OWN_LISTING' USING ERRCODE = 'PK001';
  END IF;
  IF NOT public.listing_is_open(NEW.listing_id, NEW.start_time, NEW.end_time) THEN
    RAISE EXCEPTION 'LISTING_NOT_BOOKABLE' USING ERRCODE = 'P0001', HINT = 'Requested time is outside the listing''s available hours';
  END IF;
  NEW.total_price := ROUND(l.price_per_hour * EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 3600.0, 2);
  NEW.status := 'confirmed';
  RETURN NEW;
END $$;

-- 2) Client protection (replaces 003's version): clients also cannot fake last_confirmed_at.
CREATE OR REPLACE FUNCTION public.listings_protect() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.owner_id <> OLD.owner_id THEN
    RAISE EXCEPTION 'FORBIDDEN: owner_id cannot change' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() AND (
       NEW.status <> OLD.status OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
    OR NEW.review_note IS DISTINCT FROM OLD.review_note OR NEW.is_demo IS DISTINCT FROM OLD.is_demo
    OR NEW.last_confirmed_at IS DISTINCT FROM OLD.last_confirmed_at) THEN
    RAISE EXCEPTION 'FORBIDDEN: only an admin or the backend can change review/confirmation fields' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- 3) Approval bypass protection. Runs AFTER trg_listings_protect (triggers fire alphabetically).
--    - approved listing whose location changes -> back to pending (needs re-review)
--    - rejected listing whose content is edited -> pending (resubmitted); review_note is kept so the owner sees why
--    - an explicit status change (admin review) is never overridden
CREATE OR REPLACE FUNCTION public.listings_resubmit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF OLD.status = 'approved' AND (
       NEW.address IS DISTINCT FROM OLD.address
    OR NEW.latitude IS DISTINCT FROM OLD.latitude
    OR NEW.longitude IS DISTINCT FROM OLD.longitude) THEN
    NEW.status := 'pending'; NEW.reviewed_by := NULL; NEW.review_note := NULL;
  ELSIF OLD.status = 'rejected' AND (
       NEW.title IS DISTINCT FROM OLD.title OR NEW.address IS DISTINCT FROM OLD.address
    OR NEW.latitude IS DISTINCT FROM OLD.latitude OR NEW.longitude IS DISTINCT FROM OLD.longitude
    OR NEW.price_per_hour IS DISTINCT FROM OLD.price_per_hour OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.rules IS DISTINCT FROM OLD.rules OR NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type
    OR NEW.evidence_urls IS DISTINCT FROM OLD.evidence_urls) THEN
    NEW.status := 'pending'; NEW.reviewed_by := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_listings_z_resubmit ON listings;
CREATE TRIGGER trg_listings_z_resubmit BEFORE UPDATE ON listings
FOR EACH ROW EXECUTE FUNCTION public.listings_resubmit();

-- ===== supabase/migrations/006_listing_freshness.sql =====
-- 006: track listing edits separately from owner availability confirmations.
-- Existing rows use created_at as a conservative baseline; no row is made newly fresh by migration.
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.listings
SET updated_at = created_at
WHERE updated_at IS NULL AND created_at IS NOT NULL;

ALTER TABLE public.listings ALTER COLUMN updated_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION public.listings_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.updated_at := statement_timestamp();
    RETURN NEW;
  END IF;

  IF ROW(
       NEW.owner_id, NEW.title, NEW.description, NEW.rules, NEW.address,
       NEW.latitude, NEW.longitude, NEW.price_per_hour, NEW.vehicle_type,
       NEW.evidence_urls, NEW.status, NEW.review_note, NEW.reviewed_by,
       NEW.is_demo, NEW.is_active
     ) IS DISTINCT FROM ROW(
       OLD.owner_id, OLD.title, OLD.description, OLD.rules, OLD.address,
       OLD.latitude, OLD.longitude, OLD.price_per_hour, OLD.vehicle_type,
       OLD.evidence_urls, OLD.status, OLD.review_note, OLD.reviewed_by,
       OLD.is_demo, OLD.is_active
     ) THEN
    NEW.updated_at := statement_timestamp();
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_listings_set_updated_at ON public.listings;
CREATE TRIGGER trg_listings_set_updated_at
BEFORE INSERT OR UPDATE ON public.listings
FOR EACH ROW EXECUTE FUNCTION public.listings_set_updated_at();

-- ===== supabase/migrations/007_listing_location.sql =====
-- 007: listing location tracking (Task A). Adds ONLY what listings was missing. Safe to re-run.
--
-- Field map (spec name -> existing column):
--   latitude / longitude     -> already exist (double precision, range CHECKs from 002)
--   address                  -> already exists
--   provider_id              -> already exists as listings.owner_id (NOT duplicated)
--   listing_status           -> already exists as listings.status (pending | approved | rejected)
--   location_label           -> ADDED here
--   location_verified        -> ADDED here
--   location_updated_at      -> ADDED here

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'listings' AND column_name = 'location_updated_at') THEN
    ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS location_label text;
    ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS location_verified boolean NOT NULL DEFAULT false;
    ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS location_updated_at timestamptz;
    -- one-time backfill: location was last touched at creation; approved listings already had their location reviewed
    UPDATE public.listings
    SET location_updated_at = COALESCE(created_at, now()),
        location_verified   = (status = 'approved');
  END IF;
END $$;

ALTER TABLE public.listings ALTER COLUMN location_updated_at SET DEFAULT now();
ALTER TABLE public.listings ALTER COLUMN location_updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'listings_location_label_len') THEN
    ALTER TABLE public.listings ADD CONSTRAINT listings_location_label_len
      CHECK (location_label IS NULL OR char_length(location_label) BETWEEN 1 AND 120);
  END IF;
  -- (0,0) is "null island": almost always a missing coordinate. NOT VALID = enforced for new/changed rows only.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'listings_not_null_island') THEN
    ALTER TABLE public.listings ADD CONSTRAINT listings_not_null_island
      CHECK (NOT (latitude = 0 AND longitude = 0)) NOT VALID;
  END IF;
END $$;

-- Location bookkeeping (runs after trg_listings_protect and trg_listings_set_updated_at, before trg_listings_z_resubmit):
--   * address / latitude / longitude changed -> location_updated_at = now
--   * status changed (admin review)         -> location_verified = (new status = 'approved')
--   * location changed without a status change -> location_verified = false (needs review again)
--   * INSERT from a client (auth.uid() set)  -> location_verified is forced to false
CREATE OR REPLACE FUNCTION public.listings_location() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.location_verified := false;
      NEW.location_updated_at := statement_timestamp();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.address IS DISTINCT FROM OLD.address
     OR NEW.latitude IS DISTINCT FROM OLD.latitude
     OR NEW.longitude IS DISTINCT FROM OLD.longitude THEN
    NEW.location_updated_at := statement_timestamp();
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
      NEW.location_verified := false;
    END IF;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.location_verified := (NEW.status = 'approved');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_listings_y_location ON public.listings;
CREATE TRIGGER trg_listings_y_location
BEFORE INSERT OR UPDATE ON public.listings
FOR EACH ROW EXECUTE FUNCTION public.listings_location();

-- Client protection (replaces 005's version): clients also cannot touch the two location review fields.
CREATE OR REPLACE FUNCTION public.listings_protect() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.owner_id <> OLD.owner_id THEN
    RAISE EXCEPTION 'FORBIDDEN: owner_id cannot change' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() AND (
       NEW.status <> OLD.status OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
    OR NEW.review_note IS DISTINCT FROM OLD.review_note OR NEW.is_demo IS DISTINCT FROM OLD.is_demo
    OR NEW.last_confirmed_at IS DISTINCT FROM OLD.last_confirmed_at
    OR NEW.location_verified IS DISTINCT FROM OLD.location_verified
    OR NEW.location_updated_at IS DISTINCT FROM OLD.location_updated_at) THEN
    RAISE EXCEPTION 'FORBIDDEN: only an admin or the backend can change review/confirmation fields' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- Freshness (replaces 006's version): a changed location label / verification also counts as a listing edit.
CREATE OR REPLACE FUNCTION public.listings_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.updated_at := statement_timestamp();
    RETURN NEW;
  END IF;

  IF ROW(
       NEW.owner_id, NEW.title, NEW.description, NEW.rules, NEW.address,
       NEW.latitude, NEW.longitude, NEW.price_per_hour, NEW.vehicle_type,
       NEW.evidence_urls, NEW.status, NEW.review_note, NEW.reviewed_by,
       NEW.is_demo, NEW.is_active, NEW.location_label
     ) IS DISTINCT FROM ROW(
       OLD.owner_id, OLD.title, OLD.description, OLD.rules, OLD.address,
       OLD.latitude, OLD.longitude, OLD.price_per_hour, OLD.vehicle_type,
       OLD.evidence_urls, OLD.status, OLD.review_note, OLD.reviewed_by,
       OLD.is_demo, OLD.is_active, OLD.location_label
     ) THEN
    NEW.updated_at := statement_timestamp();
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END $$;

-- ===== supabase/migrations/008_listing_photos.sql =====
-- 008: geo-tagged listing photos (Task C). Metadata lives in its own table; the image files live in a PRIVATE
-- Supabase Storage bucket. The Express backend (service-role key) is the only writer and reader. Safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'photo_review_status') THEN
    CREATE TYPE public.photo_review_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.listing_photos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  uploaded_by       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  storage_path      text NOT NULL UNIQUE,                 -- path inside the bucket, e.g. <listing_id>/<uuid>.jpg
  content_type      text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  size_bytes        integer NOT NULL CHECK (size_bytes > 0),
  capture_latitude  double precision CHECK (capture_latitude  BETWEEN -90  AND 90),
  capture_longitude double precision CHECK (capture_longitude BETWEEN -180 AND 180),
  captured_at       timestamptz,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  review_status     public.photo_review_status NOT NULL DEFAULT 'pending',
  review_note       text,
  reviewed_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  is_primary        boolean NOT NULL DEFAULT false,
  CONSTRAINT listing_photos_capture_pair CHECK ((capture_latitude IS NULL) = (capture_longitude IS NULL))
);

-- at most one main photo per listing
CREATE UNIQUE INDEX IF NOT EXISTS uq_listing_photos_primary ON public.listing_photos (listing_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_listing_photos_listing ON public.listing_photos (listing_id, review_status);

-- INSERT guard (defence in depth, the API checks the same things first):
--   * the uploader must own the listing (PH001)          * at most 10 photos per listing (PH002)
--   * a new photo is always 'pending' (nobody self-approves on insert)
--   * the first photo of a listing (or the first after the main one was removed/rejected) becomes the main photo
-- The advisory lock makes concurrent uploads for one listing count and pick the main photo one at a time.
CREATE OR REPLACE FUNCTION public.listing_photos_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l_owner uuid; n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('listing_photos:' || NEW.listing_id::text));
  SELECT owner_id INTO l_owner FROM listings WHERE id = NEW.listing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LISTING_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF l_owner <> NEW.uploaded_by THEN
    RAISE EXCEPTION 'PHOTO_NOT_LISTING_OWNER' USING ERRCODE = 'PH001';
  END IF;
  SELECT count(*) INTO n FROM listing_photos WHERE listing_id = NEW.listing_id;
  IF n >= 10 THEN
    RAISE EXCEPTION 'PHOTO_LIMIT_REACHED' USING ERRCODE = 'PH002';
  END IF;
  NEW.review_status := 'pending';
  NEW.review_note := NULL; NEW.reviewed_by := NULL; NEW.reviewed_at := NULL;
  NEW.is_primary := NOT EXISTS (SELECT 1 FROM listing_photos WHERE listing_id = NEW.listing_id AND is_primary);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_listing_photos_before_insert ON public.listing_photos;
CREATE TRIGGER trg_listing_photos_before_insert BEFORE INSERT ON public.listing_photos
FOR EACH ROW EXECUTE FUNCTION public.listing_photos_before_insert();

-- UPDATE guard: only review fields and is_primary may change; a rejected photo can never be the main photo.
CREATE OR REPLACE FUNCTION public.listing_photos_before_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.listing_id <> OLD.listing_id OR NEW.uploaded_by <> OLD.uploaded_by
     OR NEW.storage_path <> OLD.storage_path OR NEW.content_type <> OLD.content_type
     OR NEW.size_bytes <> OLD.size_bytes OR NEW.uploaded_at <> OLD.uploaded_at
     OR NEW.capture_latitude IS DISTINCT FROM OLD.capture_latitude
     OR NEW.capture_longitude IS DISTINCT FROM OLD.capture_longitude
     OR NEW.captured_at IS DISTINCT FROM OLD.captured_at THEN
    RAISE EXCEPTION 'PHOTO_IMMUTABLE' USING ERRCODE = 'P0003';
  END IF;
  IF NEW.review_status = 'rejected' THEN
    NEW.is_primary := false;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_listing_photos_before_update ON public.listing_photos;
CREATE TRIGGER trg_listing_photos_before_update BEFORE UPDATE ON public.listing_photos
FOR EACH ROW EXECUTE FUNCTION public.listing_photos_before_update();

-- Access: RLS on and NO client privileges at all. Capture coordinates are private to the owner and admins, and
-- every read/write goes through the backend, which checks ownership and the review status itself.
ALTER TABLE public.listing_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.listing_photos FROM anon, authenticated;

-- Private bucket. No storage.objects policies are created, so anon/authenticated cannot read or write files
-- directly; the backend uploads with the service-role key and hands out short-lived signed URLs for approved photos.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('listing-photos', 'listing-photos', false, 5242880, ARRAY['image/jpeg', 'image/png'])
    ON CONFLICT (id) DO UPDATE
      SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;

-- ===== supabase/migrations/009_booking_payment_state.sql =====
-- 009: payment state kept SEPARATE from booking state (Task D). Safe to re-run.
-- bookings.status      = the reservation  (confirmed | cancelled)
-- bookings.payment_status = the money side (unpaid | pending | paid | failed | refunded)
-- No payment provider is wired up yet; every new booking starts 'unpaid' and only the backend can change it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE public.payment_status AS ENUM ('unpaid', 'pending', 'paid', 'failed', 'refunded');
  END IF;
END $$;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS payment_status public.payment_status NOT NULL DEFAULT 'unpaid';

-- Booking guard (replaces 005's version): same rules, plus payment_status is always 'unpaid' on creation.
CREATE OR REPLACE FUNCTION public.bookings_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l listings%ROWTYPE;
BEGIN
  SELECT * INTO l FROM listings WHERE id = NEW.listing_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LISTING_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF l.status <> 'approved' OR NOT l.is_active THEN
    RAISE EXCEPTION 'LISTING_NOT_BOOKABLE' USING ERRCODE = 'P0001', HINT = 'Listing is not approved or is paused';
  END IF;
  IF l.owner_id = NEW.user_id THEN
    RAISE EXCEPTION 'CANNOT_BOOK_OWN_LISTING' USING ERRCODE = 'PK001';
  END IF;
  IF NOT public.listing_is_open(NEW.listing_id, NEW.start_time, NEW.end_time) THEN
    RAISE EXCEPTION 'LISTING_NOT_BOOKABLE' USING ERRCODE = 'P0001', HINT = 'Requested time is outside the listing''s available hours';
  END IF;
  NEW.total_price := ROUND(l.price_per_hour * EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 3600.0, 2);
  NEW.status := 'confirmed';
  NEW.payment_status := 'unpaid';
  RETURN NEW;
END $$;


-- 010: account deletion upgrades. Safe to re-run. RUN THIS BEFORE deploying the matching backend code.
--   1) grace period: profiles.deletion_requested_at + listings.paused_for_deletion
--   2) keep other people's booking history: bookings.listing_id may become NULL, bookings.listing_snapshot keeps title/address
--   3) audit trail: account_deletion_log (no foreign key on purpose, the row must outlive the account)

-- ---------- 1) grace period ----------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_profiles_deletion_requested
  ON public.profiles (deletion_requested_at) WHERE deletion_requested_at IS NOT NULL;

-- true only for listings that the deletion request paused itself, so "restore" never re-activates a listing the owner had paused earlier
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS paused_for_deletion boolean NOT NULL DEFAULT false;

-- clients (anon/authenticated JWT) must not touch the deletion fields; only the backend (auth.uid() IS NULL) may
CREATE OR REPLACE FUNCTION public.profiles_protect() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (
       NEW.is_admin IS DISTINCT FROM OLD.is_admin
    OR NEW.deletion_requested_at IS DISTINCT FROM OLD.deletion_requested_at) THEN
    RAISE EXCEPTION 'FORBIDDEN: is_admin and the deletion state cannot be changed from the client' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- replaces 007's version: same rules, plus paused_for_deletion is backend-only and a listing paused for deletion cannot be re-activated by a client
CREATE OR REPLACE FUNCTION public.listings_protect() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.owner_id <> OLD.owner_id THEN
    RAISE EXCEPTION 'FORBIDDEN: owner_id cannot change' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin() AND (
       NEW.status <> OLD.status OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
    OR NEW.review_note IS DISTINCT FROM OLD.review_note OR NEW.is_demo IS DISTINCT FROM OLD.is_demo
    OR NEW.last_confirmed_at IS DISTINCT FROM OLD.last_confirmed_at
    OR NEW.location_verified IS DISTINCT FROM OLD.location_verified
    OR NEW.location_updated_at IS DISTINCT FROM OLD.location_updated_at) THEN
    RAISE EXCEPTION 'FORBIDDEN: only an admin or the backend can change review/confirmation fields' USING ERRCODE = '42501';
  END IF;
  IF NEW.paused_for_deletion IS DISTINCT FROM OLD.paused_for_deletion
     OR (OLD.paused_for_deletion AND NEW.is_active) THEN
    RAISE EXCEPTION 'FORBIDDEN: this listing is paused because the account is being deleted' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- ---------- 2) keep other people's booking history ----------
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS listing_snapshot jsonb;   -- {title, address, price_per_hour, listing_removed}
ALTER TABLE public.bookings ALTER COLUMN listing_id DROP NOT NULL;

DO $$
DECLARE fk record;
BEGIN
  SELECT c.conname, c.confdeltype INTO fk
  FROM pg_constraint c
  WHERE c.conrelid = 'public.bookings'::regclass AND c.contype = 'f' AND c.confrelid = 'public.listings'::regclass;
  IF fk.conname IS NULL OR fk.confdeltype <> 'n' THEN       -- 'n' = ON DELETE SET NULL (already done on a re-run)
    IF fk.conname IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.bookings DROP CONSTRAINT %I', fk.conname);
    END IF;
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_listing_id_fkey
      FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE SET NULL;
  END IF;
  -- a booking may lose its listing only if it kept a snapshot of it
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_listing_or_snapshot') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_listing_or_snapshot
      CHECK (listing_id IS NOT NULL OR listing_snapshot IS NOT NULL);
  END IF;
END $$;

-- replaces 003's version: still immutable after creation, except that listing_id may become NULL (listing removed with its owner's account)
CREATE OR REPLACE FUNCTION public.bookings_before_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.listing_id IS DISTINCT FROM OLD.listing_id AND NEW.listing_id IS NOT NULL)
     OR NEW.user_id <> OLD.user_id
     OR NEW.start_time <> OLD.start_time OR NEW.end_time <> OLD.end_time
     OR NEW.total_price <> OLD.total_price THEN
    RAISE EXCEPTION 'BOOKING_IMMUTABLE' USING ERRCODE = 'P0003';
  END IF;
  RETURN NEW;
END $$;

-- ---------- 3) audit trail ----------
CREATE TABLE IF NOT EXISTS public.account_deletion_log (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL,                       -- NO foreign key on purpose: the row must outlive the deleted account
  method       text NOT NULL CHECK (method IN ('immediate', 'grace_period')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_account_deletion_log_user ON public.account_deletion_log (user_id);
ALTER TABLE public.account_deletion_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletion_log FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.account_deletion_log_id_seq FROM anon, authenticated;
