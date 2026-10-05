# 24 — Change Impact Analysis: Multi-Sport, Open Play, Attendance, Social Profiles

| Field | Value |
|---|---|
| Document | 24 — Change request CR-01 impact analysis (pre-implementation) |
| Status | **Approved by the product owner (2026-10-06) and implemented in the interactive demo.** Production work is planned in §10 |
| Scope received | Sections 1–6 in full, Section 7 (Social Player Profiles) up to "Blocking another user must: … Not automatically" (cut off), plus a **My Sports dashboard on the player profile** (added 2026-10-06) |
| Not yet received | The rest of section 7, plus any sections 8+. The demo uses the Q1 default for blocking (§12) |
| Related | [01 PRD](01-product-requirements.md) · [03 Roles](03-role-permission-matrix.md) · [07 Booking SM](07-booking-state-machine.md) · [12 ERD](12-database-erd.md) · [13 API](13-api-design.md) · [14 Threats](14-security-threat-model.md) · [15 Privacy](15-privacy-data-retention-matrix.md) · [23 Decisions](23-assumptions-and-decisions.md) |

CR-01 adds to the existing specification and replaces none of it. Security, payments, receipts, commission, refunds, settlements, privacy, audit, accessibility, testing and tenant isolation all stay in force. Every new money flow reuses the existing checkout → payment → ledger → refund pipeline, and every new tenant-owned table gets `business_id` plus RLS.

---

## 1. Proposed design decisions

These decisions shape everything below. Each one needs product-owner sign-off before code changes begin.

| ID | Decision | Rationale |
|---|---|---|
| CR-D01 | **Sport catalog as platform reference data.** A `sports` table managed by SuperAdmin with stable codes `pickleball`, `basketball`, `volleyball`, `tennis`. Exactly these four are seeded and `active`. UI, filters, validation and seeds read from the catalog. No sport code appears in shared component code. | Meets "no scattered hard-coded values". Adding a fifth sport later is configuration plus a format template, not code. Launch scope is enforced by a test that asserts exactly four active sports. |
| CR-D02 | **Formats are templates per sport.** `sport_formats` (platform-managed) define registration mode (individual / partner / team), team size range, players per side, and whether the format applies to bookings, Open Play or both. A venue's custom format must reference one of its sport's allowed modes and stay within the sport's min/max players. | "Do not assume singles/doubles". Compatibility is validated server-side by checking that the format belongs to the sport. |
| CR-D03 | **Physical space model for court dependencies.** Each venue defines **space units**, the smallest physically separable areas (e.g. basketball half A and half B). A bookable **court configuration** (e.g. "Full court – Basketball", "Half court A", "Volleyball court") maps to one or more units. A booking writes one `booking_slots` row **per occupied unit** in one transaction. The exclusion constraint moves from `court_id` to `space_unit_id`. | Keeps the database-enforced no-double-booking guarantee (doc 07 I1). A full court automatically blocks both halves, a half blocks the full court, and a multi-use basketball/volleyball floor can't be booked for both sports at once, because they share units. A tennis court with two pickleball overlays = units {T-a, T-b}: tennis takes both, each pickleball court takes one. |
| CR-D04 | **Conversion/changeover buffer.** When adjacent occupancies on the same unit use different configurations (e.g. tennis → pickleball nets), a venue-configured changeover time applies. It is enforced in the hold transaction under a per-unit row lock (`SELECT … FOR UPDATE` on `space_units`), because a static exclusion range can't express "buffer only if the sport differs". | Server-side conflict rule required by §2. Documented as a second guard next to the exclusion constraint. |
| CR-D05 | **Bookings carry sport and configuration.** `bookings.sport_code` and `bookings.court_configuration_id` are stored in the price snapshot. Pricing rules gain optional `sport_code` and `configuration_id` conditions, giving sport-specific rates with the existing priority → specificity winner logic. | Confirmed bookings keep their snapshot (existing invariant I5). |
| CR-D06 | **Open Play becomes a dedicated entity** (`open_play_sessions`), no longer an `event_type`. It reuses `checkouts` (new kind `open_play_registration`), payments, the ledger, refunds and cancellation policies. It reserves courts through `booking_slots` (new occupant type `open_play`). The existing `open_play` event type is retired and its rows are migrated. | Open Play needs its own attendance, rotation and live counts. Sharing the money pipeline avoids a second, unaudited payment path. |
| CR-D07 | **Registration and attendance are two separate state axes**, plus an append-only `attendance_events` log. Counts are derived from current states, which are themselves rebuilt from the event log. Registering never implies attending, and checking in never implies being on court. | Directly required by §5. |
| CR-D08 | **Check-in QR is a signed, short-lived, single-purpose token.** Format `OP1.<checkinRef>.<exp>.<kid>.<sig>`. `checkinRef` is a random 128-bit per-registration reference, never the user ID or registration ID, and is re-issued if compromised. `exp` is at most 10 minutes ahead (the app refreshes it) and never later than the late-arrival cutoff. `sig` is HMAC-SHA-256 with a KMS-held key, identified by key ID `kid` for rotation. The server verifies the signature, expiry, session, venue and staff permission, then applies `check_in` idempotently. Duplicate, expired, wrong-session and wrong-venue scans are recorded as `check_in_rejected` events. | Meets every QR requirement in §5. The existing booking QR (`CK1.<bookingId>.<hmac>`) is not time-limited, so CR-01 recommends moving it to the same scheme (`BK1`). Old tokens stay accepted for 30 days. |
| CR-D09 | **Rotation is staff-controlled in the MVP.** The session's strategy (first checked in, first waiting, manual, random, skill-grouped, winner stays, timed) only **suggests** the next group. A staff member confirms each assignment. Automated matchmaking and optimization stay out of scope (P2+). | Matches §6. Suggestions are deterministic and testable. |
| CR-D10 | **Live updates.** Production pushes session counters through Server-Sent Events, fed by the outbox, with a 10-second polling fallback. Every dashboard shows "Last updated hh:mm:ss" and a stale banner after 30 s without an update. The demo uses its existing cross-tab sync. | §5 "last successful update time". |
| CR-D11 | **Social graph is one-directional.** Users get a unique `username` (case-insensitive, 3–20 chars, reserved words blocked). `follows` has states `pending`, `accepted`, `declined`, `cancelled` and `removed`. Profile visibility values change from `private / connections / organizers / public` to `private / followers / organizers / public`. Every read of another person goes through one **public-profile projection** that can never contain contact, payment, restriction, internal-note or audit fields. | §7. A single projection makes the "never expose" list testable in one place. |
| CR-D12 | **Blocking is enforced in the read path.** A block hides profiles in search, lists and suggestions in both directions, and rejects follows and social interactions with `NOT_FOUND`, so it never reveals that a block exists. | The rest of the blocking rules wait for the missing text (see §12, Q1). |

