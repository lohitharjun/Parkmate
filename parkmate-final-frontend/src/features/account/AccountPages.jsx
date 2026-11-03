import { CreditCard, Mail, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../../app/ThemeContext.jsx';
import { EmptyState, InlineNotice, PageIntro } from '../../components/Feedback.jsx';
import { analyticsConfigured, getConsent, setConsent, track } from '../../lib/analytics.js';
import { friendlyError } from '../../lib/errors.js';
import { LANGUAGES, loadLanguage, saveLanguage } from '../../lib/i18n.js';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function nameOf(user) {
  return user?.full_name || user?.email?.split('@')[0] || 'Account';
}

/** "Orders" = the signed-in person's bookings (consumer) or reservations they receive (provider). */
export function OrdersRedirect() {
  const { viewRole } = useAuth();
  return <Navigate to={viewRole === 'provider' ? '/provider/reservations' : '/consumer/bookings'} replace />;
}

export function ProfilePage() {
  const { user, viewRole } = useAuth();
  const name = nameOf(user);
  return (
    <section className="account-page page-wrap">
      <PageIntro eyebrow="YOUR ACCOUNT" title={<>Your<br className="desktop-break" /> profile.</>} description="The details attached to this ParkMate account." />
      <div className="account-card surface-card">
        <div className="account-card__head">
          <span className="account-avatar">{name.charAt(0).toUpperCase()}</span>
          <div><h2>{name}</h2><p>{viewRole === 'provider' ? 'Provider' : 'Consumer'} view</p></div>
        </div>
        <dl className="account-details">
          <div><dt><UserRound size={16} /> Name</dt><dd>{name}</dd></div>
          <div><dt><Mail size={16} /> Email</dt><dd>{user?.email || 'Not available'}</dd></div>
          <div><dt><ShieldCheck size={16} /> Account</dt><dd>One account works on both the Consumer and Provider sides. Switch from the profile menu.</dd></div>
        </dl>
        <p className="muted-note">Name and email are managed by your sign-in account and can’t be edited here yet.</p>
      </div>
      <DeleteAccountSection />
    </section>
  );
}

export function PaymentsPage() {
  return (
    <section className="account-page page-wrap">
      <PageIntro eyebrow="YOUR ACCOUNT" title={<>Payment<br className="desktop-break" /> history.</>} description="Payments and payouts for your bookings." />
      <div className="account-card surface-card">
        <EmptyState icon={CreditCard} title="No payments yet" description="ParkMate doesn’t collect payments in this version, so there is nothing to list. Booking totals are calculated by the server and shown on each booking." action={<Link className="button button--secondary" to="/consumer/bookings">View my bookings</Link>} />
      </div>
    </section>
  );
}

export function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const [lang, setLang] = useState(loadLanguage);
  return (
    <section className="account-page page-wrap">
      <PageIntro eyebrow="YOUR ACCOUNT" title={<>Account<br className="desktop-break" /> settings.</>} description="Choose how ParkMate looks and reads for you on this device." />
      <div className="account-card surface-card">
        <div className="set-row">
          <div><b>Appearance</b><small>Light or dark. Remembered on this device.</small></div>
          <div className="seg" role="group" aria-label="Appearance">
            <button type="button" aria-pressed={theme === 'light'} onClick={() => theme !== 'light' && toggleTheme()}>Light</button>
            <button type="button" aria-pressed={theme === 'dark'} onClick={() => theme !== 'dark' && toggleTheme()}>Dark</button>
          </div>
        </div>
        <div className="set-row">
          <div><b>Language</b><small>Only the profile menu is translated for now.</small></div>
          <label className="field set-row__select"><span className="sr-only">Language</span>
            <select value={lang} onChange={(event) => { setLang(event.target.value); saveLanguage(event.target.value); }}>
              {Object.entries(LANGUAGES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </label>
        </div>
        {analyticsConfigured && <AnalyticsRow />}
      </div>
    </section>
  );
}

function AnalyticsRow() {
  const [on, setOn] = useState(() => getConsent() === 'granted');
  return (
    <div className="set-row">
      <div><b>Usage analytics</b><small>Helps us see which pages are useful. Never includes your name or email. <Link to="/legal/privacy">Learn more</Link></small></div>
      <div className="seg" role="group" aria-label="Usage analytics">
        <button type="button" aria-pressed={on} onClick={() => { setConsent('granted'); setOn(true); }}>On</button>
        <button type="button" aria-pressed={!on} onClick={() => { setConsent('denied'); setOn(false); }}>Off</button>
      </div>
    </div>
  );
}

const FAQ = [
  ['How do I book a space?', 'Open Find parking, pick a space, choose your start and end time, and confirm. The server checks the slot is free before it confirms.'],
  ['How do I list my space?', 'Switch to the Provider dashboard from the profile menu, open My spaces and add your address, hourly price and weekly hours. New spaces are reviewed before drivers can book them.'],
  ['What is Parking Rescue?', 'If the space you wanted is taken, Parking Rescue suggests other spaces that are free for your time, ranked by distance, price and how recently the listing was updated.'],
  ['Can I cancel a booking?', 'Yes. Open My bookings, find the booking and choose Cancel. The server confirms the cancellation.'],
  ['Are payments taken in the app?', 'Not in this version. ParkMate shows the total for your booking but does not collect payment.'],
];

export function HelpPage() {
  return (
    <section className="account-page page-wrap">
      <PageIntro eyebrow="WE’RE HERE TO HELP" title={<>Help &<br className="desktop-break" /> support.</>} description="Quick answers about booking, listing a space and Parking Rescue." />
      <div className="account-card surface-card faq">
        {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
        <div className="set-row"><div><b>Welcome tour</b><small>A quick walk through ParkMate.</small></div><button className="button button--secondary" type="button" onClick={() => window.dispatchEvent(new Event('parkmate:replay-tour'))}>Replay the tour</button></div>
        <p className="muted-note">Read our <Link to="/legal/terms">Terms of Service</Link> and <Link to="/legal/privacy">Privacy Policy</Link>.</p>
      </div>
    </section>
  );
}

function DeleteAccountSection() {
  const { deleteAccount, isDemoMode } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape' && !busy) close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    setOpen(false); setTyped(''); setError('');
    openerRef.current?.focus();
  }

  async function confirm(event) {
    event.preventDefault();
    if (typed.trim() !== 'DELETE') return;
    setBusy(true); setError('');
    try {
      try { sessionStorage.setItem('parkmate.accountDeleted', '1'); } catch { /* the notice is a nicety */ }
      await deleteAccount();
      track('account_deleted');
      navigate('/auth/sign-in?deleted=1', { replace: true });
    } catch (problem) {
      try { sessionStorage.removeItem('parkmate.accountDeleted'); } catch { /* ignore */ }
      setError(friendlyError(problem));
      setBusy(false);
    }
  }

  return (
    <div className="account-card surface-card danger-zone">
      <div className="danger-zone__head">
        <span className="danger-zone__icon"><Trash2 size={18} /></span>
        <div><h2>Delete account</h2><p>Permanently remove your ParkMate account and everything attached to it. This can’t be undone.</p></div>
      </div>
      <button ref={openerRef} className="button button--danger" type="button" onClick={() => setOpen(true)}>Delete my account</button>
      {open && createPortal(
        <div className="tour-overlay" role="presentation" onClick={() => !busy && close()}>
          <form className="tour-card delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-desc" onSubmit={confirm} onClick={(event) => event.stopPropagation()}>
            <h2 id="delete-title">Delete your account?</h2>
            <div id="delete-desc">
              <p>This will permanently delete:</p>
              <ul>
                <li>your login and profile</li>
                <li>every space you’ve listed</li>
                <li>your bookings, and bookings other people made on your spaces</li>
              </ul>
              {isDemoMode && <InlineNotice tone="info">Demo mode: this clears the demo data stored in this browser.</InlineNotice>}
            </div>
            <label className="field"><span>Type <strong>DELETE</strong> to confirm</span><input ref={inputRef} value={typed} onChange={(event) => { setTyped(event.target.value); setError(''); }} autoComplete="off" autoCapitalize="characters" spellCheck="false" /></label>
            {error && <InlineNotice tone="error">{error}</InlineNotice>}
            <div className="tour-card__actions">
              <button className="button button--secondary" type="button" onClick={close} disabled={busy}>Cancel</button>
              <button className="button button--danger" type="submit" disabled={busy || typed.trim() !== 'DELETE'}>{busy ? 'Deleting…' : 'Delete forever'}</button>
            </div>
          </form>
        </div>,
        document.body,
      )}
    </div>
  );
}
