import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, X } from 'lucide-react';

// In-page camera for computers (browsers ignore the `capture` hint on desktop and just open the file picker).
// Phones use their own camera app instead; see PhotoPicker.
export function cameraProblemMessage(error) {
  const name = error?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access is blocked. Allow the camera for this site in your browser settings, or choose a photo from your files instead.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'We couldn’t find a camera on this device. Choose a photo from your files instead.';
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again, or choose a photo from your files.';
  return 'We couldn’t start the camera. Choose a photo from your files instead.';
}

export default function CameraDialog({ onCapture, onClose, onProblem }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play().catch(() => {});
        setReady(true);
      } catch (error) {
        if (!cancelled) onProblem(cameraProblemMessage(error));
      }
    })();
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      document.removeEventListener('keydown', onKey);
      streamRef.current?.getTracks().forEach((track) => track.stop()); // always release the camera
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function snap() {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) { onProblem('We couldn’t capture that photo. Please try again.'); return; }
      onCapture(new File([blob], `parking-photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  }

  return createPortal(
    <div className="tour-overlay" role="presentation" onClick={onClose}>
      <div className="tour-card camera-dialog" role="dialog" aria-modal="true" aria-label="Take a photo of the parking space" onClick={(event) => event.stopPropagation()}>
        <button className="tour-card__close" type="button" onClick={onClose} aria-label="Close camera"><X size={16} /></button>
        <h2>Take a photo</h2>
        <video ref={videoRef} className="camera-dialog__video" playsInline muted autoPlay />
        {!ready && <p className="camera-dialog__wait" role="status">Starting camera… allow access if your browser asks.</p>}
        <div className="tour-card__actions">
          <button className="button button--secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="button button--primary" type="button" onClick={snap} disabled={!ready}><Camera size={16} /> Capture</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
