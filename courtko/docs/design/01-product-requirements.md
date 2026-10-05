# 01 — Product Requirements Summary

| Field | Value |
|---|---|
| Document | 01 of 23 — Product requirements summary |
| Product | CourtKo (working name, configurable; trademark search pending) |
| Status | Draft v1.0 for product-owner review |
| Owner | Product (Senior PM); approver: Jerome (product owner) |
| Last updated | 2026-09-30 |
| Sources | Original product brief (verbatim requirements); CourtKo canonical design brief |
| Related | [02 Personas](02-user-personas.md) · [03 Role & permission matrix](03-role-permission-matrix.md) · [04 Journeys](04-key-user-journeys.md) · [05 IA](05-information-architecture.md) · [06 Sitemap](06-sitemap.md) · [07 Booking state machine](07-booking-state-machine.md) · [08 Payment state machine](08-payment-state-machine.md) · [09 Refund & payout flow](09-refund-and-payout-flow.md) · [18 MVP scope](18-mvp-scope.md) · [19 Implementation phases](19-implementation-phases.md) · [23 Assumptions & decisions](23-assumptions-and-decisions.md) |

This document describes the **production** system. The interactive demo (Phase 0) runs the same pricing, availability, commission, ledger, refund and state-machine rules in the browser with synthetic data and a mock payment provider standing in for Xendit. All names, amounts and identifiers in this document are synthetic.

---

## 1. Vision

CourtKo is a trusted, commission-based marketplace where anyone in the Philippines can find a pickleball court, see the full price, pay with the method they already use, and arrive knowing the court is theirs. Venue businesses run courts, schedules, pricing, events, products, staff and money from one secure workspace that no other business can see.

Tagline: "Book pickleball courts across the Philippines."

Product tenets (used to settle trade-offs):

1. **Confirmed means confirmed.** A booking is confirmed only after server-verified payment. A court-minute can never be sold twice.
2. **Money is never a surprise.** Every fee, tax and discount is shown before payment and appears again as a separate line on receipts and statements.
3. **Each business is an island.** Tenant data is isolated in the application and in the database; cross-tenant access returns "not found".
4. **Least privilege, visible.** Staff see what their role allows; high-risk actions need step-up authentication, approval, or both.
5. **Built for a phone on mobile data.** Mobile-first, fast on mid-range Android over 4G, tolerant of dropped connections mid-payment.
6. **Privacy by design.** Collect only what a documented purpose needs; location is opt-in and never tracked continuously.

## 2. Problem

### 2.1 Players
- Booking happens in Messenger/Viber threads and phone calls; replies are slow at exactly the times people want to play.
- Payment "proof" is a screenshot of an e-wallet transfer: easy to fake, hard for staff to verify, slow to refund.
- Availability and rates (peak, weekend, holiday) are unknown until someone replies.
- Double bookings happen because schedules live in notebooks and spreadsheets.
- Cancellation and rain rules are inconsistent and rarely written down before payment.

### 2.2 Venue businesses
- Staff hours go to answering messages and matching screenshots to e-wallet credits.
- No-shows and late cancellations carry no enforceable policy.
- Pricing changes are manual; there is no utilization data and no clean trail for BIR filings.
- Access control is informal: shared logins, receptionists seeing revenue, no audit trail.

### 2.3 Platform
- A two-sided marketplace needs trust in both directions: verified venues for players, guaranteed and reconciled payments for venues.
- Holding or settling funds in the Philippines has regulatory implications (RA 11127, RA 11967, RA 10173, BIR rules) that shape the payment design (see §8).

Market hypotheses to validate during the pilot (not facts): e-wallets and QR Ph are the default payment methods for this audience; peak demand is weekday evenings and weekend mornings; covered and indoor courts command a premium in the rainy season; venue owners accept a commission if it replaces manual work and reduces no-shows.

## 3. Goals and success metrics

North-star metric: **completed court-hours booked through CourtKo per week** (sum of durations of bookings reaching `completed`, by play date).

All numeric values below are **targets** for the first six months after general availability, to be re-baselined after 90 days of live data. Items marked "hard requirement" are invariants, not targets.

| # | Goal | Metric | Definition | Target |
|---|---|---|---|---|
| G1 | Fast, reliable booking | Checkout conversion | Online bookings reaching `confirmed` ÷ holds created | ≥ 60% |
| G1 | | Time to book (returning player) | Median time from venue page open to `confirmed` | ≤ 90 s |
| G1 | | Booking integrity | Court-minutes sold more than once | 0 (hard requirement) |
| G2 | Venue adoption | Time to first publish | Median time from business `active` to first venue `published` | ≤ 2 days |
| G2 | | Verification turnaround | Median time `pending_verification` → decision | ≤ 2 business days |
| G2 | | Active venues | Published venues with ≥ 10 confirmed bookings in trailing 30 days | Set by product owner (placeholder: 30) |
| G3 | Trust in money | Payment confirmation latency | p95 from verified webhook receipt to booking `confirmed` | ≤ 15 s |
| G3 | | Reconciliation health | Unmatched provider transactions older than 2 business days | < 0.1% of transactions |
| G3 | | Ledger integrity | Unbalanced journals | 0 (hard requirement) |
| G3 | | Refund timeliness | Refunds reaching `succeeded` within the provider's stated window per method | ≥ 95% (provider-dependent) |
| G4 | Efficient operations | Check-in speed | Median time from QR scan to `checked_in` | ≤ 5 s |
| G4 | | No-show rate | `no_show` ÷ bookings with play date in period | 30% below each venue's pre-CourtKo baseline (baseline collected at onboarding) |
| G5 | Healthy economics | Effective take rate | Platform commission ÷ commissionable GBV | Within 0.2 pp of configured rates after promotions |
| G5 | | Fee burden | Platform-borne gateway fees ÷ commission revenue | ≤ 25% |
| G6 | Quality and trust | Accessibility | Critical flows audited against WCAG 2.2 AA | 0 critical/serious issues at launch |
| G6 | | Support load | Support cases per 100 bookings | ≤ 3 |
| G6 | | Booking CSAT | Post-booking survey score | ≥ 4.5 / 5 |

