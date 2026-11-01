# ParkMate implementation plan

## Scope and project boundary

Create a polished, responsive peer-to-peer parking marketplace as a **separate React + Vite frontend project**. The existing public repository `lohitharjun/Parkmate` was inspected read-only; its `frontend-vite/` app and `backend/docs/api-contract.md` informed this plan. This workspace is distinct and will not push to, overwrite, or modify that repository. No server, database, payment, or authentication credentials are configured in this project.

The live/demo boundary will be visible throughout. The default experience uses clearly marked sample listings, locally persisted demo bookings/listings, and explicitly simulated login and booking-conflict actions. A configurable integration seam will use only verified API paths and payloads from the existing v1 contract. It will be considered connected only after the user supplies browser-safe Supabase settings and an API base URL and the application can successfully verify those services. No endpoint is inferred from a screen requirement.

## Implementation approach

- **Framework and routing:** React + Vite, JavaScript/JSX, React Router for stable page URLs, reusable UI components, and CSS variables for the design system. Vite dev server on the initialized project port (3000).
- **Source organization:** `src/app/` for routes/layout; `src/components/` for navigation, badges, forms, listing cards, map preview, and empty/error/loading states; `src/features/auth/`, `search/`, `bookings/`, `provider/`, and `rescue/` for page flows; `src/lib/` for demo persistence, validation, Supabase setup, and the documented API client; `src/data/` for labelled sample data; `public/manus-routes.json` for declared website routes; `docs/` for setup and integration instructions.
- **Authentication:** The sign-in and registration screens are real, validated interfaces. Without supplied configuration, submit actions create only a clearly labelled local demo session. If configured, use the Supabase browser client with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from a local `.env` file (ignored by Git); never embed a service-role key or any private credential. No live Supabase login will be claimed before verification.
- **Backend integration seam:** `VITE_API_BASE_URL` selects an optional adapter using the existing contract's documented calls only: public `GET /listings` and `GET /listings/:id`; authenticated `POST /listings`, `PATCH /listings/:id`, `GET /listings/mine`, `POST /listings/:id/confirm`, and `PUT /listings/:id/availability`; authenticated `POST /bookings`, `GET /bookings/mine`, `PATCH /bookings/:id/cancel`, `GET /provider/bookings`, and `GET /alternatives`; and `GET /api/me`. Protected requests use the Supabase access token as `Authorization: Bearer <token>`. Listing create fields follow the contract, including address, numeric latitude/longitude, and INR hourly price. Booking times are ISO 8601 UTC. The app will show an explicit disconnected/demo status by default and surface HTTP, validation, 409 conflict, and 422 not-bookable outcomes rather than pretending writes succeeded.
- **Build and export:** Create an ordinary Vite build, add `.env.example`, setup instructions and a `features implemented vs mocked` guide, then package the complete source as a downloadable ZIP. Keep this separate from the user's GitHub repository; connecting or pushing into that repository is not part of this build.

## Product experiences

1. **Landing / entry points:** Premium ParkMate homepage with clear Consumer and Provider paths and a visible Demo mode label.
2. **Login / registration:** Validated email/password forms, account mode and role choices, inline loading/errors, and demo-only fallback when Supabase is not configured.
3. **Consumer discovery:** Search by area/landmark (client-side text filter where the existing API contract offers no text-search parameter), max INR/hour, availability, date/time, vehicle type and sorting. Result cards and a stylized illustrative map panel share clearly labelled sample data; no real distance, traffic, map-provider, or availability claim is made for demo data.
4. **Listing details and booking:** Listing detail page, rules/availability, time range and estimated total, validation (end after start, not in the past, and no more than 24 hours), confirmation/loading/error states, and an explicit demo/live distinction. Demo booking is local only; live booking uses the documented `POST /bookings` contract.
5. **My Bookings:** Upcoming/past/cancelled states, empty state, reservation details, and demo cancellation or documented live cancellation where enabled.
6. **Provider area:** Dashboard metrics; listing creation/editing with required contract fields and validation; pending review messaging; owner listings, availability, availability confirmation, and provider reservations. All local demo-created listings and reservations remain explicitly marked.
7. **Parking Rescue:** An explicit demo conflict action exercises alternatives without representing a real server conflict. In configured live mode, handle documented 409/422 booking errors and call `GET /alternatives` using the same window and excluded listing id. Show the reasons and `is_demo` source on alternatives; retry only through the documented booking call.
8. **Responsive/system states:** Desktop/mobile navigation, accessible forms, validation, loading, empty and error states, keyboard focus, reduced-motion support, and restrained transitions.

