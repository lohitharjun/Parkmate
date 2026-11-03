import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { CarFront, Filter, MapPin, Navigation, RotateCcw, Search, SlidersHorizontal, List, Map as MapIcon } from 'lucide-react';
import ListingCard from '../../components/ListingCard.jsx';
import MapPreview from '../../components/MapPreview.jsx';
import { EmptyState, ErrorState, InlineNotice, LoadingState, PageIntro } from '../../components/Feedback.jsx';
import { Button, PrimaryLink } from '../../components/Buttons.jsx';
import { useMarketplace } from '../../app/MarketplaceContext.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { validateBookingWindow } from '../../lib/validation.js';

function distanceKm(lat1, lng1, lat2, lng2) {
  const rad = (value) => (value * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hasPoint(latitude, longitude) {
  return latitude != null && longitude != null && latitude !== '' && longitude !== ''
    && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
}

const emptyFilters = { query: '', maxPrice: '', vehicleType: '', sort: 'recommended', start: '', end: '' };

export default function SearchPage() {
  const { search } = useMarketplace();
  const { isDemoMode, isLiveMode, liveReady, backendStatus } = useAuth();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [filters, setFilters] = useState(() => ({ ...emptyFilters, sort: isLiveMode ? 'price' : emptyFilters.sort, query: searchParams.get('location') || '' }));
  const [listings, setListings] = useState(() => []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [timeError, setTimeError] = useState('');
  const [destinationMessage, setDestinationMessage] = useState('');
  const [destinationBusy, setDestinationBusy] = useState(false);
  const [resultsView, setResultsView] = useState('split');
  const [selectedListingId, setSelectedListingId] = useState(null);
  const [rescueCoordinates, setRescueCoordinates] = useState({ latitude: '', longitude: '' });
  const [rescueWindow, setRescueWindow] = useState(() => ({ start: filters.start, end: filters.end }));
  const [rescueRecommendations, setRescueRecommendations] = useState([]);
  const [rescueSearchCompleted, setRescueSearchCompleted] = useState(false);
  const [rescueLoading, setRescueLoading] = useState(false);
  const [rescueError, setRescueError] = useState('');
  const rescueRequestId = useRef(0);
  const filterToggleRef = useRef(null);
  const filterPanelRef = useRef(null);
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
  const filtersVisible = !isNarrow || filtersOpen;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const updateViewport = () => setIsNarrow(media.matches);
    updateViewport();
    if (media.addEventListener) media.addEventListener('change', updateViewport);
    else media.addListener(updateViewport);
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', updateViewport);
      else media.removeListener(updateViewport);
    };
  }, []);

  useEffect(() => {
    if (!filtersOpen || !isNarrow) return undefined;
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setFiltersOpen(false);
      filterToggleRef.current?.focus();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [filtersOpen, isNarrow]);

  const windowCheck = useMemo(() => {
    if (!filters.start && !filters.end) return null;
    if (!filters.start || !filters.end) return { ok: false, error: 'Add both arrival and departure to check this time window.' };
    return validateBookingWindow({ start: filters.start, end: filters.end });
  }, [filters.start, filters.end]);
  const rescueWindowCheck = useMemo(
    () => validateBookingWindow(rescueWindow),
    [rescueWindow],
  );

  useEffect(() => {
    const controller = new AbortController();
    rescueRequestId.current += 1;
    setRescueLoading(false);
    if (isLiveMode && backendStatus === 'checking') {
      setLoading(true);
      setError('');
      return () => controller.abort();
    }
    if (isLiveMode && !liveReady) {
      setLoading(false);
      setListings([]);
      setError(backendStatus === 'misconfigured'
        ? 'Live mode is missing required settings. Configure Supabase and the API origin, or explicitly set VITE_APP_MODE=demo.'
        : 'The configured ParkMate backend is not healthy. Live data is unavailable; no sample fallback is displayed.');
      return () => controller.abort();
    }

    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      setRescueRecommendations([]);
      setRescueSearchCompleted(false);
      setRescueError('');
      setTimeError(windowCheck && !windowCheck.ok ? windowCheck.error : '');
      try {
        const located = hasPoint(filters.latitude, filters.longitude);
        const found = await search({
          ...filters,
          // Once an area is located on the map, results are chosen by distance, not by matching the typed text.
          query: located ? '' : filters.query,
          startISO: windowCheck?.ok ? windowCheck.startISO : undefined,
          endISO: windowCheck?.ok ? windowCheck.endISO : undefined,
        }, { signal: controller.signal });
        let next = found;
        if (located) {
          const lat = Number(filters.latitude);
          const lng = Number(filters.longitude);
          next = found.map((item) => (hasPoint(item.latitude, item.longitude)
            ? { ...item, distance_km: distanceKm(lat, lng, Number(item.latitude), Number(item.longitude)) }
            : item));
          if (filters.sort === 'distance') next = [...next].sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
        }
        if (!controller.signal.aborted) setListings(next);
      } catch (searchError) {
        if (!controller.signal.aborted) {
          setListings([]);
          setError(searchError?.message || 'Could not load parking spaces.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filters, search, isDemoMode, isLiveMode, liveReady, backendStatus, windowCheck, location.key]);

  function updateRescueWindow(field, value) {
    rescueRequestId.current += 1;
    setRescueLoading(false);
    setRescueWindow((current) => ({ ...current, [field]: value }));
    setRescueRecommendations([]);
    setRescueSearchCompleted(false);
    setRescueError('');
  }

  function updateRescueCoordinates(field, value) {
    rescueRequestId.current += 1;
    setRescueLoading(false);
    setRescueCoordinates((current) => ({ ...current, [field]: value }));
    setRescueRecommendations([]);
    setRescueSearchCompleted(false);
    setRescueError('');
  }

  function getCurrentCoordinates() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Location access is not available in this browser. Enter destination coordinates instead.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
        (geoError) => reject(new Error(
          geoError.code === geoError.PERMISSION_DENIED
            ? 'Location permission was denied. Enter destination coordinates to continue.'
            : 'Could not get your location. Enter destination coordinates to continue.',
        )),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
      );
    });
  }

  async function requestEmptySearchRecommendations(event) {
    event.preventDefault();
    setRescueRecommendations([]);
    setRescueError('');
    if (isDemoMode) {
      setRescueError('Recommendations require the live backend. Demo inventory is not substituted for backend results.');
      return;
    }
    if (!liveReady) {
      setRescueError('The live backend is not ready. No sample alternatives will be substituted.');
      return;
    }
    if (!rescueWindowCheck.ok) {
      setRescueError(rescueWindowCheck.error);
      return;
    }

    const requestId = ++rescueRequestId.current;
    setRescueLoading(true);
    try {
      let destination;
      const hasLatitude = rescueCoordinates.latitude.trim() !== '';
      const hasLongitude = rescueCoordinates.longitude.trim() !== '';
      if (hasLatitude !== hasLongitude) {
        throw new Error('Enter both destination coordinates, or leave both blank to use your current location.');
      }
      if (hasLatitude && hasLongitude) {
        const latitude = Number(rescueCoordinates.latitude);
        const longitude = Number(rescueCoordinates.longitude);
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
            || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
          throw new Error('Enter a valid latitude and longitude, or leave both blank to use your current location.');
        }
        destination = { latitude, longitude };
      } else {
        destination = await getCurrentCoordinates();
        if (requestId !== rescueRequestId.current) return;
        setRescueCoordinates({
          latitude: String(destination.latitude),
          longitude: String(destination.longitude),
        });
      }

      const next = await search({
        query: filters.query,
        vehicleType: filters.vehicleType,
        maxPrice: filters.maxPrice,
        sort: 'recommended',
        latitude: destination.latitude,
        longitude: destination.longitude,
        startISO: rescueWindowCheck.startISO,
        endISO: rescueWindowCheck.endISO,
      });
      if (requestId !== rescueRequestId.current) return;
      if (!Array.isArray(next)) {
        throw new Error('The backend returned an invalid recommendation response.');
      }
      setRescueRecommendations(next.map((listing) => ({
        listing,
        reasons: listing.recommendation_reasons || ['Available for the requested time window'],
      })));
      setRescueSearchCompleted(true);
    } catch (recommendationError) {
      if (requestId === rescueRequestId.current) {
        setRescueError(recommendationError?.message || 'Could not load backend recommendations.');
      }
    } finally {
      if (requestId === rescueRequestId.current) setRescueLoading(false);
    }
  }

  function update(key, value) {
    if (key === 'query') {
      // Editing the text drops the previously located point so the text search applies again.
      setDestinationMessage('');
      setFilters((current) => {
        const wasLocated = hasPoint(current.latitude, current.longitude);
        const { latitude, longitude, ...rest } = current;
        return { ...rest, query: value, sort: wasLocated && current.sort === 'distance' && isLiveMode ? 'price' : current.sort };
      });
      return;
    }
    setFilters((current) => ({ ...current, [key]: value }));
    if (key === 'start' || key === 'end') {
      updateRescueWindow(key, value);
    }
  }

  function clearFilters() {
    rescueRequestId.current += 1;
    setRescueLoading(false);
    setFilters({ ...emptyFilters, sort: isLiveMode ? 'price' : emptyFilters.sort, query: '' });
    setDestinationMessage('');
    setSelectedListingId(null);
    setRescueWindow({ start: '', end: '' });
    setRescueCoordinates({ latitude: '', longitude: '' });
    setRescueRecommendations([]);
    setRescueSearchCompleted(false);
    setRescueError('');
    setError('');
    setTimeError('');
  }

  async function geocodeDestination() {
    const address = filters.query.trim();
    if (!address) { setDestinationMessage('Enter an area or landmark first.'); return; }
    setDestinationBusy(true); setDestinationMessage('');
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Address lookup is temporarily unavailable.');
      const results = await response.json();
      if (!Array.isArray(results) || !results.length) throw new Error('No matching address found. Add the city or a nearby landmark.');
      const place = results[0];
      setFilters((current) => ({ ...current, latitude: Number(place.lat), longitude: Number(place.lon), sort: 'distance' }));
      setDestinationMessage(`Map location selected${place.display_name ? `: ${place.display_name}` : ''}.`);
    } catch (lookupError) {
      setDestinationMessage(lookupError?.message || 'Could not find this address.');
    } finally {
      setDestinationBusy(false);
    }
  }

  function useMyLocation() {
    setDestinationMessage('');
    if (!navigator.geolocation) { setDestinationMessage('Device location is unavailable. Search by address instead.'); return; }
    setDestinationBusy(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setFilters((current) => ({ ...current, latitude: coords.latitude, longitude: coords.longitude, sort: 'distance' }));
      setDestinationMessage(`Using your location (${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}).`);
      setDestinationBusy(false);
    }, (geoError) => {
      setDestinationMessage(geoError.code === 1 ? 'Location permission denied. Use “Find area on map” instead.' : 'Could not get device location. Search by address instead.');
      setDestinationBusy(false);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  const hasDestination = hasPoint(filters.latitude, filters.longitude);

  function openFilters() {
    setFiltersOpen(true);
    window.requestAnimationFrame(() => filterPanelRef.current?.querySelector('input, select, textarea')?.focus());
  }

  const resultCaption = loading ? 'Searching…' : `${listings.length} ${listings.length === 1 ? 'space' : 'spaces'} found`;

  return (
    <section className="search-page page-wrap">
      <PageIntro eyebrow="A GOOD SPACE, WITHOUT THE GUESSWORK" title={<>Find your<br className="desktop-break" /> parking spot.</>} description="Search local spaces, compare hourly rates, and check the details before you book." action={<span className="search-page__count">{resultCaption}</span>} />

      <div className="search-workspace">
        <aside ref={filterPanelRef} id="parking-filters-panel" aria-label="Parking filters" aria-hidden={!filtersVisible} inert={!filtersVisible ? '' : undefined} className={`filter-panel ${filtersOpen ? 'filter-panel--open' : ''}`}>
          <div className="filter-panel__heading"><span><SlidersHorizontal size={16} /> Refine your search</span><button type="button" className="filter-panel__close" onClick={() => { setFiltersOpen(false); filterToggleRef.current?.focus(); }} aria-label="Close filters">×</button></div>
          <label className="field"><span>Area or landmark</span><div className="input-with-icon"><MapPin size={16} /><input value={filters.query} onChange={(event) => update('query', event.target.value)} placeholder="Try ‘Adyar, Chennai’ or ‘Guindy’" autoComplete="off" /></div></label>
          <div className="location-picker__actions search-location-actions"><button type="button" className="text-link" onClick={geocodeDestination} disabled={destinationBusy}><MapPin size={14} /> {destinationBusy ? 'Finding…' : 'Find area on map'}</button><button type="button" className="text-link" onClick={useMyLocation} disabled={destinationBusy}><Navigation size={14} /> Use my location</button></div>
          {destinationMessage && <p className="location-picker__message" role="status">{destinationMessage}</p>}
          {hasDestination && <p className="location-picker__selected"><MapPin size={14} /> Search centered at {Number(filters.latitude).toFixed(4)}, {Number(filters.longitude).toFixed(4)}</p>}
          <label className="field"><span>Maximum price / hour</span><select value={filters.maxPrice} onChange={(event) => update('maxPrice', event.target.value)}><option value="">Any price</option><option value="40">Up to ₹40</option><option value="60">Up to ₹60</option><option value="80">Up to ₹80</option><option value="120">Up to ₹120</option></select></label>
          <label className="field"><span>Vehicle type</span><select value={filters.vehicleType} onChange={(event) => update('vehicleType', event.target.value)}><option value="">Any vehicle</option><option value="two-wheeler">Two-wheeler</option><option value="compact">Compact</option><option value="hatchback">Hatchback</option><option value="sedan">Sedan</option><option value="suv">SUV</option><option value="van">Van / larger vehicle</option></select></label>
          <div className="field"><span>Arrival time <small>Optional — choose both to check a window</small></span><input type="datetime-local" value={filters.start} onChange={(event) => update('start', event.target.value)} aria-label="Arrival date and time" /></div>
          <div className="field"><span>Departure time</span><input type="datetime-local" value={filters.end} onChange={(event) => update('end', event.target.value)} aria-label="Departure date and time" /></div>
          <label className="field"><span>Sort by</span><select value={filters.sort} onChange={(event) => update('sort', event.target.value)}>{!isLiveMode && <option value="recommended">Recommended</option>}<option value="price">Price: low to high</option><option value="distance" disabled={isLiveMode && !hasDestination}>Distance: nearest first{hasDestination ? '' : isLiveMode ? ' (locate an area first)' : ' (sample distances)'}</option></select></label>
          {timeError && <p className="field-error">{timeError}</p>}
          <button className="filter-panel__reset" onClick={clearFilters}><RotateCcw size={14} /> Clear all filters</button>
          <div className="filter-panel__note"><Filter size={14} /> {isLiveMode ? 'The backend applies text and vehicle filters. Use “Find area on map” or “Use my location” to search by distance; recovery suggestions still need a valid time window.' : 'Search text, vehicle type and recommendation are refined in the browser; sample distances are illustrative.'}</div>
        </aside>

        <div className="search-main">
          <div className="search-toolbar">
            <button ref={filterToggleRef} type="button" className="button button--secondary search-toolbar__filter" onClick={openFilters} aria-expanded={filtersVisible} aria-controls="parking-filters-panel"><Filter size={15} /> Filters</button>
            <div className="search-toolbar__query"><Search size={17} /><span>{filters.query ? `Showing matches for “${filters.query}”` : 'Explore nearby parking'}</span></div>
            <div className="search-view-toggle" role="group" aria-label="Parking results view">
              <button type="button" className={resultsView === 'list' ? 'is-active' : ''} aria-pressed={resultsView === 'list'} onClick={() => setResultsView('list')}><List size={14} /> List</button>
              <button type="button" className={resultsView === 'split' ? 'is-active' : ''} aria-pressed={resultsView === 'split'} onClick={() => setResultsView('split')}><MapIcon size={14} /> Map + list</button>
            </div>
            <span className="search-toolbar__source">{isDemoMode ? 'SAMPLE INVENTORY' : 'BACKEND INVENTORY'}</span>
          </div>
          {isDemoMode && <InlineNotice className="search-demo-note">Every card is fictional sample inventory. Distances and owner-confirmation dates are illustrative.</InlineNotice>}
          {isLiveMode && liveReady && windowCheck?.ok && <InlineNotice className="search-demo-note">Availability is queried for the selected ISO 8601 time window. Final bookability is rechecked by the server.</InlineNotice>}
          {loading ? <LoadingState label="Finding spaces that fit…" /> : error ? <ErrorState title="Search is unavailable" message={error} action={<Button variant="outline" onClick={clearFilters}>Clear filters</Button>} /> : listings.length === 0 ? (
            <>
              <EmptyState icon={CarFront} title="No spaces match just yet" description="Try another area, a higher hourly budget, or a different time window." action={<Button variant="outline" onClick={clearFilters}>Reset search</Button>} />
              <section className="search-rescue-fallback" aria-labelledby="search-rescue-title">
                <div>
                  <span className="eyebrow">PARKING RESCUE</span>
                  <h2 id="search-rescue-title">No search matches? Ask the backend for alternatives.</h2>
                  <p>Recommendations use the selected destination and time window. We do not guess coordinates or replace missing backend data with sample listings.</p>
                </div>
                {isDemoMode ? (
                  <InlineNotice tone="info">Switch to live mode with the ParkMate backend configured to run the recommendation logic on actual backend listings. Demo mode does not call the recommendation algorithm.</InlineNotice>
                ) : (
                  <form className="search-rescue-fallback__form" onSubmit={requestEmptySearchRecommendations}>
                    <label className="field">
                      <span>Destination coordinates <small>Leave both blank to use your device location</small></span>
                      <div className="search-rescue-fallback__coordinates">
                        <input type="number" step="any" min="-90" max="90" value={rescueCoordinates.latitude} onChange={(event) => updateRescueCoordinates('latitude', event.target.value)} placeholder="Latitude" aria-label="Destination latitude" />
                        <input type="number" step="any" min="-180" max="180" value={rescueCoordinates.longitude} onChange={(event) => updateRescueCoordinates('longitude', event.target.value)} placeholder="Longitude" aria-label="Destination longitude" />
                      </div>
                    </label>
                    <div className="search-rescue-fallback__times">
                      <label className="field"><span>Arrival time</span><input type="datetime-local" value={rescueWindow.start} onChange={(event) => updateRescueWindow('start', event.target.value)} /></label>
                      <label className="field"><span>Departure time</span><input type="datetime-local" value={rescueWindow.end} onChange={(event) => updateRescueWindow('end', event.target.value)} /></label>
                    </div>
                    <Button type="submit" variant="primary" disabled={rescueLoading}>
                      <Navigation size={15} /> {rescueLoading ? 'Checking backend alternatives…' : 'Get backend recommendations'}
                    </Button>
                  </form>
                )}
              </section>
              {rescueLoading && <LoadingState label="Checking eligible backend listings…" />}
              {!rescueLoading && rescueRecommendations.length === 0 && rescueError && !isDemoMode && <InlineNotice tone="error">{rescueError}</InlineNotice>}
              {!rescueLoading && rescueSearchCompleted && rescueRecommendations.length === 0 && !rescueError && (
                <InlineNotice>The backend found no eligible alternatives for that destination and time window.</InlineNotice>
              )}
              {rescueRecommendations.length > 0 && (
                <section className="rescue-results" aria-label="Backend Parking Rescue recommendations">
                  <div className="rescue-results__heading"><div><span className="eyebrow">BACKEND RECOMMENDATIONS</span><h2>{rescueRecommendations.length} {rescueRecommendations.length === 1 ? 'alternative' : 'alternatives'}</h2></div><span className="rescue-results__rule" /></div>
                  <div className="rescue-grid">
                    {rescueRecommendations.map((item, index) => {
                      const recommendation = item.listing || item;
                      return (
                        <article className={`rescue-card${index === 0 ? ' rescue-card--featured' : ''}`} key={recommendation.id}>
                          <ListingCard listing={recommendation} linkState={{ startISO: rescueWindowCheck.startISO, endISO: rescueWindowCheck.endISO }} />
                          <div className="rescue-card__reasons">
                            <strong>Why this alternative</strong>
                            {(item.reasons || []).map((reason) => <span key={reason}><i className="rescue-card__bullet" />{reason}</span>)}
                            <span><i className="rescue-card__bullet" />Evidence confidence: {recommendation.confidence || 'unknown'} — not a probability or availability guarantee.</span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          ) : (
            <div className={`search-results-layout${resultsView === 'list' ? ' search-results-layout--list-only' : ''}`}>
              <div className="listing-grid">
                {listings.map((listing) => <div key={listing.id} className={selectedListingId === listing.id ? 'search-listing-selected' : ''} onMouseEnter={() => setSelectedListingId(listing.id)} onFocus={() => setSelectedListingId(listing.id)}><ListingCard listing={listing} /></div>)}
              </div>
              {resultsView === 'split' && <div className="search-map-column"><MapPreview listings={listings} selectedListingId={selectedListingId} onSelectListing={setSelectedListingId} destination={filters.query} destinationCoordinates={hasDestination ? { latitude: filters.latitude, longitude: filters.longitude } : null} /><div className="search-map-tip"><span className="search-map-tip__dot" /> Select a marker or a parking card to focus the same listing.</div></div>}
            </div>
          )}
          {!loading && !error && listings.length > 0 && <p className="search-disclaimer">No payment is collected in this MVP. Live bookings confirm instantly only if the existing API is configured and accepts them.</p>}
          <div className="search-below"><span><CarFront size={15} /> Need another option?</span><PrimaryLink to="/consumer/rescue">Open Parking Rescue</PrimaryLink></div>
        </div>
      </div>
    </section>
  );
}
