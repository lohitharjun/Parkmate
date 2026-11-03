import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelBooking as apiCancelBooking,
  confirmListing as apiConfirmListing,
  createBooking as apiCreateBooking,
  createListing as apiCreateListing,
  getAlternatives as apiGetAlternatives,
  getListings as apiGetListings,
  getMyBookings as apiGetMyBookings,
  getMyListings as apiGetMyListings,
  getProviderBookings,
  getAvailabilityCheck as apiGetAvailabilityCheck,
  getBooking as apiGetBooking,
  uploadListingPhoto as apiUploadListingPhoto,
  deleteListingPhoto as apiDeleteListingPhoto,
  setPrimaryListingPhoto as apiSetPrimaryListingPhoto,
  getListing as apiGetListing,
  patchListing as apiPatchListing,
  updateListingAvailability as apiUpdateAvailability,
} from '../lib/apiClient.js';
import {
  loadDemoBookings,
  loadDemoListings,
  loadDemoProviderReservations,
  newDemoId,
  saveDemoBookings,
  saveDemoListings,
  saveDemoProviderReservations,
} from '../lib/demoStorage.js';
import { searchListings } from '../lib/validation.js';
import { MAX_PHOTOS_PER_LISTING, getCaptureLocation, shrinkToDataUrl, validatePhotoImage } from '../lib/photoUpload.js';
import { mockAvailabilityCheck } from '../lib/demoAvailability.js';
import { SAMPLE_LISTINGS, SAMPLE_PROVIDER_RESERVATIONS } from '../data/seedData.js';
import { useAuth } from '../features/auth/AuthContext.jsx';
import { ApiError } from '../lib/apiClient.js';
import { dedupeActiveBookings, filterListingsByBookings, hasSameDayBooking, vehicleFitsListing } from '../lib/bookingRules.js';

const MarketplaceContext = createContext(null);

