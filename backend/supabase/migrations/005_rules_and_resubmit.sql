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