Guardrails (watched, not optimized): chargeback rate (target ≤ 0.3% of captured payments), restriction appeals overturned (fairness signal), p75 LCP on mobile (≤ 2.5 s), refund failures per 1,000 refunds.

## 4. Business model

CourtKo earns a **commission on successful bookings**. There is no subscription. The commission rate, fee pass-through and fee bearer are configuration, never code constants.

### 4.1 Mechanics (canonical formulas)
- Rates are stored as integer parts-per-million (ppm): 5% = 50,000 ppm. Money is integer centavos. Rounding is half-up to the centavo, once per computed component, using integer/BigInt math.
- `booking_base` = Σ over time slices of (slice minutes × applicable hourly rate ÷ 60), with the venue's minimum charge applied.
- Discounts carry `funded_by`: `venue` or `platform`.
- `commissionable_base` (default definition `base_after_venue_funded_discounts`) = commissionable items − venue-funded discounts allocated to them. By default only **court bookings** are commissionable; products and events are commissionable only if the business's commission agreement says so. Platform-funded discounts do not reduce the commissionable base.
- `platform_commission` = round(commissionable_base × commission_rate_ppm ÷ 1,000,000). Rate resolution: the business's active commission agreement (by effective date), else the global default. Agreement and rate are snapshotted on the booking.
- `gateway_fee`: from the payment method's fee schedule (percent ppm + fixed centavos, from the provider contract — **PLACEHOLDER** until contracted). If pass-through is enabled for the method, the customer pays the gross-up fee `ceil_to_centavo((net + fixed) / (1 − pct)) − net`; otherwise the configured bearer absorbs it (`platform` by default, or `venue`). The actual provider fee is recorded at reconciliation; any difference posts to `platform:gateway_fee_variance`.
- `customer_total` = booking_base + products + event fees + exclusive taxes + gateway_fee (if passed through) − customer discounts.
- `venue_net` = gross venue items − venue-funded discounts − platform_commission − venue-borne gateway fee (if venue is bearer) − venue-responsible adjustments − venue share of refunds (− withholding tax, if applicable). Venue-funded discounts are subtracted exactly once.

### 4.2 Canonical example (used in every document that explains money)

| Line | Centavos | Display |
|---|---:|---:|
| Booking base (1 court-hour) | 40,000 | ₱400.00 |
| Gateway fee — QR Ph, passed to customer (placeholder schedule) | 1,500 | ₱15.00 |
| **Customer total** | **41,500** | **₱415.00** |
| Platform commission (50,000 ppm × 40,000) | 2,000 | ₱20.00 |
| **Venue net** | **38,000** | **₱380.00** |
| Platform revenue | 2,000 | ₱20.00 |
| Provider fee (charged by provider, recovered from customer) | 1,500 | ₱15.00 |

Capture journal (double-entry, append-only; debits = credits):

| Account | Debit | Credit | Entry type |
|---|---:|---:|---|
| `platform:provider_clearing` | 41,500 | | customer_charge |
| `venue:{business_id}:payable` | | 40,000 | booking_base |
| `venue:{business_id}:payable` | 2,000 | | platform_commission |
| `platform:commission_revenue` | | 2,000 | platform_commission |
| `platform:gateway_fee_recovery` | | 1,500 | gateway_fee |

Provider fee: Dr `platform:gateway_fee_expense` 1,500 / Cr `platform:provider_clearing` 1,500. Payout: Dr `venue:{business_id}:payable` 38,000 / Cr `platform:provider_clearing` 38,000.

> **Pass-through status.** The canonical example shows gateway-fee pass-through ON so that every line is visible. Until counsel confirms each method in writing, pass-through is **OFF for all methods** (doc 23 D-05, A-17): the customer pays ₱400.00, the platform bears the fee, and platform net on this booking is ₱20.00 − ₱15.00 = ₱5.00 with the placeholder fee (doc 23 §3.2). BSP guidance indicates customers pay no fees for QR Ph person-to-merchant payments, so a QR Ph surcharge in particular is unlikely to be permitted.

### 4.3 Variants (same ₱400 booking, same placeholder QR Ph fee)

| Scenario | Customer pays | Commission | Venue net | Platform result | Notes |
|---|---:|---:|---:|---:|---|
| A. Canonical | ₱415.00 | ₱20.00 | ₱380.00 | +₱20.00 | Fee recovered from customer |
| B. ₱50 venue-funded promo | ₱365.00 | ₱17.50 | ₱332.50 | +₱17.50 | Commissionable base ₱350.00 |
| C. ₱50 platform-funded promo | ₱365.00 | ₱20.00 | ₱380.00 | −₱30.00 | Venue unaffected; platform books ₱50.00 to `platform:promotions_expense`. Under `provider_split` the platform must top up the venue — gated until doc 23 D-31 |
| D. Fee not passed through (the default for every method until doc 23 D-05 resolves) | ₱400.00 | ₱20.00 | ₱380.00 | ₱20.00 − actual fee (₱5.00 with the ₱15.00 placeholder) | Bearer = platform by default; venue only by agreement |
| E. Player cancels 10 h before start (Standard policy, 50%) | ₱415.00 paid, ₱200.00 refunded | ₱10.00 after proportional reversal | ₱190.00 | +₱10.00 | Gateway fee non-refundable (disclosed before payment) |
| F. Venue cancels (court unavailable) | ₱415.00 paid, ₱415.00 refunded | ₱0.00 | ₱0.00 | −₱15.00 | Platform absorbs the fee (assumes the provider does not return its fee on refunds — PLACEHOLDER) |

Check for every row: customer net paid = venue net + platform commission + fee recovered − platform-funded discounts.

### 4.4 Settlement models (per business `settlement_model`)
- **Option A `provider_split` (default, MVP).** Payments are created on behalf of the business's Xendit xenPlatform sub-account with a split rule routing platform commission (and the customer-paid fee recovery, if configured) to the platform master account. Venue funds land in the venue's sub-account; payouts are withdrawals from that sub-account to the venue's bank. The platform does not hold venue funds.
- **Option B `platform_payout` (disabled by default).** Funds land in the platform account and the platform pays venues on a schedule via a payouts API. Requires legal and regulatory review (possible BSP Operator of Payment Systems registration under RA 11127, trust/escrow accounting, BIR implications). The ledger supports it; the switch stays off until review is complete.
- The platform never assumes an automatic split exists: every split, transfer and payout is a recorded ledger event with provider references.

