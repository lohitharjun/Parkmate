-- DEMO DATA ONLY (is_demo = true). Requires at least one row in profiles
-- (create a user in Supabase Auth, then insert into profiles first).
INSERT INTO listings (owner_id, title, description, rules, address, latitude, longitude, price_per_hour, vehicle_type, status, last_confirmed_at, is_demo)
SELECT p.id, v.title, v.description, v.rules, v.address, v.lat, v.lng, v.price, v.vehicle, v.status::listing_status, v.confirmed, true
FROM (SELECT id FROM profiles LIMIT 1) p,
(VALUES
  ('Demo: Tambaram Home Spot', 'Covered spot near the station', 'Cars only', 'Tambaram, Chennai', 12.9249, 80.1000, 40, 'car', 'approved', now() - interval '1 day'),
  ('Demo: Chromepet Driveway', 'Open driveway, gated', 'No overnight', 'Chromepet, Chennai', 12.9516, 80.1462, 30, 'car', 'approved', now() - interval '20 days'),
  ('Demo: Velachery Basement', 'Basement slot, CCTV', 'Cars only', 'Velachery, Chennai', 12.9815, 80.2180, 60, 'car', 'approved', now() - interval '2 hours'),
  ('Demo: Pending Listing', 'Waiting for review', 'None', 'Guindy, Chennai', 13.0067, 80.2206, 50, 'car', 'pending', NULL)
) AS v(title, description, rules, address, lat, lng, price, vehicle, status, confirmed);

INSERT INTO availability (listing_id, day_of_week, open_time, close_time)
SELECT l.id, d, '06:00', '22:00' FROM listings l, generate_series(0,6) d WHERE l.is_demo;