---

## 2. Affected requirements (doc 01)

### 2.1 Modified

| Existing ID | Change |
|---|---|
| Vision, §1–§2, product copy | "Book pickleball courts" becomes sport-neutral: "Book courts and join Open Play for pickleball, basketball, volleyball and tennis". |
| VEN-01 | A venue declares its supported sports (subset of active catalog sports, at least one). |
| VEN-02 | Courts: name/number, supported sports, full/partial, environment, capacity, surface, amenities, equipment, accessibility, operating and maintenance schedule, images, status. Configurations and space units are added (CR-D03). |
| VEN-04 | Booking settings can be overridden per sport (default duration from the sport, increments, changeover buffer). |
| VEN-05 | A court block targets space units. Blocking a full court blocks all its units, and blocking a half blocks the full-court configuration. |
| PRC-01/02 | Rule scope adds sport and configuration (sport-specific rates). PRC-04 simulator takes a sport. PRC-05 snapshot keeps sport and configuration. |
| DSC-05 | Filters add sport, venue, full/partial court, playing surface, Open Play availability. The existing filters (location, date, time, price, environment, amenities, events) stay. |
| DSC-06/07 | Venue cards and pages show sport chips. The venue page adds an Open Play tab. |
| BKG-01/02/04 | Booking flow step 1 is "Choose sport → configuration → time". Availability is computed per configuration from unit occupancy (server-side). BKG-04: a hold inserts one `booking_slots` row per space unit, guarded by the unit-level exclusion constraint. |
| EVT-01 | The `open_play` type is removed from events and replaced by the OPP section. Events gain `sport_code`. |
| EVT-08 | Partner/team invitations are promoted from P2 to MVP **for Open Play** (OPP-05..09). Events keep the P2 timing unless extended. |
| EVT-09 | Match/game recording for Open Play is staff-entered and only when score recording is enabled for that session. |
| PLY-01 | **My Sports dashboard** (added per product-owner request): the activity dashboard is broken down by sport. For each sport the player plays, it shows: games/sessions played, hours on court, bookings vs Open Play, venues played most, last played, upcoming bookings and sessions, skill level with its source, and officially recorded results only (PLY-03). Sports appear automatically after the first completed booking or check-in, and the player can pin, hide or add sports they're interested in. Figures come from server-side completed bookings and attendance events, never from client-side totals. |
| PLY-02 | Skill level is recorded **per sport** (self-declared, labeled with its source). |
| PLY-04 | Visibility values change to private / followers / organizers / public (CR-D11). The "connections P2" note is removed. |
| PLY-07 | Reporting a profile is supported through the existing `ContentReport` with `targetType: 'profile'`. |
| ADM | Adds a Sports catalog screen and format templates (SuperAdmin). |
| RPT | Reports gain a sport dimension: utilization, revenue and Open Play attendance by sport. |
| Out of scope (§9) | Badminton, futsal and other sports: **not in the initial release**. Automated matchmaking and advanced rotation optimization: P2+. |

### 2.2 New requirement groups

| Group | IDs | Summary |
|---|---|---|
| SPT — Sport catalog | SPT-01..08 | Fields from §1 (name, description, icon, status, court configurations, formats, min/max players, default duration, skill levels, Open Play config, match-result config, team/partner requirement). Versioned. Changes are audited. Deactivating a sport hides it from new bookings but never alters existing bookings. |
| CRT — Courts, configurations, dependencies | CRT-01..07 | Space units, configurations, multi-sport compatibility, conversion rules, server-side conflict calculation, per-sport rates, maintenance schedule. |
| OPP — Open Play sessions | OPP-01..14 | Create, edit, publish, cancel and manage. All §3 configuration fields. Format and sport compatibility validation. Discovery and filters. Individual, partner and team registration. Waitlist. Payment. Cancellation and refunds per policy. Walk-ins. |
| ATT — Attendance | ATT-01..12 | QR, registration QR, controlled search, manual fallback with reason. Separate statuses and counts. Append-only history. Corrections and reversals. Management dashboard. Privacy-safe player summary. |
| ROT — Court assignment and rotation | ROT-01..09 | Assign, pair/team, move, waiting queue, start/complete game, return to queue, temporarily unavailable, check out, optional scores, configurable strategy (suggest-only). |
| SOC — Social profiles | SOC-01..12 | Username search, discovery via shared activity (privacy-permitting), public profile, follow/unfollow, follow approval, followers/following lists, block, report, discoverability and activity-visibility controls. |

---

## 3. Affected screens

**Legend:** N = new · M = modified · — = unchanged.

### 3.1 Public and player

