import { useState } from 'react';
import { Clock3, ShieldAlert, ShieldCheck, Star, Trash2 } from 'lucide-react';
import PhotoPicker from './PhotoPicker.jsx';
import { friendlyError } from '../../lib/errors.js';
import { MAX_PHOTOS_PER_LISTING, photoReviewStatus, validatePhotoFile } from '../../lib/photoUpload.js';

const STATUS = {
  pending: { label: 'Pending', Icon: Clock3 },
  approved: { label: 'Approved', Icon: ShieldCheck },
  rejected: { label: 'Rejected', Icon: ShieldAlert },
};

// Photos of one existing listing: upload, see review status (and why a photo was rejected),
// choose the main photo, remove.
export default function ListingPhotos({ listing, onUpload, onDelete, onSetPrimary, disabled }) {
  const photos = Array.isArray(listing.photos) ? listing.photos : [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function pick(files) {
    setError(''); setMessage('');
    const room = MAX_PHOTOS_PER_LISTING - photos.length;
    const chosen = files.slice(0, Math.max(room, 0));
    setBusy(true);
    let done = 0;
    let failed = false;
    for (const file of chosen) {
      const problem = validatePhotoFile(file);
      if (problem) { setError(problem); failed = true; break; }
      try { await onUpload(listing.id, file); done += 1; }
      catch (uploadError) { setError(friendlyError(uploadError)); failed = true; break; } // stop at the first failure so the reason isn’t buried
    }
    if (files.length > chosen.length && !failed) setError('This space already has the maximum number of photos. Remove one to add another.');
    if (done) setMessage(done === 1 ? 'Photo uploaded. It will show to drivers once our team approves it.' : `${done} photos uploaded. They will show to drivers once our team approves them.`);
    setBusy(false);
  }

  async function remove(photo) {
    setError(''); setMessage(''); setBusy(true);
    try { await onDelete(listing.id, photo.id); }
    catch (deleteError) { setError(friendlyError(deleteError)); }
    finally { setBusy(false); }
  }

  async function makeMain(photo) {
    setError(''); setMessage(''); setBusy(true);
    try { await onSetPrimary(listing.id, photo.id); setMessage('Main photo updated.'); }
    catch (primaryError) { setError(friendlyError(primaryError)); }
    finally { setBusy(false); }
  }

  return (
    <PhotoPicker onPick={pick} busy={busy} disabled={disabled} error={error} limitLeft={MAX_PHOTOS_PER_LISTING - photos.length}>
      {message && <p className="photo-picker__ok" role="status">{message}</p>}
      {busy && <p className="photo-picker__busy" role="status">Working on your photo…</p>}
      {photos.length > 0 && <ul className="photo-saved-list" aria-label="Photos of this space">
        {photos.map((photo) => {
          const review = photoReviewStatus(photo);
          const status = STATUS[review];
          return <li key={photo.id} className="photo-saved">
            <div className="photo-saved__frame">
              <img src={photo.url} alt="Your parking space" loading="lazy" />
              <span className={`photo-chip photo-chip--${review}`}><status.Icon size={12} /> {status.label}</span>
              <button type="button" className="photo-saved__delete" onClick={() => remove(photo)} aria-label="Remove this photo" disabled={busy || disabled}><Trash2 size={14} /></button>
            </div>
            <div className="photo-saved__meta">
              {photo.is_primary
                ? <span className="photo-saved__main"><Star size={12} /> Main photo</span>
                : review !== 'rejected' && onSetPrimary && <button type="button" className="photo-saved__set" onClick={() => makeMain(photo)} disabled={busy || disabled}>Set as main</button>}
              {review === 'rejected' && <p className="photo-saved__note">{photo.review_note ? `Why: ${photo.review_note}` : 'This photo was not approved.'}</p>}
            </div>
          </li>;
        })}
      </ul>}
    </PhotoPicker>
  );
}