### 4.5 Configuration points

| Setting | Stored in | Who can change | Control |
|---|---|---|---|
| Global default commission rate | `platform_settings` | `platform.commissions.manage` | Maker-checker, audited, effective-dated |
| Per-business commission agreement (rate, commissionable items, fee bearer, settlement model) | `commission_agreements` | `platform.commissions.manage` | Maker-checker; signed agreement reference required; snapshotted per booking |
| Method fee schedule and pass-through toggle | Payment method configuration | `platform.config.manage` | Values from provider contract (PLACEHOLDER); pass-through OFF for every method until counsel confirms it in writing (doc 23 D-05); changes go through maker-checker |
| VAT registration / VAT-inclusive pricing | Business settings | Business owner (`business.settings.manage`), verified by platform | Tax treatment confirmed with tax counsel |
| Withholding on remittances, VAT on commission | `platform_settings` | `platform.config.manage` | Requires tax-counsel confirmation |

## 5. Scope by experience

| Experience | Users | Host (production) | Primary jobs |
|---|---|---|---|
| Public website | Anyone | courtko.ph | Discover venues, check availability, read how it works, pricing and policies; start sign-up |
| Player app | Registered players | app.courtko.ph (paths under `/app`; doc 05 §7.1) | Book, pay, cancel/reschedule, join events, buy pickup products, track activity, manage privacy |
| Business portal | Business owners and managers | business.courtko.ph | Onboard and verify, configure venues/courts/pricing/policies, manage staff, monitor money and reports |
| Staff operations portal | Receptionists, court/event/inventory managers, finance viewers | business.courtko.ph (same app, permission-filtered) | Run the day: calendar, check-in, walk-ins, no-shows, blocks, orders, events |
| SuperAdmin control center | Platform staff (`superadmin`, `platform_support`, `platform_finance`, `platform_trust_safety`, `platform_compliance`) | admin.courtko.ph (WAF IP allowlist, mandatory MFA) | Verify businesses, govern commission, reconcile money, approve exceptional refunds, moderate, support, secure, audit |

Pages per experience follow the original brief: public (Home, Find a Court, Venue Details, Events, How It Works, For Business Owners, Pricing/Commission Explanation, Help Center, Terms, Privacy Notice, Contact & Support); player (Home, Discover, Bookings, Events, Orders, Activity, Favorites, Notifications, Profile, Payments, Settings); business (Overview, Calendar, Bookings, Courts, Pricing, Events, Products, Customers, Restrictions, Staff, Payments, Payouts, Reports, Reviews, Settings, Audit Log, plus Walk-in, Venues, Orders, Onboarding); SuperAdmin (Platform Overview, Businesses, Venues, Users, Bookings, Events, Products, Transactions, Commissions, Payouts, Refunds, Disputes, Reports, Moderation, Support, Security, Audit Logs, Platform Configuration). Routes are in [06 Sitemap](06-sitemap.md).

## 6. Functional requirements

Phase: **MVP**, **P2** (Phase 2), **P3** (Phase 3). Detailed acceptance criteria are in [18 MVP scope](18-mvp-scope.md). Status values, permission codes and error codes are the canonical identifiers from the design brief.

### 6.1 ACC — Accounts and authentication

| ID | Requirement | Phase |
|---|---|---|
| ACC-01 | Register with email + password, mobile number + OTP, or an identity provider (Google at MVP; others P2) | MVP |
| ACC-02 | Verify email and mobile before a first booking, payment or business registration | MVP |
| ACC-03 | Passwords hashed with Argon2id (PHC strings, rehash on login); length-based policy with breached/common-password blocklist | MVP |
| ACC-04 | TOTP MFA with hashed recovery codes: mandatory for platform staff, `business_owner`, `business_manager`; optional for everyone else. Passkeys P2 | MVP |
| ACC-05 | Password reset with single-use, time-limited tokens; resets revoke all sessions and trigger a security notification | MVP |
| ACC-06 | Sessions: idle 30 min (admin 15 min), absolute 12 h, player "remember me" 30 days; device and login history; revoke one or all sessions | MVP |
| ACC-07 | Risk-based throttling, temporary lockout, suspicious-login alerts; CAPTCHA/challenge only when risk is elevated | MVP |
| ACC-08 | Profile: display name, avatar, optional home area, self-declared skill level, visibility settings | MVP |
| ACC-09 | One account can be a player and a staff member of several businesses; the account menu offers only the surfaces the user has access to. Platform staff use separate workforce accounts with no business memberships or bookings (doc 23 A-11) | MVP |

### 6.2 TEN — Tenancy and access control

| ID | Requirement | Phase |
|---|---|---|
| TEN-01 | Every tenant-owned row carries `business_id`; isolation enforced by application scoping and PostgreSQL RLS (`FORCE ROW LEVEL SECURITY`) | MVP |
| TEN-02 | Cross-tenant object access returns 404 `NOT_FOUND`; attempts are logged as security events | MVP |
| TEN-03 | Business permission catalog and system role templates exactly as doc 03; owners can create custom roles | MVP |
| TEN-04 | Role assignments can be scoped to specific venues (`business_member_roles.venue_id`, NULL = all venues) | MVP |
| TEN-05 | `staff.manage` cannot grant permissions the actor does not hold; the last `business_owner` cannot be removed or demoted | MVP |
| TEN-06 | `finance.manage_payout_account` is Owner-only with MFA step-up and notification; `refunds.approve` requires MFA step-up | MVP |
| TEN-07 | Platform roles and platform permission catalog as in the brief; `platform.commissions.manage` actions need a second approver | MVP |
| TEN-08 | Authorization evaluated server-side on every request, including object-level checks; hidden UI is never a control | MVP |

### 6.3 ONB — Business onboarding and verification

