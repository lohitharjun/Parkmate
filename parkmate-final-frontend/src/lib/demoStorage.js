import { SAMPLE_LISTINGS, SAMPLE_PROVIDER_RESERVATIONS } from '../data/seedData.js';

const KEYS = {
  listings: 'parkmate.demo.listings.v1',
  bookings: 'parkmate.demo.bookings.v1',
  providerReservations: 'parkmate.demo.providerReservations.v1',
  demoProfile: 'parkmate.demo.profile.v1',
  viewRole: 'parkmate.viewRole.v1',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function read(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : clone(fallback);
  } catch {
    return clone(fallback);
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The current tab still works if browser storage is blocked or full.
  }
}

function mergeSeedRows(seedRows, storedRows) {
  if (!Array.isArray(storedRows)) return clone(seedRows);
  const knownIds = new Set(storedRows.map((row) => String(row?.id ?? '')).filter(Boolean));
  const additions = seedRows.filter((row) => !knownIds.has(String(row.id)));
  return [...clone(additions), ...storedRows];
}

export function loadDemoListings() {
  const stored = read(KEYS.listings, null);
  return mergeSeedRows(SAMPLE_LISTINGS, stored);
}

export function saveDemoListings(listings) {
  write(KEYS.listings, listings);
}

export function loadDemoBookings() {
  const bookings = read(KEYS.bookings, []);
  return Array.isArray(bookings) ? bookings : [];
}

export function saveDemoBookings(bookings) {
  write(KEYS.bookings, bookings);
}

export function loadDemoProviderReservations() {
  const stored = read(KEYS.providerReservations, null);
  return mergeSeedRows(SAMPLE_PROVIDER_RESERVATIONS, stored);
}

export function saveDemoProviderReservations(reservations) {
  write(KEYS.providerReservations, reservations);
}

export function loadDemoProfile() {
  return read(KEYS.demoProfile, null);
}

export function saveDemoProfile(profile) {
  write(KEYS.demoProfile, profile);
}

export function loadViewRole() {
  try {
    return localStorage.getItem(KEYS.viewRole) === 'provider' ? 'provider' : 'consumer';
  } catch {
    return 'consumer';
  }
}

export function saveViewRole(role) {
  try {
    localStorage.setItem(KEYS.viewRole, role === 'provider' ? 'provider' : 'consumer');
  } catch {
    // View preference is non-essential.
  }
}

export function newDemoId(prefix = 'demo') {
  const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${randomPart}`;
}
