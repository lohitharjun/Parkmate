import { useEffect, useState } from 'react';
import { PencilLine, Save, X } from 'lucide-react';
import { Button } from '../../components/Buttons.jsx';

function initialValues(listing) {
  return {
    title: listing.title || '',
    address: listing.address || '',
    latitude: listing.latitude ?? '',
    longitude: listing.longitude ?? '',
    price: listing.price_per_hour ?? '',
    description: listing.description || '',
    rules: listing.rules || '',
    vehicle: listing.vehicle_type || '',
    evidenceUrls: Array.isArray(listing.evidence_urls) ? listing.evidence_urls.join('\n') : '',
  };
}

export default function ListingEditForm({ listing, onSave, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(() => initialValues(listing));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValues(initialValues(listing));
    setError('');
  }, [listing]);

  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    const latitude = Number(values.latitude);
    const longitude = Number(values.longitude);
    const price = Number(values.price);
    const urls = values.evidenceUrls.split('\n').map((value) => value.trim()).filter(Boolean);
    if (!values.title.trim()) return setError('Enter a listing name.');
    if (!values.address.trim()) return setError('Enter the full address.');
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return setError('Latitude must be between −90 and 90.');
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return setError('Longitude must be between −180 and 180.');
    if (!Number.isFinite(price) || price <= 0) return setError('Hourly price must be a positive INR amount.');
    if (urls.length > 10) return setError('Add no more than 10 evidence URLs.');
    if (urls.some((url) => !/^https?:\/\//i.test(url))) return setError('Evidence links must use an http or https URL.');

    setSaving(true);
    setError('');
    try {
      await onSave(listing.id, {
        title: values.title.trim(),
        address: values.address.trim(),
        latitude,
        longitude,
        price_per_hour: price,
        description: values.description.trim(),
        rules: values.rules.trim(),
        vehicle_type: values.vehicle.trim(),
        evidence_urls: urls,
      });
      setOpen(false);
    } catch (saveError) {
      setError(saveError?.message || 'Could not update this listing.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="listing-edit">
      <button className="text-link" type="button" onClick={() => { setOpen((current) => !current); setError(''); }} aria-expanded={open}>
        {open ? <X size={14} /> : <PencilLine size={14} />}{open ? 'Close details editor' : 'Edit listing details'}
      </button>
      {open && <form className="listing-edit__form" onSubmit={submit} noValidate>
        <div className="listing-edit__notice">Only contract-editable fields are shown. Changing an approved listing’s address or coordinates sends it back to pending review.</div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <label className="field"><span>Listing name</span><input value={values.title} onChange={(event) => update('title', event.target.value)} required /></label>
        <label className="field"><span>Full address</span><input value={values.address} onChange={(event) => update('address', event.target.value)} required /></label>
        <div className="coordinate-fields"><label className="field"><span>Latitude</span><input type="number" min="-90" max="90" step="any" value={values.latitude} onChange={(event) => update('latitude', event.target.value)} required /></label><label className="field"><span>Longitude</span><input type="number" min="-180" max="180" step="any" value={values.longitude} onChange={(event) => update('longitude', event.target.value)} required /></label></div>
        <label className="field"><span>Price per hour (INR)</span><input type="number" min="1" step="any" value={values.price} onChange={(event) => update('price', event.target.value)} required /></label>
        <label className="field"><span>Vehicle types</span><input value={values.vehicle} onChange={(event) => update('vehicle', event.target.value)} /></label>
        <label className="field"><span>Description</span><textarea rows="2" value={values.description} onChange={(event) => update('description', event.target.value)} /></label>
        <label className="field"><span>Parking rules</span><textarea rows="2" value={values.rules} onChange={(event) => update('rules', event.target.value)} /></label>
        <label className="field"><span>Evidence URLs <small>Up to 10 http(s) links, one per line</small></span><textarea rows="2" value={values.evidenceUrls} onChange={(event) => update('evidenceUrls', event.target.value)} /></label>
        <Button type="submit" variant="primary" disabled={saving || disabled}>{saving ? 'Saving…' : 'Save listing changes'} <Save size={14} /></Button>
      </form>}
    </div>
  );
}
