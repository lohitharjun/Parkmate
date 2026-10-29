# ParkMate — peer-to-peer parking marketplace

A responsive React + Vite frontend for exploring shared parking, managing consumer bookings, and hosting a space. It is a **separate project** from `lohitharjun/Parkmate`; it does not replace or modify the existing Node/Express + Supabase backend.

## Quick start

Requirements: Node.js 20+ and pnpm 11.25.0 (pinned in `package.json`). From this folder:

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Vite serves the preview on `http://localhost:3000`. The initialized ParkMate Preview uses this same port.

Run the checks and create a production bundle:

```bash
pnpm test
pnpm build
```

Build output is written to `dist/`.

## Demo mode (default)

`.env.example` selects `VITE_APP_MODE=demo`. Listings are fictional, marked as **Demo data**, and stored only in browser local storage. Sign-in and sign-up ask the user to choose Consumer or Provider before credentials. A demo sign-in/sign-up accepts a valid email and a password of at least eight characters, stores only a role-labelled local profile (never the password), and does not create a server account. Booking requires that local profile, asks for a vehicle type, checks the listed fit, and prevents a second same-space booking record for the same local calendar day. Cancellations remain visible as Cancelled history; active demo reservations and provider-created listings stay local. A provider-created demo listing becomes searchable after the provider confirms availability. Parking Rescue's “Simulate conflict” control makes no booking/API request and explicitly says the conflict is simulated. No payment is collected.

## Optional live connection to the existing backend

The frontend adapter follows the verified API contract at `backend/docs/api-contract.md` and the existing router mount. It calls only documented paths. The current session has **not** verified a live backend URL or Supabase project, so the shipped app defaults to demo mode and this README does not claim a live connection.

1. Copy `.env.example` to `.env`.
2. Set `VITE_APP_MODE=live`.
3. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the Supabase project URL and public anon key. **Never use a service-role key in a browser build.**
4. Set `VITE_API_BASE_URL` to the existing Express backend origin, without a trailing `/api` (e.g. `https://api.example.com`). The API contract base is `/api`; the adapter adds that prefix for API routes and checks the documented `/health` endpoint.
5. Restart Vite after changing `.env`. Live mode checks `GET /health`; it shows live inventory only when required settings exist and the backend/database health result is OK. If health fails, the app displays a live error and does not substitute mock inventory.
6. Ensure the backend's configured `CORS_ORIGINS` permits the browser origin. This project does not change the backend or its CORS settings.

Supabase Auth handles live sign-in/sign-up. Protected backend calls pass the Supabase access token in `Authorization: Bearer <token>`. The UI never sends a user ID as proof of ownership. Provider/consumer selection is a frontend view preference (also saved as Supabase signup metadata when Supabase is enabled); the existing contract does not define a provider-role endpoint. Before a live booking request, the client checks the signed-in user's existing bookings for a same-listing/same-local-day record and validates the selected vehicle against the listing. These are client-side preflight checks only; the backend must enforce final uniqueness and fit rules for concurrent clients. Vehicle type is deliberately not added to the existing live API payload. The API computes live booking totals and confirms instantly. The live adapter handles `BOOKING_CONFLICT` (409) and `LISTING_NOT_BOOKABLE` (422) and requests Parking Rescue via the documented `/alternatives` contract.

**Do not add private values to `VITE_` variables.** Values in a Vite `VITE_` variable are compiled into browser-visible output. `.env` and `.env.*` are ignored by Git; `.env.example` contains placeholders only.

## Visual redesign and asset notes

The refreshed UI uses a deep-evergreen, warm-ivory, and restrained lime palette; editorial type and spacing; responsive consumer/provider workspaces; and one subtle spotlight on the first Parking Rescue alternative. The generated parking visuals are kept as stable `/manus-storage/...` assets in the hosted project. This Preview's public browser path may fall back to the included, original `public/assets/parkmate-hero-fallback.svg` and `parkmate-detail-fallback.svg` scenes if the storage resolver is unavailable. All three visual treatments are illustrative, never photos of a specific listing. See [`docs/REDESIGN-RESEARCH.md`](docs/REDESIGN-RESEARCH.md) for the research choices and limitation.

The completed pre-redesign MVP remains recoverable at isolated project checkpoint `7e3368304625a80578d1be090499a1e4ad90a6d9`. This source tree contains the latest redesigned implementation plus the reliability follow-up; it remains separate from the existing public GitHub repository.

## Project map

```text
src/app/             App routing, theme provider, and shared marketplace data context
src/components/      Navigation, feedback, buttons, listing/map components, theme toggle
src/data/            Fictional sample inventory and sample provider reservations
src/features/auth/   Validated auth screens and optional Supabase Auth context
src/features/search/ Consumer landing, search and listing detail/booking
src/features/bookings/ Consumer-only My Bookings
src/features/provider/ Provider dashboard, inventory and reservations
src/features/rescue/ Parking Rescue after real or simulated conflict
src/lib/             Verified API adapter, Supabase setup, booking rules, validation and demo storage
src/styles/          Existing light design and theme-aware dark-mode overrides
public/assets/       Site branding artwork and light/dark favicon assets
docs/                 API integration notes and feature matrix
public/manus-routes.json  Preview route declarations
```

For endpoint/request mappings, see [`docs/API-INTEGRATION.md`](docs/API-INTEGRATION.md). For the feature-by-feature implemented-versus-mocked distinction, see [`docs/IMPLEMENTED-AND-MOCKED.md`](docs/IMPLEMENTED-AND-MOCKED.md).


## Sign-in-first access and appearance

Only `/auth/sign-in` and `/auth/sign-up` are public page routes. The home page, Consumer pages, Provider pages, and unknown routes stay behind the app's session gate; an unauthenticated deep link returns to sign-in and resumes only a safe same-site path after sign-in. Sign-up remains available from the sign-in screen. In the default demo mode, sign-in creates a browser-local profile only; in live mode, access requires a valid Supabase session, and email-confirmation signup remains at the sign-in page until the user signs in. The app restores an existing live session before rendering protected routes. This client-side route gate does not replace API-side authorization or make the static JavaScript bundle private; live API requests continue using the existing bearer-token contract.

The auth page offers separate Consumer and Provider mode buttons before credentials. After sign-in, the header and mobile navigation provide in-app Consumer/Provider switches; these are view preferences and do not create backend permissions. Light mode retains the approved evergreen, ivory, and sage palette. Dark mode uses the supplied near-black/charcoal layout, light-gray text, and magenta/pink-red accents. The accessible toggle appears before and after sign-in; the preference is stored locally under `parkmate.theme.v1`, and the wordmark mark and favicon change color with the selected theme. The visible product name is spelled exactly `ParkMate`.
