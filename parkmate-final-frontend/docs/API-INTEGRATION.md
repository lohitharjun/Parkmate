# Existing ParkMate API integration

This frontend reads the contract from `backend/docs/api-contract.md` and the existing Express router mounting. The Express app mounts the API router at `/api`; the health handler is available at `/health` and `/api/health`. Set `VITE_API_BASE_URL` to the backend **origin only**, such as `https://api.example.com` (do not add `/api`). The frontend adds `/api` to documented API paths and checks the documented `/health` endpoint.

## Environment and source boundary

Copy `.env.example` to `.env`. The default `VITE_APP_MODE=demo` is intentionally local-only. To opt into live mode, set `VITE_APP_MODE=live` and add the Supabase project URL, Supabase **anon/public** key, and backend origin. Never put a Supabase service-role key, database password, or other private credential in a `VITE_` variable. Local `.env` files are ignored by Git. Live mode displays an explicit connection state; if API health fails it shows no demo inventory as a fallback.

Supabase JS handles browser sign-in/sign-up. Protected Express calls send `Authorization: Bearer <Supabase access token>`. The backend resolves the user from that token; the frontend never sends a user ID to claim ownership. The only profile fetch is the documented `GET /api/me`. The contract contains no provider-role API; role is a local UI preference / Supabase signup metadata, not a backend permission.

## Verified endpoint map

| Frontend operation | Existing contract path | Request notes |
| --- | --- | --- |
| Backend/database health | `GET /health` | Flat `{status, db, time}` response; checked before live marketplace reads/writes. |
| Current profile | `GET /api/me` | Bearer token; `{ data: { id, full_name, phone, is_admin, email } }`. |
| Search approved active listings | `GET /api/listings` | Only documented query keys are sent: `max_price`, `start`, `end`, `lat`, `lng`, `max_distance_km`, `sort`. Date range is both values or neither, ISO 8601 UTC. Text/vehicle filtering is client-side because the API has no such query fields. |
| Listing detail | `GET /api/listings/:id` | Public; optional bearer token for own pending/rejected listing. |
| Create a listing | `POST /api/listings` | Bearer token; sends only contract fields. Required title/address/latitude/longitude/price_per_hour; optional description/rules/vehicle_type/evidence_urls/availability. Never sends status or owner_id. |
| Edit listing | `PATCH /api/listings/:id` | Bearer token; only owner-editable fields; never sends status. |
| My listings | `GET /api/listings/mine` | Bearer token. |
| Confirm availability | `POST /api/listings/:id/confirm` | Bearer token; owner only. |
| Replace weekly availability | `PUT /api/listings/:id/availability` | Bearer token; body `{ "windows": [{ "day_of_week", "open_time", "close_time" }] }`; `[]` means 24×7. |
| Create booking | `POST /api/bookings` | Bearer token; `{ listing_id, start_time, end_time }`; start/end sent as UTC ISO timestamps. Server computes price and confirms instantly. |
| Consumer bookings | `GET /api/bookings/mine` | Bearer token; optional documented `status=confirmed|cancelled`. |
| Cancel booking | `PATCH /api/bookings/:id/cancel` | Bearer token; contract addition, owner only; no body. |
| Provider reservations | `GET /api/provider/bookings` | Bearer token; optional documented `listing_id`. |
| Parking Rescue alternatives | `GET /api/alternatives` | Bearer token; required `lat`, `lng`, `start`, `end`; optional `exclude_listing_id`, `max_price`, `radius_km`. |

The adapter translates documented `{error:{code,message}}` results, including `BOOKING_CONFLICT` (409) and `LISTING_NOT_BOOKABLE` (422). No payment, geocoding, text-search endpoint, or live traffic service is implemented because the existing contract does not provide one. The adapter has not been connected to a backend in this project until valid environment settings are supplied and its health check succeeds.