## Design direction

**Design Movement:** premium urban editorial for a local mobility product: composed like a contemporary city journal, with useful interfaces that feel like a carefully designed service rather than a dashboard kit.

**Core Principles:** confident typography; quick scanning; generous but purposeful whitespace; honest source and availability labels.

**Color Philosophy:** deep evergreen gives the product a dependable anchor; warm ivory keeps long-form forms and records comfortable; fresh lime is reserved for primary actions, focus, and confirmed states; stone and asphalt tones organize data without excessive gradients. Amber and red remain distinct for pending and error states.

**Layout Paradigm:** an asymmetrical, image-led landing page; a consumer discovery workspace that gives listings priority over the illustrative map; clear, dense-but-readable reservation timelines; and a provider workbench with practical tables and spacious form groups. Parking Rescue becomes its own high-contrast decision surface rather than another generic card grid. Mobile layouts stack content and keep essential actions reachable without horizontal overflow.

**Signature Elements:** use the theme-adaptive parking-garage-and-car mark; use a single fine curb-line motif as a section divider; reserve the lime location dot and status chip for light-mode emphasis. Sample, demo, and live provenance remains explicit.

**Interaction Philosophy:** every existing action, route, form, error, and validation stays functional. Use restrained 150–200 ms state changes and clear focus styling. Adapt Aceternity UI's Card Spotlight idea only for the leading Parking Rescue alternative; keep the effect subtle, pointer-optional, and absent under reduced motion.

**Animation:** no Rive runtime or ornamental loops; existing CSS transitions and a subtle Rescue spotlight are sufficient. Respect `prefers-reduced-motion`, preserve keyboard operation, and ensure information never depends on motion.

**Typography System:** retain DM Sans for readable interface and data; use the existing DM Serif Display italic accent sparingly in hero and section headlines. Increase heading and label contrast, use tabular numerals for INR and times, and keep system fallbacks so remote font failure does not break layout.

**Brand Essence:** a neighbor-to-neighbor parking network that helps drivers arrive with less uncertainty; **assured, clear, neighborly**.

**Brand Voice:** direct, warm, and specific. Example lines: “A better place to leave the car.” “A demo alternative—not live availability.”

**Wordmark & Logo:** spell the wordmark exactly `ParkMate` and pair it with a compact parking-garage-and-car outline. Use evergreen/ivory in light mode and magenta/pink-red on near-black in dark mode; switch the favicon to match.

**Signature Brand Color:** deep evergreen `#173D32`, balanced with warm ivory and a controlled fresh-lime action accent.

## Visual implementation choices

Keep React + Vite, React Router, all current feature components, API adapters, validations, demo boundaries, tests, and route declarations. Redesign in place through existing JSX components and the current global/page CSS; make only targeted markup changes needed for hierarchy and visual assets. Use original generic urban-parking visuals on the landing and listing-detail experiences, with unmistakable illustrative labels rather than claims about a specific live space. Keep self-contained SVG fallbacks in `public/assets/` because the public Preview currently returns the Vite SPA fallback for managed image requests. Do not add map, location, payment, or availability claims. The exact `SiteReel.com` domain currently resolves to a domain-sale page, while Siteinspire's gallery is blocked by an automated security check; use the accessible Awwwards gallery for broad composition cues and the official Aceternity Card Spotlight reference for the single restrained Rescue treatment. Do not copy a reference site's identity. No Rive integration is planned because CSS interactions meet the requested motion needs without a new runtime.

## Project structure

