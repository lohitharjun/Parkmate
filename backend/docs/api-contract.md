# ParkMate API Contract (v1)

Base path: `/api`. REST + JSON, built with Node + Express.
Database details: [`schema.md`](./schema.md).

## Conventions (everyone follows these)

- **Login:** send the Supabase access token on protected routes: `Authorization: Bearer <token>`
- **Times:** ISO 8601 in UTC **with timezone**, e.g. `2026-10-25T09:00:00Z` (a time without `Z`/offset is rejected)
- **Money:** INR, numbers (e.g. `40.00`)
- **Success:** `{ "data": ... }`
- **Error:** `{ "error": { "code": "BOOKING_CONFLICT", "message": "Slot already booked" } }`
- Errors may carry an extra `reason` (e.g. `{ "code": "BOOKING_CONFLICT", "message": "...", "reason": "SLOT_TAKEN" }`). `code` and the HTTP status are the stable contract; `reason` says exactly why, so the UI can show a precise message. Clients that do not know `reason` can ignore it.
- The server **never** trusts user ids from the request body. It takes them from the login token.
- **Health** is the one exception: it returns a flat `{ "status", "db" }` (no `data` wrapper) and is served at both `/health` and `/api/health` until the team picks one.

| Status | `code` | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad or missing input (e.g. end before start) |
| 401 | `UNAUTHENTICATED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Logged in but not allowed (not owner / not admin) |
| 401 | `REAUTH_REQUIRED` | Logged in, but this action needs a login from the last 5 minutes: ask for the password again |
| 404 | `NOT_FOUND` | Doesn't exist, or you can't see it |
| 409 | `BOOKING_CONFLICT` | That time slot overlaps an existing booking |
| 409 | `ACCOUNT_HAS_ACTIVE_BOOKINGS` | Cannot delete (or schedule deletion of) an account while others have upcoming bookings on its listings |
| 413 | `FILE_TOO_LARGE` | Photo is bigger than 5 MB |
| 415 | `UNSUPPORTED_FILE_TYPE` | Photo is not a real JPEG/PNG, or its content does not match its `Content-Type` |
| 422 | `LISTING_NOT_BOOKABLE` | Listing is not approved, is paused, or the time is outside its opening hours |
| 422 | `PHOTO_LIMIT_REACHED` | A listing already has 10 photos |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 502 | `STORAGE_ERROR` | Supabase Storage failed (photo not saved / not loaded); safe to retry |
| 503 | `NOT_CONFIGURED` | Photo storage is not set up on this server (`SUPABASE_SERVICE_ROLE_KEY` / bucket) |
| 503 | (health only) | Database unreachable |

## Who can call what

| Endpoint | Access |
|---|---|
| `GET /health`, `GET /api/health` | Public |
| `GET /listings`, `GET /listings/:id` | Public |
| `POST /listings`, `PATCH /listings/:id` | Logged in (PATCH: owner only) |
| `GET /listings/:id/availability-check`, `GET /listings/:id/photos` | Public (same visibility rules as `GET /listings/:id`) |
| `PUT /listings/:id/location`, `POST/PATCH/DELETE /listings/:id/photos…` | Logged in, listing owner only |
| `POST /bookings`, `GET /bookings/mine`, `GET /bookings/:id` | Logged in (`:id`: the booker, the listing owner, or an admin) |
| `GET /provider/bookings` | Logged in (sees only bookings on their own listings) |
| `PATCH /admin/listings/:id/review`, `GET/PATCH/DELETE /admin/photos…` | Admin only |

---

## Health

### `GET /health` and `GET /api/health`
- DB connected: `200 { "status": "ok", "db": "up", "time": "..." }`
- DB unreachable: `503 { "status": "error", "db": "down", "time": "..." }`

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
  "location_label": "Next to Gate 2", "location_verified": true,
  "latitude": 13.0067, "longitude": 80.2206,
  "price_per_hour": 40, "distance_km": 2.4,
  "updated_at": "2026-10-24T09:00:00Z",
  "last_confirmed_at": "2026-10-24T09:00:00Z", "is_demo": false
} ] }
```
(`distance_km` is omitted when `lat`/`lng` were not sent; it is straight-line distance only. `last_confirmed_at` can be `null`.)