| ID | Requirement | Phase |
|---|---|---|
| ONB-01 | A verified user can register a business: trade and legal name, entity type, registration numbers, TIN, address, contacts, owner identity | MVP |
| ONB-02 | Upload verification documents (PDF/JPEG/PNG, size-limited, malware-scanned before any reviewer can open them) | MVP |
| ONB-03 | Business lifecycle: `draft` → `pending_verification` → `active` or `rejected`; `rejected` → `pending_verification` on resubmission; `active` ↔ `suspended` | MVP |
| ONB-04 | Structured rejection reasons per item; the owner resubmits only the flagged items | MVP |
| ONB-05 | On approval, provision a provider sub-account and store its reference (xenPlatform type MANAGED vs OWNED: decision pending) | MVP |
| ONB-06 | Owner connects a payout bank account through the provider; only masked details are stored; changes require Owner + MFA and notify all finance-permission holders | MVP |
| ONB-07 | A venue can be published only when the business is `active` and the sub-account can accept payments | MVP |

### 6.4 VEN — Venues, courts and schedules

| ID | Requirement | Phase |
|---|---|---|
| VEN-01 | Multiple venues per business with name, description, logo/cover, contacts, structured PH address (region, province, city/municipality, barangay, street, landmark), map pin, rules, amenities, parking, accessibility, accepted payment methods, policies, IANA timezone (default `Asia/Manila`) | MVP |
| VEN-02 | Courts per venue with format (full, half), environment (indoor, covered, outdoor), surface, custom tags, sort order, active flag | MVP |
| VEN-03 | Weekly operating hours (overnight spans allowed) and special hours for holidays, closures and special schedules | MVP |
| VEN-04 | Booking settings: min/max duration, start increment (30/60/90 min), advance-booking limit, cleanup buffer, check-in required flag | MVP |
| VEN-05 | Court blocks (maintenance, repair, weather, private use, closure) occupy `booking_slots`; overlapping bookings go through the conflict flow (doc 04, J7) | MVP |
| VEN-06 | Venue lifecycle `draft` → `published` ↔ `unpublished`; `suspended` by platform only; publish checklist enforced server-side | MVP |
| VEN-07 | Images re-encoded with metadata (including GPS EXIF) stripped; alt text required before publish | MVP |
| VEN-08 | Organizers, coaches and referees are added as staff with a role (`event_manager` or custom) | MVP |

### 6.5 PRC — Pricing and promotions

| ID | Requirement | Phase |
|---|---|---|
| PRC-01 | Rule types: base hourly, court-specific, time-of-day, peak/off-peak, weekday/weekend, holiday, date-specific override, seasonal, event rate, promotional, custom | MVP |
| PRC-02 | Rule attributes: venue/court scope, days of week, start/end time, effective start/end, priority, hourly rate, minimum charge, refundable or non-refundable plan, created_by/updated_by, version history | MVP |
| PRC-03 | Per time slice the highest-priority matching rule wins; equal priority → narrower scope (court over venue) wins; unresolved ties are rejected at save | MVP |
| PRC-04 | Price simulator shows slices, applied rules, fees, commission and venue net before a rule is saved | MVP |
| PRC-05 | Rate changes never alter a confirmed booking (immutable `booking_price_snapshots`) or a locked checkout quote | MVP |
| PRC-06 | Promo codes: fixed or percentage; applies-to (court booking, products, events); min spend; total and per-user usage limits; quantity limit; validity window; `funded_by` venue or platform (platform-funded codes enabled only after doc 23 D-31) | MVP |
| PRC-07 | Taxes per business `vat_registered` and `prices_include_vat`; VAT-inclusive items show "VAT (12%, included)"; exclusive taxes are added | MVP |
| PRC-08 | Add-on charges for products sold with a booking | MVP |
| PRC-09 | Member/loyalty rates; deposits | P2 |
| PRC-10 | Dynamic pricing recommendations | P3 |

### 6.6 DSC — Discovery and location

| ID | Requirement | Phase |
|---|---|---|
| DSC-01 | Location is requested only after the user taps "Use my location", with a plain-language explanation; denial never blocks search | MVP |
| DSC-02 | With permission: nearby venues sorted by proximity, approximate distance, map view, manual change of search area | MVP |
| DSC-03 | Without permission: search by city, municipality, barangay, landmark or venue name with autocomplete | MVP |
| DSC-04 | No continuous tracking; coordinates are rounded, used per request and not retained beyond the request | MVP |
| DSC-05 | List and map views; filters: distance, date, start-time window, duration, price, court environment and format, amenities, rating, event availability | MVP |
| DSC-06 | Venue card: name, cover, location, approximate distance, starting rate, rating, available courts, next available time, environment, key amenities, favorite toggle | MVP |
| DSC-07 | Venue page: details, courts, rules, policies, amenities, accessibility, reviews, events, products, live availability | MVP |
| DSC-08 | Ranking has no paid placement; sponsored listings | P3 |
| DSC-09 | Personalized recommendations | P2 |

### 6.7 BKG — Booking

| ID | Requirement | Phase |
|---|---|---|
| BKG-01 | Real-time availability per venue and date reflecting bookings, holds, blocks, event reservations, hours, buffers and advance limits | MVP |
| BKG-02 | Select court, date, start and duration within venue limits; up to 2 slots per checkout (the per-user active-hold limit) | MVP |
| BKG-03 | Before a hold: verified account, no active restriction in scope, venue rules and limits satisfied; restricted users receive `BOOKING_NOT_ALLOWED` with neutral copy | MVP |
| BKG-04 | Hold inserts an active `booking_slots` row guarded by the exclusion constraint; TTL 10 min; visible countdown; released on abandon or expiry | MVP |
| BKG-05 | Server-computed checkout quote: court price, add-ons, discounts, taxes, fee for the selected method, total, cancellation terms; stale quotes return `QUOTE_EXPIRED` | MVP |
| BKG-06 | Explicit acceptance of the displayed policy version (`POLICY_NOT_ACCEPTED` otherwise); the accepted version is stored on the booking | MVP |
| BKG-07 | Booking becomes `confirmed` only after capture is verified server-side (webhook plus provider re-query) | MVP |
| BKG-08 | Confirmation screen, digital receipt (a payment acknowledgment, not a BIR invoice — doc 23 D-13), notifications, signed check-in QR and human-readable booking code | MVP |
| BKG-09 | Confirmed bookings appear immediately in the business calendar and lists | MVP |
| BKG-10 | Add participants by name; invite registered users | MVP / P2 |
| BKG-11 | Reschedule once, ≥ 12 h before start, subject to availability; price difference charged or refunded; atomic slot swap with history | MVP |
| BKG-12 | Cancel with a refund preview (cancellation quote) before confirming | MVP |
| BKG-13 | Rebook a past booking with the selection pre-filled | MVP |
| BKG-14 | Walk-in bookings by staff with a payment link or on-screen payment QR; same pricing, restriction and payment-verification rules | MVP |
| BKG-15 | Protections: exclusion constraint, `Idempotency-Key` on every creating POST, one active payment session per checkout, stale-hold release, late-payment recovery, reconciliation | MVP |
| BKG-16 | Booking statuses and transitions exactly as doc 07; every transition writes a history entry | MVP |
| BKG-17 | Recurring bookings | P2 |
| BKG-18 | Split payment among participants (only if the provider supports it and the venue enables it) | P2 |

