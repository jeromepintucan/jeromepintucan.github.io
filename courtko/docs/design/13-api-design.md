# 13 — API Design

| Item | Value |
|---|---|
| Document | 13 of 23, CourtKo design package |
| Scope | API principles and conventions, endpoint catalog by surface, full JSON examples for the booking/payment/refund/commission flows, OpenAPI generation and publishing, workload separation |
| Implementation | `apps/api` (Fastify, Node.js 24 LTS); request/response schemas and error codes in `packages/contracts` (Zod); OpenAPI 3.1 generated from Zod |
| Related | [07](07-booking-state-machine.md), [08](08-payment-state-machine.md), [09](09-refund-and-payout-flow.md), [10](10-multi-tenant-architecture.md), [11](11-system-architecture.md), [12](12-database-erd.md) |
| Examples | All ids, names, emails and amounts are **synthetic**. Provider values are **placeholders** |

## 1. Surfaces

| Surface | Base path | Callers | Authentication | DB scope |
|---|---|---|---|---|
| Public | `/v1/public/*` | Web BFF (server components), future native apps | None (anonymous) | `public` |
| Auth | `/v1/auth/*` | All BFFs, native apps | None or session (depending on endpoint) | `public` → `player` |
| Player | `/v1/me/*` | Web BFF, native apps | Session | `player` |
| Business and staff | `/v1/businesses/{businessId}/*` (same routes for owners and staff, permission-gated); helper `/v1/staff/me/memberships` | Business BFF | Session + active membership; MFA for owner/manager roles | `business` |
| Admin | `/v1/admin/*` | Admin BFF only (WAF IP allowlist on `admin.courtko.ph`) | Session + platform role + MFA (15 min idle) | `platform` |
| Webhooks | `/v1/webhooks/{provider}` | Xendit (and `mock` outside production) | Provider verification token | `system` (worker) |

Browsers never call the API directly. Each Next.js app proxies through its BFF (`/api/bff/*`), which holds the
`__Host-` session cookie and forwards an opaque bearer token to the internal ALB.

## 2. Principles and conventions

### 2.1 Versioning

- Major version in the path (`/v1`). Within a major version, changes are additive only: new endpoints, new optional
  request fields, new response fields, new enum values (clients must tolerate unknown values).
- Breaking changes ship as `/v2` with at least 6 months of overlap for external clients (future native apps and partner
  API). Deprecated operations send `Deprecation` and `Sunset` headers plus a `Link` to the migration guide.
- The three web apps deploy in lockstep with the API through the BFF. CI runs `oasdiff` against the published `/v1`
  document and fails on unapproved breaking changes (§5).

### 2.2 Resource and payload style

JSON over HTTPS only; `Content-Type: application/json; charset=utf-8`; camelCase fields; ids are UUID strings (UUIDv7);
status values are the exact snake_case catalog values (`slot_held`, `payment_pending`, ...); nulls are explicit;
request bodies are strict (unknown keys → `422 VALIDATION_FAILED`); default body limit 64 KB. Server-controlled fields
(`businessId`, `status`, money totals, ids) are never accepted from clients (doc 10 §6). Asynchronous operations return
`202 Accepted` with a `Location` header for polling.

### 2.3 Authentication and step-up

| Mechanism | Detail |
|---|---|
| Browser sessions | Opaque 256-bit token in a host-only `__Host-` cookie per surface (Secure, HttpOnly; SameSite Lax for web/business, Strict for admin). The BFF sends it as `Authorization: Bearer`. Stored as SHA-256 in `sessions`. Idle timeout 30 min (admin 15 min), absolute 12 h (player "remember me" 30 days) |
| Native apps (future) | Short-lived access session + refresh token with rotation and reuse detection (`sessions.refresh_family_id`); reuse revokes the family |
| MFA | TOTP (RFC 6238) + hashed recovery codes. Mandatory for platform roles and business owners/managers; optional for players. High-risk permissions (`requires_mfa`) need MFA verified within 15 minutes, otherwise `401 MFA_REQUIRED` with a step-up challenge |
| Response codes | `401 UNAUTHENTICATED` (no or expired session), `401 MFA_REQUIRED`, `403 FORBIDDEN` (authenticated, lacks permission on a visible object), `404 NOT_FOUND` (object not visible, including foreign-tenant objects) |

### 2.4 Errors: RFC 9457 problem details

All errors use `application/problem+json`, with members `type`, `title`, `status`, `detail`, `instance`, plus the
extensions `code`, `correlationId` and `errors[]` (field-level). `type` is a stable URI:
`https://api.courtko.ph/problems/{code-in-kebab-case}`. `detail` never contains secrets, personal data about third
parties, or restriction reasons.

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json
X-Correlation-Id: 01J9Q7X2K3M4N5P6Q7R8S9T0VW