| Screen | Route | Change |
|---|---|---|
| Home | `/` | M: sport-neutral hero copy, sport picker chips, Open Play strip |
| Discover / search | `/courts`, `/app/discover` | M: sport filter (required first chip row), configuration (full/half), surface, Open Play availability |
| Venue detail | `/venues/:slug` | M: sport chips, courts grouped by sport, Open Play tab |
| Booking | `/app/book/:slug` | M: sport → configuration selector before the time grid. Grid columns become configurations. Dependent cells show "In use (full court)" |
| Checkout / receipt | `/app/checkout/:id`, receipt | M: sport and configuration lines. Open Play registration variant |
| Open Play discovery | `/open-play`, `/app/open-play` | N: list plus filters (sport, venue, location, date, level, format, price, availability) |
| Open Play session | `/open-play/:id`, `/app/open-play/:id` | N: details, capacity bar, register (individual / with partner / team), waitlist, live summary (privacy-safe) |
| My Open Play | `/app/open-play/registrations/:id` | N: registration, payment, check-in and attendance status. Rotating QR. Partner/team status. Court or waiting position. Cancel with quote |
| Partner and team invites | `/app/invites` | N: accept/decline. Join a team (when permitted) |
| Events | `/events`, `/app/events` | M: sport filter. Open Play removed from the event types |
| My Sports dashboard | `/app/profile` (top section), `/app/activity` | N: one card per sport (stats, upcoming, skill, venues). Sport filter on Activity |
| Player profile (own) | `/app/profile` | M: username, per-sport skill, social privacy controls (discoverable, allow follows, follow approval, activity visibility) |
| Public player profile | `/players/:username` | N: public projection. Shows the sports the player plays, and per-sport stats only if their activity visibility allows. Follow/unfollow/request, block, report |
| Player search | `/app/players` | N: search by display name or username, honoring blocks and discoverability |
| Followers / following | `/players/:username/followers`, `…/following` | N: shown only when permitted |
| Follow requests | `/app/follow-requests` | N: incoming/outgoing. Accept/decline/cancel |
| Blocked users | `/app/settings` → Privacy | M: blocked list with unblock |
| Notifications | `/app/notifications` | M: categories for partner invite, team invite, follow request, Open Play changes, court assignment |

### 3.2 Business portal

| Screen | Route | Change |
|---|---|---|
| Venue settings | `/biz/venues` | M: supported sports, per-sport booking settings, changeover buffers |
| Courts | `/biz/courts` | M: becomes "Courts & layouts": space units, configurations, sport compatibility, capacity, equipment, accessibility, maintenance schedule, images. Includes a dependency preview (what each configuration blocks) |
| Calendar | `/biz/calendar` | M: columns per space unit or court group. Sport color tags. Dependent occupancy shown hatched |
| Pricing | `/biz/pricing` | M: sport/configuration conditions. The simulator takes a sport |
| Walk-in | `/biz/walk-in` | M: sport and configuration. Open Play walk-in registration |
| Open Play sessions | `/biz/open-play` | N: list, create/edit (all §3 fields), publish, cancel, duplicate, recurring series (P2) |
| Open Play live desk | `/biz/open-play/:id/live` | N: management dashboard (§5 counts), QR scanner/code entry, controlled search, manual check-in with reason, player list, partner/team status, court board with drag-to-assign, waiting rotation, exceptions, last update |
| Attendance history | `/biz/open-play/:id/attendance` | N: append-only event log, corrections with reason, reversals |
| Events | `/biz/events` | M: sport field. Open Play type removed |
| Staff & roles | `/biz/staff` | M: new permission rows (§6) |
| Reports | `/biz/reports` | M: sport dimension. Open Play attendance and no-show report |

### 3.3 SuperAdmin

| Screen | Route | Change |
|---|---|---|
| Sports catalog | `/admin/sports` | N: four sports, fields from §1, format templates, skill levels, status (audited, maker-checker for deactivation) |
| Config | `/admin/config` | M: court-type catalog replaced by configuration templates per sport |
| Venues / bookings / events | `/admin/venues`, `/admin/bookings`, `/admin/events` | M: sport column and filter |
| Open Play | `/admin/open-play` | N: platform-wide read view (no attendance PII beyond what the support policy allows) |
| Moderation | `/admin/moderation` | M: profile reports. Username and bio moderation actions (reset username, hide bio) |
| Users | `/admin/users` | M: social status, blocks count (no list), follower counts |
| Reports | `/admin/reports` | M: sport dimension |

---

## 4. Affected entities (doc 12 and `schema.sql`)

### 4.1 New tables