### 6.8 PAY — Payments

| ID | Requirement | Phase |
|---|---|---|
| PAY-01 | Approved provider only (first adapter: Xendit xenPlatform) via hosted checkout or provider SDK; the platform never receives card numbers, CVV/CVC, OTPs, wallet PINs or bank passwords | MVP |
| PAY-02 | Methods per actual contract (expected: QR Ph, GCash, Maya, cards, selected bank channels); each has an enable flag and fee schedule | MVP (provider-dependent) |
| PAY-03 | The fee for each method is shown before selection; pass-through is a per-method toggle, OFF for all methods until counsel confirms each one (doc 23 D-05) | MVP |
| PAY-04 | Webhooks: constant-time `x-callback-token` check, stored with `UNIQUE(provider, provider_event_id)`, fast 200, provider re-query before any state change | MVP |
| PAY-05 | Never mark paid from a browser redirect; the return page shows server state only | MVP |
| PAY-06 | Payment statuses exactly as doc 08; every change recorded in `payment_events` | MVP |
| PAY-07 | Failed or cancelled attempts return the booking to `slot_held` while the hold is valid | MVP |
| PAY-08 | Late capture after hold expiry: re-acquire the slot or refund in full automatically, including the fee | MVP |
| PAY-09 | Provider outage: `PROVIDER_UNAVAILABLE`, hold preserved, status banner; reconciliation catches up | MVP |
| PAY-10 | Every amount and transaction carries currency; storage in integer centavos | MVP |
| PAY-11 | Saved payment methods (provider tokens and masked metadata only) | P2 (provider-dependent) |

### 6.9 FIN — Commission, ledger, settlement and payouts

| ID | Requirement | Phase |
|---|---|---|
| FIN-01 | Global default commission (50,000 ppm) plus per-business agreements with effective dates and maker-checker approval | MVP |
| FIN-02 | Commission computed per §4.1 and snapshotted with agreement ID and rate on each booking | MVP |
| FIN-03 | Append-only double-entry ledger with canonical accounts and entry types; balanced journals enforced at commit; corrections by reversing journals only | MVP |
| FIN-04 | Settlement model per business: `provider_split` (default) or `platform_payout` (disabled pending legal review) | MVP (A) / gated (B) |
| FIN-05 | Daily settlement statements with separate lines for base, products, events, discounts by funder, taxes, fees, commission, refunds, adjustments and venue net, with provider references | MVP |
| FIN-06 | Payout tracking (`scheduled`, `processing`, `paid`, `failed`, `reversed`) with alerts on failure | MVP (provider-dependent) |
| FIN-07 | Refunds reverse commission proportionally by default; a refund after payout drives venue payable negative, recovered from future settlements | MVP |
| FIN-08 | Manual adjustments only as approved, audited adjusting journals | MVP |
| FIN-09 | Reconciliation: pending payments re-checked every 5 min; daily full reconciliation against provider reports; exception queue; fee variance posted | MVP |
| FIN-10 | Reports never mix date bases (booking, play, payment, settlement, payout, refund) | MVP |
| FIN-11 | VAT on commission and withholding on remittances are configurable, pending tax-counsel confirmation | MVP (configuration) |

### 6.10 REF — Cancellations, refunds, no-shows and disputes

| ID | Requirement | Phase |
|---|---|---|
| REF-01 | Versioned policies: Standard (≥ 24 h 100%, 6–24 h 50%, < 6 h 0%), Flexible (≥ 2 h 100%), Strict (≥ 72 h 100%, ≥ 24 h 50%), Non-refundable | MVP |
| REF-02 | Player cancellation refunds tier % × booking base; gateway fee non-refundable for player-initiated cancellations when disclosed before payment | MVP |
| REF-03 | Venue-initiated, court-unavailable, weather and system-failure cancellations refund 100% including the fee (platform absorbs the fee) | MVP |
| REF-04 | Refunds go to the original method; platform credit only where legally and contractually allowed | MVP / P2 (credit) |
| REF-05 | Approval: automatic within policy; goodwill and exception refunds need `refunds.approve`; > ₱5,000 or after payout also need `platform.refunds.approve` | MVP |
| REF-06 | Partial refunds, one item of a combined order, event cancellations, product cancellations | MVP |
| REF-07 | Refund failure: `failed` status, alert, retry or provider-supported alternative; player informed with next steps | MVP |
| REF-08 | No-show: staff may mark after start + 15 min grace; no automatic refund; player notified neutrally | MVP |
| REF-09 | Disputes/chargebacks tracked (`open`, `evidence_submitted`, `won`, `lost`) with an evidence pack (booking, policy acceptance, check-in, receipts) | MVP |

### 6.11 OPS — Business and staff operations