{
  "type": "https://api.courtko.ph/problems/slot-unavailable",
  "title": "Slot unavailable",
  "status": 409,
  "detail": "Court 3 is no longer available from 6:00 PM to 7:00 PM on Fri 9 Oct.",
  "instance": "/v1/me/booking-holds",
  "code": "SLOT_UNAVAILABLE",
  "correlationId": "01J9Q7X2K3M4N5P6Q7R8S9T0VW",
  "errors": [],
  "nextAvailable": [
    { "courtId": "0190f59e-3333-7aaa-8bbb-222233334444", "startsAt": "2026-10-09T11:00:00Z", "endsAt": "2026-10-09T12:00:00Z" },
    { "courtId": "0190f59e-3334-7aaa-8bbb-222233334444", "startsAt": "2026-10-09T10:00:00Z", "endsAt": "2026-10-09T11:00:00Z" }
  ]
}
```

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 (malformed JSON) / 422 (schema or rule) / 428 (missing `If-Match`) | `errors[]` lists `{ "path": "durationMinutes", "message": "Must be a multiple of 60", "code": "multiple_of" }` |
| `UNAUTHENTICATED` | 401 | Missing, expired or revoked session |
| `MFA_REQUIRED` | 401 | Step-up needed; body includes `challengeUrl` |
| `FORBIDDEN` | 403 | Permission missing on a visible object; four-eyes violation |
| `NOT_FOUND` | 404 | Unknown or not visible (never reveals existence) |
| `CONFLICT` | 409 / 412 | Concurrent modification (`412` when `If-Match` does not match; body includes the current `etag`); overlapping agreement; object state conflict |
| `SLOT_UNAVAILABLE` | 409 | Exclusion constraint conflict or slot not offered |
| `HOLD_EXPIRED` | 409 | Hold no longer active |
| `HOLD_LIMIT_REACHED` | 409 | 2 active holds already |
| `BOOKING_NOT_ALLOWED` | 403 | Neutral wording for restrictions ("This booking can't be completed. Contact the venue or CourtKo support.") |
| `QUOTE_EXPIRED` | 409 | Quote hash mismatch or quote past expiry |
| `PROMO_INVALID` | 422 | Unknown, expired, exhausted or not applicable |
| `POLICY_NOT_ACCEPTED` | 422 | Cancellation policy version not accepted, or disclosure hash mismatch |
| `PAYMENT_METHOD_UNAVAILABLE` | 422 | Method disabled for the venue or provider |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Same key, different request |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | Same key still processing; `Retry-After` |
| `RATE_LIMITED` | 429 | `Retry-After` + `RateLimit-*` |
| `PROVIDER_UNAVAILABLE` | 503 | Payment provider circuit open or unreachable; `Retry-After` |
| `OUT_OF_STOCK` | 409 | Requested quantity exceeds available stock |
| `EVENT_FULL` | 409 | No seats (waitlist may be offered: `waitlistAvailable: true`) |
| `INVALID_STATE_TRANSITION` | 409 | Action not allowed from the current status |
| `SUPPORT_MODE_READ_ONLY` | 403 | Mutation attempted in support mode |
| `APPROVAL_REQUIRED` | 403 | Action must go through an approval request; body includes `approvalRequestsUrl` |
| `INTERNAL_ERROR` | 500 | Unexpected failure (added to the brief's list); the correlation id is the support reference |

### 2.5 Pagination

Cursor pagination on every list: `?limit=25&cursor=eyJrIjpb...` (default 25, max 100). The response is
`{ "data": [...], "page": { "nextCursor": "…", "hasMore": true } }`. Cursors are opaque, base64url-encoded,
HMAC-signed keyset positions (last sort values + id); a tampered cursor → `422 VALIDATION_FAILED`. No offset
pagination and no total counts on large collections (dashboards use dedicated summary endpoints).

### 2.6 Idempotency

| Aspect | Rule |
|---|---|
| Required on | `POST` that creates holds, checkouts, payment sessions, cancellations, reschedules, walk-ins, refunds (request and approve), payout retries, manual adjustments, commission agreements and approval decisions, data export/deletion requests, exports. Missing key → `422 VALIDATION_FAILED` |
| Key | Client-generated UUID (8–255 characters) in `Idempotency-Key`, one per user intent (reused on retries of that intent only) |
| Scope | `(principal scope, key)`: `user:{userId}`, `member:{businessId}:{userId}` or `platform:{userId}`, plus the route template. The same key used by two principals does not collide |
| Fingerprint | SHA-256 of method + route template + path parameters + canonical JSON body |
| First request | Row inserted in `idempotency_keys` (`in_progress`, 30 s lease). Single-transaction operations store the final response **in the same transaction** as the state change. Multi-step operations (payment sessions: DB → provider → DB) mark the key `completed` in the final transaction |
| Replay (same key, same fingerprint, completed) | Stored status, headers and body returned with `Idempotent-Replayed: true` |
| Conflict (same key, different fingerprint) | `422 IDEMPOTENCY_KEY_REUSED`; nothing executed |
| Concurrent duplicate | Waits up to 2 s on the key's row lock, then replays; if still running → `409 IDEMPOTENCY_IN_PROGRESS` with `Retry-After: 1` |
| Crash recovery | After lease expiry a retry takes over (compare-and-set on `locked_until`); safe because side effects are also guarded by domain constraints (exclusion, in-flight payment uniqueness, journal idempotency keys, provider idempotency keys) |
| What is stored | 2xx and deterministic 4xx outcomes (`409 SLOT_UNAVAILABLE`, `422` rule failures). **Not stored:** `5xx`, `429`, `503 PROVIDER_UNAVAILABLE`, and `401`/`403` from authentication, so a retry with the same key can succeed |
| Retention | 24 hours (`idempotency.ttl_seconds`); purged by `retention.enforce` |

### 2.7 Filtering and sorting

Allow-listed parameters per endpoint, documented in OpenAPI. Unknown parameters → `422`. Examples:
`GET /v1/businesses/{businessId}/bookings?venueId=…&status=confirmed,checked_in&from=2026-10-01T00:00:00Z&to=2026-10-08T00:00:00Z&sort=-startsAt`.
Rules: `from` is inclusive and `to` exclusive (RFC 3339 UTC); lists of enum values are comma-separated; `sort` takes one
allow-listed field with an optional `-` prefix (the tie-breaker is always `id`); free text `q` is at most 100 characters;
date-range windows are capped at 93 days per request.

### 2.8 Correlation and tracing

`X-Correlation-Id` is accepted when well-formed (UUID or ULID, ≤ 64 characters), otherwise replaced. It is echoed on
every response, included in problem details, logs, audit rows and outbox events. W3C `traceparent`/`tracestate` are
propagated from the BFF through the API, worker and provider calls (OpenTelemetry).

### 2.9 Rate limits

Headers follow the IETF RateLimit header fields draft: `RateLimit-Policy`, `RateLimit-Limit`, `RateLimit-Remaining`,
`RateLimit-Reset`, plus `Retry-After` on `429`. **Initial targets**, to be tuned with load tests:

| Surface / operation | Key | Limit |
|---|---|---|
| Public search, venue and availability reads | IP | 60/min, burst 30 |
| `POST /v1/auth/login` | account + IP | 5 failures per 15 min, then exponential backoff; CAPTCHA only on risk signals |
| `POST /v1/auth/register`, password reset, OTP sends | IP and target | 5/hour per target, 20/hour per IP |
| `POST /v1/me/booking-holds` | user | 10/min (plus the domain limit of 2 active holds) |
| `POST /v1/me/checkouts/{id}/payment-sessions` | checkout | 5/min |
| Player API overall | user | 300/min |
| Business API | business / staff user | 600/min per business (burst 100); 120/min per staff user |
| Walk-ins | business | 60/min |
| Exports | business | 10/hour, 1 concurrent |
| Admin API | platform user | 300/min |
| Webhooks | source IP (WAF) | 600 per 5 min |

### 2.10 Concurrency control: ETag and If-Match

Versioned resources (pricing rules, promotions, venue settings, courts, cancellation policies, roles, commission
agreement drafts, platform settings, feature flags, bookings for staff edits) return a strong
`ETag: "{version}"`. `PUT`/`PATCH` on versioned configuration **requires** `If-Match`: missing → `428` with
`VALIDATION_FAILED`; mismatch → `412` with `CONFLICT` and the current representation's `etag`. Staff booking actions
(reschedule, cancel) accept an optional `If-Match`. `GET` supports `If-None-Match` → `304` (used by checkout polling).

### 2.11 Money, rates and time

| Type | Format | Example |
|---|---|---|
| Money | `{ "amount": <integer minor units>, "currency": "<ISO 4217>" }` | `{ "amount": 41500, "currency": "PHP" }` = ₱415.00 |
| Rate | Integer parts-per-million, named `…Ppm` | `"ratePpm": 50000` = 5% |
| Instant | RFC 3339 UTC with `Z` | `"startsAt": "2026-10-09T10:00:00Z"` (6:00 PM Asia/Manila) |
| Venue-local date | `YYYY-MM-DD` interpreted in the venue's timezone, where documented | `GET …/availability?date=2026-10-09` |
| Timezone | IANA name returned with venue-context resources | `"venueTimezone": "Asia/Manila"` |

Clients format for display (`Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })`; local date/time
labelled with the timezone). The server never sends pre-formatted money strings as the only representation.

### 2.12 Caching headers

Authenticated responses: `Cache-Control: private, no-store`. Public catalog responses without cookies may send
`Cache-Control: public, s-maxage=15, stale-while-revalidate=30` (availability) or `s-maxage=60` (venue details).

## 3. Endpoint catalog

"Idem." = `Idempotency-Key` required. Permissions are the exact codes of the canonical brief. Business routes also
require an active membership in `{businessId}` and, for venue-scoped roles, the target venue in scope.

### 3.1 Public (`/v1/public`, anonymous)

| Method | Path | Purpose | Idem. | Key request → response | Notable errors |
|---|---|---|---|---|---|
| GET | `/v1/public/venues` | Discovery list/map | No | `q`, `psgc`, `near=lat,lng` (3 decimals), `radiusKm` (≤ 25), `date`, `time`, `durationMinutes`, `courtType`, `environment`, `amenities`, `priceMax`, `ratingMin`, `hasEvents`, `sort=distance\|price\|rating` → venue cards (name, cover, city, approx distance, starting rate, rating, available courts, next available time, amenities) | 422 |
| GET | `/v1/public/venues/{venueId}` | Venue details (also `/v1/public/venues/by-slug/{slug}`) | No | → profile, courts, hours, amenities, rules, accepted methods, current policy summary + version id | 404 |
| GET | `/v1/public/venues/{venueId}/availability` | Availability timeline | No | `date` (venue-local), `durationMinutes`, `courtId?` → per court: bookable starts with indicative price, blocked ranges (no occupant identity) | 404, 422 |
| GET | `/v1/public/venues/{venueId}/reviews` | Published reviews | No | cursor → rating, text, reviewer display name, business response | 404 |
| GET | `/v1/public/events`, `/v1/public/events/{eventId}` | Published events | No | filters: `psgc`, `type`, `from`, `to`, `skill` → events with divisions and seats left | 404 |
| GET | `/v1/public/locations` | PSGC lookup | No | `parent`, `level`, `q` → regions/provinces/cities/barangays | 422 |
| GET | `/v1/public/catalog/{kind}` | Reference catalogs | No | `kind` ∈ `amenities`, `court-types`, `event-types`, `payment-methods` | 404 |
| GET | `/v1/public/policies/{policyVersionId}` | Cancellation policy disclosure text | No | → tiers, fee refundability, reschedule rule, `disclosureSha256` | 404 |
| POST | `/v1/public/pricing/calculator` | Commission explainer on `/pricing` (non-binding) | No | `{ base, paymentMethod }` → `{ customerTotal, gatewayFee, commission, venueNet }` using current default rates (placeholder fee values labelled) | 422 |

### 3.2 Auth (`/v1/auth`)

| Method | Path | Purpose | Idem. | Key request → response | Notable errors |
|---|---|---|---|---|---|
| POST | `/v1/auth/register` | Register with email or mobile | No (rate-limited) | `{ email \| phone, password, displayName, consents[] }` → `202` verification sent (same response whether or not the account exists) | 422, 429 |
| POST | `/v1/auth/verify` | Verify email/phone | No | `{ token }` or `{ phone, otp }` → `204` | 422, 429 |
| POST | `/v1/auth/login` | Password login for a surface | No | `{ login, password, surface }` → session (BFF sets cookie) or `{ mfaChallengeId }` | 401, 429 |
| POST | `/v1/auth/mfa/verify` | Complete MFA / step-up | No | `{ challengeId, code \| recoveryCode }` → session with `mfaVerifiedAt` | 401, 429 |
| GET | `/v1/auth/session` | Current session | No | → user, surface, MFA state, support-mode banner data | 401 |
| POST | `/v1/auth/logout`, `/v1/auth/logout-all` | Revoke session(s) | No | → `204` | 401 |
| POST | `/v1/auth/password/forgot`, `/v1/auth/password/reset` | Password reset | No | `{ login }` → `202` (no enumeration); `{ token, newPassword }` → `204` (revokes all sessions) | 422, 429 |
| POST / GET | `/v1/auth/oidc/{provider}/start`, `/v1/auth/oidc/{provider}/callback` | Identity-provider login (Google, Apple, Facebook), PKCE + state + nonce | No | → redirect / session | 401 |
| POST | `/v1/auth/refresh` | Native apps only: rotate refresh token | No | `{ refreshToken }` → new pair; reuse → family revoked | 401 |

### 3.3 Player (`/v1/me`, session)

| Method | Path | Purpose | Idem. | Key request → response | Notable errors |
|---|---|---|---|---|---|
| GET / PATCH | `/v1/me` | Profile | No | display name, names, avatar upload id, self-declared level, visibility | 422 |
| GET / PUT | `/v1/me/preferences`, `/v1/me/notification-preferences`, `/v1/me/consents` | Privacy, location permission state, marketing, cookies, channels | No | Transactional/security categories cannot be disabled | 422 |
| GET / DELETE | `/v1/me/sessions`, `/v1/me/sessions/{sessionId}`; GET `/v1/me/security/login-history` | Devices and login history | No | → device label, surface, last seen, approximate location from IP (city) | 404 |
| POST / DELETE | `/v1/me/security/mfa` | Enroll/disable TOTP | No | → otpauth URI (shown once) / `204` | 401 `MFA_REQUIRED` |
| POST | `/v1/me/booking-holds` | Hold a slot (B01) | **Yes** | `{ venueId, courtId, startsAt, durationMinutes }` → `201` hold (id, expiry) + booking (`slot_held`, code, times, `venueTimezone`, `version`); transaction in doc 07 §5.2 | 409 `SLOT_UNAVAILABLE`, `HOLD_LIMIT_REACHED`; 403 `BOOKING_NOT_ALLOWED`; 422 |
| DELETE | `/v1/me/booking-holds/{holdId}` | Abandon the hold (B03) | No (idempotent by nature) | → `204` | 404, 409 `INVALID_STATE_TRANSITION` |
| POST | `/v1/me/checkouts` | Create checkout and lock the quote | **Yes** | `{ holdIds[], items[], promoCode?, paymentMethod, acceptedPolicyVersionId, acceptedPolicyDisclosureSha256 }` → `201` checkout with quote lines (court booking, add-ons, discounts, VAT-included info line, gateway fee), totals, quote hash and expiry, policy summary; lines stored verbatim in `checkouts.quote_lines` | 409 `HOLD_EXPIRED`, `OUT_OF_STOCK`, `EVENT_FULL`; 422 `PROMO_INVALID`, `POLICY_NOT_ACCEPTED`, `PAYMENT_METHOD_UNAVAILABLE` |
| GET | `/v1/me/checkouts/{checkoutId}` | Status polling | No | `If-None-Match` supported → checkout status, display state (`processing`, `retry_available`, `confirmed`, `expired`, `failed`, `refund_in_progress`), payment, bookings, next action | 404 |
| POST | `/v1/me/checkouts/{checkoutId}/payment-sessions` | Create provider session (B02) | **Yes** | `{ quoteSha256, paymentMethod, savePaymentMethod }` → `201` payment id, attempt, amount, hosted-page redirect URL, shared hold/session expiry (sequence in doc 08 §10.1) | 409 `QUOTE_EXPIRED`, `HOLD_EXPIRED`; 503 `PROVIDER_UNAVAILABLE`; 403 `BOOKING_NOT_ALLOWED` |
| GET | `/v1/me/bookings`, `/v1/me/bookings/{bookingId}` | Bookings across all businesses | No | `status`, `from`, `to` → bookings with venue, court, price snapshot lines, policy, refunds | 404 |
| POST | `/v1/me/bookings/{bookingId}/cancellation-quote` | Refund preview | No | → tier, lines, refund total, signed `quoteToken` valid 5 min (§4.1) | 404, 409 `INVALID_STATE_TRANSITION` |
| POST | `/v1/me/bookings/{bookingId}/cancel` | Cancel (B17/B18) | **Yes** | `{ quoteToken, reason? }` → booking + refund | 409 `CONFLICT` (tier changed: new quote attached), `INVALID_STATE_TRANSITION` |
| POST | `/v1/me/bookings/{bookingId}/reschedule` | Reschedule (B12) | **Yes** | `{ courtId, startsAt }` → equal/lower: booking + refund; higher: top-up checkout | 409 `SLOT_UNAVAILABLE`, `INVALID_STATE_TRANSITION` |
| POST / DELETE | `/v1/me/bookings/{bookingId}/participants`, `…/participants/{participantId}` | Invite participants | No | `{ userId \| inviteHandle }` | 404, 409 |
| GET | `/v1/me/bookings/{bookingId}/receipt`, `…/check-in-token` | Receipt (JSON/PDF); signed QR payload (rotates every 60 s) | No | → receipt lines with provider reference; `{ token, expiresAt }` | 404 |
| POST | `/v1/me/bookings/{bookingId}/review` | Review after a verified completed booking | No | `{ rating, title?, body? }` | 409 (not completed or already reviewed) |
| GET / POST | `/v1/me/orders`, `/v1/me/orders/{orderId}`, `/v1/me/orders/{orderId}/cancel` | Product orders and claim status; cancel before preparation | Cancel: **Yes** | → status, claim code/QR | 409 `INVALID_STATE_TRANSITION` |
| GET / POST / DELETE | `/v1/me/event-registrations`, `…/{registrationId}` | Register (seat held), withdraw | POST/DELETE: **Yes** | `{ eventId, divisionId, teamId? }` → registration `held` + checkout link | 409 `EVENT_FULL` (`waitlistAvailable`), 403 `BOOKING_NOT_ALLOWED` |
| POST | `/v1/me/event-waitlists`, `/v1/me/event-waitlists/{entryId}/accept` | Join waitlist; accept an offer | Accept: **Yes** | → entry / registration `held` | 409 (offer expired) |
| GET | `/v1/me/payments`, `/v1/me/refunds` | Payment and refund records | No | → method (masked), amounts, statuses, provider references | none |
| GET / DELETE | `/v1/me/payment-methods`, `…/{tokenId}` | Saved methods (tokens + masked data only) | No | → brand, last 4, expiry month/year | 404 |
| GET / PUT / DELETE | `/v1/me/favorites`, `/v1/me/favorites/{venueId}` | Favorites | No | | 404 |
| GET | `/v1/me/activity`, `/v1/me/ratings` | Stats (sessions, hours, venues, spend) and ratings with source labels | No | → aggregates by play date | none |
| GET / POST | `/v1/me/notifications`, `…/{notificationId}/read` | In-app inbox | No | cursor | 404 |
| POST | `/v1/me/reports`, `/v1/me/support-cases`, `/v1/me/appeals` | Report content; contact support; appeal a restriction by the neutral reference in its notice | No | → `201` | 422 |
| POST | `/v1/me/data-requests` | Data export or account deletion (DSR) | **Yes** | `{ type: "export" \| "deletion" \| "correction" }` → `202` with due date | 409 (one open request per type) |
| POST | `/v1/me/uploads` | Presigned upload (avatar) | No | `{ purpose, contentType, byteSize, sha256 }` → URL (5 min), upload id | 422 |
| GET | `/v1/staff/me/memberships` | Businesses the caller can act for | No | → business, roles, venue scopes, MFA requirement | none |

### 3.4 Business and staff (`/v1/businesses/{businessId}`)

| Method | Path (relative to `/v1/businesses/{businessId}`) | Purpose | Permission | Idem. | Notable errors |
|---|---|---|---|---|---|
| POST | `/v1/businesses` (absolute) | Create draft business (onboarding) | authenticated user | **Yes** | 422 |
| GET / PATCH | (root: the business itself) | Business profile, policies, booking settings, VAT flags | `business.view` / `business.settings.manage` (`If-Match`) | No | 412, 428 |
| POST | `/verification-submissions` | Submit verification documents | owner | **Yes** | 409 (already pending) |
| GET / POST / PATCH | `/venues`, `/venues/{venueId}`; POST `/venues/{venueId}/publish`; PUT `/venues/{venueId}/operating-hours`; POST/DELETE `/venues/{venueId}/special-hours` | Venues and hours | `venues.manage` | No | 412, 422 (publish needs location) |
| GET / POST / PATCH | `/courts`, `/courts/{courtId}` | Courts | `courts.manage` | No | 412 |
| GET / POST / DELETE | `/court-blocks`, `/court-blocks/{blockId}` | Maintenance and closures | `courts.block` | POST: **Yes** | 409 `CONFLICT` with conflicting holds/bookings; `202` when scheduled via `courts.apply_block` |
| GET / POST / PATCH / DELETE | `/pricing-rules`, `/pricing-rules/{ruleId}`; POST `/pricing/preview` | Pricing rules; quote simulation for a date | `pricing.manage` (`If-Match` on edits) | No | 412, 422 |
| GET / POST / PATCH | `/promotions`, `/promotions/{promotionId}` | Venue-funded promo codes | `promotions.manage` | No | 409 (code exists) |
| GET / PUT | `/settings/cancellation-policy` | Choose a template or publish a new version | `business.settings.manage` | PUT: **Yes** | 422 |
| GET | `/calendar` | Calendar by venue/date (bookings, holds, blocks, events) | `bookings.view` | No | 422 |
| GET | `/bookings`, `/bookings/{bookingId}` | Bookings list and detail | `bookings.view` | No | 404 |
| POST | `/walk-ins` | Walk-in: hold + checkout + payment link to the customer (SMS/email) | `bookings.create_walkin` | **Yes** | 409 `SLOT_UNAVAILABLE`; 403 `BOOKING_NOT_ALLOWED` |
| POST | `/bookings/{bookingId}/check-in` | Check-in by QR token or booking code (B13) | `bookings.check_in` | Optional | 409 (outside window, already checked in) |
| POST | `/bookings/{bookingId}/no-show` | Mark no-show (B16) | `bookings.mark_no_show` | **Yes** | 409 (before grace) |
| POST | `/bookings/{bookingId}/cancel` | Venue-initiated cancellation, full refund incl. fee (B18) | `bookings.cancel` (MFA step-up) | **Yes** | 409 `INVALID_STATE_TRANSITION` |
| POST | `/bookings/{bookingId}/reschedule` | Reschedule on the customer's behalf | `bookings.reschedule` | **Yes** | 409 `SLOT_UNAVAILABLE` |
| GET | `/payments`, `/payments/{paymentId}` | Payment status | `payments.view` | No | 404 |
| POST | `/payments/{paymentId}/status-check` | Trigger a provider re-query (never sets "paid") | `payments.confirm_status` | No (rate-limited 1/min per payment) | 429 |
| GET / POST | `/refunds`, `/refunds/{refundId}`; POST `/refunds/{refundId}/approve`, `/refunds/{refundId}/reject` | Goodwill/exception refunds and approvals | `refunds.request`; `refunds.approve` (MFA, approver ≠ requester) | **Yes** | 403 `FORBIDDEN` (four-eyes), 409 (payment disputed) |
| GET | `/finance/summary`, `/settlements`, `/settlements/{settlementId}`, `/payouts` | Revenue, commission, fees, statements, payouts | `finance.view_summary` / `finance.view_payouts` | No | none |
| GET / POST | `/payout-account` | View / connect or change the payout account (approval + 48 h cooling-off + notification to owners) | `finance.view_payouts` / `finance.manage_payout_account` (owner only, MFA) | POST: **Yes** | 401 `MFA_REQUIRED`, 403 |
| GET / POST | `/reports/{reportType}`, `/exports`, `/exports/{exportId}` | Reports; async export (audited, link valid 15 min) | `reports.view` / `reports.export` | POST: **Yes** | 429 |
| GET / POST / PATCH | `/events`, `/events/{eventId}`; POST `…/publish`, `…/cancel`; GET `…/registrations`; POST `/event-registrations/{registrationId}/check-in` | Events, registrations, check-in | `events.manage`; `events.check_in` | Cancel: **Yes** | 409 |
| GET / POST / PATCH | `/products`, `/products/{productId}`, `/products/{productId}/variants`; POST `/inventory-adjustments` | Catalog and stock | `products.manage`; `inventory.manage` | Adjustments: **Yes** | 422 (negative stock) |
| GET / POST | `/orders`, `/orders/{orderId}/status`, `/orders/{orderId}/claim`, `/orders/{orderId}/cancel` | Fulfilment: preparing, ready, claimed (single claim); venue cancellation (refund) | `orders.fulfill` | Claim/cancel: **Yes** | 409 (already claimed) |
| GET | `/customers`, `/customers/{userId}` | Customer list and history (no contact data) | `customers.view` | No | 404 |
| GET | `/customers/{userId}/contact` | Email/phone (audited) | `customers.view_contact` | No | 404 |
| GET / POST | `/restrictions`, `/restrictions/{restrictionId}/lift` | Restrictions (reason category visible with `restrictions.view`; notes with `restrictions.manage`) | `restrictions.view` / `restrictions.manage` | POST: **Yes** | 422 |
| GET / POST | `/reviews`, `/reviews/{reviewId}/response` | Reviews and replies | `reviews.respond` | No | 409 |
| GET / POST / PATCH / DELETE | `/staff`, `/staff/invitations`, `/staff/{memberId}` | Staff and role assignments (cannot grant permissions the caller does not hold) | `staff.manage` | Invitations: **Yes** | 403 (escalation attempt) |
| GET / POST / PATCH | `/roles`, `/roles/{roleId}` | Custom roles (`finance.manage_payout_account` stays owner-only) | `roles.manage` (`If-Match`) | No | 412, 422 |
| GET | `/audit-logs` | Business audit log | `audit.view` | No | none |
| POST | `/uploads` | Presigned uploads (venue images, verification documents, evidence) | Depends on purpose | No | 422 |

### 3.5 Admin (`/v1/admin`, platform roles + MFA)

| Method | Path (relative to `/v1/admin`) | Purpose | Permission | Idem. | Notable errors |
|---|---|---|---|---|---|
| GET | `/overview` | Platform dashboard: GBV, commission, fees, venue net, failed payments, payout failures, alerts | `platform.overview.view` | No | none |
| GET | `/businesses`, `/businesses/{businessId}` | Businesses and verification queue | `platform.businesses.view` | No | 404 |
| POST | `/businesses/{businessId}/verification-decision` | Approve or reject (reviewer ≠ submitter) | `platform.businesses.verify` | **Yes** | 403 |
| POST | `/businesses/{businessId}/suspension`, `/businesses/{businessId}/reactivation` | Suspend or reactivate (approval request; booking policy `honor_existing` or `cancel_and_refund`) | `platform.businesses.suspend` | **Yes** | 403 `APPROVAL_REQUIRED` |
| GET / POST | `/venues`, `/venues/{venueId}/moderation` | Listing moderation | `platform.venues.moderate` | POST: **Yes** | none |
| GET / POST | `/users`, `/users/{userId}`, `/users/{userId}/suspension` | Users | `platform.users.view` / `platform.users.suspend` | POST: **Yes** | none |
| GET | `/bookings` | All bookings | `platform.bookings.view` | No | none |
| GET | `/transactions`, `/ledger/journals/{journalId}` | Payments, refunds, journals | `platform.transactions.view` | No | none |
| POST / GET | `/reconciliation-runs`, `/reconciliation-exceptions`, `/reconciliation-exceptions/{exceptionId}/resolve` | Run and resolve reconciliation | `platform.reconciliation.run` | **Yes** | 409 (run in progress) |
| GET / POST | `/commission-agreements`, `/commission-agreements/{agreementId}` | Create a draft plus approval request (§4.3) | `platform.commissions.manage` | **Yes** | 409 `CONFLICT` (overlap) |
| GET / POST | `/fee-schedules` | Gateway fee schedules (maker-checker) | `platform.config.manage` | **Yes** | 409 (overlap) |
| GET / POST | `/approval-requests`, `/approval-requests/{approvalRequestId}/approve`, `…/reject` | Maker-checker decisions (approver ≠ requester, payload hash confirmed) | Permission named in the request | **Yes** | 403 `FORBIDDEN`, 412 |
| GET / POST | `/payouts`, `/payouts/{payoutId}/retry`, `/manual-adjustments` | Payouts, retries, adjustments (approval) | `platform.payouts.manage` | **Yes** | 403 `APPROVAL_REQUIRED` |
| GET / POST | `/refunds`, `/refunds/{refundId}/approve` | Refunds above ₱5,000.00 or after payout | `platform.refunds.approve` | **Yes** | 403 |
| GET / POST | `/disputes`, `/disputes/{disputeId}/evidence`, `/disputes/{disputeId}/resolution` | Dispute ingestion (manual), evidence, outcome | `platform.disputes.manage` | **Yes** | 409 |
| GET / POST | `/reports/{reportType}`, `/exports` | Platform reports and exports (audited) | `platform.reports.view` / `platform.reports.export` | Exports: **Yes** | 429 |
| GET / POST | `/moderation/reports`, `/moderation/reports/{reportId}/actions` | Moderation queue | `platform.moderation.manage` | **Yes** | none |
| GET / POST | `/restrictions`, `/restrictions/{restrictionId}/lift` | Platform-level restrictions | `platform.restrictions.manage` | **Yes** | none |
| POST / DELETE | `/support-sessions`, `/support-sessions/{sessionId}` | Start/end support mode (reason ≥ 15 chars, ticket, 30 min max, read-only) | `platform.support.impersonate` | POST: **Yes** | 403, 422 |
| GET | `/security-events`, `/audit-logs` | Security and audit views | `platform.security.view` / `platform.audit.view` | No | none |
| GET / PATCH / POST | `/config/settings/{key}`, `/config/feature-flags/{key}`, `/config/catalog/{kind}` | Platform configuration and catalogs | `platform.config.manage` (`If-Match`) | No | 412 |
| GET / POST | `/promotions` | Platform-funded promotions | `platform.promotions.manage` | **Yes** | 409 |
| GET / POST | `/data-subject-requests`, `/data-subject-requests/{requestId}/complete` | Privacy requests | `platform.privacy.requests` | **Yes** | none |

### 3.6 Webhooks

| Method | Path | Purpose | Auth | Notes |
|---|---|---|---|---|
| POST | `/v1/webhooks/xendit` | Payment, session, refund, split, payout events | `x-callback-token` (constant-time compare) | Persist + `200` fast; worker re-queries (doc 08 §4) |
| POST | `/v1/webhooks/mock` | Mock provider events (dev, test, demo) | Shared test token | Disabled in production by configuration and route registration |
| GET | `/health/live`, `/health/ready` | Health (not versioned, internal ALB only) | none | Readiness checks DB and Redis reachability |

## 4. Worked examples

All examples use the canonical booking: one court, 60 minutes, ₱400.00 court fee, 5% commission, and an online-banking convenience fee of ₱15.00 shown to the customer. The convenience fee applies only where pass-through is both allowed and enabled. It is never allowed for QR Ph or cards, and it is OFF by default in production (doc 23, D-05). Amounts are integer centavos. Times are RFC 3339 UTC with a `+08:00` display offset handled by clients. IDs are UUIDv7, shortened here.

### 4.1 Create a hold

```http
POST /v1/me/booking-holds
Idempotency-Key: 5b8a0f7e-5e0c-4c2e-9f59-3f3d1a0b2c11
Content-Type: application/json

