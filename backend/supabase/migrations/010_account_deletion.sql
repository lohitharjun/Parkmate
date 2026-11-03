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
