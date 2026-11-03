import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, CarFront, Clock3, MapPin } from 'lucide-react';
import { useMarketplace } from '../../app/MarketplaceContext.jsx';
import { ErrorState, LoadingState } from '../../components/Feedback.jsx';
import { friendlyError } from '../../lib/errors.js';
import { formatDateTime, formatINR } from '../../lib/validation.js';

const PAYMENT_LABELS = { unpaid: 'Unpaid', paid: 'Paid', refunded: 'Refunded', failed: 'Payment failed' };

export default function BookingDetailPage() {
  const { bookingId } = useParams();
  const { getBooking } = useMarketplace();
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    getBooking(bookingId)
      .then((result) => { if (active) setBooking(result); })
      // Someone else’s booking comes back 404 from the server; we say so plainly and reveal nothing about it.
      .catch((problem) => { if (active) setError(problem?.status === 404 ? 'We couldn’t find that booking. It may not exist, or it may belong to another account.' : friendlyError(problem)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [getBooking, bookingId]);

  const back = <Link className="back-link" to="/consumer/bookings"><ArrowLeft size={16} /> Back to my bookings</Link>;
  if (loading) return <section className="bookings-page page-wrap">{back}<LoadingState label="Loading booking…" /></section>;
  if (error || !booking) return <section className="bookings-page page-wrap">{back}<ErrorState title="Booking unavailable" message={error || 'We couldn’t find that booking.'} /></section>;
  const title = booking.listing?.title || booking.listing_title || 'Parking space';
  const address = booking.listing?.address || booking.address;
  return (
    <section className="bookings-page page-wrap">
      {back}
      <article className="booking-detail surface-card">
        <div className="booking-detail__top"><div><span className="eyebrow">BOOKING</span><h1>{title}</h1>{address && <p><MapPin size={15} /> {address}</p>}</div><span className={`status-chip status-chip--${booking.status}`}>{booking.status}</span></div>
        <dl className="booking-detail__grid">
          <div><dt><CalendarDays size={14} /> Starts</dt><dd>{formatDateTime(booking.start_time)}</dd></div>
          <div><dt><Clock3 size={14} /> Ends</dt><dd>{formatDateTime(booking.end_time)}</dd></div>
          {booking.vehicle_type && <div><dt><CarFront size={14} /> Vehicle</dt><dd>{booking.vehicle_type}</dd></div>}
          <div><dt>Total</dt><dd>{formatINR(booking.total_price)}</dd></div>
          {booking.payment_status && <div><dt>Payment</dt><dd><span className={`payment-chip payment-chip--${booking.payment_status}`}>{PAYMENT_LABELS[booking.payment_status] || booking.payment_status}</span></dd></div>}
        </dl>
        <p className="muted-note">Online payment isn’t available yet. Your booking is held; there’s nothing to pay in the app right now.</p>
      </article>
    </section>
  );
}