| ID | Requirement | Phase |
|---|---|---|
| OPS-01 | Overview shows decisions and exceptions first, then today's activity, then permission-gated financial summary | MVP |
| OPS-02 | Calendar of courts × time (day/week) with status colors plus patterns; create block or walk-in from an empty slot | MVP |
| OPS-03 | Bookings list with filters (status, date basis, court, source, payment status) and detail with full history | MVP |
| OPS-04 | Check-in by QR scan or booking code within the window (30 min before start until end) | MVP |
| OPS-05 | Mark no-show; venue-initiated cancellation (`bookings.cancel`); reschedule or move court on the customer's behalf (`bookings.reschedule`) | MVP |
| OPS-06 | `payments.confirm_status` triggers a provider re-check; no user can set "paid" manually | MVP |
| OPS-07 | Customer list and history (`customers.view`); email/phone only with `customers.view_contact` | MVP |
| OPS-08 | Staff invites, role and venue-scope assignment, immediate deactivation; custom role editor with risk labels | MVP |
| OPS-09 | Read and respond to reviews (`reviews.respond`); report abusive reviews | MVP |
| OPS-10 | Business audit log (`audit.view`) | MVP |

### 6.12 EVT — Events, tournaments and open play

| ID | Requirement | Phase |
|---|---|---|
| EVT-01 | Event types: tournament, league, clinic, training, open play, social, private | MVP (registration features) |
| EVT-02 | Configuration: name, description, venue and courts (reserved in `booking_slots`), schedule, organizer, capacity, fee, divisions, skill requirement, age category where appropriate, team/individual, registration open/close, waitlist, cancellation policy, match format, prizes (informational), rules, check-in, visibility, publish/unpublish | MVP |
| EVT-03 | Registration statuses as in the brief (`held` → `pending_payment` → `confirmed`, etc.); capacity counts held, pending, offered and confirmed seats | MVP |
| EVT-04 | Full events return `EVENT_FULL` and offer the waitlist; a freed seat creates an `offered` registration with expiry; expired offers cascade to the next person | MVP |
| EVT-05 | Withdrawal per event policy; venue cancellation of an event refunds all participants in full | MVP |
| EVT-06 | Organizer announcements to registrants through notifications (no contact details exposed) | MVP |
| EVT-07 | Event check-in (`events.check_in`) | MVP |
| EVT-08 | Partner/team invites and team management (MVP captures partner name for doubles divisions) | P2 |
| EVT-09 | Brackets, match scheduling, official results; advanced league management | P2 / P3 |

### 6.13 PRD — Products and venue pickup

| ID | Requirement | Phase |
|---|---|---|
| PRD-01 | Product fields: name, description, images, price, stock quantity/status, variants, category, availability schedule, venue, pickup instructions, max quantity per order, tax configuration, active flag | MVP |
| PRD-02 | Sold as booking add-on, event add-on or standalone pickup | MVP |
| PRD-03 | Stock reserved during checkout; `OUT_OF_STOCK` before payment; stock changes recorded in `inventory_movements` | MVP |
| PRD-04 | Order statuses: `pending_payment`, `paid`, `preparing`, `ready_for_pickup`, `claimed`, `cancelled`, `refunded`, `partially_refunded` | MVP |
| PRD-05 | Claim by QR or claim code; exactly one successful claim per order; a second attempt shows who claimed it and when | MVP |
| PRD-06 | Equipment rental with return tracking (MVP sells rentals as products) | P2 |

### 6.14 RST — Restrictions

| ID | Requirement | Phase |
|---|---|---|
| RST-01 | Fields: user, business, optional venue, reason category, internal notes, start/end, temporary/permanent, created_by, approved_by, evidence/incident reference, status (`active`, `lifted`, `expired`), appeal status, history | MVP |
| RST-02 | Blocks new bookings, walk-ins and restricted event registrations in scope; checked at hold and again at confirmation | MVP |
| RST-03 | Never public, never visible to other businesses; the player receives neutral wording and an appeal path | MVP |
| RST-04 | Appeals via support: `none`, `submitted`, `upheld`, `overturned` | MVP |
| RST-05 | `restrictions.view` shows existence and reason category; `restrictions.manage` shows notes and can create or lift | MVP |
| RST-06 | Platform-level restrictions only by `superadmin` or `platform_trust_safety` (`platform.restrictions.manage`) | MVP |

### 6.15 PLY — Player profile, activity and ratings

| ID | Requirement | Phase |
|---|---|---|
| PLY-01 | Activity dashboard: sessions, bookings, hours, venues visited, upcoming/completed/cancelled, events, frequency, booking and spending history | MVP |
| PLY-02 | Skill level always labeled with its source: self-declared (MVP); venue-verified and external provider via official API with user authorization (P2); platform recreational rating (P3). No invented official rating | MVP–P3 |
| PLY-03 | Tournament results and win/loss only when officially recorded; achievements and progress trends | P2 |
| PLY-04 | Visibility per stat group: private, event organizers, public (connections P2) | MVP |
| PLY-05 | Favorites and one-tap rebook | MVP |
| PLY-06 | Reviews only after a verified `completed` booking; one per booking | MVP |
| PLY-07 | Report a venue, event, product, review or user | MVP |
| PLY-08 | Full access to own booking, payment, refund and order records and receipts | MVP |

### 6.16 NTF — Notifications

| ID | Requirement | Phase |
|---|---|---|
| NTF-01 | Channels: in-app and email (MVP); SMS for OTP and critical booking messages once an aggregator and registered sender ID are contracted, with templates that carry no clickable links (MVP, provider-dependent — doc 23 D-22); Web Push (P2 with the installable PWA) | MVP / P2 |
| NTF-02 | Events: verification, business approval, booking confirmation, payment confirmation/failure, reminders (24 h, 2 h), cancellation, refund update, court change, venue closure, maintenance conflict, event reminder, waitlist offer, product ready, payout completed/failed, security alert, password/account change, support-session access notice | MVP |
| NTF-03 | Users manage non-essential categories per channel; transactional and security messages stay on | MVP |
| NTF-04 | Delivered from a transactional outbox; idempotent, retried, dead-lettered with alerts | MVP |

### 6.17 ADM — SuperAdmin control center

