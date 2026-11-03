import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, CarFront, ClipboardList, MapPin, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMarketplace } from '../../app/MarketplaceContext.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { EmptyState, ErrorState, InlineNotice, LoadingState, PageIntro, SourceBadge } from '../../components/Feedback.jsx';
import { PrimaryLink } from '../../components/Buttons.jsx';
import { formatDateTime, formatINR } from '../../lib/validation.js';
import { BOOKING_VEHICLE_OPTIONS } from '../../lib/bookingRules.js';

export default function ProviderReservationsPage() {
  const { getProviderReservations, getMyListings } = useMarketplace();
  const { isDemoMode, user } = useAuth();
  const [reservations, setReservations] = useState([]);
  const [listings, setListings] = useState([]);
  const [listingId, setListingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [nextListings, nextReservations] = await Promise.all([getMyListings(), getProviderReservations(listingId || undefined)]);
      setListings(nextListings);
      setReservations(nextReservations);
    } catch (loadError) {
      setListings([]); setReservations([]);
      setError(loadError?.message || 'Could not load provider reservations.');
    } finally { setLoading(false); }
  }, [getMyListings, getProviderReservations, listingId]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <section className="provider-page page-wrap">
      <PageIntro eyebrow="KEEP TRACK OF VISITS" title={<>Provider<br className="desktop-break" /> reservations.</>} description={isDemoMode ? 'Browser-created demo bookings appear alongside clearly labelled sample reservations. Consumer “My Bookings” is a separate view.' : `Reservations for this signed-in account${user?.full_name ? `, ${user.full_name}` : ''}.`} action={<Link className="button button--secondary" to="/provider/listings">Manage spaces</Link>} />
      {isDemoMode && <InlineNotice>Demo reservations are local to this browser. Seeded examples are illustrative; demo consumer bookings for your provider listings appear here too. No real customers, notifications, or payments are connected.</InlineNotice>}
      <div className="reservation-toolbar"><label className="field"><span>Filter by listing</span><select value={listingId} onChange={(event) => setListingId(event.target.value)}><option value="">All my listings</option>{listings.map((listing) => <option key={listing.id} value={listing.id}>{listing.title}</option>)}</select></label><span className="reservation-toolbar__count">{loading ? 'Loading…' : `${reservations.length} reservations`}</span></div>
      {loading ? <LoadingState label="Loading provider reservations…" /> : error ? <ErrorState title="Reservations unavailable" message={error} onRetry={refresh} action={<Link className="button button--primary" to="/auth/sign-in?role=provider&next=%2Fprovider%2Freservations">Sign in</Link>} /> : reservations.length === 0 ? <EmptyState icon={ClipboardList} title="No reservations yet" description="When a driver books one of your approved spaces, the reservation appears here — separately from your own bookings." action={<PrimaryLink to="/provider/listings">Create or manage a space</PrimaryLink>} /> : (
        <div className="provider-reservation-list">{reservations.map((reservation) => <article className="provider-reservation" key={reservation.id}>
          <span className="provider-reservation__avatar"><UsersRound size={18} /></span>
          <div className="provider-reservation__main"><div className="provider-reservation__title"><h2>{reservation.consumer?.display_name || 'Consumer'}</h2><SourceBadge isDemo={Boolean(reservation.is_demo)} /></div><p><MapPin size={14} /> {reservation.listing?.title || 'Listing unavailable'} · {reservation.listing?.address || ''}</p><span className="provider-reservation__time"><CalendarDays size={14} /> {formatDateTime(reservation.start_time)} – {formatDateTime(reservation.end_time)}</span>{reservation.vehicle_type && <span className="provider-reservation__time"><CarFront size={14} /> Vehicle: {BOOKING_VEHICLE_OPTIONS.find((option) => option.value === reservation.vehicle_type)?.label || reservation.vehicle_type}</span>}</div>
          <div className="provider-reservation__side"><span className={`status-chip status-chip--${reservation.status}`}>{reservation.status}</span><strong>{formatINR(reservation.total_price)}</strong><small>{reservation.is_demo ? 'Demo estimate only' : 'Calculated by backend in live mode'}</small></div>
        </article>)}</div>
      )}
      <div className="bookings-separation"><span>Looking for your own parking reservations?</span><Link to="/consumer/bookings">Open consumer My Bookings →</Link></div>
    </section>
  );
}
