import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, ImageUp, X } from 'lucide-react';
import { ACCEPT_ATTR, MAX_PHOTOS_PER_LISTING, validatePhotoFile, validatePhotoImage } from '../../lib/photoUpload.js';
import CameraCapture from './CameraCapture.jsx';

// "Parking photos" card. Used in two ways:
//  - create form: `files` are held here and uploaded after the listing exists
//  - existing listing: `onPick` uploads straight away (pass `busy` while that happens)
export default function PhotoPicker({ files = [], onPick, onRemove, busy = false, disabled = false, error = '', limitLeft = MAX_PHOTOS_PER_LISTING, children }) {
  const chooseRef = useRef(null);
  const cameraRef = useRef(null);
  const urls = useRef(new Map());
  const [cameraOpen, setCameraOpen] = useState(false);
  const [localError, setLocalError] = useState('');

  // Previews are object URLs; release them when files go away.
  useEffect(() => {
    const live = new Set(files);
    for (const [file, url] of urls.current) if (!live.has(file)) { URL.revokeObjectURL(url); urls.current.delete(file); }
  }, [files]);
  useEffect(() => () => { for (const url of urls.current.values()) URL.revokeObjectURL(url); urls.current.clear(); }, []);
  const previewOf = (file) => {
    if (!urls.current.has(file)) urls.current.set(file, URL.createObjectURL(file));
    return urls.current.get(file);
  };

  // Check type, size and dimensions before anything is uploaded; only good photos are passed on.
  async function accept(list) {
    const good = [];
    const problems = [];
    for (const file of list) {
      const problem = await validatePhotoImage(file);
      if (problem) problems.push(problem); else good.push(file);
    }
    setLocalError(problems.length ? `${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more not added)` : ''}` : '');
    if (good.length) onPick(good);
  }

  function handle(event) {
    const picked = Array.from(event.target.files || []);
    event.target.value = ''; // allow choosing the same photo again
    if (picked.length) accept(picked);
  }

  function handleCaptured(file) {
    setCameraOpen(false);
    accept([file]);
  }

  function openCameraApp() {
    setCameraOpen(false);
    cameraRef.current?.click(); // phones open their camera app; computers show a file picker
  }

  const full = limitLeft <= 0;
  return (
    <div className="photo-picker" aria-busy={busy}>
      <div className="photo-picker__head">
        <span className="photo-picker__icon"><ImageUp size={20} /></span>
        <div><h3>Parking photos</h3><p>Add clear photos of the actual parking space. JPG or PNG, up to 5 MB each.</p></div>
      </div>
      <div className="photo-picker__actions">
        <button type="button" className="photo-picker__btn" onClick={() => chooseRef.current?.click()} disabled={disabled || busy || full}><ImagePlus size={17} /> Choose photos</button>
        <button type="button" className="photo-picker__btn" onClick={() => { setLocalError(''); setCameraOpen(true); }} disabled={disabled || busy || full}><Camera size={17} /> Take photo</button>
        <span className="photo-picker__hint">JPG or PNG · max 5 MB · at least 200×200 px · up to {MAX_PHOTOS_PER_LISTING} photos</span>
      </div>
      <input ref={chooseRef} className="sr-only" type="file" accept={ACCEPT_ATTR} multiple onChange={handle} tabIndex={-1} aria-label="Choose parking photos" />
      <input ref={cameraRef} className="sr-only" type="file" accept={ACCEPT_ATTR} capture="environment" onChange={handle} tabIndex={-1} aria-label="Take a parking photo" />
      {(error || localError) && <p className="field-error" role="alert">{error || localError}</p>}
      {cameraOpen && <CameraCapture onCapture={handleCaptured} onClose={() => setCameraOpen(false)} onFallback={openCameraApp} />}
      {files.length > 0 && <ul className="photo-picker__grid" aria-label="Photos to upload">
        {files.map((file, index) => {
          const problem = validatePhotoFile(file);
          return <li key={`${file.name}-${file.size}-${index}`} className={problem ? 'has-problem' : ''}>
            <img src={previewOf(file)} alt="" />
            {onRemove && <button type="button" onClick={() => onRemove(index)} aria-label={`Remove ${file.name}`} disabled={busy}><X size={14} /></button>}
            {problem && <small>{problem}</small>}
          </li>;
        })}
      </ul>}
      {children}
      <p className="photo-picker__note"><strong>Review:</strong> new photos are checked by our team before drivers can see them. Uploading a photo does not verify the listing.</p>
    </div>
  );
}