### `GET /listings/:id`: listing details
Anyone can view approved listings. The owner (and admin) can also view pending/rejected ones. Otherwise `404`.
Fields: `id, title, description, rules, address, location_label, location_verified, location_updated_at, latitude, longitude, price_per_hour, vehicle_type, is_active, status, updated_at, last_confirmed_at, is_demo, availability: [{day_of_week, open_time, close_time}], photos: [{id, url, is_primary, uploaded_at}]` (+ `owner_id`, `review_note`, `evidence_urls` for owner/admin).
`photos` holds the **approved** photos, main photo first; `url` is a signed link that expires (about an hour), so load it when the screen opens and do not store it. Owner/admin also get pending/rejected photos with their review fields (see Photos).
A missing, invalid or expired token on this public route is ignored (treated as anonymous) instead of returning `401`.
`updated_at` = last change to listing data/status. `last_confirmed_at` = when the owner last confirmed the spot is available; these timestamps are separate. `is_demo = true` means demonstration data and **must be labelled as such in the UI**.

### `POST /listings`: create a listing
Request:
```json
{ "title": "Guindy Metro Lot", "address": "...", "latitude": 13.0067, "longitude": 80.2206, "price_per_hour": 40 }
```
Optional: `description`, `rules`, `vehicle_type`, `location_label` (display text such as "Next to Gate 2", max 120) (an empty string or `null` is accepted and stored as empty), `evidence_urls` (array of up to 10 `http(s)` URLs) and `availability` (weekly opening hours, same shape as `PUT /listings/:id/availability`). **If `availability` is omitted the listing is open 24x7**; it can also be set later with `PUT`.
Response `201`: the listing (with `availability`), with `"status": "pending"` (waits for admin review). Sending `status` or `owner_id` → `400`.

