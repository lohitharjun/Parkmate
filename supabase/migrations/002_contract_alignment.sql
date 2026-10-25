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
