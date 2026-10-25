-- 004: table privileges for Supabase's client roles. Safe to re-run.
-- Without these, anon/authenticated get "permission denied" (42501) before RLS is even evaluated.
-- This matches Supabase's default; row access is then decided by the RLS policies from 003.
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON TABLE public.profiles, public.listings, public.availability, public.bookings TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;
