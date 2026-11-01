import ParkingPhoto from '../../components/ParkingPhoto.jsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CarFront, Clock3, TicketCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMarketplace } from '../../app/MarketplaceContext.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { EmptyState, ErrorState, InlineNotice, LoadingState, PageIntro, SourceBadge } from '../../components/Feedback.jsx';
import { Button, PrimaryLink } from '../../components/Buttons.jsx';
import { formatDateTime, formatINR } from '../../lib/validation.js';
import { BOOKING_VEHICLE_OPTIONS } from '../../lib/bookingRules.js';

const tabs = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  { id: 'cancelled', label: 'Cancelled' },
];

function bookingBucket(booking) {
  if (['cancelled', 'canceled'].includes(String(booking.status).toLowerCase())) return 'cancelled';
  return new Date(booking.end_time).getTime() < Date.now() ? 'past' : 'upcoming';
}

export default function BookingsPage() {
  const { getMyBookings, cancelBooking } = useMarketplace();
  const { isDemoMode, isLiveMode, user, liveReady } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [tab, setTab] = useState('upcoming');
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await getMyBookings());
    } catch (loadError) {
      setItems([]);
      setError(loadError?.message || 'Could not load your bookings.');
    } finally {
      setLoading(false);
    }
  }, [getMyBookings]);

  useEffect(() => { refresh(); }, [refresh]);

  const visibleItems = useMemo(() => items.filter((item) => bookingBucket(item) === tab), [items, tab]);

  async function handleCancel(booking) {
    if (!isDemoMode && !liveReady) return;
    const confirmation = isDemoMode
      ? 'Cancel this demo booking? It will remain visible as Cancelled in local history.'
      : 'Cancel this booking? The backend will receive the cancellation request.';
    if (!window.confirm(confirmation)) return;
    setBusyId(booking.id);
    setMessage('');
    setActionError('');
    try {
      const result = await cancelBooking(booking);
      const updated = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
      setItems((current) => current.map((item) => String(item.id) === String(booking.id)
        ? { ...item, ...updated, status: updated.status || 'cancelled' }
        : item));
      setMessage(isDemoMode ? 'Demo booking cancelled locally. No server request was made.' : 'The backend confirmed the cancellation.');
    } catch (cancelError) {
      setActionError(cancelError?.message || 'Could not cancel this booking.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="bookings-page page-wrap">
      <PageIntro eyebrow="YOUR PARKING, IN ONE PLACE" title={<>My<br className="desktop-break" /> bookings.</>} description={isDemoMode ? 'Only bookings created in this browser session appear here.' : 'Bookings returned for the signed-in Supabase account.'} action={<PrimaryLink to="/consumer/search">Find a space <span aria-hidden="true">↗</span></PrimaryLink>} />
      {isDemoMode && <InlineNotice>Consumer bookings are stored locally in this browser and are labelled demo. Provider reservations are shown on a separate page.</InlineNotice>}
      {isLiveMode && !user && <InlineNotice tone="info">Sign in with Supabase to view the authenticated consumer booking list.</InlineNotice>}
      {message && <InlineNotice tone="success">{message}</InlineNotice>}
      {actionError && <InlineNotice tone="error">{actionError}</InlineNotice>}
      <div className="booking-tabs" role="tablist" aria-label="Filter bookings">
        {tabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-current' : ''} onClick={() => setTab(item.id)}>{item.label}<span>{items.filter((row) => bookingBucket(row) === item.id).length}</span></button>)}
      </div>
      {loading ? <LoadingState label="Loading your bookings…" /> : error ? <ErrorState title="Bookings unavailable" message={error} onRetry={refresh} action={isLiveMode && !user ? <Link className="button button--primary" to="/auth/sign-in?role=consumer&next=%2Fconsumer%2Fbookings">Sign in</Link> : null} /> : visibleItems.length === 0 ? (
        <EmptyState icon={TicketCheck} title={tab === 'upcoming' ? 'Your next stop starts here' : `No ${tab} bookings`} description={tab === 'upcoming' ? 'Choose a space and time window; a confirmed booking will show up here.' : 'When you have bookings in this category, they will appear here.'} action={<PrimaryLink to="/consumer/search">Browse parking</PrimaryLink>} />
      ) : (
        <div className="booking-list">
          {visibleItems.map((booking) => (
            <article className="booking-row" key={booking.id}>
              <div className="booking-row__mark"><ParkingPhoto item={{ ...(booking.listing || {}), id: booking.listing_id || booking.listing?.id || booking.id }} width={200} alt="" /></div>
              <div className="booking-row__main">
                <div className="booking-row__titleline"><h2>{booking.listing?.title || booking.listing_title || 'Parking space'}</h2><SourceBadge isDemo={Boolean(booking.is_demo)} /></div>
                <p className="booking-row__address">{booking.listing?.address || booking.address || 'Address unavailable'}</p>
                <div className="booking-row__times"><span><CalendarDays size={14} /> {formatDateTime(booking.start_time)}</span><span><Clock3 size={14} /> Until {formatDateTime(booking.end_time)}</span>{booking.vehicle_type && <span><CarFront size={14} /> {BOOKING_VEHICLE_OPTIONS.find((option) => option.value === booking.vehicle_type)?.label || booking.vehicle_type}</span>}</div>
              </div>
              <div className="booking-row__side"><span className={`status-chip status-chip--${booking.status}`}>{booking.status}</span><strong>{formatINR(booking.total_price)}</strong>{booking.status === 'confirmed' && new Date(booking.start_time).getTime() > Date.now() && <Button variant="text" className="booking-cancel" disabled={busyId === booking.id} onClick={() => handleCancel(booking)}>{busyId === booking.id ? 'Cancelling…' : 'Cancel booking'}</Button>}</div>
            </article>
          ))}
        </div>
      )}
      <div className="bookings-separation"><span>Different view?</span><Link to="/provider/reservations">Provider reservations are listed separately →</Link></div>
    </section>
  );
}