| Table | Scope | Key columns and constraints |
|---|---|---|
| `sports` | global ref | `code` PK (`^[a-z0-9_]{2,40}$`), `name`, `description`, `icon_asset_id`, `status`, `min_players`, `max_players`, `default_duration_min`, `skill_levels jsonb`, `open_play_config jsonb`, `match_result_config jsonb`, `team_requirement` enum, `version`, audit columns |
| `sport_formats` | global ref | `id`, `sport_code` FK, `code`, `label`, `registration_mode` (`individual` / `partner` / `team`), `team_size_min/max`, `sides`, `applies_to` (`booking` / `open_play` / `both`), `kind` (`recreational` / `competitive` / `beginner` / `rotation` …), `status`. Unique `(sport_code, code)` |
| `configuration_templates` | global ref | Replaces `court_types`: `sport_code`, `code` (`full`, `half`, `singles_court` …), `partial boolean` |
| `space_units` | tenant | `business_id`, `venue_id`, `court_id`, `name`, `status`. Unique `(court_id, lower(name))` |
| `court_configurations` | tenant | `business_id`, `venue_id`, `court_id`, `sport_code`, `template_code`, `name`, `capacity`, `status`. Unique `(court_id, sport_code, name)` |
| `court_configuration_units` | tenant | `(configuration_id, space_unit_id)` PK, both same tenant (composite FK) |
| `court_conversion_rules` | tenant | `venue_id`, `from_sport/config`, `to_sport/config`, `changeover_min` |
| `court_sports` | tenant | `(court_id, sport_code)`, a court's compatible sports |
| `court_media`, `court_equipment`, `court_maintenance_windows` | tenant | Images (re-encoded, EXIF stripped per VEN-07), equipment list, recurring maintenance that creates court blocks |
| `venue_sports` | tenant | `(venue_id, sport_code)`, per-sport settings override |
| `open_play_sessions` | tenant | All §3 fields: `sport_code`, `format_id`, `court_configuration_ids`, `registration_opens_at/closes_at`, `checkin_opens_at`, `late_cutoff_at`, `min_participants`, `capacity`, `capacity_unit` (`player` / `team`), `pricing_mode` (`free` / `per_player` / `per_team`), `price_minor`, `registration_modes`, `walk_in_enabled`, `waitlist_enabled`, `equipment_included`, `policy_key`, `no_show_policy`, `rotation_strategy`, `score_recording`, `organizer_member_id`, `status` (`draft` / `published` / `registration_closed` / `in_progress` / `completed` / `cancelled`), `version`. CHECK `capacity >= min_participants` |
| `open_play_staff` | tenant | `(session_id, member_id)`, assigned staff |
| `open_play_registrations` | tenant | `session_id`, `user_id`, `party_id`, `registration_status`, `attendance_status`, `waitlist_position`, `checkout_id`, `checkin_ref_hash` (only the SHA-256 is stored), `needs_partner`, `manually_adjusted`. Partial unique `(session_id, user_id)` where not cancelled |
| `open_play_parties` | tenant | Partner pair or team: `session_id`, `kind`, `name`, `captain_user_id`, `size_target`, `status` (`forming` / `complete` / `needs_member` / `dissolved`), `joinable` |
| `party_invitations` | tenant | `party_id`, `inviter_id`, `invitee_user_id`, `status` (`pending` / `accepted` / `declined` / `expired` / `cancelled`), `expires_at`. No contact details. Invitations go only to registered users, by username |
| `attendance_events` | tenant, **append-only** | `session_id`, `registration_id` (nullable for rejected unknown scans), `type` (`check_in`, `check_in_rejected`, `assign_court`, `start_game`, `end_game`, `to_waiting`, `temp_off`, `check_out`, `no_show`, `correction`, `reversal`), `method` (`qr` / `registration_qr` / `search` / `manual`), `actor_member_id`, `reason` (required for manual, correction, reversal), `reject_code`, `reverses_event_id`, `created_at`. Trigger blocks UPDATE/DELETE (same as the audit tables) |
| `open_play_games` | tenant | `session_id`, `court_configuration_id`, `side_a uuid[]`, `side_b uuid[]`, `status` (`in_progress` / `completed` / `abandoned`), `started_at`, `ended_at`, `score jsonb` (only if `score_recording`), `recorded_by` |
| `open_play_queue` | tenant | Waiting rotation: `session_id`, `registration_id`, `entered_at`, `priority`, `status` |
| `player_sport_profiles` | user | `(user_id, sport_code)`, `skill_level`, `skill_source`, `visibility`, `pinned`, `hidden`, `interested` |
| `player_sport_stats` (view) | user | Per-sport aggregates from completed bookings, Open Play attendance and recorded games. Rebuilt by the worker; never written by clients |
| `follows` | user (cross-tenant, platform) | `follower_id`, `followee_id`, `status` (`pending` / `accepted` / `declined` / `cancelled` / `removed`), timestamps. Partial unique `(follower_id, followee_id)` where status IN (`pending`, `accepted`). CHECK `follower_id <> followee_id` |
| `user_blocks` | user | `blocker_id`, `blocked_id`, `created_at`, unique pair. CHECK not self |
| `social_settings` | user | `discoverable`, `allow_follows`, `require_follow_approval`, `show_followers`, `show_following`, `activity_visibility` per group |

### 4.2 Modified tables

| Table | Change |
|---|---|
| `courts` | Drop `court_type_code` (moved to configurations). Add `partial_capable`, `capacity`, `accessibility`, `amenities`. `max_players` moves to the configuration |
| `booking_slots` | Add `space_unit_id` and `court_configuration_id`. Add `open_play_session_id` with occupant type `open_play` (extend the `booking_slots_one_occupant` CHECK). **The exclusion constraint becomes `EXCLUDE USING gist (space_unit_id WITH =, occupied_range WITH &&) WHERE (status='active')`**. One logical occupancy = N rows sharing an `occupancy_group_id` |
| `bookings`, `booking_price_snapshots` | Add `sport_code`, `court_configuration_id`, `format_id` (nullable) |
| `pricing_rules` | Add `sport_code`, `configuration_ids` conditions |
| `events` | Add `sport_code`. Remove `open_play` from `event_types` (migration moves existing rows) |
| `checkouts` | Kind adds `open_play_registration`. The line item kind adds `open_play_seat` and `open_play_team` |
| `refunds` | Add an `open_play_registration_id` source (same proportional rules, doc 09) |
| `user_profiles` | Add `username` (citext, unique), `username_changed_at`. Visibility enum gains `followers` and drops `connections` |
| `content_reports` | `target_type` adds `profile` |
| `notification_categories` | Add `open_play`, `party_invite`, `follow`, `court_assignment` |
| `court_types` | Superseded by `configuration_templates` (kept read-only for one release) |

**Migration notes.**

1. Each existing court gets one space unit, plus one configuration of sport `pickleball` matching its current `format`. Existing slots get `space_unit_id` backfilled before the constraint swap (create the new constraint `NOT VALID`, validate, then drop the old one).
2. Events of type `open_play` become `open_play_sessions` with their registrations. Event registrations that are already checked in become `check_in` attendance events with method `migration`.
3. Profiles with `connections` visibility map to `followers`.

---

## 5. Affected APIs (doc 13)

### 5.1 New endpoints