| ID | Requirement | Phase |
|---|---|---|
| ADM-01 | Business verification queue; approve, reject, suspend, reactivate | MVP |
| ADM-02 | Venue and listing moderation; suspend or unpublish | MVP |
| ADM-03 | Users and staff: view, suspend, platform restrictions | MVP |
| ADM-04 | Cross-tenant read of bookings, events, products with payment, settlement, fee, refund, discount and venue-earnings detail | MVP |
| ADM-05 | Transactions and ledger explorer; reconciliation runs and exception resolution | MVP |
| ADM-06 | Global default commission and per-business agreements with maker-checker | MVP |
| ADM-07 | Payouts, platform-level refund approvals, disputes | MVP |
| ADM-08 | Configuration: payment providers and methods, fee schedules, pass-through, taxonomies (court types, amenities, event types, product categories, restriction reasons), policy templates, holiday calendar, platform content, feature flags | MVP |
| ADM-09 | Platform-funded promo codes and basic campaigns (enabled after doc 23 D-31) | MVP |
| ADM-10 | Moderation queue for reported users, venues, events, products, reviews | MVP |
| ADM-11 | Support mode: reason (≥ 15 characters) + ticket, ≤ 30 min, read-only, persistent banner, full audit, blocked sensitive areas | MVP |
| ADM-12 | Operational and security alerts: failed-payment spikes, payout failures, unusual activity, double-booking attempts, security events | MVP |
| ADM-13 | Audit log search and integrity verification | MVP |
| ADM-14 | Exports per access policy (`platform.reports.export`), audited | MVP |
| ADM-15 | Privacy request handling (`platform.privacy.requests`) | MVP |

### 6.18 RPT — Reporting

| ID | Requirement | Phase |
|---|---|---|
| RPT-01 | Platform: GBV, commission, gateway fees, venue net, successful/failed payments, refunds, chargebacks, pending/failed payouts, booking volume, active businesses/venues/users, utilization, event registrations, product sales, support trends | MVP |
| RPT-02 | Business: revenue, net settlement, booking volume, utilization, peak hours, return rate, cancellation rate, no-show rate, event and product revenue, refunds, discounts, commission, fees, payout history | MVP |
| RPT-03 | Player: frequency, hours, history, events, venue activity (rating progress P2) | MVP |
| RPT-04 | Every report states its date basis and time zone; CSV exports (PDF for statements), audited and CSV-injection-safe | MVP |

### 6.19 AUD and PRV — Audit, security operations and privacy

| ID | Requirement | Phase |
|---|---|---|
| AUD-01 | Audit: login and failed login, role/permission change, business approval, suspension, restriction, court configuration change, rate change, refund, payout adjustment, commission change, impersonation, data export, account deletion, security-setting change | MVP |
| AUD-02 | Record: actor, action, target, timestamp, business scope, before/after, IP/device where permitted, correlation ID, support-session subject | MVP |
| AUD-03 | Append-only for application roles, hash-chained, archived daily to S3 Object Lock | MVP |
| PRV-01 | Privacy notice, location explanation, cookie preferences, consent records | MVP |
| PRV-02 | Export, correction, deletion (with legal-retention exceptions), marketing opt-out | MVP |
| PRV-03 | Every sensitive field documented with purpose, legal basis, access, retention, protection, required/optional and deletion behavior (doc 15) | MVP |
| PRV-04 | PII and payment data redacted from logs and analytics; no production data in non-production environments | MVP |

## 7. Non-functional requirements (summary)

Numbers are targets pending load-test evidence; authoritative SLOs live in doc 22 and test methods in doc 20.

| Area | Requirement |
|---|---|
| Availability | 99.9% monthly for public browsing, booking and payment APIs; 99.5% for business and admin portals (targets) |
| Latency (server, p95 at planned peak) | Search ≤ 400 ms; availability ≤ 300 ms; hold creation ≤ 300 ms; quote ≤ 400 ms; business calendar ≤ 800 ms (targets) |
| Client performance | p75 LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 on a mid-range Android over 4G (targets) |
| Background timeliness | Holds released ≤ 60 s after TTL; pending payments re-checked ≤ 5 min; daily reconciliation complete by 06:00 Manila time |
| Recovery | RPO ≤ 5 min (point-in-time recovery); RTO ≤ 4 h for loss of a primary component; cross-region restore drill each quarter (targets) |
| Scalability | Stateless services on ECS Fargate across 3 AZs, horizontal scaling; reporting on a read replica |
| Security | OWASP ASVS 5.0 Level 2 (Level 3 for authentication, payments and admin, per doc 14); MFA for privileged roles; encryption in transit and at rest; WAF; SAST/DAST/dependency scanning; third-party pen test before launch (doc 14) |
| Privacy | RA 10173 compliance, PIA before launch, retention jobs, breach workflow with 72-hour notification (doc 15) |
| Accessibility | WCAG 2.2 AA; touch targets ≥ 44 × 44 px; keyboard and screen-reader support (doc 17) |
| Localization | en-PH at launch; fil-PH ready (externalized strings); peso formatting via `Intl.NumberFormat('en-PH', {style:'currency', currency:'PHP'})`; times labeled with zone |
| Observability | Structured logs with PII redaction, traces with correlation IDs, error tracking, business and security alerts (doc 22) |
| Operability | Feature flags, forward-only expand/contract migrations, low-risk deploys with rollback, staging parity |
| Browser support | Last two versions of Chrome, Safari (iOS 16.4+), Samsung Internet, Edge, Firefox |

## 8. Constraints and dependencies

### 8.1 Provider-dependent (all PLACEHOLDER until contracts exist)
| Item | Dependency |
|---|---|
| Payment provider account | Xendit account and xenPlatform approval; sub-account type MANAGED vs OWNED |
| Methods and fees | Supported PH channels, fee schedules per method, settlement timing (T+N) |
| Split and transfers | Split-rule behavior for commission and fee recovery; transfers for platform-funded discounts and commission reversals under `provider_split` |
| Refunds | Refund support per method (full, partial, QR Ph), refund timing, whether provider fees are returned |
| Session expiry | Ability to set provider session expiry equal to the 10-minute hold |
| Webhooks and reports | Event types, retry schedule, published source IPs, reconciliation report API |
| Payouts and disputes | Payout API for sub-accounts, dispute/chargeback notifications and evidence submission |
| SMS | PH aggregator with registered sender ID |
| Maps/geocoding | Commercial provider (Google Maps Platform or Mapbox); terms on caching and display |
| Email | Amazon SES production access; SPF/DKIM/DMARC on the sending domain |

