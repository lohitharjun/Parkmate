-- supabase/schema.sql: CONSOLIDATED SNAPSHOT = migrations 001-006 (generated). For a fresh project run this ONE file,
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
--    plus "you cannot book your own listing" (PK001).
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
