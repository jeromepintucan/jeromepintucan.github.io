# 02 — User Personas

| Field | Value |
|---|---|
| Document | 02 of 23 — User personas |
| Status | Draft v1.0 — proto-personas, to be validated in pilot research |
| Owner | Product design (Senior UX/UI) with Product |
| Last updated | 2026-09-30 |
| Related | [01 Product requirements](01-product-requirements.md) · [03 Role & permission matrix](03-role-permission-matrix.md) · [04 Key user journeys](04-key-user-journeys.md) · [16 Wireframes](16-wireframes.md) · [23 Assumptions & decisions](23-assumptions-and-decisions.md) |

**Illustrative only.** Every name, business, venue and detail below is fictional and synthetic. These are proto-personas built from the product brief and general knowledge of the Philippine market. They are hypotheses to validate (see §7), not research findings.

---

## 1. Overview

| ID | Persona (illustrative) | Segment | Primary surface | Access model | MVP design priority |
|---|---|---|---|---|---|
| P1 | Bea Santos, 27 | After-work regular player, Metro Manila | Player app | Player | Primary |
| P2 | Ramon dela Cruz, 45 | Weekend family/barkada organizer | Public site + player app | Player | Secondary |
| P3 | Carla Mendoza, 31 | Competitive tournament player, Cebu | Events + activity | Player | Secondary |
| P4 | Joel Reyes, 38 | Single-venue owner | Business portal | `business_owner` | Primary |
| P5 | Patricia Lim, 42 | Multi-venue operator | Business portal (desktop) | `business_owner` + custom roles for her team | Secondary |
| P6 | Mark Villanueva, 23 | Front-desk receptionist | Staff operations | `receptionist` | Primary |
| P7 | Aileen Torres, 35 | Event organizer and coach at two businesses | Staff operations (events) | `event_manager` in two businesses | Secondary |
| P8 | Nina Castillo, 34 | Platform finance and operations lead | SuperAdmin control center | `platform_finance` | Primary for admin |

## 2. Philippine context that shapes every persona

| Factor | Design consequence |
|---|---|
| Mobile-first population; many players book on mid-range Android phones over prepaid data | Performance budget, small payloads, skeletons instead of spinners, resilient payment return page |
| E-wallets (GCash, Maya) and QR Ph dominate small payments; cards are secondary | E-wallet and QR Ph first in the method picker; per-method fee shown; fee pass-through off for every method until counsel confirms it (doc 23 D-05) |
| Booking today happens in Messenger and Viber threads with screenshot "proof" | Server-verified payment status is the core trust promise; staff never verify screenshots |
| Addresses are described by barangay and landmark ("near the church", "beside the mall") | Search by city, municipality, barangay and landmark; landmark field on venue addresses |
| Heat pushes play to evenings and early mornings; rainy season and typhoon signals cause cancellations | Peak-rate rules; covered/indoor filters; weather cancellation refunds in full |
| Traffic makes late arrival common | 15-minute no-show grace; check-in window opens 30 minutes before start |
| Pay cycles around the 15th and end of month | Promo scheduling by date range; do not rely on stored cards |
| English and Taglish in daily use | en-PH copy at launch, plain words, fil-PH ready; no idioms that do not translate |
| Low trust in unknown online sellers | Verified-business badge, visible policies before payment, receipts, clear support path |

## 3. Player personas

### P1 — Bea Santos, the after-work regular (illustrative)

> "If I can't book it on my way home, I'm not playing tonight."

