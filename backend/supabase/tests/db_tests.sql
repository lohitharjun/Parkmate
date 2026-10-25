-- ParkMate DB tests: booking constraint, triggers, price rules, availability, RLS.
-- Run on the DEV project only: Supabase SQL editor (paste whole file) or `npm run test:db`.
-- Needs migrations 001-005 applied. Creates temp users (@dbtest.invalid) and removes ONLY those at the end.
-- (The API test users, e.g. owner@parkmate.test, are never touched.)
-- Final SELECT is the results table. Concurrency (parallel requests) is tested in tests/api.test.js.

DROP TABLE IF EXISTS pg_temp.results;
CREATE TEMP TABLE results (n serial, name text, passed boolean, detail text);

CREATE OR REPLACE FUNCTION pg_temp.cleanup() RETURNS void LANGUAGE plpgsql AS $$
DECLARE ids uuid[];
BEGIN
  SELECT array_agg(id) INTO ids FROM auth.users WHERE email LIKE '%@dbtest.invalid';
  IF ids IS NULL THEN RETURN; END IF;
  DELETE FROM bookings WHERE user_id = ANY(ids) OR listing_id IN (SELECT id FROM listings WHERE owner_id = ANY(ids));
  DELETE FROM availability WHERE listing_id IN (SELECT id FROM listings WHERE owner_id = ANY(ids));
  DELETE FROM listings WHERE owner_id = ANY(ids);
  DELETE FROM profiles WHERE id = ANY(ids);
  DELETE FROM auth.users WHERE id = ANY(ids);
END $$;
SELECT pg_temp.cleanup();

-- run SQL as role/user; returns 'OK:<rowcount>' or 'ERR:<sqlstate>:<message>'
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_role text, p_uid uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint; out text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', p_role)::text END, true);
    EXECUTE 'SET LOCAL ROLE ' || quote_ident(p_role);
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    out := 'OK:' || n;
  EXCEPTION WHEN OTHERS THEN
    out := 'ERR:' || SQLSTATE || ':' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN out;
END $$;

