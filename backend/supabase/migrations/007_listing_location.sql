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