| Attribute | Detail |
|---|---|
| Context | Product analyst in Bonifacio Global City; lives in Kapitolyo, Pasig. Plays doubles 2–3 weekday evenings (7–10 PM) and some Sunday mornings with office friends. Self-declared Intermediate. |
| Today | Messages three or four venue Facebook pages at 5 PM, waits for replies, pays by GCash transfer and sends a screenshot. Was once turned away because the court had been given to someone else. |
| Goals | Book a 7 PM court in under two minutes; know the full total before paying; share details with friends; rebook the same court and time next week. |
| Pain points | Slow replies at the moment she decides; unclear peak pricing; refunds by manual transfer take days; no record of what she spends. |
| Key tasks | Search nearby for tonight → compare next available times → book 60–90 min with ball and water add-ons → pay with GCash → show QR at the desk → occasionally cancel when work runs late → rebook from history. |
| Devices and connectivity | Recent iPhone, postpaid 4G/5G, Safari. Books during the commute with patchy signal (elevators, MRT). Notifications on. |
| Payments | GCash first, Maya second, credit card rarely. Avoids anything that looks like a surcharge. |
| Trust concerns | "Is the slot really mine?" "Is there a hidden fee?" "What if GCash charges me but the app says failed?" |
| Success criteria | Confirmed with QR in about 90 seconds; no surprises at the desk; refund amount and status visible without messaging anyone. |
| Primary surfaces | `/courts`, `/venues/:slug`, `/app/book/:venueSlug`, `/app/checkout/:id`, `/app/bookings`, `/app/favorites` |
| Design implications | "Next available" on venue cards; one-thumb slot selection; sticky price summary; return page that survives a closed browser ("You can close this page — we'll notify you"); add-to-calendar and share. |

### P2 — Ramon dela Cruz, the weekend organizer (illustrative)

> "I just need two covered courts at 7 on Saturday, and a clear answer if it rains."

| Attribute | Detail |
|---|---|
| Context | Operations supervisor in Quezon City. Organizes Saturday 7–9 AM games for family and neighbors, usually two courts. Pays for everyone and collects shares by e-wallet afterwards. |
| Goals | Two courts side by side for two hours; covered courts in the rainy season; a clear weather rule; the desk knows who is in his group. |
| Pain points | Rain cancellations handled differently every time; collecting money from eight people; small text; forgotten passwords. |
| Key tasks | Search "Quezon City" without sharing location → filter "Covered" → book two slots in one checkout (the 2-hold limit) → add participant names → get SMS and email confirmation → receive a reminder 24 h before → full refund if the venue cancels for weather. |
| Devices and connectivity | Mid-range Android (4 GB RAM), prepaid data, often low on storage, Chrome, OS text size set to about 130%. |
| Payments | GCash. Would pay cash at the desk if allowed (not recorded by the platform at MVP). |
| Trust concerns | Paying for two courts and receiving one; confirmations that only live inside an app. |
| Success criteria | One payment covers both courts; confirmation by SMS and email; clear, automatic full refund when the venue cancels. |
| Primary surfaces | `/courts` (manual search), `/app/book/:venueSlug`, `/app/bookings/:id`, SMS and email notifications |
| Design implications | Manual location search is a first-class path; layouts survive 200% text zoom; multi-slot checkout; participant list; weather cancellation copy; split payment is a known Phase 2 request. |

### P3 — Carla Mendoza, the competitive player (illustrative)

> "Tell me my waitlist number and give me a fair shot when a slot opens."

| Attribute | Detail |
|---|---|
| Context | Physical therapist in Cebu City. Plays 4–5 times a week and enters regional tournaments in Cebu, Metro Manila and Iloilo. Holds a rating from an external rating provider. |
| Goals | Find tournaments by division and skill; register before divisions fill; get waitlist offers quickly; keep results and verified levels in one place; show stats to organizers but not publicly. |
| Pain points | Registration through web forms plus bank transfer; waitlists run in group chats; unclear division eligibility; no single history of results. |
| Key tasks | Browse `/events` for tournaments at 3.5–4.0 → register for a division (partner name captured) → join a waitlist when full → accept an offer before it expires → check in at the event → review activity. |
| Devices and connectivity | Android flagship, 5G, travels between islands. |
| Payments | Maya and credit card. |
| Trust concerns | FIFO waitlist with a visible position; refunds when an event is cancelled; ratings labeled by source (self-declared, venue-verified, external); organizer legitimacy. |
| Success criteria | Waitlist offer notification within minutes and in-app payment before expiry; official results shown with their source (Phase 2). |
| Primary surfaces | `/events`, `/events/:id`, `/app/events`, `/app/activity`, `/app/settings` (visibility) |
| Design implications | Division and skill filters; waitlist position and offer countdown; source labels on every rating; per-stat-group visibility; external ratings only via an official partner API with her authorization (Phase 2). |

## 4. Business personas

### P4 — Joel Reyes, the single-venue owner (illustrative)

> "I don't mind paying a commission. I mind not knowing where my money is."

