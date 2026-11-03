import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, X } from 'lucide-react';

// Live camera view for "Take photo". A plain <input capture> only opens the camera on phones;
// on a computer it just shows the file picker, so this opens the camera itself.
export default function CameraCapture({ onCapture, onClose, onFallback }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const captureRef = useRef(null);
  const [state, setState] = useState('starting'); // starting | ready | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('error');
        setMessage('This browser can’t open the camera here. The camera only works on a secure (https) page or localhost.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) { video.srcObject = stream; await video.play().catch(() => {}); }
        setState('ready');
      } catch (problem) {
        if (cancelled) return;
        setState('error');
        setMessage(problem?.name === 'NotAllowedError' || problem?.name === 'SecurityError'
          ? 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.'
          : problem?.name === 'NotFoundError' || problem?.name === 'OverconstrainedError'
            ? 'No camera was found on this device.'
            : 'The camera couldn’t be started. Close other apps that may be using it and try again.');
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => { if (state === 'ready') captureRef.current?.focus(); }, [state]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      onCapture(new File([blob], `parking-photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  }

  return createPortal(
    <div className="camera-modal" role="dialog" aria-modal="true" aria-label="Take a parking photo" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="camera-modal__panel">
        <div className="camera-modal__bar">
          <strong>Take a photo of the parking space</strong>
          <button type="button" className="camera-modal__close" onClick={onClose} aria-label="Close camera"><X size={18} /></button>
        </div>
        <div className="camera-modal__view">
          <video ref={videoRef} playsInline muted autoPlay />
          {state === 'starting' && <p className="camera-modal__status" role="status">Starting camera… allow access if your browser asks.</p>}
          {state === 'error' && <p className="camera-modal__status camera-modal__status--error" role="alert">{message}</p>}
        </div>
        <div className="camera-modal__actions">
          <button type="button" className="photo-picker__btn" onClick={onClose}>Cancel</button>
          {state === 'error' && <button type="button" className="photo-picker__btn" onClick={onFallback}>Use camera app instead</button>}
          <button ref={captureRef} type="button" className="camera-modal__shutter" onClick={capture} disabled={state !== 'ready'}><Camera size={18} /> Capture</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
