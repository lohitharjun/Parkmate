import ParkingPhoto from '../../components/ParkingPhoto.jsx';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Building2, CalendarClock, Clock3, MapPin, Plus, Power } from 'lucide-react';
import { useMarketplace } from '../../app/MarketplaceContext.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import ListingEditForm from './ListingEditForm.jsx';
import { Button, PrimaryLink } from '../../components/Buttons.jsx';
import { EmptyState, ErrorState, InlineNotice, LoadingState, PageIntro, SourceBadge } from '../../components/Feedback.jsx';
import { formatINR, formatDateTime } from '../../lib/validation.js';

const DAYS = [
  { day_of_week: 0, label: 'Sun' }, { day_of_week: 1, label: 'Mon' }, { day_of_week: 2, label: 'Tue' },
  { day_of_week: 3, label: 'Wed' }, { day_of_week: 4, label: 'Thu' }, { day_of_week: 5, label: 'Fri' }, { day_of_week: 6, label: 'Sat' },
];
const defaultForm = { title: '', address: '', latitude: '', longitude: '', price: '50', description: '', rules: '', vehicle: '', evidenceUrls: '', allDay: true, days: [1, 2, 3, 4, 5], open: '08:00', close: '20:00' };

function validateForm(form) {
  if (!form.title.trim()) return 'Enter a listing name.';
  if (!form.address.trim()) return 'Enter the full address.';
  const latitude = Number(form.latitude);
  const longitude = Number(form.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return 'Enter a valid latitude between −90 and 90.';
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return 'Enter a valid longitude between −180 and 180.';
  const price = Number(form.price);
  if (!Number.isFinite(price) || price <= 0) return 'Hourly price must be a positive INR amount.';
  if (!form.allDay && form.days.length === 0) return 'Choose at least one day for weekly availability.';
  if (!form.allDay && form.close <= form.open) return 'Closing time must be after opening time.';
  const urls = form.evidenceUrls.split('\n').map((url) => url.trim()).filter(Boolean);
  if (urls.length > 10) return 'Add no more than 10 evidence URLs.';
  if (urls.some((url) => !/^https?:\/\//i.test(url))) return 'Evidence links must use an http or https URL.';
  return '';
}

function AvailabilityEditor({ listing, onSave, disabled }) {
  const [open, setOpen] = useState(false);
  const [allDay, setAllDay] = useState(!Array.isArray(listing.availability) || listing.availability.length === 0);
  const existing = Array.isArray(listing.availability) ? listing.availability : [];
  const [days, setDays] = useState(existing.map((window) => Number(window.day_of_week)));
  const [start, setStart] = useState(existing[0]?.open_time?.slice(0, 5) || '08:00');
  const [end, setEnd] = useState(existing[0]?.close_time?.slice(0, 5) || '20:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  function toggleDay(day) { setDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day]); }
  async function submit(event) {
    event.preventDefault();
    if (!allDay && (days.length === 0 || end <= start)) { setError('Choose days and a close time after the open time.'); return; }
    setSaving(true); setError('');
    try {
      const windows = allDay ? [] : DAYS.filter((item) => days.includes(item.day_of_week)).map((item) => ({ day_of_week: item.day_of_week, open_time: start, close_time: end }));
      await onSave(listing.id, windows);
      setOpen(false);
    } catch (saveError) { setError(saveError?.message || 'Could not update availability.'); }
    finally { setSaving(false); }
  }
  return <div className="availability-editor">
    <button className="text-link" type="button" onClick={() => setOpen((value) => !value)}><CalendarClock size={14} /> {open ? 'Close hours editor' : 'Edit weekly hours'}</button>
    {open && <form className="availability-editor__form" onSubmit={submit}>
      <label className="check-line"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} /> Open 24×7 (empty weekly window list)</label>
      {!allDay && <><div className="day-pills">{DAYS.map((day) => <button key={day.day_of_week} type="button" className={days.includes(day.day_of_week) ? 'is-selected' : ''} onClick={() => toggleDay(day.day_of_week)}>{day.label}</button>)}</div><div className="time-pair"><label>Open<input type="time" value={start} onChange={(event) => setStart(event.target.value)} required /></label><label>Close<input type="time" value={end} onChange={(event) => setEnd(event.target.value)} required /></label></div></>}
      {error && <p className="field-error">{error}</p>}<Button type="submit" variant="primary" disabled={saving || disabled}>{saving ? 'Saving…' : 'Save availability'}</Button>
    </form>}
  </div>;
}

export default function ProviderListingsPage() {
  const { getMyListings, createListing, updateListing, confirmListing, updateAvailability } = useMarketplace();
  const { isDemoMode, liveReady, isLiveMode } = useAuth();
  const [listings, setListings] = useState([]);
  const [form, setForm] = useState(defaultForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setListings(await getMyListings()); }
    catch (loadError) { setListings([]); setError(loadError?.message || 'Could not load your listings.'); }
    finally { setLoading(false); }
  }, [getMyListings]);
  useEffect(() => { refresh(); }, [refresh]);

  function updateField(key, value) { setForm((current) => ({ ...current, [key]: value })); setFormError(''); }
  function toggleFormDay(day) { setForm((current) => ({ ...current, days: current.days.includes(day) ? current.days.filter((item) => item !== day) : [...current.days, day] })); }

  async function submit(event) {
    event.preventDefault();
    const issue = validateForm(form);
    if (issue) { setFormError(issue); return; }
    setSaving(true); setFormError(''); setNotice('');
    const availability = form.allDay ? undefined : DAYS.filter((day) => form.days.includes(day.day_of_week)).map((day) => ({ day_of_week: day.day_of_week, open_time: form.open, close_time: form.close }));
    const payload = {
      title: form.title.trim(), address: form.address.trim(), latitude: Number(form.latitude), longitude: Number(form.longitude),
      price_per_hour: Number(form.price), description: form.description.trim(), rules: form.rules.trim(), vehicle_type: form.vehicle.trim(),
      evidence_urls: form.evidenceUrls.split('\n').map((url) => url.trim()).filter(Boolean),
      ...(availability ? { availability } : {}),
    };
    try {
      const result = await createListing(payload);
      setNotice(result.is_demo ? 'Demo listing saved in this browser as pending. Confirm availability to make it searchable here.' : 'Listing submitted to the backend; it is pending review and cannot be booked until approved.');
      setForm(defaultForm);
      setListings((current) => [result, ...current.filter((item) => String(item.id) !== String(result.id))]);
    } catch (saveError) { setFormError(saveError?.message || 'Could not create the listing.'); }
    finally { setSaving(false); }
  }

  async function handleToggle(listing) {
    setBusyId(listing.id); setNotice('');
    try {
      const result = await updateListing(listing.id, { is_active: listing.is_active === false });
      setListings((current) => current.map((item) => item.id === listing.id ? result : item));
      setNotice(result.is_demo ? 'Demo listing status changed locally.' : 'Listing status updated by the backend.');
    } catch (updateError) { setError(updateError?.message || 'Could not update this listing.'); }
    finally { setBusyId(null); }
  }

  async function handleConfirm(listing) {
    setBusyId(listing.id); setNotice('');
    try {
      const result = await confirmListing(listing.id);
      setListings((current) => current.map((item) => item.id === listing.id ? result : item));
      setNotice(result.is_demo
        ? result.status === 'approved'
          ? 'Demo availability confirmed; this listing is now searchable in the consumer section on this browser.'
          : 'Demo availability timestamp updated locally; this listing remains unavailable until its status is approved.'
        : 'The backend recorded your availability confirmation; backend review status remains unchanged.');
    } catch (confirmError) { setError(confirmError?.message || 'Could not confirm availability.'); }
    finally { setBusyId(null); }
  }

  async function handleAvailability(id, windows) {
    const result = await updateAvailability(id, windows);
    setListings((current) => current.map((item) => String(item.id) === String(id) ? result : item));
    setNotice(result.is_demo ? 'Demo weekly hours saved locally.' : 'Weekly availability saved by the backend.');
  }

  async function handleEdit(id, payload) {
    setBusyId(id); setNotice('');
    try {
      const result = await updateListing(id, payload);
      setListings((current) => current.map((item) => String(item.id) === String(id) ? result : item));
      setNotice(result.is_demo
        ? 'Demo listing details updated locally; no server request was made.'
        : result.status === 'pending'
          ? 'Listing details updated by the backend. Location changes require admin re-review.'
          : 'Listing details updated by the backend.');
    } catch (saveError) {
      throw saveError;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="provider-page page-wrap">
      <PageIntro eyebrow="MANAGE YOUR SPACE" title={<>My<br className="desktop-break" /> listings.</>} description={isDemoMode ? 'Create a sample space, then confirm availability to make it searchable in this browser.' : 'Create and maintain your spaces. New listings wait for backend review before they can be booked.'} action={<PrimaryLink to="/provider/reservations">Reservations <ArrowRight size={15} /></PrimaryLink>} />
      {isDemoMode && <InlineNotice>Local demo provider listings are fictional. Create/pause actions stay in this browser; availability is not published to a server.</InlineNotice>}
      {notice && <InlineNotice tone="success">{notice}</InlineNotice>}
      {error && <ErrorState title="Listing action unavailable" message={error} onRetry={refresh} />}
      <div className="provider-listings-layout">
        <section className="listing-management-list">
          <div className="section-heading"><div><span className="eyebrow">YOUR INVENTORY</span><h2>{loading ? 'Loading spaces…' : `${listings.length} ${listings.length === 1 ? 'space' : 'spaces'}`}</h2></div><Link className="text-link" to="/provider/dashboard">Dashboard <ArrowRight size={14} /></Link></div>
          {loading ? <LoadingState label="Loading your spaces…" /> : error && listings.length === 0 ? null : listings.length === 0 ? <EmptyState icon={Building2} title="No listings yet" description="Add your first space with an address, coordinates, hourly price, and optional weekly availability." /> : <div className="provider-listings">{listings.map((listing) => <article className="managed-listing" key={listing.id}>
            <div className="managed-listing__head"><span className={`managed-listing__icon managed-listing__icon--${listing.illustration || 'sage'}`}><ParkingPhoto item={listing} width={200} alt="" /></span><div className="managed-listing__identity"><h3>{listing.title}</h3><p><MapPin size={13} /> {listing.address}</p></div><SourceBadge isDemo={Boolean(listing.is_demo)} /></div>
            <div className="managed-listing__meta"><span><strong>{formatINR(listing.price_per_hour)}</strong> / hour</span><span className={`status-chip status-chip--${listing.status || 'unknown'}`}>{listing.status || 'status unavailable'}</span><span>{listing.is_active === false ? 'Paused' : 'Active toggle on'}</span></div>
            {listing.status === 'pending' && <InlineNotice tone="info">{listing.is_demo ? 'Pending confirmation — use “Confirm availability” to approve this local demo listing and show it in consumer search.' : 'Pending review — this listing is not bookable until approved by an admin.'}</InlineNotice>}
            {listing.review_note && <InlineNotice tone="error">Review note: {listing.review_note}</InlineNotice>}
            <div className="managed-listing__last-confirmed"><Clock3 size={14} /> {listing.last_confirmed_at ? `Last confirmed ${formatDateTime(listing.last_confirmed_at)}` : 'Availability has not been confirmed yet'}</div>
            <div className="managed-listing__actions"><Button variant="secondary" onClick={() => handleConfirm(listing)} disabled={busyId === listing.id || (isLiveMode && !liveReady)}><BadgeCheck size={15} /> {busyId === listing.id ? 'Saving…' : 'Confirm availability'}</Button><Button variant="outline" onClick={() => handleToggle(listing)} disabled={busyId === listing.id || (isLiveMode && !liveReady)}><Power size={14} /> {listing.is_active === false ? 'Reactivate' : 'Pause'}</Button></div>
            <AvailabilityEditor listing={listing} onSave={handleAvailability} disabled={isLiveMode && !liveReady} />
            <ListingEditForm listing={listing} onSave={handleEdit} disabled={isLiveMode && !liveReady} />
          </article>)}</div>}
        </section>

        <aside className="create-listing-panel surface-card">
          <div className="create-listing-panel__head"><span className="create-listing-panel__icon"><Plus size={19} /></span><div><span className="eyebrow">SHARE A SPOT</span><h2>Add a parking space</h2></div></div>
          <p className="muted-note">A clear listing helps drivers know what to expect. Coordinates are required by the current backend contract; enter the verified spot location. Demo listings are saved locally and appear in search after you confirm availability.</p>
          {formError && <InlineNotice tone="error">{formError}</InlineNotice>}
          <form className="listing-form" onSubmit={submit} noValidate>
            <label className="field"><span>Listing name</span><input value={form.title} onChange={(event) => updateField('title', event.target.value)} placeholder="e.g. Maple Street Driveway" required /></label>
            <label className="field"><span>Full address</span><input value={form.address} onChange={(event) => updateField('address', event.target.value)} placeholder="Street, area, city" required /></label>
            <div className="coordinate-fields"><label className="field"><span>Latitude</span><input type="number" min="-90" max="90" step="any" value={form.latitude} onChange={(event) => updateField('latitude', event.target.value)} placeholder="13.0067" required /></label><label className="field"><span>Longitude</span><input type="number" min="-180" max="180" step="any" value={form.longitude} onChange={(event) => updateField('longitude', event.target.value)} placeholder="80.2206" required /></label></div>
            <label className="field"><span>Price per hour (INR)</span><input type="number" min="1" step="1" value={form.price} onChange={(event) => updateField('price', event.target.value)} required /></label>
            <label className="field"><span>Vehicle types</span><input value={form.vehicle} onChange={(event) => updateField('vehicle', event.target.value)} placeholder="e.g. Hatchback, sedan" /></label>
            <label className="field"><span>Description</span><textarea rows="3" value={form.description} onChange={(event) => updateField('description', event.target.value)} placeholder="Describe access, cover, and nearby landmarks." /></label>
            <label className="field"><span>Parking rules</span><textarea rows="2" value={form.rules} onChange={(event) => updateField('rules', event.target.value)} placeholder="Share any arrival or vehicle notes." /></label>
            <label className="field"><span>Evidence URLs <small>Optional · up to 10 http(s) links, one per line</small></span><textarea rows="2" value={form.evidenceUrls} onChange={(event) => updateField('evidenceUrls', event.target.value)} placeholder="https://example.com/photo" /></label>
            <div className="availability-form"><div className="availability-form__title"><CalendarClock size={16} /><strong>Weekly availability</strong></div><label className="check-line"><input type="checkbox" checked={form.allDay} onChange={(event) => updateField('allDay', event.target.checked)} /> Open 24×7</label>
              {!form.allDay && <><div className="day-pills">{DAYS.map((day) => <button key={day.day_of_week} type="button" className={form.days.includes(day.day_of_week) ? 'is-selected' : ''} onClick={() => toggleFormDay(day.day_of_week)}>{day.label}</button>)}</div><div className="time-pair"><label>Open<input type="time" value={form.open} onChange={(event) => updateField('open', event.target.value)} required /></label><label>Close<input type="time" value={form.close} onChange={(event) => updateField('close', event.target.value)} required /></label></div><p className="field-help">Opening hours are interpreted in Asia/Kolkata by the backend.</p></>}
            </div>
            <Button type="submit" variant="primary" className="listing-form__submit" disabled={saving || (isLiveMode && !liveReady)}>{saving ? 'Saving listing…' : 'Submit listing'} <ArrowRight size={15} /></Button>
            {isLiveMode && !liveReady && <p className="field-error">Live submission is disabled until the backend health check succeeds.</p>}
            <p className="field-help">The client does not set owner ID, review status, or demo status; the backend owns those fields.</p>
          </form>
        </aside>
      </div>
      <div className="provider-page__footer"><Link className="text-link" to="/provider/reservations">View reservations separately <ArrowRight size={14} /></Link></div>
    </section>
  );
}
