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