{ "venueId": "018f…a1", "courtId": "018f…c3", "startAt": "2026-10-03T10:00:00Z", "durationMinutes": 60 }
```

```http
201 Created
Location: /v1/me/checkouts/018f…k9

{
  "checkoutId": "018f…k9",
  "bookingId": "018f…b7",
  "status": "open",
  "expiresAt": "2026-10-03T02:10:00Z",
  "extensionsRemaining": 1,
  "quote": { "subtotal": 40000, "discount": null, "fee": null, "total": 40000, "currency": "PHP", "quoteVersion": 1 }
}
```

Failure: `409 SLOT_UNAVAILABLE`. It is raised by the `booking_slots` exclusion constraint, not by a pre-read, so two concurrent holds can never both succeed. The response includes `alternatives[]` (nearest free starts on the same or other courts).

### 4.2 Select a payment method and start payment

```http
POST /v1/me/checkouts/018f…k9/payment-sessions
Idempotency-Key: 9e1c…
If-Match: "q-3"

{ "paymentMethod": "online_banking", "acceptPolicyVersion": "standard-v2", "promoCode": null }
```

```http
201 Created

{
  "paymentId": "018f…p2",
  "status": "pending",
  "redirectUrl": "https://checkout.xendit.co/web/…",
  "expiresAt": "2026-10-03T02:10:00Z",
  "quote": {
    "items": [{ "ref": "court", "label": "Court 3 · 60 min", "amount": 40000 }],
    "subtotal": 40000,
    "fee": { "method": "online_banking", "label": "Convenience fee", "customerAmount": 1500, "passThrough": true },
    "total": 41500,
    "commission": { "ratePpm": 50000, "base": 40000, "amount": 2000, "source": "global" },
    "venueNet": 38000,
    "platformRevenue": 3500
  }
}
```

The server recomputes the quote from the stored snapshot. The client never sends amounts. `split = total − venueNet = 3,500` goes to the platform master account and `38,000` goes to the venue sub-account (settlement Option A). The quote is frozen as `pricing_snapshots` row and referenced by `payments.snapshot_id`. Refunds and chargebacks always use this snapshot.

Failures: `409 CHECKOUT_EXPIRED`, `409 PRICE_CHANGED` (a new quote is attached; the client must re-confirm), `412` (stale `If-Match`), `422 PAYMENT_METHOD_UNAVAILABLE`, `503 PROVIDER_UNAVAILABLE` (the hold is kept and the client can retry with the same key).

### 4.3 Return from the provider and poll

Returning to `/checkout/{id}?return=1` **never** marks a payment successful. The client polls:

```http
GET /v1/me/checkouts/018f…k9
```

```json
{ "status": "payment_pending", "payment": { "status": "pending", "lastCheckedAt": "2026-10-03T02:01:12Z" }, "retryAfterSeconds": 2 }
```

The client polls with backoff (2 s, 2 s, 3 s, 5 s, then every 10 s, for up to 2 minutes). After 20 s without a webhook, the server re-queries the provider itself (`GET /v3/payment_requests/{id}`) and applies the result through the same capture path as the webhook. Final states are `confirmed` (with `bookingCode`), `failed` (with a reason, and the hold is kept if time remains) and `expired`.

### 4.4 Cancellation quote, then cancel

```http
GET /v1/me/bookings/018f…b7/cancellation-quote
```

```json
{
  "quoteId": "cq_018f…",
  "policy": "standard",
  "tier": "24h+ before start: 100% court fee",
  "refund": { "court": 40000, "addOns": 0, "fee": 0, "tax": 0, "total": 40000 },
  "nonRefundable": [{ "label": "Convenience fee", "amount": 1500 }],
  "validUntil": "2026-10-02T10:00:00Z"
}
```

```http
POST /v1/me/bookings/018f…b7/cancellation
Idempotency-Key: …

