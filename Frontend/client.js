// API layer. Endpoint names below are ASSUMED - confirm with Lohith and edit here only.
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';
// TEMPORARY: mock data is ON unless VITE_USE_MOCK=false. Remove once Lohith's APIs are live.
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

async function req(path, opts = {}) {
  const token = localStorage.getItem('pm_token');
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: opts.body && JSON.stringify(opts.body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || d.detail || `Request failed (${r.status})`);
  return d;
}
const real = {
  signup: (b) => req('/auth/signup', { method: 'POST', body: b }),          // -> {token, user}
  login: (b) => req('/auth/login', { method: 'POST', body: b }),            // -> {token, user}
  search: (q) => req('/listings?query=' + encodeURIComponent(q)),           // -> [listing]
  listing: (id) => req('/listings/' + id),
  book: (b) => req('/bookings', { method: 'POST', body: b }),               // {listingId,date,hours}
  myBookings: () => req('/bookings/me'),
  myListings: () => req('/provider/listings'),
  addListing: (b) => req('/provider/listings', { method: 'POST', body: b }), // {title,address,price}
  reservations: () => req('/provider/reservations'),
};

// ---- TEMPORARY MOCK (localStorage) ----
const get = (k, d) => JSON.parse(localStorage.getItem('pm_mock_' + k) || 'null') ?? d;
const put = (k, v) => localStorage.setItem('pm_mock_' + k, JSON.stringify(v));
const wait = (v) => new Promise((r) => setTimeout(() => r(v), 300));
const me = () => JSON.parse(localStorage.getItem('pm_user') || '{}').email;
const users = () => get('users', [
  { name: 'Demo Consumer', email: 'consumer@parkmate.com', password: 'demo123' },
  { name: 'Demo Provider', email: 'provider@parkmate.com', password: 'demo123' },
]);
const seed = [
  { id: 1, title: 'MG Road Covered Slot', address: 'MG Road, Chennai', price: 40, owner: 'provider@parkmate.com' },
  { id: 2, title: 'T Nagar Basement Parking', address: 'T Nagar, Chennai', price: 30, owner: 'provider@parkmate.com' },
];
const listings = () => [...seed, ...get('listings', [])];
const mock = {
  signup: async (b) => {
    const u = users();
    if (u.some((x) => x.email === b.email)) throw new Error('Email already registered');
    put('users', [...u, b]);
    return wait({ token: 'mock', user: { name: b.name, email: b.email } });
  },
  login: async (b) => {
    const u = users().find((x) => x.email === b.email && x.password === b.password);
    if (!u) throw new Error('Invalid email or password');
    return wait({ token: 'mock', user: { name: u.name, email: u.email } });
  },
  search: (q) => wait(listings().filter((l) => (l.title + l.address).toLowerCase().includes(q.toLowerCase()))),
  listing: async (id) => {
    const l = listings().find((x) => String(x.id) === String(id));
    if (!l) throw new Error('Listing not found');
    return wait(l);
  },
  book: async (b) => { const l = await mock.listing(b.listingId); put('bookings', [...get('bookings', []), { id: Date.now(), ...b, title: l.title, price: l.price, owner: l.owner, user: me() }]); return wait({ ok: true }); },
  myBookings: () => wait(get('bookings', []).filter((b) => b.user === me())),
  myListings: () => wait(get('listings', []).filter((l) => l.owner === me())),
  addListing: (b) => { put('listings', [...get('listings', []), { id: Date.now(), ...b, owner: me() }]); return wait({ ok: true }); },
  reservations: () => wait(get('bookings', []).filter((b) => b.owner === me())),
};
export const api = USE_MOCK ? mock : real;
