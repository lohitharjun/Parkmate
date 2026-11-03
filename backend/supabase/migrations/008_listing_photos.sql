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