| Area | Endpoints | Permission / auth |
|---|---|---|
| Sports (public) | `GET /v1/public/sports`, `GET /v1/public/sports/{code}` | Anonymous (active sports only) |
| Sports (admin) | `GET/POST/PATCH /v1/admin/sports…`, `…/formats` | `platform.sports.manage` (MFA, `If-Match`, audited; deactivation = maker-checker) |
| Configurations | `GET/POST/PATCH /v1/businesses/{b}/courts/{c}/configurations`, `…/space-units`, `…/conversion-rules`, `GET …/configurations/{id}/dependencies` | `courts.manage` |
| Open Play (public) | `GET /v1/public/open-play` (filters), `GET /v1/public/open-play/{id}` (summary) | Anonymous |
| Open Play (player) | `POST /v1/me/open-play/{id}/registrations` (mode individual / partner / team), `GET /v1/me/open-play/registrations/{rid}`, `GET …/{rid}/checkin-token` (rotating), `GET …/{rid}/cancellation-quote`, `POST …/{rid}/cancellation`, `POST /v1/me/open-play/{id}/waitlist`, `GET /v1/me/open-play/{id}/live` (privacy-safe) | Session. Idempotency-Key on POST |
| Parties | `POST /v1/me/parties/{pid}/invitations` (by username), `POST /v1/me/invitations/{iid}/accept`, `…/decline`, `POST /v1/me/parties/{pid}/join` | Session |
| Open Play (business) | `GET/POST/PATCH /v1/businesses/{b}/open-play…`, `…/{id}/publish`, `…/{id}/cancellation` (refunds all) | `openplay.manage` |
| Attendance | `POST …/open-play/{id}/check-ins` (`{token}` or `{registrationId, method:'search'}` or `{registrationId, method:'manual', reason}`), `POST …/attendance-events/{eid}/reversal` (reason), `POST …/registrations/{rid}/attendance-corrections` (reason), `GET …/open-play/{id}/attendance-events` | `openplay.check_in`. Corrections and reversals need `openplay.attendance.correct` |
| Live desk | `GET …/open-play/{id}/live` (full dashboard), `GET …/open-play/{id}/stream` (SSE) | `openplay.view` |
| Rotation | `POST …/open-play/{id}/assignments`, `…/games` (start), `…/games/{gid}/completion` (optional score), `…/queue` (add/move/remove), `…/registrations/{rid}/status` (`temp_off`, `check_out`), `GET …/open-play/{id}/rotation-suggestion` | `openplay.run` (scores need `score_recording` enabled) |
| Partner replacement | `POST …/parties/{pid}/replacement` | `openplay.manage` |
| Social | `GET /v1/players?q=` (name or username), `GET /v1/players/{username}`, `…/followers`, `…/following`, `POST/DELETE /v1/me/follows/{username}`, `GET /v1/me/follow-requests`, `POST …/follow-requests/{id}/accept`, `…/decline`, `DELETE /v1/me/followers/{username}` (remove), `POST/DELETE /v1/me/blocks/{username}`, `PATCH /v1/me/social-settings`, `POST /v1/reports` (`targetType:'profile'`) | Session. Rate-limited (follows 60/h, search 30/min, reports 10/day) |

### 5.2 Modified endpoints

| Endpoint | Change |
|---|---|
| `GET /v1/public/venues` | Adds `sport`, `configuration` (`full` / `partial`), `surface`, `hasOpenPlay` filters. The response adds `sports[]` |
| `GET /v1/public/venues/{id}/availability` | Requires `sport`. Returns cells per **configuration**, with `blockedBy` (`dependent_configuration`, `changeover`, `block`, `open_play`) and no other customers' data |
| `POST /v1/me/booking-holds` | Body adds `sport` and `courtConfigurationId`. New errors `SPORT_NOT_SUPPORTED`, `FORMAT_INCOMPATIBLE`, `CHANGEOVER_CONFLICT` (409). `SLOT_UNAVAILABLE` also covers dependent units |
| Court blocks | Target `spaceUnitIds[]` or `courtConfigurationId` |
| Pricing rules and simulator | `sportCode` and `configurationIds` conditions |
| `GET /v1/me/bookings/{id}` | Returns a rotating `BK1` token instead of the static `CK1` (CR-D08). Business check-in accepts both during the transition |
| Events CRUD | Requires `sportCode`. Type `open_play` is rejected with `410 GONE_USE_OPEN_PLAY` |
| Profile | `PATCH /v1/me/profile` adds `username` (once per 30 days) and per-sport skill |

**New error codes:** `SPORT_NOT_SUPPORTED`, `FORMAT_INCOMPATIBLE`, `CHANGEOVER_CONFLICT`, `SESSION_FULL`, `REGISTRATION_CLOSED`, `PARTNER_REQUIRED`, `INVITE_EXPIRED`, `CHECKIN_TOKEN_INVALID`, `CHECKIN_TOKEN_EXPIRED`, `CHECKIN_WRONG_SESSION`, `ALREADY_CHECKED_IN`, `CHECKIN_WINDOW_CLOSED`, `NOT_CHECKED_IN`, `SCORE_RECORDING_DISABLED`, `USERNAME_TAKEN`, `FOLLOW_NOT_ALLOWED`.

---

## 6. Permissions (doc 03, `rbac.ts`)

| New code | Label | Risk | Default role templates |
|---|---|---|---|
| `openplay.view` | View Open Play sessions and live desk | low | owner, manager, receptionist, event_manager, court_manager |
| `openplay.manage` | Create, edit, publish, cancel sessions. Assign replacements | medium | owner, manager, event_manager |
| `openplay.check_in` | Check in players (QR, search, manual with reason) | low | owner, manager, receptionist, event_manager |
| `openplay.run` | Assign courts, run rotation, start/complete games, record scores | low | owner, manager, event_manager, court_manager |
| `openplay.attendance.correct` | Reverse or correct attendance (reason required, audited) | medium (**MFA**) | owner, manager |
| `platform.sports.manage` | Manage the sport catalog and format templates | high (**MFA**, maker-checker for deactivation) | superadmin |

Unchanged rules: the receptionist's venue scoping (BGC-only) applies to Open Play, and support mode stays read-only. Social actions are personal-account actions, not business permissions. Staff never act socially on behalf of a business.

---

## 7. Workflows and state machines