{ "quoteId": "cq_018f…", "reason": "schedule_conflict" }
```

The response is `200` with `{ "booking": { "status": "refund_pending" }, "refund": { "id": "…", "amount": 40000, "status": "submitted" } }`. The refund is proportional: commission and venue share are reversed pro rata (doc 09 §3). If the tier changed since the quote was issued, the server returns `409 QUOTE_EXPIRED` with a fresh quote.

### 4.5 Inbound webhook

```http
POST /v1/webhooks/xendit
x-callback-token: ••••••••
webhook-id: evt_…

{ "event": "payment.succeeded", "data": { "id": "pr-…", "reference_id": "018f…p2", "amount": 41500, "currency": "PHP", "status": "SUCCEEDED" } }
```

Processing steps:

1. Compare the token in constant time. On mismatch, return `401` and record a `webhook_rejected` security event.
2. Insert into `webhook_events` with a unique `(provider, event_id)`. Duplicates return `200` with no side effects.
3. Return `200` within 300 ms.
4. The worker re-queries the provider for the authoritative status and amount, then runs `capture` in one transaction: payment → `captured`, booking → `confirmed`, ledger journal (doc 09 §2), outbox notification.
5. If the amount differs from the snapshot total, the worker raises `payment_amount_mismatch`, does not confirm the booking and opens a reconciliation exception.

### 4.6 Commission change (maker-checker)

```http
POST /v1/admin/commission-agreements
Idempotency-Key: …