| Attribute | Detail |
|---|---|
| Context | Converted a family warehouse in Kapitolyo, Pasig into **Pasig Pickle Hub**: 4 courts (2 indoor, 2 covered), operated by "Hub Sports Co." (synthetic sole proprietorship, VAT-registered, prices include VAT). Team: one manager (his cousin), three receptionists across shifts, one part-time coach. |
| Today | Facebook page and Messenger, a shared spreadsheet schedule, an e-wallet business QR, weekly manual reconciliation, occasional edited screenshots, frequent weekday-evening no-shows. |
| Goals | Fill weekday daytime hours with promos; enforce cancellation and no-show rules; stop answering booking messages by hand; see what he earns after fees; keep control of prices and customer relationships. |
| Pain points | Receptionists cannot verify payments; double bookings when two staff reply; bookkeeping from screenshots; manual peak-price changes. |
| Key tasks | Onboard and submit documents (DTI certificate, business permit, BIR registration, owner ID) → set up courts, hours and pricing with the simulator → choose the Standard policy → invite staff as receptionists → review Overview daily → read settlement statements and match payouts. |
| Devices and connectivity | Android phone for daily checks; Windows laptop for setup and reports; venue fiber that sometimes drops. |
| Trust concerns | Who pays the 5% and the gateway fee; payout timing; who owns customer data; whether the platform steers his players to competitors; safety of uploaded documents; lock-in. |
| Success criteria | Setup finished in one afternoon after approval; zero manual payment checks; statement totals match payouts; no-show rate falls. |
| Primary surfaces | `/for-business`, `/pricing` (calculator), `/biz/onboarding`, `/biz`, `/biz/pricing`, `/biz/staff`, `/biz/payouts`, `/biz/reports` |
| Design implications | Fee calculator using the canonical ₱400 → ₱380 example; simulator shows venue net; payout timing labeled as provider-dependent; permissions explained in plain words; customer data ownership stated in the terms and in the portal. |

### P5 — Patricia Lim, the multi-venue operator (illustrative)

> "Every manager should see their venue, and only their venue."

| Attribute | Detail |
|---|---|
| Context | Managing director of "Rally Point Ventures Inc." (synthetic, SEC-registered, VAT-registered) with three venues: Makati Dink Club, Alabang Rally Point and Santa Rosa Pickle Park — 12 courts, a site manager per venue, an in-house accountant, about 15 staff with regular turnover. |
| Goals | One pricing framework with local variation; venue-scoped staff access; consolidated and per-venue reports; exports her accountant can use for BIR filings; a negotiated commission rate; an audit trail of staff actions. |
| Pain points | Onboarding and offboarding staff across tools; reconciling three venues; VAT-inclusive pricing and invoices; managers changing prices informally. |
| Key tasks | Create a custom "Site Supervisor" role scoped to one venue → approve goodwill refunds (`refunds.approve`, MFA) → review her commission agreement → export monthly reports by payment date → compare utilization across venues → manage the payout account (Owner-only). |
| Devices and connectivity | Laptop at 1280 px and wider; iPad in meetings; accountant works in spreadsheets from CSV exports. |
| Trust concerns | Isolation from competitor venues on the same platform; agreed rates honored on every booking; segregation of duties. |
| Success criteria | Month-end close in hours, not days; offboarding revokes access and sessions immediately; per-venue statements reconcile with sub-account payouts. |
| Primary surfaces | `/biz` (all venues), `/biz/staff`, `/biz/reports`, `/biz/payouts`, `/biz/audit`, `/biz/settings` |
| Design implications | Business and venue switchers; venue-scoped role assignments; every export states its date basis; filterable audit log; permission editor with risk labels and "cannot grant what you do not hold". |

### P6 — Mark Villanueva, the front-desk receptionist (illustrative)

> "If the system says paid, it's paid. I shouldn't have to argue."

