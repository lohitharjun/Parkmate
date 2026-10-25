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
