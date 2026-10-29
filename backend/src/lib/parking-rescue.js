'use strict';

const HOUR_MS = 60 * 60 * 1000;
const EVIDENCE_WINDOW_MS = 24 * HOUR_MS;
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;

function timestampAge(value, now) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) && timestamp <= now ? now - timestamp : null;
  }
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, timezone] = parts;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(yearText), Number(monthText) - 1, Number(dayText));
  calendar.setUTCHours(Number(hourText), Number(minuteText), Number(secondText), 0);
  if (calendar.getUTCFullYear() !== Number(yearText)
      || calendar.getUTCMonth() !== Number(monthText) - 1
      || calendar.getUTCDate() !== Number(dayText)
      || Number(hourText) > 23
      || Number(minuteText) > 59
      || Number(secondText) > 59) {
    return null;
  }
  if (timezone !== 'Z') {
    const [offsetHours, offsetMinutes] = timezone.slice(1).split(':').map(Number);
    if (offsetHours > 23 || offsetMinutes > 59) return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > now) return null;
  return now - timestamp;
}

function assessConfidence(listing, now) {
  const updateAge = timestampAge(listing.updated_at, now);
  const confirmationValue = listing.last_confirmed_at;
  const confirmationAge = timestampAge(confirmationValue, now);
  const freshness = updateAge === null
    ? 'unknown'
    : updateAge <= EVIDENCE_WINDOW_MS ? 'fresh' : 'stale';
  const confirmation = confirmationValue === null || confirmationValue === undefined
    ? 'unconfirmed'
    : confirmationAge === null ? 'unknown'
      : confirmationAge <= EVIDENCE_WINDOW_MS ? 'recent' : 'older';
  const confidence = freshness === 'unknown' || confirmation === 'unknown' || confirmation === 'unconfirmed'
    ? 'unknown'
    : freshness === 'fresh' && confirmation === 'recent' ? 'supported' : 'limited';

  return { confidence, freshness, confirmation };
}

function isEligible(listing) {
  return listing
    && typeof listing === 'object'
    && listing.status === 'approved'
    && listing.is_active === true
    && listing.is_available === true
    && typeof listing.id === 'string'
    && listing.id.trim() !== ''
    && typeof listing.title === 'string'
    && listing.title.trim() !== ''
    && typeof listing.price_per_hour === 'number'
    && Number.isFinite(listing.price_per_hour)
    && listing.price_per_hour > 0;
}

function trustedRouteDistance(listing) {
  return listing.distance_source === 'routing_provider'
    && typeof listing.distance_km === 'number'
    && Number.isFinite(listing.distance_km)
    && listing.distance_km >= 0
    ? listing.distance_km
    : null;
}

function recommendParking(listings, { now = new Date(), limit } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const requestedLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
  const resultLimit = Math.min(requestedLimit, MAX_LIMIT);

  if (!Array.isArray(listings)) {
    return { recommendations: [], warnings: ['invalid_listing_data'] };
  }

  const warnings = [];
  const candidates = [];
  let ignored = false;
  for (const listing of listings) {
    if (!isEligible(listing)) {
      ignored = true;
      continue;
    }
    candidates.push({
      listing,
      evidence: assessConfidence(listing, safeNow),
      distanceKm: trustedRouteDistance(listing),
    });
  }
  if (ignored) warnings.push('ineligible_or_invalid_listings_ignored');

  const confidenceOrder = { supported: 0, limited: 1, unknown: 2 };
  candidates.sort((a, b) => confidenceOrder[a.evidence.confidence] - confidenceOrder[b.evidence.confidence]
    || (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY)
    || a.listing.price_per_hour - b.listing.price_per_hour
    || a.listing.id.localeCompare(b.listing.id));

  const recommendations = candidates.slice(0, resultLimit).map(({ listing, evidence, distanceKm }) => {
    const reasons = [];
    if (evidence.confirmation === 'recent') reasons.push('Recently confirmed');
    if (candidates.some((candidate) => candidate.listing.price_per_hour > listing.price_per_hour)) {
      reasons.push('Lower price');
    }
    if (distanceKm !== null && candidates.some((candidate) =>
      candidate.distanceKm !== null && candidate.distanceKm > distanceKm)) {
      reasons.push('Closer to destination');
    }
    if (listing.is_demo === true) reasons.push('Demo data — not live inventory');

    return {
      id: listing.id,
      title: listing.title,
      address: listing.address,
      price_per_hour: listing.price_per_hour,
      last_confirmed_at: listing.last_confirmed_at,
      updated_at: listing.updated_at,
      is_demo: listing.is_demo,
      confidence: evidence.confidence,
      freshness: evidence.freshness,
      confirmation: evidence.confirmation,
      reasons,
      ...(distanceKm === null ? {} : { distance_km: distanceKm }),
    };
  });

  return { recommendations, warnings };
}

module.exports = { recommendParking, assessConfidence, isEligible };
