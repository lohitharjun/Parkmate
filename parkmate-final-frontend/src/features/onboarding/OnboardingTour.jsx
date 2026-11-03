import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { Building2, CalendarCheck, LifeBuoy, Search, Sparkles, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { track } from '../../lib/analytics.js';

const STEPS = {
  consumer: [
    { icon: Sparkles, title: 'Welcome to ParkMate', body: 'Find a private space near where you’re headed and book it by the hour. Here’s a 30-second tour.' },
    { icon: Search, title: 'Search by area and time', body: 'Type an area or landmark, set when you’ll arrive and leave, and compare prices side by side.', cta: { to: '/consumer/search', label: 'Open Find parking' } },
    { icon: CalendarCheck, title: 'Book with confidence', body: 'We check the slot is free before confirming, so you never get double-booked. Find every booking in My bookings.', cta: { to: '/consumer/bookings', label: 'See My bookings' } },
    { icon: LifeBuoy, title: 'A backup if it falls through', body: 'If the space you wanted is taken, Parking Rescue suggests alternatives that fit your time.', cta: { to: '/consumer/rescue', label: 'Open Parking Rescue' } },
  ],
  provider: [
    { icon: Sparkles, title: 'Welcome to ParkMate', body: 'Turn a garage, driveway or apartment spot into extra income. Here’s a 30-second tour.' },
    { icon: Building2, title: 'List your space', body: 'Add the address, your hourly price and the vehicles it fits. New spaces are reviewed before drivers can book them.', cta: { to: '/provider/listings', label: 'Add a space' } },
    { icon: CalendarCheck, title: 'Set the hours it’s free', body: 'Choose the days and times your space can be rented, and keep them up to date so drivers can trust them.', cta: { to: '/provider/listings', label: 'Set availability' } },
    { icon: Search, title: 'Track every reservation', body: 'See who’s booked and when from the Reservations tab. You can also switch to the driver side from your profile menu any time.', cta: { to: '/provider/reservations', label: 'Open Reservations' } },
  ],
};

const storageKey = (id) => `parkmate.onboarding.v1.${id}`;
function isDone(id) {
  try { return localStorage.getItem(storageKey(id)) === 'done'; } catch { return true; /* can't remember, so don't nag */ }
}
function markDone(id) {
  try { localStorage.setItem(storageKey(id), 'done'); } catch { /* ignore */ }
}

/** First-run welcome tour. Shows once per account; can be replayed from Help & support. */
export default function OnboardingTour() {
  const { user, viewRole } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const dialogRef = useRef(null);
  const userId = user?.id;
  const onAppPage = !/^\/(auth|legal)\b/.test(location.pathname) && location.pathname !== '/';

  useEffect(() => {
    if (userId && onAppPage && !isDone(userId)) { setIndex(0); setOpen(true); }
  }, [userId, onAppPage]);

  useEffect(() => {
    const replay = () => { setIndex(0); setOpen(true); };
    window.addEventListener('parkmate:replay-tour', replay);
    return () => window.removeEventListener('parkmate:replay-tour', replay);
  }, []);

  const finish = useCallback((how) => {
    if (userId) markDone(userId);
    track(`onboarding_${how}`, { step: index + 1 });
    setOpen(false);
  }, [index, userId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') finish('skipped'); };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.querySelector('button.button--primary, a.button--primary')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, index, finish]);

  if (!open || !user) return null;
  const steps = STEPS[viewRole === 'provider' ? 'provider' : 'consumer'];
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const Icon = step.icon;

  return createPortal(
    <div className="tour-overlay" role="presentation">
      <div className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" ref={dialogRef}>
        <button className="tour-card__close" type="button" aria-label="Skip the tour" onClick={() => finish('skipped')}><X size={18} /></button>
        <span className="tour-card__icon"><Icon size={26} /></span>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.body}</p>
        {step.cta && <Link className="tour-card__link" to={step.cta.to} onClick={() => finish('completed')}>{step.cta.label} →</Link>}
        <div className="tour-card__dots" aria-hidden="true">{steps.map((_, i) => <i key={i} className={i === index ? 'is-on' : ''} />)}</div>
        <div className="tour-card__actions">
          {index > 0 ? <button className="button button--secondary" type="button" onClick={() => setIndex(index - 1)}>Back</button> : <button className="button button--secondary" type="button" onClick={() => finish('skipped')}>Skip</button>}
          <button className="button button--primary" type="button" onClick={() => (last ? finish('completed') : setIndex(index + 1))}>{last ? 'Get started' : 'Next'}</button>
        </div>
        <p className="tour-card__count">Step {index + 1} of {steps.length}</p>
      </div>
    </div>,
    document.body,
  );
}
