# ParkMate frontend (React + Vite)

## Before adding files (do NOT duplicate setup)
```
cd frontend && ls && cat package.json && ls src && git status
```
If React + Vite already exists, only copy `src/` from this folder: `cp -rn src/* frontend/src/`.
Then replace the Vite boilerplate `src/App.jsx` and `src/App.css` with the ones here (`cp -f`). Copy `.env.example` to `.env`.

## Install and run
```
cd frontend
npm install
npm install react-router-dom
npm run dev      # http://localhost:5173
npm run build    # must succeed before committing
```

## Structure
`src/api/client.js` (all API calls + TEMPORARY mock) · `src/context/AuthContext.jsx` (session, mode) · `src/components/` (Layout, ListingCard, States) · `src/pages/` (Auth, Search, ListingDetails, Booking, MyBookings, ProviderListings)

## Mock vs real
Mock data is ON by default (yellow banner shown). Set `VITE_USE_MOCK=false` and `VITE_API_URL` when Lohith's APIs are ready. See API-CONTRACT.md.

## Commit
```
git checkout -b frontend-foundation
git add frontend && git commit -m "feat(frontend): ParkMate React UI - auth, consumer and provider flows"
git push -u origin frontend-foundation
```