| Machine | States and key transitions | Notes |
|---|---|---|
| Open Play session | `draft → published → registration_closed → in_progress → completed`. `cancelled` from any state before `completed` | Cancellation refunds all paid registrations in full (venue-initiated, like EVT-05). Below `min_participants` at the configured cutoff, the venue chooses cancel or proceed |
| Registration (commercial) | `held → pending_payment → confirmed`. `waitlisted → offered → held`. `confirmed → cancelled → refund_pending → refunded`. Free sessions skip payment | Reuses the hold TTL and the offer cascade (EVT-04). Capacity counts held, pending, offered and confirmed |
| Attendance (physical) | `not_arrived → checked_in → waiting ⇄ on_court ⇄ temp_off → checked_out → completed`. `not_arrived → no_show` after the late cutoff | "Eligible for check-in" is derived: confirmed, window open, not restricted, not checked in. "Check-in rejected" is an event outcome, counted separately. "Manually adjusted" is a flag set by a correction event |
| Party (partner/team) | `forming → complete`. `complete → needs_member` when a member cancels or declines. `needs_member → complete` on a replacement. `→ dissolved` | If session rules allow, the remaining player stays registered with `needs_partner = true` and is notified. Their seat and payment are unaffected |
| Invitation | `pending → accepted / declined / expired / cancelled` | Invitee search by username only. No email or phone shown |
| Game | `in_progress → completed / abandoned` | Completing returns players to `waiting` with fresh queue entries |
| Follow | `pending → accepted / declined / cancelled`. `accepted → removed`. Without approval, the follow goes straight to `accepted` | A block sets every active follow in both directions to `removed` |

**Money rules for Open Play (unchanged pipeline).**

- Per-player pricing: each registrant pays their own seat.
- Per-team pricing: the captain pays the team fee (default, pending Q3).
- Commission uses the existing formula on the commissionable base.
- Refunds follow the session's policy snapshot. A team refund when one member leaves is proportional only if the policy says so (default: no partial refund for a member leaving a team-priced party).
- No-show policy runs at the late cutoff: no refund by default and a counter for restriction rules. It never auto-restricts.

---

## 8. Tests to add or change (doc 20)

| Area | Tests |
|---|---|
| Catalog | Exactly four sports active. Inactive sports are hidden from discovery and rejected on new holds. Formats outside the sport are rejected (`FORMAT_INCOMPATIBLE`). A custom format outside min/max players is rejected. Catalog changes are audited |
| Terminology | Static check: no `pickleball` literal outside seeds, catalog data and sport-specific copy files. UI smoke test: shared screens render with each sport |
| Court dependencies | Full court blocks halves. A half blocks the full court. Two halves can coexist. Basketball and volleyball on a shared unit conflict. Tennis plus pickleball overlays follow the unit map. Changeover buffer enforced only when the sport or configuration changes. **Concurrency:** 50 parallel holds on overlapping configurations produce exactly one winner (constraint-level) |
| Availability | Server-side per configuration. `blockedBy` reasons. No leak of other bookers |
| Pricing | Sport-specific rule wins by specificity. Snapshot keeps the sport and configuration |
| Open Play | Create/publish validation (sport and format, capacity ≥ min, windows ordered). Register individual/partner/team. `SESSION_FULL` → waitlist → offer cascade. Free vs paid. Per-team pricing. Cancellation quote and refund per policy. Venue cancel refunds all. Walk-in registration |
| Partners and teams | Invite by username. Accept/decline/expire. Decline leaves the remaining player registered with `needs_partner` when allowed. Replacement by management. Notification sent. No contact fields in any invite payload |
| QR and check-in | Valid token checks in once. A duplicate is rejected and recorded. Expired, tampered, wrong session, wrong venue and outside window are rejected and recorded. The token contains no user ID or PII. The key ID enables rotation. Manual check-in without a reason gives 422. A reversal creates a new event (the old one is untouched). Attendance tables reject UPDATE/DELETE |
| Counts | Registration ≠ attendance. Check-in ≠ on court. On-court count changes only on explicit assignment. Counts recomputed from events equal the live counters (property test) |
| Rotation | Each strategy's suggestion is deterministic for a given queue. Staff confirmation is required. Scores are rejected when recording is disabled |
| Privacy | The player live summary contains only counts plus own data (snapshot test of the DTO keys). The public-profile projection never includes contact, payment, restriction, notes or audit fields, across all endpoints that embed a person |
| My Sports dashboard | Stats per sport match completed bookings and attendance events exactly. Cancelled and no-show sessions are excluded from "played". A sport appears after the first completed activity. Hidden sports never appear on the public profile. Another user sees stats only when visibility allows |
| Social | Follow without approval → accepted. With approval → pending → accept/decline/cancel. Removing a follower works. Block removes both directions, prevents follows, hides from search and returns 404 on profile. Discoverability off excludes the user from search. Rate limits apply. Reporting a profile reaches the moderation queue |
| Tenant isolation | Every new tenant table tested for cross-business access (404). The receptionist's venue scope covers the Open Play desk |
| Regression | All existing 52 demo tests stay green. Existing pickleball bookings migrate to the unit model with identical availability |

---

## 9. Design documents to update

| Doc | Update |
|---|---|
| 01 PRD | §2 changes. New SPT/CRT/OPP/ATT/ROT/SOC sections. Out-of-scope rows |
| 02 Personas | Add a basketball team captain, a volleyball organizer, a tennis player, and an Open Play desk staffer |
| 03 Roles | New permission rows and template defaults (§6) |
| 04 Journeys | New: multi-sport booking with a dependency conflict, Open Play partner registration and decline, desk check-in and rotation, follow/block. Update J-event (Friday Open Play) |
| 05 IA / 06 Sitemap | New routes (§3) |
| 07 Booking SM | Unit-based occupancy, changeover guard (CR-D03/D04), invariant I1 restated per unit |
| 08 / 09 | Open Play registrations as a checkout kind. Per-team refunds |
| 10 Multi-tenant | New tenant tables and RLS. `follows`/`user_blocks` are user-scoped platform tables (no business access) |
| 12 ERD + schema.sql | §4 |
| 13 API | §5 |
| 14 Threats | QR replay/forgery, stalking via social discovery, enumeration via username search, harassment via follow spam, attendance tampering |
| 15 Privacy | New data: usernames, social graph, attendance events, check-in timestamps. Retention (proposal: attendance 2 years, then aggregate; follows deleted with the account; blocks kept 1 year after account deletion to stop re-harassment, pending DPO review) |
| 16 Wireframes | Sport selector, configuration grid, Open Play session, live desk, public profile |
| 17 Design system | Sport icons (original line icons), sport color tags, court board component, live counter component, stale banner |
| 18 MVP / 19 Phases | Add phases (§10). Matchmaking out of scope |
| 20 Testing | §8 |
| 22 Monitoring | SSE connection health, check-in rejection rate alert, attendance-correction volume alert |
| 23 Decisions | CR-D01..D12 and the open questions (§12) |