```text
parkmate/
├── public/
│   └── manus-routes.json
├── src/
│   ├── app/                 # route table, app shell, navigation
│   ├── components/          # reusable cards, fields, status, map, feedback
│   ├── data/                # explicitly fictional demo inventory
│   ├── features/
│   │   ├── auth/             # sign in and registration
│   │   ├── search/           # filters, result list, detail and booking
│   │   ├── bookings/         # My Bookings and booking state
│   │   ├── provider/         # dashboard, listings and reservations
│   │   └── rescue/           # conflict alternatives
│   ├── lib/                  # API adapter, Supabase, validation, persistence
│   ├── styles/               # tokens, global and responsive styles
│   └── main.jsx
├── docs/                     # setup, integration and implementation/mock matrix
├── .env.example
├── package.json
└── vite.config.js
```

## Material constraints

The existing backend is unchanged and has not been connected from this isolated frontend. No API health request, Supabase authentication, live reservation, payment, geocoding, traffic feed, or map service has been verified in this session. The existing API contract does not include a free-text query parameter or payment endpoint; the UI must not imply either exists. All sample listings, distances, local demo accounts, local storage records, and simulated conflicts will say so explicitly. The source will include an `.env.example`, but no credentials.

## Reliability follow-up — 2026-10-28

Keep the delivered redesign, brand palette, existing routes, React + Vite architecture, and documented live API contract intact. No new runtime dependency or backend endpoint is planned. Move the existing Consumer/Provider choice to the top of the existing sign-in/sign-up form, preserve the choice and safe return path across auth-mode switching, and require a demo or live user before booking. A booking redirect must retain the listing and selected time window.

Centralize local-calendar-day and vehicle-fit rules in a small pure helper module so the existing demo marketplace context can reject duplicate active bookings, hide held spaces from applicable search results, and expose the same local records to My Bookings and Provider Reservations. New demo listings remain pending until their existing availability-confirm action; in local demo mode only, confirmation also makes them approved/searchable and updates the timestamp. Expand clearly fictional inventory and merge newly added sample IDs into an existing browser store without overwriting user-created listings. Keep live create/confirm/cancel requests and payloads unchanged; local preflight checks are not represented as backend enforcement.

Fix the search/map collision with width-safe CSS constraints and a responsive stacked results/map layout at tablet-sized widths. Retain the existing typography, evergreen/ivory/lime colors, illustrations, card treatment, and copy style; do not redesign unrelated screens. Make cancellation state updates immediate only after a successful action, persist demo changes through the existing storage path, and keep canceled history distinct from active reservations. Add focused pure-function regression tests and use the project's existing test/build commands; do not add dependencies.


## Mandatory authentication and theme follow-up — 2026-10-28

Keep the existing React + Vite feature architecture and current light theme unchanged. Add a persistent `ThemeProvider` in `src/app/ThemeContext.jsx`, a reusable `ThemeToggle` component, and a final theme stylesheet loaded after the existing CSS. Default first-time visitors to Light mode; preserve a saved choice in browser storage and set document color-scheme, theme-color metadata, and favicon before paint where possible. The dark palette follows the supplied screenshot: black canvas, charcoal panels, gray secondary text, bright magenta/pink-red actions, and a black-and-magenta ParkMate garage/car mark. The visible in-app mark and favicon use theme-specific colors; the display name and page title use exact `ParkMate` casing.

Enforce authentication at the application shell, not only at the booking CTA. Allow only sign-in and sign-up routes without a session; delay the gate until a live Supabase session check is complete. Redirect every other unauthenticated path to sign-in with an encoded safe in-app return path, then resume it after a successful session. A live sign-up that awaits email confirmation is not treated as signed in. Existing signed-in sessions retain all routes. Keep the Consumer/Provider selection as distinct buttons before auth credentials and retain the existing in-app role switch; it is a view switch, not a new backend permission mechanism. The public auth header remains minimal, with the role choice in the form and the theme toggle available. Do not change API endpoints, marketplace behavior, or unrelated layout.

Project responsibilities remain: `src/app/` owns access gating and shared theme state; `src/features/auth/` owns sign-in/sign-up and pre-auth role choice; `src/components/` owns the shared header, theme toggle, and theme-responsive logo; `src/styles/` owns the existing light design plus dark-mode overrides; `public/assets/` contains the mode-specific favicon. Keep the existing backend unchanged and do not claim live access unless Supabase is configured and the returned session is verified.