### `PATCH /listings/:id`: update your own listing
Owner only (`403` otherwise). Allowed fields: `title`, `address`, `latitude`, `longitude`, `price_per_hour`, `is_active` (+ `description`, `rules`, `vehicle_type`, `location_label`, `evidence_urls`). `location_verified` and `location_updated_at` can never be set by a client. Sending `status` is rejected (`400`).
**Re-review rules (enforced in the database):** changing `address`, `latitude` or `longitude` of an **approved** listing sends it back to `pending` (not bookable until re-approved). Editing the content of a **rejected** listing resubmits it (`pending`; the admin's `review_note` is kept so the owner sees the feedback). Changing only price/title of an approved listing, or only `is_active`, does not. The response shows the resulting `status`.

### `PUT /listings/:id/location`: save the coordinates the provider picked
Owner only (`403` otherwise). Body: `{ "latitude": 13.0067, "longitude": 80.2206, "address": "optional", "location_label": "optional, max 120" }`. `latitude` and `longitude` are required; ranges are checked (`-90..90`, `-180..180`) and `0,0` is rejected. Anything else in the body → `400`.
Response `200`: the listing. The database stamps `location_updated_at` and sets `location_verified = false`; if the listing was **approved** it goes back to `pending` (the response shows it), because a moved location needs a new review. Changing only `location_label` keeps the verification. An admin approving the listing sets `location_verified = true`.

### `GET /listings/:id/availability-check?start=&end=`: can I book this window?
Public (an owner/admin token is optional; pending/rejected listings stay `404` for everyone else). `start`/`end` follow the same rules as a booking (ISO with timezone, end after start, not in the past, at most 24 h; otherwise `400`).
```json
{ "data": { "listing_id": "uuid", "start_time": "2026-11-05T09:00:00.000Z", "end_time": "2026-11-05T11:00:00.000Z",
            "available": false, "reason": "SLOT_TAKEN", "message": "Slot already booked", "estimated_total_price": null } }
```
`available: true` comes with `reason: null` and `estimated_total_price`. Reasons are the same as in the booking table below. This is a read-only hint: `POST /bookings` checks again and is the authority.

## Photos
Photos are stored in a **private** Supabase Storage bucket (`listing-photos`); metadata is in its own table. Only the backend touches either. The server **strips EXIF/GPS, XMP, IPTC and comments** from every upload before storing it (only the rotation flag is kept so phone photos stay upright). Embedded metadata is never used as proof of ownership or of where the photo was taken.

### `POST /listings/:id/photos`: upload one photo
Owner only. Send the **raw file as the request body** (not multipart): `Content-Type: image/jpeg` or `image/png`, max 5 MB, at least 200×200 px, max 10 photos per listing. Optional query params, sent from the browser's location permission (never read from the file): `capture_latitude` + `capture_longitude` (both or neither) and `captured_at` (ISO time, not in the future).
```js
await fetch(`${API}/listings/${id}/photos?capture_latitude=13.0067&capture_longitude=80.2206`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type }, body: file });
```
Response `201`: `{ id, listing_id, url, is_primary, uploaded_at, review_status: "pending", review_note, captured_at, capture_latitude, capture_longitude, content_type, size_bytes, distance_from_listing_m }`. The first photo becomes the main one. New photos are always `pending` until an admin approves them. `distance_from_listing_m` is a hint for the reviewer, not proof.

### `GET /listings/:id/photos`
Consumers (and anonymous users) get **approved photos only**: `[{ id, url, is_primary, uploaded_at }]`, main photo first. Owner/admin get every photo with the review and capture fields above. `url` is a signed link that expires after about an hour (`PHOTO_URL_TTL_SECONDS`).

### `PATCH /listings/:id/photos/:photoId`: choose the main photo
Owner only. Body exactly `{ "is_primary": true }`. A rejected photo cannot be the main photo (`400`).

### `DELETE /listings/:id/photos/:photoId`
Owner only. Removes the row and the stored file. If it was the main photo, the next best photo is promoted.

## Bookings

### `POST /bookings`: book a listing
Request:
```json
{ "listing_id": "uuid", "start_time": "2026-10-25T09:00:00Z", "end_time": "2026-10-25T11:00:00Z" }
```
Response `201`: the booking with `"status": "confirmed"`, `"payment_status": "unpaid"` and a `total_price` calculated by the database (`price_per_hour × hours`, rounded to 2 decimals). Any price/status/payment/user sent by the client is ignored. Bookings confirm instantly.
**The server re-checks everything right before inserting** (it does not trust an earlier availability answer). Errors: `400` invalid times (end not after start, in the past, longer than 24 h, bad format), `403` you cannot book your own listing, `404` listing not found, `422` listing not bookable, `409` slot already taken (including when two requests arrive at the same moment: exactly one wins).

| HTTP | `code` | `reason` | Meaning |
|---|---|---|---|
| 404 | `NOT_FOUND` | `LISTING_NOT_FOUND` | No such listing |
| 422 | `LISTING_NOT_BOOKABLE` | `LISTING_NOT_APPROVED` | Pending or rejected listing |
| 422 | `LISTING_NOT_BOOKABLE` | `LISTING_PAUSED` | Owner paused it (`is_active = false`) |
| 403 | `FORBIDDEN` | `OWN_LISTING` | You cannot book your own listing |
| 422 | `LISTING_NOT_BOOKABLE` | `OUTSIDE_AVAILABLE_HOURS` | Outside the weekly opening hours (Asia/Kolkata) |
| 409 | `BOOKING_CONFLICT` | `SLOT_TAKEN` | Overlaps a confirmed booking (back-to-back is fine) |

**Booking state and payment state are separate.** `status` is the reservation (`confirmed` / `cancelled`). `payment_status` is the money side (`unpaid` / `pending` / `paid` / `failed` / `refunded`). Every new booking is `unpaid`; cancelling never rewrites `payment_status`. No payment provider is connected yet.

### `GET /bookings/:id`: one booking
Allowed for the person who booked it (response has `user_id`), the owner of that listing (response has `consumer: { display_name }` instead) and admins. Everyone else gets `404`. Fields: `id, listing_id, start_time, end_time, total_price, status, payment_status, created_at, listing: { title, address }`.

### `GET /bookings/mine`: my bookings
Optional `?status=confirmed|cancelled`. Each item includes `payment_status` and `listing: { title, address }`.

## Provider

### `GET /provider/bookings`: reservations on my listings
Optional `?listing_id=`. Each item includes `consumer: { display_name }`, the times, `status`, `payment_status` and `total_price`.

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
| `GET /listings/mine` | Logged in | All my listings, any status. Each listing also has `photos`: **all** its photos (pending and rejected too), main photo first, as `[{ id, url, is_primary, uploaded_at, review_status, review_note, ... }]` (same fields as `GET /listings/:id/photos` for the owner), or `[]`. `url` is a signed link that expires after about an hour. If photo storage is down, `photos` is `[]` and the listings still load. |
| `PUT /listings/:id/availability` | Owner | Body `{ "windows": [ { "day_of_week": 0-6 (0 = Sunday), "open_time": "HH:MM", "close_time": "HH:MM" } ] }` replaces the weekly opening hours (Asia/Kolkata). `[]` = open 24x7. A booking must fit inside one window on one day. |
| `GET /admin/listings?status=pending` | Admin | Review queue. |
| `GET /admin/photos?status=pending&listing_id=` | Admin | Photo review queue (max 100), each with a signed `url`, capture data, `distance_from_listing_m` and `listing: { id, title, address, latitude, longitude }`. |
| `PATCH /admin/photos/:id/review` | Admin | Body `{ "decision": "approved" \| "rejected", "review_note": "optional" }`. Rejecting the main photo promotes another one. |
| `DELETE /admin/photos/:id` | Admin | Removes an abusive photo and its file. |
| `GET /api/me` | Logged in | See **Account** below (now also returns the deletion fields) |

## Account (`/me`)

| Endpoint | Access | Notes |
|---|---|---|
| `GET /me` | Logged in | `{ data: { id, full_name, phone, is_admin, email, deletion_requested_at, deletion_scheduled_for } }`. The two deletion fields are `null` unless the account is waiting for deletion; the app shows "Your account will be deleted on <date>. Restore it?" when they are set. |
| `GET /me/export` | Logged in | `{ data: { exported_at, profile, listings, availability, photos, bookings, bookings_on_my_listings } }`. Photo files and storage paths are not included (metadata only); other people appear only by display name. |
| `POST /me/deletion-request` | Logged in + **fresh login** | Body `{ "confirm": "DELETE" }`. Pauses my active listings and starts the waiting time (`DELETION_GRACE_DAYS`, default 30). `200 { data: { deletion_requested_at, deletion_scheduled_for } }`. Calling it again changes nothing. `409 ACCOUNT_HAS_ACTIVE_BOOKINGS` while others have upcoming bookings on my listings. |
| `DELETE /me/deletion-request` | Logged in | Cancels the request and switches back on exactly the listings it paused. `200 { data: { restored: true } }` (`false` when there was nothing to cancel). |
| `DELETE /me` | Logged in + **fresh login** | Body `{ "confirm": "DELETE" }`. Deletes the account right now. `200 { data: { deleted: true } }`. `409 ACCOUNT_HAS_ACTIVE_BOOKINGS`, `503 NOT_CONFIGURED` (no service-role key). |

**Fresh login:** the token's sign-in time must be within `REAUTH_WINDOW_SECONDS` (default 300). Otherwise `401 { code: "REAUTH_REQUIRED" }`: the app asks for the password again (a new sign-in gives a new token) and repeats the call. A frontend that signs the user out on *every* 401 must treat `REAUTH_REQUIRED` differently.

**While an account waits for deletion** every write is refused with `403 { code: "FORBIDDEN", reason: "ACCOUNT_PENDING_DELETION" }`, except `DELETE /me/deletion-request`, `DELETE /me` and `PATCH /bookings/:id/cancel`. Reads still work.

**What deletion does to other people's data:** the user's own bookings are deleted. Bookings that *other* users made on the user's listings are kept; the booking keeps `listing: { title, address, listing_removed: true }` (copied from the deleted listing) and `listing_id` becomes `null`. `GET /bookings/mine` and `GET /bookings/:id` now return `listing.listing_removed` (boolean) next to `title` and `address`.

New status/reason values: `401 REAUTH_REQUIRED`, `403 FORBIDDEN` with `reason: ACCOUNT_PENDING_DELETION`, `409 ACCOUNT_HAS_ACTIVE_BOOKINGS`.

### Parking Rescue flow
1. `POST /bookings` returns `409 BOOKING_CONFLICT` (or `422`).
2. Frontend calls `GET /alternatives` with the same destination and time window plus `exclude_listing_id`.
3. User picks one → `POST /bookings` again. The server re-checks everything; a `409` can happen again.

### Parking Rescue evidence and ranking
`updated_at` and `last_confirmed_at` are separate evidence. `freshness` is `fresh`, `stale`, or `unknown` using a 24-hour window for `updated_at`; `confirmation` is `recent`, `older`, `unconfirmed`, or `unknown` using the same window for `last_confirmed_at`. `confidence` is `supported` only when both are fresh/recent, `limited` when both timestamps are valid but at least one is older, and `unknown` when either timestamp is unavailable, invalid, or future-dated. These labels are evidence summaries, not probabilities or guarantees of availability.

Ranking is deterministic: confidence first, routing-provider distance when present, then lower hourly price, then listing ID. This endpoint currently has no routing-provider distance, so it ranks by confidence and price after eligibility; Haversine distance is used only for the `radius_km` search filter and is not returned as travel distance. Reasons are emitted only when supported by data. `is_demo: true` and the reason `Demo data — not live inventory` identify synthetic listings.

Eligibility is rechecked in the backend: status must be approved, the listing active, and the requested time window free according to confirmed bookings and opening hours. Booking remains authoritative and can still fail if availability changes after this search. The endpoint does not claim live inventory or real-time route data.

## Field names: spec vs real columns (Task A)
| In the task list | Real column | Status |
|---|---|---|
| `latitude`, `longitude` | `listings.latitude`, `listings.longitude` (double precision, range CHECKs) | already existed |
| `address` | `listings.address` | already existed |
| `provider_id` | `listings.owner_id` | already existed; **not duplicated**, API exposes `owner_id` |
| `listing_status` | `listings.status` (`pending` / `approved` / `rejected`) | already existed; API exposes `status`. No `draft` yet |
| `location_label`, `location_verified`, `location_updated_at` | same names | **added** in migration 007 |

## Proposed endpoint names for Task B (confirm with Nilesh)
| Operation | Endpoint |
|---|---|
| Create listing | `POST /listings` (existing) |
| Update listing | `PATCH /listings/:id` (existing) |
| Search listings | `GET /listings` (existing) |
| Get listing details | `GET /listings/:id` (existing, now with photos) |
| Update location | `PUT /listings/:id/location` (new) |
| Check availability | `GET /listings/:id/availability-check` (new; `PUT /listings/:id/availability` is still the owner's weekly hours) |
| Create booking | `POST /bookings` (existing, now re-checks on the server) |

## Notes for the team

- **Frontend:** only the listed fields are guaranteed. Tell the backend owner if you need more before building the screen.
- **Backend:** Postgres `23P01` on insert → `409 BOOKING_CONFLICT`. Postgres `P0001` with message `LISTING_NOT_BOOKABLE` → `422`.
- **CORS:** the API allows the origins listed in `CORS_ORIGINS` (localhost + the Vercel URL + `*.vercel.app` previews).
- **Not in v1:** payments (only the separate `payment_status` field exists, always `unpaid` for now).
- **Backend:** Postgres `PH001` / `PH002` on a photo insert → `403` / `422 PHOTO_LIMIT_REACHED`.