---

## 10. Implementation plan (demo first, then production steps)

These are scoped changes. Untouched: the money engine (`money.ts`, `ledger.ts`, commission, fee rules), payments, provider, webhooks, reconciliation, payouts, disputes, auth/MFA, audit chain, products, restrictions and the presenter tooling. These get new callers, not rewrites.

| Step | Demo files (`demo/src`) | Content |
|---|---|---|
| 1. Sport catalog | `domain/sports.ts` (new), `services/model.ts`, `services/seed.ts`, `services/admin.ts`, `ui/views/admin.ts` | Catalog data and format templates for the four sports. Validation helpers (`formatAllowed`, `playersInRange`). Admin screen |
| 2. Space units and configurations | `domain/availability.ts`, `services/store.ts` (overlap rule keyed by `spaceUnitId`), `services/venues.ts`, `services/checkout.ts` (`insertSlot` writes N unit rows), `services/booking.ts` | Dependency-aware availability and changeover guard. Existing courts migrated in the seed |
| 3. Sport-aware booking and pricing | `domain/pricing.ts` (sport/config conditions), `services/catalog.ts` (filters), `ui/views/public.ts`, `ui/views/booking.ts`, `ui/views/shared.ts`, `ui/views/business-setup.ts` | Sport selector, configuration grid, filters, sport-neutral copy |
| 4. Open Play sessions | `services/openplay.ts` (new), `services/checkout.ts` (new kind), `services/refunds.ts` (new source), `ui/views/openplay.ts` (new), `ui/views/business-openplay.ts` (new) | CRUD, publish, register, waitlist, pay, cancel/refund |
| 5. Partners and teams | `services/parties.ts` (new), notifications | Invites by username, decline handling, replacement |
| 6. Attendance and QR | `domain/checkin-token.ts` (new), `services/attendance.ts` (new), `store.ts` (append-only `attendanceEvents`) | Rotating tokens, check-in methods, rejections, corrections/reversals, derived counts |
| 7. Live desk and rotation | `services/rotation.ts` (new), `ui/views/business-openplay.ts` | Court board, queue, strategies (suggest-only), games, optional scores, last-updated indicator |
| 8. Social profiles | `services/social.ts` (new), `services/profile.ts`, `ui/views/social.ts` (new), moderation | Usernames, search, follows, approval, blocks, reports, privacy settings, public projection |
| 9. Seed and presenter | `services/seed.ts`, `ui/views/presenter.ts`, `docs/demo-guide.md` | Venues for all four sports: a basketball gym with halves, a volleyball/basketball multi-use hall, a tennis club with pickleball overlays. Live Open Play sessions for the four sports, social graph for personas. New presenter scenarios: "full vs half court race", "scan a replayed QR" |
| 10. Tests and docs | `tests/*.test.ts`, docs 01–23 | §8 tests, doc updates (§9). Rebuild `CourtKo-Demo.html` |

The production 20-step plan (doc 19) gains matching work in steps for schema (units/configurations, Open Play, social), API, worker (no-show job at late cutoff, SSE fan-out) and E2E.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| The unit-model migration changes the core no-double-booking guarantee | Migrate with `NOT VALID` → `VALIDATE`. Parity test: identical availability before and after for every seeded court. Concurrency test at constraint level |
| Social discovery enables stalking or harassment | Default `discoverable = true` but activity visibility `private`. No location or venue history on profiles by default. Blocks enforced in the read path. Rate limits. Reports |
| QR screenshots shared to check in absent friends | 10-minute rotating tokens. Duplicate detection. Staff see the display name and avatar on scan to confirm |
| Live desk load during peak Open Play | SSE fed from the outbox with counters cached per session. Polling fallback |
| Scope growth (four sports × formats × rotation strategies) | Strategies are suggest-only. Brackets/leagues stay P2 |

---

## 12. Open questions (need answers before or during build)

| # | Question | Default if no answer |
|---|---|---|
| Q1 | **Section 7 was cut off at "Blocking another user must: … Not automatically".** What should blocking *not* do automatically (e.g. cancel existing bookings or Open Play registrations, notify the blocked user)? Are there sections 8+? | Blocking affects social features only. It does not cancel bookings or registrations and does not notify the blocked user. Management can separate players in rotation |
| Q2 | Minimum age for accounts and social features. Social discovery of minors is a child-safety and Data Privacy Act concern | Accounts 18+ for social features. Under-18 participation only through a guardian-managed flow (P2). Minors are never discoverable |
| Q3 | Per-team pricing: does the captain pay for everyone, or does each member pay a share? | The captain pays the team fee. Per-player sessions are each-pays-own |
| Q4 | Partner invites: does the inviter's seat count against capacity before the partner accepts, and for how long? | Two seats are held for the invite expiry (30 min, capped at registration close). On expiry, the inviter keeps one seat with `needs_partner` |
| Q5 | Can players see other participants' display names in an Open Play session, or only counts? | Counts only. Partner/team members see each other's display names. Display names of others appear only on the court board shown in-venue, if each player's visibility allows |
| Q6 | Changeover times between sports per venue (e.g. tennis ↔ pickleball net conversion) | 15 minutes when the configuration changes, configurable per venue |
| Q7 | Do events (tournaments, leagues, clinics) also need to be multi-sport in this release? | Yes: `sport_code` is required on events. No other event changes |