-- how many rows would this SELECT return for that role/user (-1 on error)
CREATE OR REPLACE FUNCTION pg_temp.seen(p_role text, p_uid uuid, p_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', p_role)::text END, true);
    EXECUTE 'SET LOCAL ROLE ' || quote_ident(p_role);
    EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO n;
  EXCEPTION WHEN OTHERS THEN n := -1;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.rec(p_name text, p_ok boolean, p_detail text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO pg_temp.results(name, passed, detail) VALUES (p_name, COALESCE(p_ok, false), p_detail) $$;

DO $$
DECLARE
  u_owner uuid := '11111111-1111-4111-8111-111111111111';
  u_cons  uuid := '22222222-2222-4222-8222-222222222222';
  u_admin uuid := '33333333-3333-4333-8333-333333333333';
  u_other uuid := '44444444-4444-4444-8444-444444444444';
  u_new   uuid := '55555555-5555-4555-8555-555555555555';
  l_ok uuid; l_pend uuid; l_off uuid; l_hours uuid; l_re1 uuid; l_re2 uuid; l_re3 uuid; b1 uuid; new_l uuid;
  base timestamptz := (date_trunc('day', timezone('Asia/Kolkata', now())) + interval '400 days') AT TIME ZONE 'Asia/Kolkata'; -- midnight IST, far future
  r text; n int; price numeric; st text; ttl text;
  ins text := 'INSERT INTO bookings (listing_id,user_id,start_time,end_time,total_price) VALUES (%L,%L,%L,%L,0)';
BEGIN
  -- ---------- fixtures (as postgres) ----------
  INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
    (u_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@dbtest.invalid'),
    (u_cons ,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','consumer@dbtest.invalid'),
    (u_admin,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@dbtest.invalid'),
    (u_other,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','other@dbtest.invalid'),
    (u_new  ,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','new@dbtest.invalid');
  INSERT INTO profiles (id, full_name, is_admin) VALUES (u_owner,'Test Owner',false),(u_cons,'Test Consumer',false),(u_admin,'Test Admin',true),(u_other,'Test Other',false);
  INSERT INTO listings (owner_id,title,address,latitude,longitude,price_per_hour,status) VALUES (u_owner,'T ok','a',13.0,80.2,40,'approved') RETURNING id INTO l_ok;
  INSERT INTO listings (owner_id,title,address,latitude,longitude,price_per_hour,status) VALUES (u_owner,'T pending','a',13.0,80.2,40,'pending') RETURNING id INTO l_pend;
  INSERT INTO listings (owner_id,title,address,latitude,longitude,price_per_hour,status,is_active) VALUES (u_owner,'T paused','a',13.0,80.2,40,'approved',false) RETURNING id INTO l_off;
  INSERT INTO listings (owner_id,title,address,latitude,longitude,price_per_hour,status) VALUES (u_owner,'T hours','a',13.0,80.2,40,'approved') RETURNING id INTO l_hours;
  INSERT INTO listings (owner_id,title,address,latitude,longitude,price_per_hour,status) VALUES (u_owner,'T re1','a',13.0,80.2,40,'approved') RETURNING id INTO l_re1;
  INSERT INTO listings (owner_id,title,address,latitude,longitude,price_per_hour,status) VALUES (u_owner,'T re2','a',13.0,80.2,40,'approved') RETURNING id INTO l_re2;
  INSERT INTO listings (owner_id,title,address,latitude,longitude,price_per_hour,status) VALUES (u_owner,'T re3','a',13.0,80.2,40,'approved') RETURNING id INTO l_re3;
  INSERT INTO availability (listing_id, day_of_week, open_time, close_time) SELECT l_hours, d, '10:00', '12:00' FROM generate_series(0,6) d;

  -- ================= BOOKING CONSTRAINT / TRIGGERS =================
  r := pg_temp.as_user('postgres', NULL, format(ins, l_ok, u_cons, base + interval '9 hours', base + interval '11 hours'));
  PERFORM pg_temp.rec('booking: first booking inserts', r = 'OK:1', r);
  SELECT id, total_price, status::text INTO b1, price, st FROM bookings WHERE listing_id = l_ok AND start_time = base + interval '9 hours';
  PERFORM pg_temp.rec('price: 2h x 40 = 80.00 computed by DB (client sent 0)', price = 80, 'total_price=' || price);

  r := pg_temp.as_user('postgres', NULL, format('INSERT INTO bookings (listing_id,user_id,start_time,end_time,total_price,status) VALUES (%L,%L,%L,%L,999,''cancelled'')', l_ok, u_cons, base + interval '13 hours', base + interval '14 hours'));
  SELECT total_price, status::text INTO price, st FROM bookings WHERE listing_id = l_ok AND start_time = base + interval '13 hours';
  PERFORM pg_temp.rec('price/status: client-sent total_price=999,status=cancelled overridden (40.00, confirmed)', price = 40 AND st = 'confirmed', price || ' / ' || st);

  r := pg_temp.as_user('postgres', NULL, format(ins, l_ok, u_other, base + interval '10 hours', base + interval '12 hours'));
  PERFORM pg_temp.rec('overlap: partial overlap rejected with 23P01', r LIKE 'ERR:23P01:%', r);
  r := pg_temp.as_user('postgres', NULL, format(ins, l_ok, u_other, base + interval '9 hours', base + interval '11 hours'));
  PERFORM pg_temp.rec('overlap: identical slot rejected with 23P01', r LIKE 'ERR:23P01:%', r);
  r := pg_temp.as_user('postgres', NULL, format(ins, l_ok, u_other, base + interval '9 hours 30 minutes', base + interval '10 hours'));
  PERFORM pg_temp.rec('overlap: slot contained inside existing rejected with 23P01', r LIKE 'ERR:23P01:%', r);
  r := pg_temp.as_user('postgres', NULL, format(ins, l_ok, u_other, base + interval '8 hours', base + interval '12 hours'));
  PERFORM pg_temp.rec('overlap: slot wrapping existing rejected with 23P01', r LIKE 'ERR:23P01:%', r);
  r := pg_temp.as_user('postgres', NULL, format(ins, l_ok, u_other, base + interval '11 hours', base + interval '12 hours'));
  PERFORM pg_temp.rec('overlap: back-to-back (starts when other ends) allowed', r = 'OK:1', r);
  r := pg_temp.as_user('postgres', NULL, format(ins, l_ok, u_other, base + interval '7 hours', base + interval '9 hours'));
  PERFORM pg_temp.rec('overlap: back-to-back (ends when other starts) allowed', r = 'OK:1', r);
  r := pg_temp.as_user('postgres', NULL, format(ins, l_hours, u_other, base + interval '10 hours 30 minutes', base + interval '11 hours'));
  PERFORM pg_temp.rec('overlap: same time on a DIFFERENT listing is independent', r = 'OK:1', r);

  r := pg_temp.as_user('postgres', NULL, format('UPDATE bookings SET status=''cancelled'' WHERE id=%L', b1));
  r := pg_temp.as_user('postgres', NULL, format(ins, l_ok, u_other, base + interval '9 hours', base + interval '11 hours'));
  PERFORM pg_temp.rec('cancel: cancelled booking frees the slot', r = 'OK:1', r);

  r := pg_temp.as_user('postgres', NULL, format(ins, l_ok, u_cons, base + interval '20 hours', base + interval '19 hours'));
  PERFORM pg_temp.rec('timing: end before start rejected (check constraint 23514)', r LIKE 'ERR:23514:%', r);
  r := pg_temp.as_user('postgres', NULL, format(ins, l_ok, u_cons, base + interval '20 hours', base + interval '20 hours'));
  PERFORM pg_temp.rec('timing: zero-length booking rejected (23514)', r LIKE 'ERR:23514:%', r);

  r := pg_temp.as_user('postgres', NULL, format(ins, l_pend, u_cons, base + interval '15 hours', base + interval '16 hours'));
  PERFORM pg_temp.rec('bookable: pending listing -> LISTING_NOT_BOOKABLE (P0001)', r LIKE 'ERR:P0001:LISTING_NOT_BOOKABLE', r);
  UPDATE listings SET status = 'rejected' WHERE id = l_pend;
  r := pg_temp.as_user('postgres', NULL, format(ins, l_pend, u_cons, base + interval '15 hours', base + interval '16 hours'));
  PERFORM pg_temp.rec('bookable: rejected listing -> LISTING_NOT_BOOKABLE', r LIKE 'ERR:P0001:LISTING_NOT_BOOKABLE', r);
  r := pg_temp.as_user('postgres', NULL, format(ins, l_off, u_cons, base + interval '15 hours', base + interval '16 hours'));
  PERFORM pg_temp.rec('bookable: approved but paused (is_active=false) -> LISTING_NOT_BOOKABLE', r LIKE 'ERR:P0001:LISTING_NOT_BOOKABLE', r);
  r := pg_temp.as_user('postgres', NULL, format(ins, '00000000-0000-4000-8000-000000000000', u_cons, base + interval '15 hours', base + interval '16 hours'));
  PERFORM pg_temp.rec('bookable: unknown listing -> LISTING_NOT_FOUND (P0002)', r LIKE 'ERR:P0002:%', r);

  r := pg_temp.as_user('postgres', NULL, format(ins, l_hours, u_cons, base + interval '13 hours', base + interval '14 hours'));
  PERFORM pg_temp.rec('availability: booking outside opening hours (10-12 IST) rejected', r LIKE 'ERR:P0001:LISTING_NOT_BOOKABLE', r);
  r := pg_temp.as_user('postgres', NULL, format(ins, l_hours, u_cons, base + interval '9 hours 30 minutes', base + interval '10 hours 30 minutes'));
  PERFORM pg_temp.rec('availability: booking straddling opening time rejected', r LIKE 'ERR:P0001:LISTING_NOT_BOOKABLE', r);
  r := pg_temp.as_user('postgres', NULL, format(ins, l_hours, u_cons, base + interval '11 hours 15 minutes', base + interval '12 hours'));
  PERFORM pg_temp.rec('availability: booking inside window accepted', r = 'OK:1', r);

  INSERT INTO bookings (listing_id,user_id,start_time,end_time,total_price) VALUES (l_ok,u_cons,base + interval '21 hours', base + interval '22 hours 30 minutes', 0);
  SELECT total_price INTO price FROM bookings WHERE listing_id = l_ok AND start_time = base + interval '21 hours';
  PERFORM pg_temp.rec('price: 90 min x 40 = 60.00', price = 60, 'total_price=' || price);
  INSERT INTO bookings (listing_id,user_id,start_time,end_time,total_price) VALUES (l_ok,u_cons,base + interval '23 hours', base + interval '23 hours 20 minutes', 0);
  SELECT total_price INTO price FROM bookings WHERE listing_id = l_ok AND start_time = base + interval '23 hours';
  PERFORM pg_temp.rec('price: 20 min x 40 = 13.33 (rounded)', price = 13.33, 'total_price=' || price);

  r := pg_temp.as_user('postgres', NULL, format('UPDATE bookings SET end_time = end_time + interval ''1 hour'' WHERE id=%L', b1));
  PERFORM pg_temp.rec('immutable: booking times cannot be edited after creation (P0003)', r LIKE 'ERR:P0003:%', r);
  r := pg_temp.as_user('postgres', NULL, format('UPDATE bookings SET total_price = 1 WHERE id=%L', b1));
  PERFORM pg_temp.rec('immutable: booking price cannot be edited (P0003)', r LIKE 'ERR:P0003:%', r);

  -- ================= RLS =================
  UPDATE listings SET status = 'pending' WHERE id = l_pend;
  PERFORM pg_temp.rec('RLS enabled on all 4 tables',
    (SELECT count(*) FROM pg_class WHERE relname IN ('profiles','listings','availability','bookings') AND relnamespace = 'public'::regnamespace AND relrowsecurity) = 4, '');

  n := pg_temp.seen('anon', NULL, 'SELECT 1 FROM listings WHERE status <> ''approved''');
  PERFORM pg_temp.rec('RLS anon: cannot see pending/rejected listings', n = 0, 'rows=' || n);
  n := pg_temp.seen('anon', NULL, format('SELECT 1 FROM listings WHERE id=%L', l_ok));
  PERFORM pg_temp.rec('RLS anon: CAN see approved listing', n = 1, 'rows=' || n);
  n := pg_temp.seen('anon', NULL, 'SELECT 1 FROM bookings');
  PERFORM pg_temp.rec('RLS anon: cannot see any bookings', n = 0, 'rows=' || n);
  n := pg_temp.seen('anon', NULL, 'SELECT 1 FROM profiles');
  PERFORM pg_temp.rec('RLS anon: cannot see any profiles', n = 0, 'rows=' || n);
  n := pg_temp.seen('anon', NULL, format('SELECT 1 FROM availability WHERE listing_id=%L', l_hours));
  PERFORM pg_temp.rec('RLS anon: can read availability of approved listing', n = 7, 'rows=' || n);

  n := pg_temp.seen('authenticated', u_cons, format('SELECT 1 FROM listings WHERE id=%L', l_pend));
  PERFORM pg_temp.rec('RLS: other user cannot see someone else''s pending listing', n = 0, 'rows=' || n);
  n := pg_temp.seen('authenticated', u_owner, format('SELECT 1 FROM listings WHERE id=%L', l_pend));
  PERFORM pg_temp.rec('RLS: owner sees own pending listing', n = 1, 'rows=' || n);
  n := pg_temp.seen('authenticated', u_admin, format('SELECT 1 FROM listings WHERE id=%L', l_pend));
  PERFORM pg_temp.rec('RLS: admin sees pending listing', n = 1, 'rows=' || n);

  r := pg_temp.as_user('authenticated', u_cons, format('INSERT INTO listings (owner_id,title,address,latitude,longitude,price_per_hour) VALUES (%L,''x'',''a'',1,1,10)', u_cons));
  PERFORM pg_temp.rec('RLS: user can create own listing (defaults to pending)', r = 'OK:1', r);
  SELECT status::text INTO st FROM listings WHERE owner_id = u_cons AND title = 'x';
  PERFORM pg_temp.rec('RLS: new listing from client is pending', st = 'pending', st);
  r := pg_temp.as_user('authenticated', u_cons, format('INSERT INTO listings (owner_id,title,address,latitude,longitude,price_per_hour,status) VALUES (%L,''y'',''a'',1,1,10,''approved'')', u_cons));
  PERFORM pg_temp.rec('RLS: user cannot create listing already approved', r LIKE 'ERR:42501:%row-level security%', r);
  r := pg_temp.as_user('authenticated', u_cons, format('INSERT INTO listings (owner_id,title,address,latitude,longitude,price_per_hour) VALUES (%L,''z'',''a'',1,1,10)', u_owner));
  PERFORM pg_temp.rec('RLS: user cannot create listing owned by someone else', r LIKE 'ERR:42501:%row-level security%', r);

  r := pg_temp.as_user('authenticated', u_owner, format('UPDATE listings SET title=''T ok renamed'' WHERE id=%L', l_ok));
  PERFORM pg_temp.rec('RLS: owner can edit own listing', r = 'OK:1', r);
  r := pg_temp.as_user('authenticated', u_owner, format('UPDATE listings SET status=''approved'' WHERE id=%L', l_pend));
  PERFORM pg_temp.rec('RLS: owner cannot self-approve (status change blocked)', r LIKE 'ERR:42501:FORBIDDEN%', r);
  r := pg_temp.as_user('authenticated', u_cons, format('UPDATE listings SET title=''hijack'' WHERE id=%L', l_ok));
  SELECT title INTO ttl FROM listings WHERE id = l_ok;
  PERFORM pg_temp.rec('RLS: non-owner edit affects 0 rows and data unchanged', r = 'OK:0' AND ttl = 'T ok renamed', r || ' title=' || ttl);
  r := pg_temp.as_user('authenticated', u_cons, format('UPDATE listings SET status=''approved'' WHERE id=%L', l_pend));
  SELECT status::text INTO st FROM listings WHERE id = l_pend;
  PERFORM pg_temp.rec('RLS: non-admin cannot approve a listing', st = 'pending', r || ' status=' || st);
  r := pg_temp.as_user('authenticated', u_admin, format('UPDATE listings SET status=''approved'', reviewed_by=%L WHERE id=%L', u_admin, l_pend));
  SELECT status::text INTO st FROM listings WHERE id = l_pend;
  PERFORM pg_temp.rec('RLS: admin can approve a listing', r = 'OK:1' AND st = 'approved', r || ' status=' || st);
  r := pg_temp.as_user('authenticated', u_admin, format('UPDATE listings SET owner_id=%L WHERE id=%L', u_admin, l_pend));
  PERFORM pg_temp.rec('RLS: even admin cannot reassign listing owner from client', r LIKE 'ERR:42501:FORBIDDEN%', r);
  r := pg_temp.as_user('authenticated', u_owner, format('DELETE FROM listings WHERE id=%L', l_ok));
  PERFORM pg_temp.rec('RLS: clients cannot delete listings', r = 'OK:0' AND EXISTS (SELECT 1 FROM listings WHERE id = l_ok), r);

  n := pg_temp.seen('authenticated', u_cons, 'SELECT 1 FROM bookings');
  PERFORM pg_temp.rec('RLS bookings: consumer sees only own bookings', n > 0 AND n = (SELECT count(*) FROM bookings WHERE user_id = u_cons), 'rows=' || n);
  n := pg_temp.seen('authenticated', u_other, format('SELECT 1 FROM bookings WHERE user_id = %L', u_cons));
  PERFORM pg_temp.rec('RLS bookings: another user cannot see consumer''s bookings', n = 0, 'rows=' || n);
  n := pg_temp.seen('authenticated', u_owner, format('SELECT 1 FROM bookings WHERE user_id = %L', u_cons));
  PERFORM pg_temp.rec('RLS bookings: provider sees bookings on own listings', n > 0, 'rows=' || n);
  r := pg_temp.as_user('authenticated', u_cons, format(ins, l_ok, u_cons, base + interval '5 hours', base + interval '6 hours'));
  PERFORM pg_temp.rec('RLS bookings: client cannot insert directly (RLS denies, no row created)', r LIKE 'ERR:42501:%row-level security%' AND NOT EXISTS (SELECT 1 FROM bookings WHERE listing_id = l_ok AND start_time = base + interval '5 hours'), r);
  r := pg_temp.as_user('postgres', NULL, format(ins, l_ok, u_owner, base + interval '5 hours', base + interval '6 hours'));
  PERFORM pg_temp.rec('rules: booking your own listing is blocked (PK001)', r LIKE 'ERR:PK001:%' AND NOT EXISTS (SELECT 1 FROM bookings WHERE listing_id = l_ok AND user_id = u_owner), r);
  r := pg_temp.as_user('authenticated', u_cons, format('UPDATE bookings SET status=''cancelled'' WHERE user_id=%L AND status=''confirmed''', u_cons));
  PERFORM pg_temp.rec('RLS bookings: client cannot update directly', r = 'OK:0', r);
  r := pg_temp.as_user('authenticated', u_cons, format('DELETE FROM bookings WHERE user_id=%L', u_cons));
  PERFORM pg_temp.rec('RLS bookings: client cannot delete directly', r = 'OK:0' AND EXISTS (SELECT 1 FROM bookings WHERE user_id = u_cons), r);

  r := pg_temp.as_user('authenticated', u_cons, format('UPDATE profiles SET is_admin=true WHERE id=%L', u_cons));
  PERFORM pg_temp.rec('RLS profiles: user cannot make themselves admin', r LIKE 'ERR:42501:FORBIDDEN%' AND NOT (SELECT is_admin FROM profiles WHERE id = u_cons), r);
  r := pg_temp.as_user('authenticated', u_new, format('INSERT INTO profiles (id,is_admin) VALUES (%L,true)', u_new));
  PERFORM pg_temp.rec('RLS profiles: cannot create own profile as admin', r LIKE 'ERR:42501:%row-level security%', r);
  r := pg_temp.as_user('authenticated', u_new, format('INSERT INTO profiles (id) VALUES (%L)', u_new));
  PERFORM pg_temp.rec('RLS profiles: can create own normal profile', r = 'OK:1', r);
  n := pg_temp.seen('authenticated', u_cons, format('SELECT 1 FROM profiles WHERE id=%L', u_owner));
  PERFORM pg_temp.rec('RLS profiles: user cannot read other users'' profiles', n = 0, 'rows=' || n);

  r := pg_temp.as_user('authenticated', u_cons, format('INSERT INTO availability (listing_id,day_of_week,open_time,close_time) VALUES (%L,1,''08:00'',''09:00'')', l_ok));
  PERFORM pg_temp.rec('RLS availability: non-owner cannot add hours to someone else''s listing', r LIKE 'ERR:42501:%row-level security%', r);
  r := pg_temp.as_user('authenticated', u_owner, format('INSERT INTO availability (listing_id,day_of_week,open_time,close_time) VALUES (%L,1,''08:00'',''09:00'')', l_ok));
  PERFORM pg_temp.rec('RLS availability: owner can add hours to own listing', r = 'OK:1', r);
  -- ---------- approval bypass / confirmation protection ----------
  UPDATE listings SET price_per_hour = 45 WHERE id = l_re1;
  SELECT status::text INTO st FROM listings WHERE id = l_re1;
  PERFORM pg_temp.rec('resubmit: price change keeps an approved listing approved', st = 'approved', st);
  UPDATE listings SET latitude = latitude + 0.01 WHERE id = l_re1;
  SELECT status::text INTO st FROM listings WHERE id = l_re1;
  PERFORM pg_temp.rec('resubmit: moving an approved listing sends it back to pending', st = 'pending', st);
  UPDATE listings SET status = 'approved' WHERE id = l_re1;
  SELECT status::text INTO st FROM listings WHERE id = l_re1;
  PERFORM pg_temp.rec('resubmit: an explicit review decision is never overridden', st = 'approved', st);

  UPDATE listings SET status = 'rejected', review_note = 'no photo' WHERE id = l_re2;
  UPDATE listings SET is_active = false WHERE id = l_re2;
  SELECT status::text INTO st FROM listings WHERE id = l_re2;
  PERFORM pg_temp.rec('resubmit: pausing a rejected listing does not resubmit it', st = 'rejected', st);
  UPDATE listings SET title = 'Fixed title' WHERE id = l_re2;
  SELECT status::text, review_note INTO st, ttl FROM listings WHERE id = l_re2;
  PERFORM pg_temp.rec('resubmit: editing a rejected listing resubmits it (feedback note kept)', st = 'pending' AND ttl = 'no photo', st || ' / ' || COALESCE(ttl, 'null'));

  r := pg_temp.as_user('authenticated', u_owner, format('UPDATE listings SET address = %L WHERE id = %L', 'New address', l_re3));
  SELECT status::text INTO st FROM listings WHERE id = l_re3;
  PERFORM pg_temp.rec('resubmit: owner moving an approved listing directly (client) also resets to pending', r = 'OK:1' AND st = 'pending', r || ' status=' || st);

  r := pg_temp.as_user('authenticated', u_owner, format('UPDATE listings SET last_confirmed_at = now() WHERE id = %L', l_ok));
  PERFORM pg_temp.rec('rules: a client cannot fake last_confirmed_at', r LIKE 'ERR:42501:FORBIDDEN%', r);
END $$;

SELECT pg_temp.cleanup();
SELECT name, passed, detail FROM pg_temp.results ORDER BY n;