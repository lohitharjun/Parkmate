# ParkMate redesign changes and limitations

## Changed files

- `src/styles/redesign.css` adds the responsive evergreen/ivory/lime visual system, typography hierarchy, refined surfaces, icon sizing, reduced-motion handling, the restrained Rescue-card spotlight, and hidden-state styling for the filter drawer.
- `src/main.jsx` loads the redesign stylesheet after the existing page styles.
- `src/features/search/LandingPage.jsx` adds the original illustrative urban-parking hero visual while preserving the working search form and Consumer/Provider entry routes.
- `src/features/search/SearchPage.jsx` gives the mobile filter drawer accurate expanded/control semantics, removes its closed controls from keyboard focus, moves focus into the drawer on open, and closes on Escape with focus restoration.
- `src/features/search/ListingDetailsPage.jsx` adds the illustrative listing visual while preserving listing details, date/time validation, booking, and demo conflict actions.
- `src/features/rescue/RescuePage.jsx` adds a localized spotlight interaction only; the existing demo/live guard, conflict state, alternative provenance, and retry route remain intact.
- `public/assets/parkmate-hero-fallback.svg` and `public/assets/parkmate-detail-fallback.svg` provide portable, text-free scenes for the public Preview and local runs when the generated managed images cannot be fetched.
- `README.md`, `plan.md`, `TODO.md`, `docs/IMPLEMENTED-AND-MOCKED.md`, and `docs/REDESIGN-RESEARCH.md` document the design decisions, testing, source boundary, and mock/live distinctions.

The existing API adapter, adapter contract tests, Supabase auth context, marketplace data logic, and validation modules are unchanged from the preserved pre-redesign checkpoint. The backend project was not modified. The existing GitHub clone remains clean; the redesign changes are not pushed.

## Regressions and incomplete integrations

No blocking regression was observed in the tested UI flows. Manual Preview checks covered mixed-case search, local demo booking and My Bookings separation, provider reservations separation, the simulated Rescue flow with time-window preservation, and empty auth/provider-form validation. The mobile filter drawer's simulated narrow state was checked for `aria-expanded`/`aria-hidden`/`inert`, focus into the drawer, and Escape close with focus return; 390px and 768px screenshots verify its responsive presentation. The automated suite contains 10 passing unit/adapter-contract tests; it is not an end-to-end browser suite.

The existing Express API and Supabase Auth were not connected or tested against a live deployment because no live service configuration was supplied. The existing contract-aligned client code is preserved and covered by request-format tests; successful real authentication, listing writes, bookings, cancellation, Rescue alternatives, and backend health still require valid environment configuration and a deployed API.

The generated managed photographs are available to the bound Webdev screenshot renderer, but their managed storage path returned SPA HTML in the actual public Preview browser. The public Preview therefore displays the original local SVG fallback scenes, which are explicitly labelled illustrative. No live listing photograph is implied.

SiteReel's public domain resolves to a sale page rather than an active research product; this limitation and the alternate Awwwards/Aceternity references are recorded in `REDESIGN-RESEARCH.md`.