---

## 13. Implementation status (interactive demo, build `courtko-demo-2026.10.06-gateway`)

| Area | Demo implementation | Key files | Tests |
|---|---|---|---|
| Sport catalog (CR-D01/D02) | Four active sports with formats, layouts, player counts, skill levels, Open Play and match-result settings. SuperAdmin screen with versioned, audited edits. Deactivation needs a reason. Maker-checker for deactivation is deferred: the demo has only one SuperAdmin | `domain/sports.ts`, `services/sportsAdmin.ts`, `ui/views/admin-sports.ts` | `multisport.test.ts` › sport catalog |
| Physical courts, space units, layouts (CR-D03) | Slots carry space units. The store's no-overlap rule is keyed on units, giving full ↔ half, shared basketball/volleyball floors, and two pickleball courts on a tennis court. Courts & layouts editor with a dependency table. Calendar columns are physical courts, and half courts fill half a column | `services/courts.ts`, `services/store.ts`, `services/venues.ts`, `ui/views/business-setup.ts`, `business-ops.ts` | court dependencies suite |
| Changeover (CR-D04) | Server-side guard in the hold/insert path. Availability explains the gap | `services/checkout.ts`, `domain/availability.ts` | shared-floor test |
| Sport-specific rates (CR-D05) | Rules can be limited to sports. Specificity order: court > sport > venue | `domain/pricing.ts`, `services/pricingSvc.ts` | sport-specific rates test |
| Search & discovery | Filters for sport, full/half court, surface and Open Play. Sport picker on home, discover, events and venue pages. Sport-specific cover art | `services/catalog.ts`, `ui/views/public.ts`, `shared.ts`, `art.ts` | UI smoke |
| Open Play (CR-D06) | Dedicated sessions with all §3 fields and sport ↔ format ↔ court validation. Individual, partner and team registration. Join a team. Waitlist with offers. Free, per-player and per-team pricing through the shared checkout/ledger/refund pipeline. Venue cancellation refunds everyone in full | `services/openplay.ts`, `ui/views/openplay.ts`, `business-openplay.ts` | Open Play suite |
| Partner/teams (§4) | Invites by username only. On decline, expiry or cancellation the remaining player stays registered with "needs partner" (or both are cancelled with a full refund if the session is configured that way). Staff can assign a replacement. Notifications sent | `services/openplay.ts` | partner invite test |
| Secure check-in (CR-D08) | OP1 live pass (10-minute rotation) and REG1 registration QR: HMAC-signed, bound to the session, no personal data. Duplicate, expired, tampered, wrong-session and out-of-window scans are rejected **and recorded**; tampering raises a security event. Manual check-in needs a reason. Reversals and corrections are new events (MFA + permission) | `domain/checkin.ts`, `services/openplay.ts` | secure check-in suite |
| Attendance & rotation (CR-D07/D09) | Separate registration and attendance axes. Fifteen live counters. Players count as on court only after explicit assignment. Court board, waiting rotation, strategy suggestions (staff confirm), games with optional scores, temporarily off, check-out, no-show job at the late cutoff | `services/openplay.ts`, `ui/views/business-openplay.ts` | check-in ≠ on court test |
| Player privacy (§5) | The live summary contains counts plus the viewer's own status. Registrations returned to players strip check-in secrets. Restriction flags are shown only to staff with `restrictions.view` | `services/openplay.ts` | privacy-safe summary test |
| Social profiles (§7, CR-D11/D12) | Usernames, search, suggestions, public-profile projection, follow with optional approval, followers/following lists, block (both directions, looks like "not found", doesn't touch bookings), report → moderation, privacy controls. Data export includes the social graph. Account deletion clears the username and ends follows | `services/social.ts`, `ui/views/social.ts`, `services/profile.ts`, `services/reviews.ts` | social suite |
| My Sports dashboard (PLY-01 addition) | Per-sport sessions, hours, games, W–L, venues, upcoming games, self-declared level, pin/hide, interested sports. Visibility respected on the public profile | `services/social.ts` › `mySportsDashboard` | My Sports test |
| Permissions (§6) | `openplay.view/manage/check_in/run/attendance.correct` (correct = MFA), `platform.sports.manage`. Role templates updated | `domain/rbac.ts` | desk & reversal tests |
| Live status (player) | Always on from publication, not only during the session: phase (check-in opens / open / in progress / ended) with countdowns, how many registered players are already here, arrivals in the last 15 min, waiting / playing / not-here counts, per-court occupancy, and the viewer's own place in line with an estimated wait. Aggregates only, auto-refreshing (SSE in production) | `services/openplay.ts` (`playerLive`), `ui/views/openplay.ts` (`livePanel`) | live-status tests |
| Publishing against a real calendar | A pre-publish court check lists every conflicting booking, hold, block, event, Open Play session and changeover gap per court, including dependent layouts. It suggests a set of free courts of the same sport and layout. Publish can switch to them, or cancel the conflicting bookings with full refunds (`bookings.cancel`, audited). Blocks and events are never cancelled from here. Draft editors mark each court "free" or "in use" | `services/openplay.ts` (`openPlayCourtCheck`, `publishOpenPlay`), `ui/views/business-openplay.ts` | publish-conflict test |
| Demo-only helpers | `GET /demo/open-play/{id}/sample-pass`, `POST /demo/open-play/live` and `POST /demo/open-play/arrivals`, so presenters can show scans and a live desk at any time. **Not part of the production API** | `services/openplay.ts` | — |

**Defaults used for open questions:**

- Q1 (blocking): social-only, with no notification to the blocked user.
- Q2 (minors): not implemented in the demo. All demo personas are adults. **Production must decide before launch.**
- Q3 (team pricing): per-team means the captain pays.
- Q4 (invites): seats are reserved while an invite is pending; the invite lasts 30 minutes, capped at registration close.
- Q5: players see counts only; party members see each other's display names.
- Q6: changeover is 15–20 minutes, configurable per court.
- Q7: events now carry a sport.

