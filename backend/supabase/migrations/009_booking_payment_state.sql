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
