# ParkMate API Contract (v1)
 
Base path: `/api`. REST + JSON, built with Node + Express.
Database details: [`schema.md`](./schema.md).
 
_Last updated: 2026-11-01 (added rate limiting, account deletion, new error codes, deployment notes)._
 
## Conventions (everyone follows these)
 
- **Login:** send the Supabase access token on protected routes: `Authorization: Bearer <token>`
- **Times:** ISO 8601 in UTC **with timezone**, e.g. `2026-10-25T09:00:00Z` (a time without `Z`/offset is rejected)
- **Money:** INR, numbers (e.g. `40.00`)
- **Success:** `{ "data": ... }`
- **Error:** `{ "error": { "code": "BOOKING_CONFLICT", "message": "Slot already booked" } }`
- The server **never** trusts user ids from the request body. It takes them from the login token.
- **Health** is the one exception: it returns a flat `{ "status", "db" }` (no `data` wrapper) and is served at both `/health` and `/api/health` until the team picks one.
- **Rate limits:** every route under `/api` is rate limited per IP address (see [Rate limiting](#rate-limiting)). Too many requests return `429 RATE_LIMITED`.
| Status | `code` | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad or missing input (e.g. end before start) |
| 401 | `UNAUTHENTICATED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Logged in but not allowed (not owner / not admin) |
| 404 | `NOT_FOUND` | Doesn't exist, or you can't see it |
| 409 | `BOOKING_CONFLICT` | That time slot overlaps an existing booking |
| 409 | `ACCOUNT_HAS_ACTIVE_BOOKINGS` | `DELETE /api/me` only: other users have upcoming confirmed bookings on your listings |
| 422 | `LISTING_NOT_BOOKABLE` | Listing is not approved, is paused, or the time is outside its opening hours |
| 429 | `RATE_LIMITED` | Too many requests from this IP address; wait and try again |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 503 | `NOT_CONFIGURED` | The feature is not available on this server (e.g. account deletion is not set up) |
| 503 | (health only) | Database unreachable |
 
## Who can call what
 
| Endpoint | Access |
|---|---|
| `GET /health`, `GET /api/health` | Public |
| `GET /listings`, `GET /listings/:id` | Public |
| `POST /listings`, `PATCH /listings/:id` | Logged in (PATCH: owner only) |
| `POST /bookings`, `GET /bookings/mine` | Logged in |
| `GET /provider/bookings` | Logged in (sees only bookings on their own listings) |
| `PATCH /admin/listings/:id/review` | Admin only |
| `GET /me`, `DELETE /me` | Logged in |
 
---
 
## Rate limiting
 
Limits apply per client IP address, in a 15-minute window, to everything under `/api` (including `/api/health`). `/health` (without `/api`) is not limited.
 
| Limit | Applies to | Allowed per 15 min |
|---|---|---|
| General | all methods | 300 requests |
| Write | anything except `GET`, `HEAD`, `OPTIONS` (POST, PATCH, PUT, DELETE) | 60 requests |
 
When a limit is exceeded the server answers `429` with the standard error shape. The response also carries the standard rate-limit headers (for example `Retry-After`).
 
```json
{ "error": { "code": "RATE_LIMITED", "message": "Too many changes in a short time, please slow down" } }
```
 
Notes for the frontend:
- Show a friendly message ("Too many attempts, please wait a few minutes") and **do not retry in a loop**.
- The limit is per IP, so many people on the same network (for example college Wi-Fi at a demo) share one budget.
- The limits are production defaults. Local testing raises them with the `RATE_LIMIT_GENERAL` and `RATE_LIMIT_WRITE` environment variables.
## Health
 
### `GET /health` and `GET /api/health`
- DB connected: `200 { "status": "ok", "db": "up", "time": "..." }`
- DB unreachable: `503 { "status": "error", "db": "down", "time": "..." }`
## Account
 
### `GET /me`: my profile
Logged in. Response `200`: `{ "data": { "id", "full_name", "phone", "is_admin", "email" } }`
 
### `DELETE /me`: delete my account
Logged in. **Permanent and cannot be undone.** Request body (required, so it can't happen by accident):
```json
{ "confirm": "DELETE" }
```
Response `200`: `{ "data": { "deleted": true } }`
 
What gets removed: the user's bookings, all bookings on the user's own listings (past or cancelled), the user's listings and their opening hours, the profile, and the login itself. After a successful call the old token no longer works, so the frontend must clear the session and send the user to the sign-in or home page.
 
Errors:
- `400 VALIDATION_ERROR`: `confirm` is missing or is not exactly `"DELETE"`.
- `401 UNAUTHENTICATED`: missing or invalid token.
- `409 ACCOUNT_HAS_ACTIVE_BOOKINGS`: someone has an upcoming confirmed booking on one of your listings. Tell the user to pause the listings (`PATCH /listings/:id` with `is_active: false`) and try again after those bookings end.
- `500 INTERNAL_ERROR`: the data was removed but the login could not be removed yet. The user can safely try again.
- `503 NOT_CONFIGURED`: account deletion is not enabled on this server.
## Listings
 
### `GET /listings`: search approved listings
Only `approved` **and** `is_active` listings are returned. Query params (all optional): `query`, `vehicle_type`, `max_price`, `lat`, `lng`, `max_distance_km`, `start`, `end`, `sort` (`recommended` | `price` | `distance`).
- `start` + `end` (both or neither): only return listings with no overlapping booking and inside their opening hours.
- `lat` + `lng` (both or neither): adds a Haversine straight-line `distance_km` to each result; this is not routing distance or travel time. Required for `sort=distance`, `sort=recommended` and `max_distance_km` (`400` otherwise).
- Default sort: `recommended` when `lat`/`lng` are given (cheap + close), otherwise `price`. Max 100 results.
- If an exact search returns no rows and the request includes coordinates plus a valid `start`/`end` window, the backend automatically runs Parking Rescue on approved, active listings that are free for that window. It keeps the vehicle filter, relaxes the text and maximum-price filters, and limits candidates to 5 km unless `max_distance_km` is provided. It returns up to five results ranked by qualitative freshness/confirmation evidence, then price. These rows include `search_fallback`, `recommendation_reasons`, `confidence`, `freshness`, and `confirmation`; Haversine distance is used only as a radius filter and is not included as a route-distance claim. Without coordinates or a time window the backend returns the original empty result rather than guessing.
```json
{ "data": [ {
  "id": "uuid", "title": "Guindy Metro Lot", "address": "...",
  "latitude": 13.0067, "longitude": 80.2206,
  "price_per_hour": 40, "distance_km": 2.4,
  "updated_at": "2026-10-24T09:00:00Z",
  "last_confirmed_at": "2026-10-24T09:00:00Z", "is_demo": false
} ] }
```
(`distance_km` is omitted when `lat`/`lng` were not sent; it is straight-line distance only. `last_confirmed_at` can be `null`.)
 
### `GET /listings/:id`: listing details
Anyone can view approved listings. The owner (and admin) can also view pending/rejected ones. Otherwise `404`.
Fields: `id, title, description, rules, address, latitude, longitude, price_per_hour, vehicle_type, is_active, status, updated_at, last_confirmed_at, is_demo, availability: [{day_of_week, open_time, close_time}]` (+ `owner_id`, `review_note`, `evidence_urls` for owner/admin).
A missing, invalid or expired token on this public route is ignored (treated as anonymous) instead of returning `401`.
`updated_at` = last change to listing data/status. `last_confirmed_at` = when the owner last confirmed the spot is available; these timestamps are separate. `is_demo = true` means demonstration data and **must be labelled as such in the UI**.
 
### `POST /listings`: create a listing
Request:
```json
{ "title": "Guindy Metro Lot", "address": "...", "latitude": 13.0067, "longitude": 80.2206, "price_per_hour": 40 }
```
Optional: `description`, `rules`, `vehicle_type` (an empty string or `null` is accepted and stored as empty), `evidence_urls` (array of up to 10 `http(s)` URLs) and `availability` (weekly opening hours, same shape as `PUT /listings/:id/availability`). **If `availability` is omitted the listing is open 24x7**; it can also be set later with `PUT`.
Response `201`: the listing (with `availability`), with `"status": "pending"` (waits for admin review). Sending `status` or `owner_id` → `400`.
 
### `PATCH /listings/:id`: update your own listing
Owner only (`403` otherwise). Allowed fields: `title`, `address`, `latitude`, `longitude`, `price_per_hour`, `is_active` (+ `description`, `rules`, `vehicle_type`, `evidence_urls`). Sending `status` is rejected (`400`).
**Re-review rules (enforced in the database):** changing `address`, `latitude` or `longitude` of an **approved** listing sends it back to `pending` (not bookable until re-approved). Editing the content of a **rejected** listing resubmits it (`pending`; the admin's `review_note` is kept so the owner sees the feedback). Changing only price/title of an approved listing, or only `is_active`, does not. The response shows the resulting `status`.
 
## Bookings
 
### `POST /bookings`: book a listing
Request:
```json
{ "listing_id": "uuid", "start_time": "2026-10-25T09:00:00Z", "end_time": "2026-10-25T11:00:00Z" }
```
Response `201`: the booking with `"status": "confirmed"` and a `total_price` calculated by the database (`price_per_hour × hours`, rounded to 2 decimals). Any price/status/user sent by the client is ignored. Bookings confirm instantly.
Errors: `400` invalid times (end not after start, in the past, longer than 24 h, bad format), `403` you cannot book your own listing, `404` listing not found, `422` listing not bookable, `409` slot already taken (including when two requests arrive at the same moment: exactly one wins), `429` too many requests.
 
### `GET /bookings/mine`: my bookings
Optional `?status=confirmed|cancelled`. Each item includes `listing: { title, address }`.
 
## Provider
 
### `GET /provider/bookings`: reservations on my listings
Optional `?listing_id=`. Each item includes `consumer: { display_name }`, the times, `status` and `total_price`.
 
## Review
 
### `PATCH /admin/listings/:id/review`: approve or reject
Admin only (`403` otherwise). Request:
```json
{ "decision": "approved", "review_note": "optional text" }
```
`decision` is `approved` or `rejected`. Response: the updated listing.
 
---
 
## Additions beyond the v1 text (implemented, need Nilesh's OK)
 
| Endpoint | Access | Notes |
|---|---|---|
| `PATCH /bookings/:id/cancel` | Booking owner | `200` booking with `status: "cancelled"`. Idempotent. `404` if not yours. `400` if the booking already started. Frees the slot. |
| `GET /alternatives` | Logged in | Parking Rescue. Query: `lat, lng, start, end` (required), `exclude_listing_id`, `max_price`, `radius_km` (default 5). Never includes the caller's own listings. Returns up to five eligible records in `{ "data": [{ "listing": {id,title,address,latitude,longitude,price_per_hour,status,is_active,is_available,updated_at,last_confirmed_at,is_demo,confidence,freshness,confirmation}, "reasons": ["Free for your whole time window", "Recently confirmed", "Lower price"] }] }`; may be empty. Haversine distance is used only to filter the search radius and is not returned as route distance. |
| `POST /listings/:id/confirm` | Owner | "This spot is still available": sets `last_confirmed_at = now`. Returns the listing. `403` if not the owner. |
| `GET /listings/mine` | Logged in | All my listings, any status. |
| `PUT /listings/:id/availability` | Owner | Body `{ "windows": [ { "day_of_week": 0-6 (0 = Sunday), "open_time": "HH:MM", "close_time": "HH:MM" } ] }` replaces the weekly opening hours (Asia/Kolkata). `[]` = open 24x7. A booking must fit inside one window on one day. |
| `GET /admin/listings?status=pending` | Admin | Review queue. |
| `GET /api/me` | Logged in | `{ data: { id, full_name, phone, is_admin, email } }` |
| `DELETE /api/me` | Logged in | **New.** Deletes the account and its data. Body `{ "confirm": "DELETE" }`. See [Account](#account). |
| Rate limiting (`429 RATE_LIMITED`) | Everyone | **New.** 300 requests and 60 writes per 15 minutes per IP. See [Rate limiting](#rate-limiting). |
 
### Parking Rescue flow
1. `POST /bookings` returns `409 BOOKING_CONFLICT` (or `422`).
2. Frontend calls `GET /alternatives` with the same destination and time window plus `exclude_listing_id`.
3. User picks one → `POST /bookings` again. The server re-checks everything; a `409` can happen again.
### Parking Rescue evidence and ranking
`updated_at` and `last_confirmed_at` are separate evidence. `freshness` is `fresh`, `stale`, or `unknown` using a 24-hour window for `updated_at`; `confirmation` is `recent`, `older`, `unconfirmed`, or `unknown` using the same window for `last_confirmed_at`. `confidence` is `supported` only when both are fresh/recent, `limited` when both timestamps are valid but at least one is older, and `unknown` when either timestamp is unavailable, invalid, or future-dated. These labels are evidence summaries, not probabilities or guarantees of availability.
 
Ranking is deterministic: confidence first, routing-provider distance when present, then lower hourly price, then listing ID. This endpoint currently has no routing-provider distance, so it ranks by confidence and price after eligibility; Haversine distance is used only for the `radius_km` search filter and is not returned as travel distance. Reasons are emitted only when supported by data. `is_demo: true` and the reason `Demo data — not live inventory` identify synthetic listings.
 
Eligibility is rechecked in the backend: status must be approved, the listing active, and the requested time window free according to confirmed bookings and opening hours. Booking remains authoritative and can still fail if availability changes after this search. The endpoint does not claim live inventory or real-time route data.
 
## Deployment
 
- **Backend:** Node + Express on Render. Base URL for the frontend: `https://<render-service>.onrender.com/api` (the exact link is in the Render dashboard).
- **Frontend:** Vercel, `https://parkmate-gd46.vercel.app`.
- **Database and login:** Supabase.
- **Cold starts:** on Render's free plan the service sleeps when idle, so the first request can take 30 to 60 seconds. Show a loading state and do not treat a slow first response as an error.
- **Error tracking:** unexpected `500` errors are reported to Sentry when `SENTRY_DSN` is set on the server. This does not change any response.
## Notes for the team
 
- **Frontend:** only the listed fields are guaranteed. Tell the backend owner if you need more before building the screen. Handle `429 RATE_LIMITED` and the `DELETE /api/me` errors above.
- **Backend:** Postgres `23P01` on insert → `409 BOOKING_CONFLICT`. Postgres `P0001` with message `LISTING_NOT_BOOKABLE` → `422`.
- **CORS:** the API allows the origins listed in `CORS_ORIGINS` (localhost + the Vercel URL + `*.vercel.app` previews).
- **Not in v1:** payments.
 