### 8.2 Regulatory reviews (confirm with counsel)
| Topic | Why it matters |
|---|---|
| Data Privacy Act (RA 10173), IRR, NPC circulars | DPO designation and registration, consent, PIA, breach notification within 72 hours |
| Internet Transactions Act (RA 11967) and IRR | E-marketplace duties, merchant verification, DTI E-Commerce Bureau obligations |
| National Payment Systems Act (RA 11127) | Option B (`platform_payout`) may require OPS registration; Option A is the default partly for this reason |
| RA 11765 (financial consumer protection) and Consumer Act (RA 7394) | Complaint handling, clear total-price display, no hidden charges |
| BIR: EOPT Act (RA 11976), RR 16-2023, NIRC Sec. 235 | Invoicing (proposal: the CourtKo receipt is a payment acknowledgment, the venue invoices its service, CourtKo invoices commission to the venue; e-invoicing first-wave date reported as 31 Dec 2026 — doc 23 D-13), withholding on remittances (D-12), record retention (D-15) |
| Fee pass-through and surcharging | Card-network rules outside the U.S. generally bar surcharges unless local law requires they be permitted, and BSP guidance indicates no customer fees for QR Ph P2M payments; pass-through stays OFF for all methods until counsel confirms per method (doc 23 D-05) |
| Cybercrime Prevention Act (RA 10175) | Incident handling and evidence preservation context |

### 8.3 Product-owner inputs
Payment provider account and KYB, fee contract, legal and tax review, brand and trademark clearance, domain registration, SMS sender ID, maps account, support contact channels, DPO appointment, the platform entity's own registrations, pilot venue list, confirmation of default commission and policies. Tracked in [18 MVP scope](18-mvp-scope.md), section 6.

## 9. Out of scope

| Item | Status |
|---|---|
| Recording cash payments as "paid" on the platform | Not in MVP; walk-ins use digital payment. Offline use is recorded as a court block with reason `offline_booking` so availability stays correct (doc 23 D-29) |
| Storing card numbers, CVV, OTPs, wallet PINs, bank passwords, or unmasked credentials | Never |
| Holding venue funds (Option B) before legal review | Blocked |
| Prize-money handling and coach revenue-share payouts | Not planned; prizes are informational text |
| Native iOS/Android apps, installable PWA with offline and push | P2 |
| Multi-country or multi-currency, franchise management, enterprise accounts, sponsorship/ads | P3 |
| Automated fraud scoring beyond rule-based velocity checks and WAF bot control | P3 |
| Paid ranking or undisclosed sponsored placement | Never without clear labeling (P3 at the earliest) |

## 10. Open questions

Unresolved decisions are tracked with owners and due dates in [doc 23 — Known assumptions & unresolved decisions](23-assumptions-and-decisions.md). The ones that shape this document most: provider account and contract (D-01), sub-account type (D-02), settlement model and RA 11127 (D-03), e-marketplace duties (D-04), fee pass-through per method (D-05), invoicing and e-invoicing (D-13), commission-base correction (D-14), password policy (D-28), cash/offline bookings (D-29), QR Ph refund route (D-30), platform-funded discount transfers (D-31), identity providers (D-32), hold extension for accessibility (D-33) and bookings of suspended businesses (D-34).

---

## Addendum CR-01 (2026-10-06): multi-sport, Open Play, attendance, social profiles

Approved change request. The full impact analysis and the design decisions (CR-D01…D12) are in [doc 24](24-change-impact-multisport.md). Every requirement above stays in force. Where a requirement below conflicts with an earlier one, this addendum wins.

| ID | Requirement | Phase |
|---|---|---|
| SPT-01 | The initial release supports exactly four sports: pickleball, basketball, volleyball and tennis. Badminton, futsal and other sports are out of scope for launch | MVP |
| SPT-02 | Sports are platform reference data managed by SuperAdmin: name, description, icon, status, court layouts, formats, min/max players, default duration, skill levels, Open Play configuration, match-result configuration, team/partner requirements. No sport value is hard-coded in shared components. Changes are versioned and audited | MVP |
| SPT-03 | Format compatibility is validated server-side. Not every sport uses singles and doubles | MVP |
| SPT-04 | Shared UI uses sport-neutral terms (Player, Sport, Court, Game/Match, Open Play Session) | MVP |
| VEN-09 | A venue lists the sports it offers. A physical court supports one or more compatible sports | MVP |
| CRT-01 | Courts are modelled as space units and bookable layouts. A full-court booking blocks its halves, a half-court booking blocks the full court, a shared floor hosts one sport at a time, and tennis/pickleball conversion follows the unit map | MVP |
| CRT-02 | A changeover time applies between different sports on the same space (server-side) | MVP |
| CRT-03 | Court configuration covers name/number, venue, sports, full/partial, environment, capacity, surface, amenities, equipment, accessibility, operating and maintenance schedule, sport-specific rates, images and status | MVP |
| PRC-10 | Pricing rules can be limited to sports. Specificity order: court > sport > venue | MVP |
| DSC-10 | Search and filters cover sport, location, venue, date, time, price, full/partial court, environment, surface, amenities, Open Play and events | MVP |
| OPP-01…14 | Open Play sessions (configuration per doc 24 §3). Individual, partner and team registration. Join a team. Waitlist. Free, per-player or per-team pricing through the standard checkout/ledger/refund pipeline. Cancellation and refunds per policy. Walk-ins | MVP |
| ATT-01…12 | Signed, time-limited check-in passes (live and registration QR), controlled search, manual fallback with a reason. Separate registration and attendance statuses and counts. Append-only attendance history with recorded rejected and reversed scans. Management dashboard. Privacy-safe player summary | MVP |
| ROT-01…09 | Staff-controlled court assignment and rotation (first checked in, first waiting, manual, random, skill-based, winner stays, timed). Strategies only suggest. Optional score recording. Automated matchmaking is P2+ | MVP |
| SOC-01…12 | Usernames, player search, public profiles (privacy projection), one-directional follows with optional approval, followers/following, block, report, discoverability and activity controls | MVP |
| PLY-01a | **My Sports dashboard** on the player profile: per-sport sessions, hours, games, W–L, venues, upcoming games and self-declared level (with pin/hide) | MVP |
