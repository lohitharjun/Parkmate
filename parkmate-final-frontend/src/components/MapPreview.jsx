import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigation } from 'lucide-react';
import L, { DEFAULT_CENTER, createBaseMap, validPoint, watchMapSize } from '../lib/leafletSetup.js';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export default function MapPreview({ listings = [], selectedListingId = null, onSelectListing = () => {}, destination = '', destinationCoordinates = null }) {
  const mapNode = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const markersRef = useRef(new Map());
  const selectRef = useRef(onSelectListing);
  const [mapError, setMapError] = useState('');

  useEffect(() => { selectRef.current = onSelectListing; }, [onSelectListing]);

  const validListings = useMemo(
    () => listings.filter((item) => validPoint(item.latitude, item.longitude)),
    [listings],
  );
  // The parent re-renders on every card hover and passes new array/object identities each time.
  // Rebuilding markers and re-fitting the view on those renders made the map jump back and lose the
  // user's pan/zoom. These string keys only change when the results or the destination really change.
  const listingsKey = validListings.map((item) => `${item.id}:${item.latitude}:${item.longitude}:${item.title}:${item.price_per_hour}`).join('|');
  const destinationPoint = destinationCoordinates ? validPoint(destinationCoordinates.latitude, destinationCoordinates.longitude) : null;
  const destinationKey = destinationPoint ? destinationPoint.join(',') : '';

  // Create the map once.
  useEffect(() => {
    if (!mapNode.current) return undefined;
    let stopWatching = () => {};
    try {
      const map = createBaseMap(mapNode.current, { scrollWheelZoom: false }).setView(DEFAULT_CENTER, 12);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      stopWatching = watchMapSize(mapNode.current, map);
      setMapError('');
    } catch {
      setMapError('The map could not start. Reload the page and try again.');
    }
    return () => {
      stopWatching();
      markersRef.current.clear();
      layerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Rebuild markers and the viewport only when results or destination actually change.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current.clear();
    validListings.forEach((listing) => {
      const marker = L.marker([Number(listing.latitude), Number(listing.longitude)]);
      marker.bindPopup(`<strong>${escapeHtml(listing.title || 'Parking space')}</strong><br>₹${Number(listing.price_per_hour || 0)}/hour`, { autoPan: false });
      marker.on('click', () => selectRef.current?.(listing.id));
      marker.addTo(layer);
      markersRef.current.set(String(listing.id), marker);
    });
    const points = validListings.map((item) => [Number(item.latitude), Number(item.longitude)]);
    if (destinationPoint) map.setView(destinationPoint, 14);
    else if (points.length === 1) map.setView(points[0], 14);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 15 });
    else map.setView(DEFAULT_CENTER, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingsKey, destinationKey]);

  // Hovering/selecting a card highlights its marker; only pan if the pin is off-screen.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markersRef.current.get(String(selectedListingId));
    if (!map || !marker) return;
    marker.openPopup();
    if (!map.getBounds().contains(marker.getLatLng())) map.panTo(marker.getLatLng(), { animate: true });
  }, [selectedListingId, listingsKey]);

  return <section className="map-preview" aria-label="Live parking map">
    <div className="map-preview__top"><div><span className="eyebrow">LIVE MAP</span><strong>{destination ? `Parking near ${destination}` : 'Parking spaces'}</strong></div><span className="map-preview__icon"><Navigation size={15} /></span></div>
    <div className="map-preview__canvas map-preview__canvas--leaflet" ref={mapNode} />
    {mapError && <p className="map-preview__foot" role="alert">{mapError}</p>}
    {!mapError && validListings.length === 0 && <p className="map-preview__foot">No listings with valid coordinates are available for these results.</p>}
    <p className="map-preview__foot">Markers use coordinates returned by the listing API. Map tiles &copy; OpenStreetMap contributors. Location pins do not imply listing or photo verification.</p>
  </section>;
}