| Attribute | Detail |
|---|---|
| Context | Evening-shift receptionist (3–11 PM) at Pasig Pickle Hub; first full-time job. Handles check-ins, walk-ins, product pickups (water, balls, paddle rental) and questions. |
| Goals | Check players in within seconds; see which court is next and who is late; sell a walk-in slot without calling the owner; hand orders to the right person; avoid mistakes. |
| Pain points | Arguments over payment screenshots; 6–8 PM queues; no clear rule for declaring a no-show; players asking him for refunds he cannot give. |
| Key tasks | Sign in with his own account on the desk tablet → open Today → scan QR or type booking code → create a walk-in and show the payment QR → mark no-show after the grace period → mark orders ready and claimed. |
| Devices and connectivity | Shared 10-inch Android tablet at the desk plus his own phone; venue Wi-Fi; noisy, bright, constant interruptions. |
| Access | `receptionist`: `bookings.view`, `bookings.create_walkin`, `bookings.check_in`, `bookings.mark_no_show`, `payments.view`, `customers.view`, `orders.fulfill`, `events.check_in`, `restrictions.view` (plus implicit `business.view`). |
| Trust concerns | Being blamed for errors — wants actions recorded under his name; wants the system, not him, to refuse what he cannot do; does not want to see customers' phone numbers. |
| Success criteria | Check-in under 5 seconds; walk-ins confirmed without manual verification; a neutral script when a booking is not allowed. |
| Primary surfaces | `/biz/calendar` (Today), check-in scanner, `/biz/walk-in`, `/biz/orders`, `/biz/bookings` |
| Design implications | Large targets and high contrast for glare; scanner with manual code fallback; "Already checked in at 6:02 PM by Mark V." messages; no finance widgets for his role; fast re-login after the 30-minute idle timeout; "Switch user" so shifts never share a session. |

### P7 — Aileen Torres, the event organizer and coach (illustrative)

> "I want to coach, not chase payments in group chats."

| Attribute | Detail |
|---|---|
| Context | Freelance coach running beginner clinics (Tuesday and Thursday mornings) and Friday Night Open Play at Pasig Pickle Hub, plus a monthly social at Makati Dink Club. Staff member of both businesses with the `event_manager` role; also a player. |
| Goals | Create events quickly by copying last week's; cap capacity at 16; automatic waitlist; message registrants about changes; check people in; see headcount at a glance. |
| Pain points | Collecting fees from 16 people individually; tracking who paid; waitlists in group chats; no-shows. |
| Key tasks | Switch business → copy an event → set divisions, skill range, fee, capacity, registration window → publish → watch registrations → post an announcement → check in participants → let the system handle withdrawals and waitlist offers. |
| Devices and connectivity | Android phone at the courts; laptop for planning. |
| Access | `event_manager`: `bookings.view`, `events.manage`, `events.check_in`, `customers.view` — no contact details, no finance. |
| Trust concerns | Participant privacy; fairness of the waitlist. Her own fee arrangement with venues is off-platform and out of scope. |
| Success criteria | Events fill on their own; zero manual payment tracking; announcements reach every registrant. |
| Primary surfaces | Business switcher, `/biz/events`, `/events/:id` (public preview), `/app` as a player |
| Design implications | Business switcher always visible for multi-membership users; "Copy event"; waitlist view with positions and offer expiries; announcement composer that sends through CourtKo notifications, never exposing contact details. |

## 5. Platform persona

### P8 — Nina Castillo, platform finance and operations lead (illustrative)

> "Show me what doesn't match, and why."

| Attribute | Detail |
|---|---|
| Context | CPA at CourtKo with the `platform_finance` role. Works with a `superadmin` colleague (illustrative: Dana Uy) as maker-checker counterpart. Handles escalated refunds and disputes. |
| Goals | Daily reconciliation clean by mid-morning; exceptions resolved within two business days; approve high-value and after-payout refunds; monitor payouts; draft commission agreements; month-end reports for tax. |
| Pain points | Provider report formats; fee variances; refunds after payout that create venue receivables; ad-hoc reports that mix payment and play dates; chasing evidence for disputes. |
| Key tasks | Review reconciliation exceptions → drill into ledger journals with provider references → propose an agreement change (maker) → approve refunds (`platform.refunds.approve`) → watch payout failures → export reports by explicit date basis. |
| Devices and connectivity | Desktop with two monitors; office network on the admin IP allowlist; TOTP app on her phone. |
| Trust concerns | Segregation of duties; immutable ledger; no exposure to card data; her own actions audited. |
| Success criteria | Zero unbalanced journals; exception backlog under two business days; statements tie out to provider reports. |
| Primary surfaces | `/admin`, `/admin/transactions` (reconciliation), `/admin/commissions`, `/admin/refunds`, `/admin/payouts`, `/admin/disputes`, `/admin/reports` |
| Design implications | Exception-first overview; internal vs provider amounts side by side; date-basis selector on every financial view; maker-checker UI that blocks self-approval and explains why; exports audited. |