export function MarketplaceProvider({ children }) {
  const { isDemoMode, isLiveMode, liveReady, getAccessToken, user } = useAuth();
  const [demoListings, setDemoListings] = useState(() => loadDemoListings());
  const [demoBookings, setDemoBookings] = useState(() => loadDemoBookings());
  const demoBookingsRef = useRef(demoBookings);
  const [demoProviderReservations, setDemoProviderReservations] = useState(() => loadDemoProviderReservations());

  const demoListingsRef = useRef(demoListings);
  useEffect(() => { demoListingsRef.current = demoListings; saveDemoListings(demoListings); }, [demoListings]);
  useEffect(() => {
    demoBookingsRef.current = demoBookings;
    saveDemoBookings(demoBookings);
  }, [demoBookings]);
  useEffect(() => saveDemoProviderReservations(demoProviderReservations), [demoProviderReservations]);

  const assertLiveBackend = useCallback(() => {
    if (!isLiveMode) return;
    if (!liveReady) {
      throw new ApiError('Live actions are disabled until the configured ParkMate API passes its health check.', {
        code: 'BACKEND_UNAVAILABLE',
      });
    }
  }, [isLiveMode, liveReady]);

  const requireToken = useCallback(async () => {
    assertLiveBackend();
    const token = await getAccessToken();
    if (!token) throw new ApiError('Sign in with Supabase before using this protected live action.', { status: 401, code: 'UNAUTHENTICATED' });
    return token;
  }, [assertLiveBackend, getAccessToken]);

  const search = useCallback(async (filters = {}, { signal } = {}) => {
    if (isDemoMode) {
      const matches = searchListings(demoListings.filter((listing) => listing.status === 'approved' && listing.is_active !== false), filters);
      return filterListingsByBookings(matches, demoBookings, {
        selectedDate: filters.start || filters.startISO,
        userId: user?.id,
      });
    }
    assertLiveBackend();
    const apiFilters = {
      query: filters.query,
      vehicle_type: filters.vehicleType,
      max_price: filters.maxPrice,
      lat: filters.latitude,
      lng: filters.longitude,
      start: filters.startISO,
      end: filters.endISO,
      sort: filters.sort,
      signal,
    };
    const rows = await apiGetListings(apiFilters);
    return searchListings(rows, filters);
  }, [assertLiveBackend, demoBookings, demoListings, isDemoMode, user?.id]);

  const getListing = useCallback(async (id) => {
    if (isDemoMode) return demoListings.find((listing) => String(listing.id) === String(id)) || null;
    assertLiveBackend();
    const token = await getAccessToken();
    return apiGetListing(id, token || undefined);
  }, [assertLiveBackend, demoListings, getAccessToken, isDemoMode]);

  const getMyBookings = useCallback(async (status) => {
    if (isDemoMode) return dedupeActiveBookings(demoBookings.filter((booking) => !status || booking.status === status));
    const token = await requireToken();
    return dedupeActiveBookings(await apiGetMyBookings(token, status));
  }, [demoBookings, isDemoMode, requireToken]);

  const getProviderReservations = useCallback(async (listingId) => {
    if (isDemoMode) {
      const localReservations = dedupeActiveBookings(demoBookings)
        .filter((booking) => demoListings.some((listing) => String(listing.id) === String(booking.listing_id) && listing.owner_id === 'demo-provider'))
        .map((booking) => ({
          ...booking,
          listing: booking.listing || { title: booking.listing_title, address: booking.address },
          consumer: booking.consumer || { display_name: 'Demo consumer' },
          is_demo: true,
        }));
      const combined = dedupeActiveBookings([...demoProviderReservations, ...localReservations]);
      return listingId ? combined.filter((booking) => String(booking.listing_id) === String(listingId)) : combined;
    }
    const token = await requireToken();
    return getProviderBookings(token, listingId);
  }, [demoBookings, demoListings, demoProviderReservations, isDemoMode, requireToken]);

  const getMyListings = useCallback(async () => {
    if (isDemoMode) {
      const ownerId = user?.is_demo || !user ? 'demo-provider' : user.id;
      return demoListings.filter((listing) => listing.owner_id === ownerId || (ownerId === 'demo-provider' && listing.id === 'demo-provider-driveway'));
    }
    const token = await requireToken();
    return apiGetMyListings(token);
  }, [demoListings, isDemoMode, requireToken, user?.id, user?.is_demo]);

  const createListing = useCallback(async (payload) => {
    if (!isDemoMode) {
      const token = await requireToken();
      return apiCreateListing(token, payload);
    }
    const ownerId = user?.is_demo ? 'demo-provider' : user?.id || 'demo-provider';
    const listing = {
      ...payload,
      id: newDemoId('demo-listing'),
      owner_id: ownerId,
      status: 'pending',
      is_active: true,
      is_demo: true,
      last_confirmed_at: null,
      distance_km: null,
      illustration: 'forest',
      photos: [],
      location_label: String(payload.address || '').split(',').map((part) => part.trim()).filter(Boolean).slice(-2).join(', '),
    };
    setDemoListings((current) => [listing, ...current]);
    return listing;
  }, [isDemoMode, requireToken, user?.id, user?.is_demo]);

  const updateListing = useCallback(async (id, payload) => {
    if (!isDemoMode) {
      const token = await requireToken();
      return apiPatchListing(token, id, payload);
    }
    const existing = demoListings.find((listing) => String(listing.id) === String(id));
    if (!existing) throw new ApiError('Demo listing not found.', { status: 404, code: 'NOT_FOUND' });
    const updated = { ...existing, ...payload, is_demo: true };
    if (existing.status === 'approved' && ['address', 'latitude', 'longitude'].some((key) => key in payload)) updated.status = 'pending';
    setDemoListings((current) => current.map((listing) => String(listing.id) === String(id) ? updated : listing));
    return updated;
  }, [demoListings, isDemoMode, requireToken]);

  const confirmListing = useCallback(async (id) => {
    if (!isDemoMode) {
      const token = await requireToken();
      return apiConfirmListing(token, id);
    }
    const timestamp = new Date().toISOString();
    const existing = demoListings.find((listing) => String(listing.id) === String(id));
    if (!existing) throw new ApiError('Demo listing not found.', { status: 404, code: 'NOT_FOUND' });
    const updated = {
      ...existing,
      ...(existing.status === 'pending' ? { status: 'approved' } : {}),
      last_confirmed_at: timestamp,
      is_demo: true,
    };
    setDemoListings((current) => current.map((listing) => String(listing.id) === String(id) ? updated : listing));
    return updated;
  }, [demoListings, isDemoMode, requireToken]);

  const updateAvailability = useCallback(async (id, windows) => {
    if (!isDemoMode) {
      const token = await requireToken();
      return apiUpdateAvailability(token, id, windows);
    }
    const existing = demoListings.find((listing) => String(listing.id) === String(id));
    if (!existing) throw new ApiError('Demo listing not found.', { status: 404, code: 'NOT_FOUND' });
    const updated = { ...existing, availability: windows, is_demo: true };
    setDemoListings((current) => current.map((listing) => String(listing.id) === String(id) ? updated : listing));
    return updated;
  }, [demoListings, isDemoMode, requireToken]);

  const createBooking = useCallback(async ({ listing, startISO, endISO, hours, vehicleType }) => {
    if (!user) {
      throw new ApiError('Sign in before creating a booking.', { status: 401, code: 'UNAUTHENTICATED' });
    }
    if (!vehicleType) {
      throw new ApiError('Choose your vehicle type before confirming this booking.', { status: 400, code: 'VEHICLE_REQUIRED' });
    }
    if (!vehicleFitsListing(vehicleType, listing.vehicle_type)) {
      throw new ApiError(`This space does not list a fit for ${vehicleType}. Choose a compatible vehicle or another space.`, {
        status: 400,
        code: 'VEHICLE_NOT_SUPPORTED',
      });
    }
    if (listing.owner_id === (user.id || '')) {
      throw new ApiError('You can’t book your own listing.', { status: 403, code: 'FORBIDDEN', reason: 'OWN_LISTING' });
    }

    if (isDemoMode) {
      const current = demoBookingsRef.current;
      if (hasSameDayBooking(current, listing.id, startISO, user.id)) {
        throw new ApiError('You already have a booking record for this space on that local calendar day. Choose another day.', {
          status: 409,
          code: 'DUPLICATE_LISTING_DAY',
        });
      }
      const booking = {
        id: newDemoId('demo-booking'),
        listing_id: listing.id,
        listing_title: listing.title,
        address: listing.address,
        user_id: user.id,
        consumer_id: user.id,
        vehicle_type: vehicleType,
        start_time: startISO,
        end_time: endISO,
        total_price: Number((Number(listing.price_per_hour) * hours).toFixed(2)),
        status: 'confirmed',
        payment_status: 'unpaid',
        is_demo: true,
        consumer: { id: user.id, display_name: user.full_name || 'Demo driver' },
        listing: { id: listing.id, title: listing.title, address: listing.address },
      };
      const next = [booking, ...current];
      demoBookingsRef.current = next;
      setDemoBookings(next);
      return booking;
    }

    const token = await requireToken();
    const currentBookings = await apiGetMyBookings(token);
    if (hasSameDayBooking(currentBookings, listing.id, startISO, user.id)) {
      throw new ApiError('You already have a booking record for this space on that local calendar day. Choose another day.', {
        status: 409,
        code: 'DUPLICATE_LISTING_DAY',
      });
    }
    return apiCreateBooking(token, {
      listing_id: listing.id,
      start_time: startISO,
      end_time: endISO,
    });
  }, [isDemoMode, requireToken, user]);

  const cancelBooking = useCallback(async (booking) => {
    if (new Date(booking.start_time).getTime() <= Date.now()) {
      throw new ApiError('This booking has already started and cannot be cancelled.', { status: 400, code: 'BOOKING_ALREADY_STARTED' });
    }
    if (!isDemoMode) {
      const token = await requireToken();
      return apiCancelBooking(token, booking.id);
    }
    let cancelled;
    const next = demoBookingsRef.current.map((item) => {
      if (String(item.id) !== String(booking.id)) return item;
      cancelled = { ...item, status: 'cancelled', is_demo: true };
      return cancelled;
    });
    if (!cancelled) throw new ApiError('Demo booking not found.', { status: 404, code: 'NOT_FOUND' });
    demoBookingsRef.current = next;
    setDemoBookings(next);
    return cancelled;
  }, [isDemoMode, requireToken]);

  const getAlternatives = useCallback(async ({ listing, destination, startISO, endISO, maxPrice }) => {
    if (!isDemoMode) {
      const token = await requireToken();
      const latitude = destination?.latitude ?? listing?.latitude;
      const longitude = destination?.longitude ?? listing?.longitude;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new ApiError('A valid destination is required to request backend recommendations.', {
          status: 400,
          code: 'VALIDATION_ERROR',
        });
      }
      return apiGetAlternatives(token, {
        lat: latitude,
        lng: longitude,
        start: startISO,
        end: endISO,
        exclude_listing_id: listing?.id,
        max_price: maxPrice,
        radius_km: 5,
      });
    }
    if (!listing) {
      throw new ApiError('Backend recommendations are unavailable in demo mode. Switch to live mode to use actual backend listings.', {
        code: 'BACKEND_UNAVAILABLE',
      });
    }
    const candidates = searchListings(demoListings.filter((candidate) => (
      candidate.status === 'approved'
      && candidate.is_active !== false
      && String(candidate.id) !== String(listing.id)
      && candidate.owner_id !== (user?.id || 'demo-provider')
    )), { maxPrice, sort: 'distance' });
    return filterListingsByBookings(candidates, demoBookings, { selectedDate: startISO, userId: user?.id })
      .map((candidate) => ({
        listing: candidate,
        distance_km: candidate.distance_km,
        reasons: [
          'Demo alternative only; a server has not checked this time window.',
          'Sample listing and distance; verify all details before real-world use.',
        ],
        is_demo: true,
      }));
  }, [demoBookings, demoListings, isDemoMode, requireToken, user?.id]);

  // Hint only. Never blocks booking: POST /bookings still decides (409 / 422).
  const checkAvailability = useCallback(async (listing, { startISO, endISO }, signal) => {
    if (!listing?.id) return null;
    // Demo mode answers from browser data so the booking panel behaves like live mode.
    if (isDemoMode) return mockAvailabilityCheck(listing, demoBookingsRef.current, startISO, endISO);
    assertLiveBackend();
    const token = await getAccessToken();
    return apiGetAvailabilityCheck(listing.id, { start: startISO, end: endISO }, token || undefined, signal);
  }, [assertLiveBackend, getAccessToken, isDemoMode]);

  const getBooking = useCallback(async (id) => {
    if (isDemoMode) {
      const found = demoBookingsRef.current.find((item) => String(item.id) === String(id));
      if (!found) throw new ApiError('We couldn’t find that booking.', { status: 404, code: 'NOT_FOUND' });
      return found;
    }
    const token = await requireToken();
    return apiGetBooking(token, id);
  }, [isDemoMode, requireToken]);

  const uploadPhoto = useCallback(async (listingId, file) => {
    const problem = await validatePhotoImage(file);
    if (problem) throw new ApiError(problem, { status: 415, code: 'INVALID_PHOTO', context: 'photo' });
    if (!isDemoMode) {
      const token = await requireToken();
      // Location is attached only if the person allows it; a denial just means no coordinates are sent.
      const location = await getCaptureLocation();
      return apiUploadListingPhoto(token, listingId, file, location);
    }
    // A just-created listing may not be in `demoListings` yet, so this works off the id alone.
    const existing = demoListingsRef.current.find((listing) => String(listing.id) === String(listingId));
    if (existing && (existing.photos || []).length >= MAX_PHOTOS_PER_LISTING) throw new ApiError('', { status: 422, code: 'PHOTO_LIMIT_REACHED', context: 'photo' });
    const url = await shrinkToDataUrl(file);
    const photo = { id: newDemoId('demo-photo'), url, status: 'approved', review_status: 'approved', review_note: null, is_primary: !(existing?.photos || []).some((item) => item.is_primary) };
    setDemoListings((current) => current.map((listing) => String(listing.id) === String(listingId) ? { ...listing, photos: [...(listing.photos || []), photo] } : listing));
    return photo;
  }, [demoListings, isDemoMode, requireToken]);

  const deletePhoto = useCallback(async (listingId, photoId) => {
    if (!isDemoMode) {
      const token = await requireToken();
      return apiDeleteListingPhoto(token, listingId, photoId);
    }
    setDemoListings((current) => current.map((listing) => {
      if (String(listing.id) !== String(listingId)) return listing;
      const left = (listing.photos || []).filter((photo) => photo.id !== photoId);
      // If the main photo was removed, the first remaining one takes over.
      if (left.length && !left.some((photo) => photo.is_primary)) left[0] = { ...left[0], is_primary: true };
      return { ...listing, photos: left };
    }));
    return null;
  }, [isDemoMode, requireToken]);

  const setPrimaryPhoto = useCallback(async (listingId, photoId) => {
    if (!isDemoMode) {
      const token = await requireToken();
      return apiSetPrimaryListingPhoto(token, listingId, photoId);
    }
    setDemoListings((current) => current.map((listing) => String(listing.id) === String(listingId)
      ? { ...listing, photos: (listing.photos || []).map((photo) => ({ ...photo, is_primary: photo.id === photoId })) }
      : listing));
    return null;
  }, [isDemoMode, requireToken]);

  const simulateConflict = useCallback((listing) => ({
    code: 'BOOKING_CONFLICT',
    message: `Simulated demo conflict for ${listing.title}; no server booking was attempted.`,
    is_demo: true,
  }), []);

  const value = useMemo(() => ({
    demoListings,
    demoBookings,
    isDemoMode,
    isLiveMode,
    liveReady,
    search,
    getListing,
    getMyBookings,
    getProviderReservations,
    getMyListings,
    createListing,
    updateListing,
    confirmListing,
    updateAvailability,
    createBooking,
    cancelBooking,
    getAlternatives,
    checkAvailability,
    getBooking,
    uploadPhoto,
    deletePhoto,
    setPrimaryPhoto,
    simulateConflict,
  }), [demoListings, demoBookings, isDemoMode, isLiveMode, liveReady, search, getListing, getMyBookings,
    getProviderReservations, getMyListings, createListing, updateListing, confirmListing, updateAvailability,
    createBooking, cancelBooking, getAlternatives, checkAvailability, getBooking, uploadPhoto, deletePhoto, setPrimaryPhoto, simulateConflict]);

  return <MarketplaceContext.Provider value={value}>{children}</MarketplaceContext.Provider>;
}

export function useMarketplace() {
  const context = useContext(MarketplaceContext);
  if (!context) throw new Error('useMarketplace must be used within MarketplaceProvider.');
  return context;
}

export const initialSampleInventory = SAMPLE_LISTINGS;
export const initialSampleReservations = SAMPLE_PROVIDER_RESERVATIONS;
