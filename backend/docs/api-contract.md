# ParkMate API Contract (v1)

Base path: `/api`. REST + JSON, built with Node + Express.
Database details: [`schema.md`](./schema.md).

## Conventions (everyone follows these)

- **Login:** send the Supabase access token on protected routes: `Authorization: Bearer <token>`
- **Times:** ISO 8601 in UTC **with timezone**, e.g. `2026-10-25T09:00:00Z` (a time without `Z`/offset is rejected)
- **Money:** INR, numbers (e.g. `40.00`)
- **Success:** `{ "data": ... }`
- **Error:** `{ "error": { "code": "BOOKING_CONFLICT", "message": "Slot already booked" } }`
- The server **never** trusts user ids from the request body. It takes them from the login token.
- **Health** is the one exception: it returns a flat `{ "status", "db" }` (no `data` wrapper) and is served at both `/health` and `/api/health` until the team picks one.

| Status | `code` | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad or missing input (e.g. end before start) |
| 401 | `UNAUTHENTICATED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Logged in but not allowed (not owner / not admin) |
| 404 | `NOT_FOUND` | Doesn't exist, or you can't see it |
| 409 | `BOOKING_CONFLICT` | That time slot overlaps an existing booking |
| 422 | `LISTING_NOT_BOOKABLE` | Listing is not approved, is paused, or the time is outside its opening hours |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
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

---

## Health

### `GET /health` and `GET /api/health`
- DB connected: `200 { "status": "ok", "db": "up", "time": "..." }`
- DB unreachable: `503 { "status": "error", "db": "down", "time": "..." }`

## Listings

### `GET /listings`: search approved listings
Only `approved` **and** `is_active` listings are returned. Query params (all optional): `max_price`, `lat`, `lng`, `max_distance_km`, `start`, `end`, `sort` (`recommended` | `price` | `distance`).
- `start` + `end` (both or neither): only return listings with no overlapping booking and inside their opening hours.
- `lat` + `lng` (both or neither): adds `distance_km` to each result. Required for `sort=distance`, `sort=recommended` and `max_distance_km` (`400` otherwise).
- Default sort: `recommended` when `lat`/`lng` are given (cheap + close), otherwise `price`. Max 100 results.

```json
{ "data": [ {
  "id": "uuid", "title": "Guindy Metro Lot", "address": "...",
  "latitude": 13.0067, "longitude": 80.2206,
  "price_per_hour": 40, "distance_km": 2.4,
  "last_confirmed_at": "2026-10-24T09:00:00Z", "is_demo": false
} ] }
```
(`distance_km` is omitted when `lat`/`lng` were not sent; `last_confirmed_at` can be `null`.)

### `GET /listings/:id`: listing details
Anyone can view approved listings. The owner (and admin) can also view pending/rejected ones. Otherwise `404`.
Fields: `id, title, description, rules, address, latitude, longitude, price_per_hour, vehicle_type, is_active, status, last_confirmed_at, is_demo, availability: [{day_of_week, open_time, close_time}]` (+ `owner_id`, `review_note`, `evidence_urls` for owner/admin).
A missing, invalid or expired token on this public route is ignored (treated as anonymous) instead of returning `401`.
`last_confirmed_at` = when the owner last confirmed the spot is available (freshness); `is_demo = true` means demonstration data and **must be labelled as such in the UI**.

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
Errors: `400` invalid times (end not after start, in the past, longer than 24 h, bad format), `403` you cannot book your own listing, `404` listing not found, `422` listing not bookable, `409` slot already taken (including when two requests arrive at the same moment: exactly one wins).

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
| `GET /alternatives` | Logged in | Parking Rescue. Query: `lat, lng, start, end` (required), `exclude_listing_id`, `max_price`, `radius_km` (default 5). Never includes the caller's own listings. Returns `{ "data": [ { "listing": {id,title,address,latitude,longitude,price_per_hour,last_confirmed_at,is_demo}, "distance_km": 0.8, "reasons": ["Free for your whole time window", "Availability confirmed by the owner in the last 7 days", ...] } ] }`, closest first, max 10, may be empty. Freshness reasons: confirmed ≤ 7 days ago, or "Owner has not confirmed availability recently" (> 30 days / never). |
| `POST /listings/:id/confirm` | Owner | "This spot is still available": sets `last_confirmed_at = now`. Returns the listing. `403` if not the owner. |
| `GET /listings/mine` | Logged in | All my listings, any status. |
| `PUT /listings/:id/availability` | Owner | Body `{ "windows": [ { "day_of_week": 0-6 (0 = Sunday), "open_time": "HH:MM", "close_time": "HH:MM" } ] }` replaces the weekly opening hours (Asia/Kolkata). `[]` = open 24x7. A booking must fit inside one window on one day. |
| `GET /admin/listings?status=pending` | Admin | Review queue. |
| `GET /api/me` | Logged in | `{ data: { id, full_name, phone, is_admin, email } }` |

### Parking Rescue flow
1. `POST /bookings` returns `409 BOOKING_CONFLICT` (or `422`).
2. Frontend calls `GET /alternatives` with the same destination and time window plus `exclude_listing_id`.
3. User picks one → `POST /bookings` again. The server re-checks everything; a `409` can happen again.

## Notes for the team

- **Frontend:** only the listed fields are guaranteed. Tell the backend owner if you need more before building the screen.
- **Backend:** Postgres `23P01` on insert → `409 BOOKING_CONFLICT`. Postgres `P0001` with message `LISTING_NOT_BOOKABLE` → `422`.
- **CORS:** the API allows the origins listed in `CORS_ORIGINS` (localhost + the Vercel URL + `*.vercel.app` previews).
- **Not in v1:** payments.
