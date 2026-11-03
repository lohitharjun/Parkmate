// One place that configures Leaflet for the whole app.
// Leaflet is bundled from npm (no CDN <script> tag), so the map no longer depends on unpkg being reachable
// and `window.L` timing. Importing the marker images through Vite fixes the broken/missing default pin icon.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow });

export const DEFAULT_CENTER = [13.0827, 80.2707]; // Chennai
// OpenStreetMap asks apps to use the single tile host (the old a/b/c subdomains are no longer recommended).
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_OPTIONS = {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
};

export function createBaseMap(node, options = {}) {
  const map = L.map(node, { zoomControl: true, ...options });
  L.tileLayer(TILE_URL, TILE_OPTIONS).addTo(map);
  return map;
}

// A map created while its container is hidden, still animating in, or resized shows grey tiles.
// Re-measure whenever the container changes size.
export function watchMapSize(node, map) {
  const refresh = () => { try { map.invalidateSize(); } catch { /* map already removed */ } };
  const timer = window.setTimeout(refresh, 150);
  let observer = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(refresh);
    observer.observe(node);
  }
  return () => { window.clearTimeout(timer); observer?.disconnect(); };
}

export function validPoint(latitude, longitude) {
  if (latitude === '' || longitude === '' || latitude == null || longitude == null) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

export default L;