## 6. Coverage

### 6.1 Roles not modeled as full personas

| Role | Represented by | Where designed |
|---|---|---|
| `platform_support` | Illustrative agent "Leo Garcia" | J12 support impersonation; `/admin/support` |
| `platform_trust_safety` | — | J10 (platform-level variant); `/admin/moderation` |
| `platform_compliance` (DPO office) | — | J13 data export and deletion; `/admin/audit`, privacy requests |
| `superadmin` | Dana Uy (checker in J11) | J11 maker-checker |
| `business_manager` | Joel's cousin (manager at Pasig Pickle Hub) | J7 court block conflict (has `bookings.cancel`) |
| `court_manager` | Site staff at Rally Point venues | J7 (lacks `bookings.cancel`, sees the escalation branch) |
| `finance_viewer` | Patricia's accountant | Settlement statement, reports |
| `inventory_manager` | Pasig Pickle Hub stockroom staff | J9 product orders |

### 6.2 Persona × surface

| Persona | Public site | Player app | Business portal | Staff operations | SuperAdmin |
|---|---|---|---|---|---|
| P1 Bea | Secondary | **Primary** | — | — | — |
| P2 Ramon | **Primary** (search) | **Primary** | — | — | — |
| P3 Carla | Secondary (events) | **Primary** | — | — | — |
| P4 Joel | Secondary (`/for-business`, `/pricing`) | Occasional | **Primary** | Secondary | — |
| P5 Patricia | — | — | **Primary** | — | — |
| P6 Mark | — | Occasional (as a player) | — | **Primary** | — |
| P7 Aileen | Secondary (event preview) | Secondary | — | **Primary** (events) | — |
| P8 Nina | — | — | — | — | **Primary** |

### 6.3 Persona × journey (doc 04)

| Journey | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 |
|---|---|---|---|---|---|---|---|---|
| J1 Discover and book | ● | ● | ○ | | | | | |
| J2 Delayed/late payment | ● | ○ | | | | | | ○ |
| J3 Cancel with partial refund | ● | ○ | | ○ | | | | |
| J4 Reschedule | ● | ● | | | | | | |
| J5 Business onboarding to publish | | | | ● | ● | | | ○ |
| J6 Receptionist daily operations | ○ | ○ | | ○ | | ● | | |
| J7 Maintenance block conflict | ○ | ● | | ● | ○ | | | |
| J8 Event registration and waitlist | | | ● | | | | ● | |
| J9 Product add-on and pickup | ● | | | | | ● | | |
| J10 Player restriction | ○ | | | ● | ○ | ○ | | |
| J11 Approval, commission, reconciliation | | | | ○ | ○ | | | ● |
| J12 Support impersonation | ○ | | | | | | | ○ |
| J13 Data export and account deletion | ● | | ○ | | | | | |

● primary actor or directly affected · ○ secondary

## 7. Validation plan

| Question | Method | Sample (target) | Decision it informs |
|---|---|---|---|
| Which payment methods do players actually use, and how do they react to a visible per-method fee? | Demo usability sessions with fee variants | 12–15 players across P1–P3 profiles | Default method order; pass-through settings per method, subject to doc 23 D-05 |
| Is a 10-minute hold enough on a slow connection with e-wallet app switching? | Timed tasks on mid-range Android over throttled 4G | 8 players | Hold TTL and extension design (doc 23 D-33) |
| Will venue owners accept 5% plus a customer-paid gateway fee? | Owner interviews with the `/pricing` calculator | 5–8 owners (single and multi-venue) | Default commission; fee bearer defaults |
| How do receptionists handle cash walk-ins today? | Shadowing at two venues during peak hours | 2 venues, 4 shifts | Cash/offline booking decision (doc 23 D-29) |
| What no-show grace and check-in window match reality? | Venue interviews plus pilot data | Pilot venues | Default grace (15 min) and window (30 min) |
| Do players understand neutral restriction wording without feeling accused? | Copy testing | 8 players | Restriction message copy |

Findings update these personas and the assumptions log (doc 23).
