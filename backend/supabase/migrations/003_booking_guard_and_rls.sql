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
