import ParkingPhoto from '../../components/ParkingPhoto.jsx';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, CarFront, Clock3, MapPin, ShieldCheck } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMarketplace } from '../../app/MarketplaceContext.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { Button } from '../../components/Buttons.jsx';
import { EmptyState, ErrorState, InlineNotice, LoadingState, SourceBadge } from '../../components/Feedback.jsx';
import { formatDateTime, formatINR, getDefaultWindow, toLocalDateTimeInput, validateBookingWindow } from '../../lib/validation.js';
import { ApiError } from '../../lib/apiClient.js';
import { BOOKING_VEHICLE_OPTIONS, vehicleFitsListing } from '../../lib/bookingRules.js';

function initialWindow(location, params) {
  const queryStart = params.get('start');
  const queryEnd = params.get('end');
  const stateStart = location.state?.startISO;
  const stateEnd = location.state?.endISO;
  if (queryStart && queryEnd) return { start: toLocalDateTimeInput(queryStart), end: toLocalDateTimeInput(queryEnd) };
  if (stateStart && stateEnd) return { start: toLocalDateTimeInput(stateStart), end: toLocalDateTimeInput(stateEnd) };
  return getDefaultWindow();
}

export default function ListingDetailsPage() {
  const { listingId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { getListing, createBooking, getAlternatives, simulateConflict } = useMarketplace();
  const { isDemoMode, user, isLiveMode, liveReady } = useAuth();
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [bookingError, setBookingError] = useState('');
  const [success, setSuccess] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [windowRange, setWindowRange] = useState(() => initialWindow(location, params));
  const [vehicleType, setVehicleType] = useState(() => params.get('vehicle') || '');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    getListing(listingId)
      .then((result) => {
        if (!active) return;
        setListing(result);
        if (!result) setLoadError('This listing is not available in the current data source.');
      })
      .catch((error) => { if (active) setLoadError(error?.message || 'Could not load this listing.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [getListing, listingId]);

  const timeCheck = useMemo(() => validateBookingWindow(windowRange), [windowRange]);
  const hours = timeCheck.ok ? timeCheck.hours : 0;
  const estimate = listing ? Number(listing.price_per_hour) * hours : 0;

  async function openRescue(simulated = false, error = null) {
    if (!listing) return;
    const state = {
      listing,
      startISO: timeCheck.ok ? timeCheck.startISO : undefined,
      endISO: timeCheck.ok ? timeCheck.endISO : undefined,
      maxPrice: listing.price_per_hour,
      simulated,
      conflictMessage: simulated ? simulateConflict(listing).message : error?.message,
    };
    try {
      if (timeCheck.ok) state.alternatives = await getAlternatives({
        listing,
        startISO: timeCheck.startISO,
        endISO: timeCheck.endISO,
        maxPrice: listing.price_per_hour,
      });
    } catch (alternativeError) {
      state.alternativeError = alternativeError?.message || 'Could not load alternatives.';
    }
    navigate('/consumer/rescue', { state });
  }

  async function submitBooking(event) {
    event.preventDefault();
    setBookingError('');
    setSuccess(null);
    if (!listing) return;
    if (!timeCheck.ok) {
      setBookingError(timeCheck.error);
      return;
    }
    if (!vehicleType) {
      setBookingError('Choose the vehicle you are parking before continuing.');
      return;
    }
    if (!vehicleFitsListing(vehicleType, listing.vehicle_type)) {
      setBookingError(`This space does not list a fit for ${vehicleType}. Choose a compatible vehicle or another space.`);
      return;
    }
    if (!user) {
      const nextParams = new URLSearchParams({ start: windowRange.start, end: windowRange.end, vehicle: vehicleType });
      const next = `${location.pathname}?${nextParams.toString()}`;
      navigate(`/auth/sign-in?role=consumer&next=${encodeURIComponent(next)}`);
      return;
    }
    if (listing.status === 'pending' || listing.status === 'rejected' || listing.is_active === false) {
      setBookingError('This listing is pending, rejected, or paused and cannot be booked.');
      return;
    }
    setSubmitting(true);
    try {
      const booking = await createBooking({ listing, startISO: timeCheck.startISO, endISO: timeCheck.endISO, hours, vehicleType });
      setSuccess(booking);
    } catch (error) {
      if (error instanceof ApiError && ['BOOKING_CONFLICT', 'LISTING_NOT_BOOKABLE'].includes(error.code)) {
        await openRescue(false, error);
      } else {
        setBookingError(error?.message || 'The booking could not be completed.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSimulatedConflict() {
    if (!timeCheck.ok) {
      setBookingError(timeCheck.error);
      return;
    }
    setSubmitting(true);
    setBookingError('');
    await openRescue(true);
    setSubmitting(false);
  }

  if (loading) return <section className="page-wrap detail-page"><LoadingState label="Loading listing details…" /></section>;
  if (loadError) return <section className="page-wrap detail-page"><ErrorState title="Listing unavailable" message={loadError} action={<Link className="button button--secondary" to="/consumer/search">Back to search</Link>} /></section>;
  if (!listing) return <section className="page-wrap detail-page"><EmptyState title="Listing not found" description="Return to search and choose another space." action={<Link className="button button--primary" to="/consumer/search">Find parking</Link>} /></section>;

  return (
    <section className="detail-page page-wrap">
      <Link className="back-link" to="/consumer/search"><ArrowLeft size={16} /> Back to spaces</Link>
      <div className="detail-layout">
        <div className="listing-detail-art" aria-label="Illustrative parking image">
          <ParkingPhoto item={listing} width={1400} loading="eager" alt="Illustrative parking photograph; this is not a photograph of the listed space" />
          <span className="detail-art__image-label">ILLUSTRATIVE IMAGE · NOT THIS SPACE</span>
          <span className="detail-art__caption">{listing.is_demo ? 'Sample visual only — not a real offer' : 'No specific listing photo is connected'}</span>
        </div>
        <div className="detail-copy">
          <div className="detail-copy__top"><span className="eyebrow">PARKING SPACE DETAILS</span><SourceBadge isDemo={Boolean(listing.is_demo)} /></div>
          <h1>{listing.title}</h1>
          <p className="detail-copy__address"><MapPin size={16} /> {listing.address}</p>
          <div className="detail-copy__price"><strong>{formatINR(listing.price_per_hour)}</strong><span>per hour</span></div>
          <div className="detail-copy__status"><BadgeCheck size={16} /><span>{listing.status === 'approved' && listing.is_active ? 'Approved listing' : `${listing.status || 'Status unavailable'} listing`}</span><span className="detail-copy__dot" />{listing.distance_km == null ? <span>Distance not provided</span> : <span>{Number(listing.distance_km).toFixed(1)} km {listing.is_demo ? 'sample estimate' : 'away'}</span>}</div>
          <div className="detail-copy__description"><h2>About this space</h2><p>{listing.description || 'The host has not added a description yet.'}</p></div>
          {listing.vehicle_type && <div className="detail-copy__detail"><CarFront size={16} /><span>Fits: {listing.vehicle_type}</span></div>}
          {listing.rules && <div className="detail-copy__detail"><ShieldCheck size={16} /><span>{listing.rules}</span></div>}
          <div className="detail-copy__detail"><Clock3 size={16} /><span>{Array.isArray(listing.availability) && listing.availability.length ? 'Weekly hours on file; confirm the requested time.' : 'Hours not specified; the backend contract treats no windows as open 24×7.'}</span></div>
          {listing.is_demo && <InlineNotice tone="info" className="detail-demo-note">This is a fictional sample listing. Its address, coordinates, price and availability are not a real offer.</InlineNotice>}
        </div>
      </div>

      <div className="booking-panel">
        <div className="booking-panel__summary"><div><span className="eyebrow">YOUR TIME WINDOW</span><h2>Choose when you’ll park</h2><p>{isDemoMode ? 'Demo estimate only · no payment is collected' : 'The server validates availability and calculates the final total.'}</p></div><div className="booking-panel__price"><strong>{formatINR(listing.price_per_hour)}</strong><span>/ hour</span></div></div>
          <form className="booking-form" onSubmit={submitBooking} noValidate>
          <label className="field"><span>Start time</span><input type="datetime-local" value={windowRange.start} onChange={(event) => { setWindowRange((current) => ({ ...current, start: event.target.value })); setBookingError(''); setSuccess(null); }} required /></label>
          <label className="field"><span>End time</span><input type="datetime-local" value={windowRange.end} onChange={(event) => { setWindowRange((current) => ({ ...current, end: event.target.value })); setBookingError(''); setSuccess(null); }} required /></label>
          <label className="field booking-form__vehicle"><span>What are you parking?</span><select value={vehicleType} onChange={(event) => { setVehicleType(event.target.value); setBookingError(''); setSuccess(null); }} required><option value="">Choose vehicle type</option>{BOOKING_VEHICLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>{listing.vehicle_type ? `Fit listed: ${listing.vehicle_type}` : 'The provider has not specified a vehicle fit; confirm access details before arriving.'}</small></label>
          <div className="booking-form__total"><span>Estimated total</span><strong>{timeCheck.ok ? formatINR(estimate) : '—'}</strong><small>{timeCheck.ok ? `${hours.toFixed(hours % 1 ? 1 : 0)} hours` : 'Choose a valid time window'}</small></div>
          <button className="button button--primary booking-submit" type="submit" disabled={submitting || Boolean(success) || (isLiveMode && !liveReady)}>{submitting ? 'Checking…' : !user ? 'Sign in to book' : isDemoMode ? 'Create demo booking' : 'Confirm booking'} <ArrowRight size={16} /></button>
        </form>
        {!timeCheck.ok && <p className="field-error booking-form__error">{timeCheck.error}</p>}
        {bookingError && <InlineNotice tone="error" className="booking-result-note">{bookingError}</InlineNotice>}
        {success && <InlineNotice tone="success" className="booking-result-note"><strong>{success.is_demo ? 'Demo booking saved locally.' : 'Booking confirmed by the backend.'}</strong> {success.is_demo ? 'No reservation was sent to a server.' : 'The API confirmed this reservation.'}<div className="notice-actions"><Link className="text-link" to="/consumer/bookings">View My Bookings <ArrowRight size={14} /></Link></div></InlineNotice>}
        {isDemoMode && <div className="booking-panel__sim"><span><AlertTriangle size={15} /> Explore the recovery flow without a server request.</span><Button variant="outline" onClick={submitSimulatedConflict} disabled={submitting}>Simulate conflict & open Rescue (demo)</Button></div>}
        {isLiveMode && <p className="field-help">Vehicle fit is checked before submission; the existing live API receives only the documented listing and time fields.</p>}
        {isLiveMode && !liveReady && <p className="field-error">Live booking is disabled until the API health check succeeds.</p>}
      </div>
    </section>
  );
}