{ "businessId": "018f…", "ratePpm": 40000, "base": "court_and_addons_ex_tax", "effectiveFrom": "2026-11-01", "reason": "Launch partner, 12-month agreement" }
```

```http
202 Accepted
{ "agreementId": "…", "status": "pending_approval", "approvalRequestId": "ar_…", "payloadHash": "sha256:4c1f…" }
```

```http
POST /v1/admin/approval-requests/ar_…/approve
Idempotency-Key: …
{ "payloadHash": "sha256:4c1f…", "comment": "Matches signed agreement" }
```

Rules:

- The approver must differ from the requester (`403 FORBIDDEN` otherwise) and must hold `platform.commissions.manage` with fresh MFA.
- A payload-hash mismatch returns `412`.
- The new rate applies only to quotes created on or after `effectiveFrom`. Existing snapshots are never repriced.

## 5. OpenAPI and contracts

- The source of truth is Zod schemas in `packages/contracts`. `@asteasolutions/zod-to-openapi` generates `openapi.yaml` (OpenAPI 3.1) in CI.
- CI fails if the generated spec differs from the committed spec, or if the breaking-change check (`oasdiff breaking`) reports changes to a released version.
- Every operation declares: `operationId`, required permission (`x-permission`), idempotency requirement (`x-idempotent`), rate-limit class (`x-rate-limit`) and the error codes it can return.
- The same schemas validate requests at the API (Fastify type provider) and type the web clients. Clients never hand-write response types.
- The spec is served at `/v1/openapi.json` in non-production environments only. Partner-facing documentation is generated from a filtered copy that excludes `/v1/admin` and internal routes.

## 6. Workload separation

| Workload | Runs in | Why separate |
|---|---|---|
| Public read API (search, venue detail, availability) | `api` service, read replica, CDN cache 30 s (availability `no-store`) | Spiky, anonymous, cacheable |
| Transactional API (holds, checkout, bookings, staff ops, admin) | `api` service, primary DB | Needs strong consistency and idempotency |
| Webhook ingress | `api` service, dedicated route group and rate-limit class | Must acknowledge fast even under load. Persist-then-process |
| Background jobs (hold expiry, reconciliation, payouts, reminders, exports, retention) | `worker` service (pg-boss) | Retries, schedules and long-running work off the request path |
| Reports and exports | `worker` plus reporting views on the read replica | Heavy queries never touch the primary during peak |

## 7. Deprecation policy

- A breaking change creates `/v2` for the affected resources only.
- `/v1` stays available for at least 6 months after `/v2` is released, with `Deprecation` and `Sunset` headers (RFC 8594) and a changelog entry.
- Mobile clients report their version (`X-Client-Version`). The API can return `426` with an upgrade prompt for versions below the supported minimum.

