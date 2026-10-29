# ParkMate API Contract (v1)

Base path: `/api`. REST + JSON, built with Node + Express.
Database details: [`schema.md`](./schema.md).

## Conventions (everyone follows these)

- **Login:** send the Supabase access token on protected routes: `Authorization: Bearer <token>`
- **Times:** ISO 8601 in UTC, e.g. `2026-10-25T09:00:00Z`
- **Money:** INR, numbers (e.g. `40.00`)
- **Success:** `{ "data": ... }`
- **Error:** `{ "error": { "code": "BOOKING_CONFLICT", "message": "Slot already booked" } }`
- The server **never** trusts user ids from the request body. It takes them from the login token.

| Status | `code` | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad or missing input (e.g. end before start) |
| 401 | `UNAUTHENTICATED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Logged in but not allowed (not owner / not admin) |
| 404 | `NOT_FOUND` | Doesn't exist, or you can't see it |
| 409 | `BOOKING_CONFLICT` | That time slot overlaps an existing booking |
| 422 | `LISTING_NOT_BOOKABLE` | Listing is not approved, or is paused |

## Who can call what

| Endpoint | Access |
|---|---|
| `GET /health` | Public (already working) |
| `GET /listings`, `GET /listings/:id` | Public |
| `POST /listings`, `PATCH /listings/:id` | Logged in (PATCH: owner only) |
| `POST /bookings`, `GET /bookings/mine` | Logged in |
| `GET /provider/bookings` | Logged in (sees only bookings on their own listings) |
| `PATCH /admin/listings/:id/review` | Admin only |

---

## Listings

### `GET /listings`: search approved listings
Query params (all optional): `query`, `vehicle_type`, `max_price`, `lat`, `lng`, `max_distance_km`, `start`, `end`, `sort` (`recommended` | `price` | `distance`).
- `start` + `end`: only return listings free for that whole window.
- `lat` + `lng`: adds Haversine straight-line `distance_km` to each search result; this is not routing distance or travel time.
- If an exact search returns no rows and the request includes coordinates plus a valid `start`/`end` window, the backend automatically runs Parking Rescue on approved, active listings free for that window. It retains `vehicle_type`, relaxes the text and maximum-price filters, and limits candidates to 5 km unless `max_distance_km` is provided. It returns up to five results ranked by qualitative freshness/confirmation evidence, then price. Fallback rows include `search_fallback`, `recommendation_reasons`, `confidence`, `freshness`, and `confirmation`. Haversine distance is used only as a radius filter and is not returned as a route-distance claim. Without coordinates or a time window, no fallback is attempted.

```json
{ "data": [ {
  "id": "uuid", "title": "Guindy Metro Lot", "address": "...",
  "latitude": 13.0067, "longitude": 80.2206,
  "price_per_hour": 40, "distance_km": 2.4
} ] }
```

### `GET /listings/:id`: listing details
Anyone can view approved listings. The owner can also view their own pending/rejected ones. Otherwise `404`.

### `POST /listings`: create a listing
Request:
```json
{ "title": "Guindy Metro Lot", "address": "...", "latitude": 13.0067, "longitude": 80.2206, "price_per_hour": 40 }
```
Response `201`: the listing, with `"status": "pending"` (waits for admin review).

### `PATCH /listings/:id`: update your own listing
Owner only (`403` otherwise). Allowed fields: `title`, `address`, `latitude`, `longitude`, `price_per_hour`, `is_active`. Sending `status` is rejected (`400`).

### `GET /alternatives`: Parking Rescue
Requires login and `lat`, `lng`, `start`, `end`; optional `exclude_listing_id`, `max_price`, and `radius_km` (default 5). Backend independently requires approved, active listings that are free for the full requested time window, excludes the caller's own listings, and returns at most five alternatives. Each item contains a `listing` with eligibility fields, `updated_at`, `last_confirmed_at`, `is_demo`, `confidence`, `freshness`, and `confirmation`, plus data-supported `reasons`. The Haversine `radius_km` filter is not returned as route distance. `is_demo: true` identifies demo data. Results may be empty; booking rechecks availability authoritatively and can still fail if a slot was taken after search.

Freshness is based on `updated_at`; provider confirmation is based on `last_confirmed_at`. Both use a documented 24-hour evidence window. `confidence` is qualitative, not a probability.

## Bookings

### `POST /bookings`: book a listing
Request:
```json
{ "listing_id": "uuid", "start_time": "2026-10-25T09:00:00Z", "end_time": "2026-10-25T11:00:00Z" }
```
Response `201`: the booking with `"status": "confirmed"` and a calculated `total_price`. Bookings confirm instantly.
Errors: `400` invalid times (end not after start, or in the past), `404` listing not found, `422` listing not bookable, `409` slot already taken.

### `GET /bookings/mine`: my bookings
Optional `?status=confirmed|cancelled`. Each item includes `listing: { title, address }`.

## Provider

### `GET /provider/bookings`: reservations on my listings
Optional `?listing_id=`. Each item includes `consumer: { display_name }`, the times, `status` and `total_price`.

## Review

### `PATCH /admin/listings/:id/review`: approve or reject
Admin only (`403` otherwise). Request:
```json
{ "decision": "approved" }
```
`decision` is `approved` or `rejected`. Response: the updated listing.

---

## Notes for the team

- **Frontend:** only the listed fields are guaranteed. Tell the backend owner if you need more before building the screen.
- **Backend:** when Postgres returns error code `23P01` on insert, return `409 BOOKING_CONFLICT`. When it raises `LISTING_NOT_BOOKABLE`, return `422`.
- **Not in v1:** cancelling a booking (`PATCH /bookings/:id/cancel`) and payments.
