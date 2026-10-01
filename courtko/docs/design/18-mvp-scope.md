# 18 — MVP Scope

| Field | Value |
|---|---|
| Document | 18 of 23 — MVP scope |
| Status | Draft v1.0 for product-owner approval |
| Owner | Product (Senior PM) |
| Last updated | 2026-09-30 |
| Related | [01 Product requirements](01-product-requirements.md) (requirement IDs) · [19 Implementation phases](19-implementation-phases.md) · [20 Testing strategy](20-testing-strategy.md) · [22 Operational monitoring](22-operational-monitoring.md) · [23 Assumptions & decisions](23-assumptions-and-decisions.md) |

## 1. What MVP means for CourtKo

The MVP is the first **production** release: real venues, real players, real money through Xendit, commission live. It is not the interactive demo (Phase 0).

Scoping rules:
1. **Thin but complete.** Anything that touches money, security or tenant isolation is either complete (pay, refund, settle, reconcile, audit) or absent. No half-built financial paths.
2. **Operators before growth.** Features that let venues run their day (calendar, check-in, walk-ins, refunds, statements) come before engagement features (social, loyalty).
3. **Provider-dependent features ship behind flags** and switch on only when the contract confirms the capability.
4. **Launch in stages:** closed pilot that starts with 3–5 Metro Manila venues and grows toward the doc 23 A-07 planning figure (20 venues) → public launch in Metro Manila → other cities (Cebu next, by demand).

## 2. Scope by feature

| Area | Feature | Phase | Rationale |
|---|---|---|---|
| Accounts | Email + password; mobile + OTP; verification | MVP | Core access. OTP needs the SMS aggregator (provider-dependent) |
| Accounts | Google sign-in | MVP | Low effort, reduces password friction |
| Accounts | Facebook and Apple sign-in | P2 | App-review overhead; Apple needed only with native iOS apps |
| Accounts | TOTP MFA (mandatory for platform staff, owners, managers) | MVP | Protects money and tenant data |
| Accounts | Passkeys / WebAuthn | P2 | Better UX once the base is stable |
| Accounts | Sessions, device and login history, suspicious-login alerts | MVP | Security baseline |
| Tenancy | Isolation (app scoping + RLS), role templates, custom roles, venue-scoped assignments | MVP | Non-negotiable for a multi-tenant marketplace |
| Onboarding | Registration, document upload with malware scan, manual review, approve/reject/suspend | MVP | Trust; merchant verification duties (RA 11967) |
| Onboarding | Automated registry checks (KYB APIs) | P3 | Manual review is adequate at launch volume |
| Venues | Venues, courts, hours, special hours, booking settings, blocks, media | MVP | Supply side |
| Pricing | Rule engine (base, peak/off-peak, weekday/weekend, holiday, date override, seasonal, event rate, promotional), priorities, simulator, snapshots | MVP | Core venue value |
| Pricing | Promo codes (fixed/percent, limits, `funded_by`) | MVP (venue-funded); platform-funded after doc 23 D-31 | Off-peak fill and launch marketing; platform funding needs provider transfers under `provider_split` |
| Pricing | Member/loyalty rates; deposits | P2 | Depend on memberships; deposits add a second payment lifecycle |
| Pricing | Advanced promotions (targeting, bundles, referrals) | P2 | After baseline conversion data |
| Pricing | Dynamic pricing recommendations | P3 | Needs history |
| Discovery | Nearby (with permission), manual search (PSGC + landmark), list/map, filters | MVP | Core player value |
| Discovery | Personalized recommendations | P2 | Needs behavior data |
| Discovery | Sponsored listings (clearly labeled) | P3 | Trust first |
| Booking | Holds, quote, policy acceptance, verified confirmation, QR, receipt | MVP | Core |
| Booking | Up to 2 slots per checkout; participant names | MVP | Group play is common |
| Booking | Reschedule and cancel within policy | MVP | Consumer protection and trust |
| Booking | Walk-in with payment link or on-screen QR | MVP | Venues need desk sales on day one |
| Booking | Invite registered users; recurring bookings; split payment | P2 | Social features; split depends on provider support |
| Booking | Recording cash payments as paid | Not in MVP | Unverifiable; offline use is recorded as a court block with reason `offline_booking` (doc 23 D-29) |
| Payments | Xendit hosted checkout (QR Ph, GCash, Maya, cards per contract), webhooks + re-query, pending reconciliation | MVP | Provider-dependent |
| Payments | Per-method fee disclosure and pass-through toggles (OFF for all methods until doc 23 D-05) | MVP | No hidden charges |
| Payments | Saved payment methods (tokens) | P2 | Provider tokenization for e-wallets to be confirmed |
| Payments | Second payment-provider adapter | P2 | Resilience and negotiating leverage |
| Money | Double-entry ledger, commission agreements (maker-checker), daily statements, daily reconciliation | MVP | Auditability |
| Money | Settlement Option A `provider_split` | MVP | Avoids holding venue funds |
| Money | Settlement Option B `platform_payout` | Gated | Only after legal and regulatory approval |
| Money | Payout tracking | MVP | Venue trust |
| Money | VAT on commission and withholding configuration | MVP (config) | Activated after tax-counsel opinion |
| Money | E-invoicing (EIS) integration | Assess now | Doc 23 D-13: first-wave date reported as 31 Dec 2026 for e-commerce taxpayers; if CourtKo is covered this becomes a launch requirement |
| Refunds | Policy tiers, automatic refunds, approvals, partial refunds, failure handling, disputes | MVP | Required for a trusted launch |
| Refunds | Platform credit (wallet) | P2 | Only if legally and contractually allowed |
| Operations | Overview, calendar, bookings, check-in, no-show, walk-in, orders, customers, restrictions, staff, payments, payouts, reports, reviews, settings, audit | MVP | Business portal |
| Operations | Business integrations (outbound webhooks, accounting exports connectors) | P2 | After schema stabilizes |
| Events | Open play, clinics, training, social, private, simple tournament registration with divisions, capacity, waitlist with offers, check-in, announcements | MVP | Basic events per brief |
| Events | Partner/team invites; brackets, match scheduling, official results | P2 | Advanced tournaments |
| Events | Advanced league management | P3 | Per brief |
| Products | Catalog, variants, stock, add-ons, standalone pickup, claim codes | MVP | Basic products per brief |
| Products | Equipment rental with return tracking | P2 | MVP sells rentals as products |
| Player | Activity dashboard, favorites, rebook, reviews, reports, records | MVP | |
| Player | Self-declared skill level | MVP | |
| Player | Venue-verified level; external rating via official partner API | P2 | Requires partner agreements |
| Player | Platform recreational rating; achievements beyond basics | P3 / P2 | Needs match data |
| Notifications | In-app and email | MVP | |
| Notifications | SMS for OTP and critical booking messages | MVP once contracted | Doc 23 D-22: registered sender ID, templates without clickable links; email fallback until then |
| Notifications | Web Push | P2 | Ships with the installable PWA |
| Platform | SuperAdmin control center (all brief modules) | MVP | |
| Platform | Support mode (read-only) | MVP | Policy approval under doc 23 D-24; write-enabled mode P2, with an approval flow |
| Platform | WAF bot control, velocity rules | MVP | Advanced fraud detection P3 |
| Reporting | Core platform, business and player reports with date bases and exports | MVP | Custom report builder P2 |
| Privacy | Notice, consent, cookies, export, deletion, retention jobs, audit hash chain | MVP | RA 10173 |
| Channels | Responsive mobile web | MVP | |
| Channels | Installable PWA (offline QR, push), native apps | P2 | |
| Channels | fil-PH localization | P2 | Strings externalized at MVP |
| Expansion | Multi-country/currency, franchise management, enterprise accounts, ads/sponsorship | P3 | Per brief |

## 3. Acceptance criteria

### 3.1 Module criteria (testable)

| Module | Criteria |
|---|---|
| ACC | Registration via email, mobile OTP and Google succeeds and requires verification before booking. Owners, managers and platform staff cannot reach their portals without TOTP. Password reset revokes all sessions. Idle (30 min; admin 15 min) and absolute (12 h) timeouts enforced server-side. Five failed logins trigger throttling with a lockout period, and the account owner is notified. |
| TEN | Every business route requires membership and the declared permission. Role templates match doc 03 exactly. Venue-scoped members cannot see other venues' bookings. The last owner cannot be removed. |
| ONB | Files are scanned before any reviewer can open them. A business cannot publish a venue until `active` with a payment-capable sub-account. Every approval, rejection and suspension is audited with the reviewer. |
| VEN | Operating hours support overnight spans. Special hours override weekly hours. Increments are limited to 30/60/90. Blocks occupy `booking_slots`. Publish checklist enforced by the API, not only the UI. |
| PRC | Simulator output equals the checkout quote for the same inputs. Same-priority overlaps for the same scope cannot be saved. Rule changes never alter confirmed snapshots. Promo limits (total, per user) hold under concurrent redemption. |
| DSC | Search works with location denied. Coordinates are rounded to 3 decimals and absent from logs. Results never include unpublished venues or suspended businesses. |
| BKG | Scenarios BKG-A to BKG-F below. Confirmation, receipt and QR are available within the confirmation-latency target. Reschedule allowed once, ≥ 12 h before start. |
| PAY | Scenarios PAY-A to PAY-H below. The checkout shows the fee for every method before selection. No code path sets a payment `captured` without a provider re-query. |
| FIN | Scenarios FIN-A to FIN-E below. Daily statements generate for every active business by 06:00 Manila time (target). |
| REF | Scenarios REF-A to REF-C below. Refunds go to the original method (or the provider-supported alternative where the method has no API refund). |
| OPS | Check-in only within the window; no-show only after grace; walk-in follows the same pricing and restriction checks; staff cannot mark payments paid. |
| EVT | Scenario EVT-A below. Event cancellation by the venue refunds all participants in full. |
| PRD | Scenario PRD-A below. Stock never goes negative; adjustments recorded in `inventory_movements`. |
| RST | Restricted players cannot hold, walk in or register in scope; the response carries only `BOOKING_NOT_ALLOWED` and neutral copy; other businesses see nothing. |
| PLY | Reviews only for `completed` bookings, one per booking. Ratings always show their source. Visibility settings are enforced by the API. |
| NTF | Transactional and security messages cannot be disabled; others respect preferences per channel. Each triggering event produces at most one message per channel (idempotent delivery). |
| ADM | Scenarios ADM-A and ADM-B below. Admin routes unreachable outside the WAF allowlist. |
| RPT | Every report displays its date basis; exports require the export permission, are audited and neutralize CSV-injection characters. |
| AUD/PRV | Scenarios AUD-A, PRV-A, PRV-B below. |

### 3.2 Critical scenarios (Given / When / Then)

| ID | Given | When | Then |
|---|---|---|---|
| BKG-A | Court 2 is free Sat, Oct 3, 6:00–7:00 PM | 50 players request a hold for that slot concurrently | Exactly one hold succeeds (`slot_held`); 49 receive `SLOT_UNAVAILABLE`; one active `booking_slots` row overlaps the range |
| BKG-B | Buffer 10 min, 30-min increments, confirmed 6:00–7:00 PM booking | Availability is requested; a hold for 7:00 PM is attempted | 7:00 PM is not offered and 7:30 PM is; the 7:00 PM hold returns `SLOT_UNAVAILABLE` |
| BKG-C | Hold created 9:04:00 PM, TTL 600 s, no payment session | Clock passes 9:14:00 PM | Within 60 s the booking is `expired` and the slot is bookable; the player's next checkout call returns `HOLD_EXPIRED` |
| BKG-D | Player holds 2 active slots | Requests a third hold | `HOLD_LIMIT_REACHED`; no slot row created |
| BKG-E | Player sees a ₱400.00 quote | Venue changes the rate to ₱450.00 before the checkout is created | `POST /v1/me/checkouts` returns `QUOTE_EXPIRED` with the new quote; a checkout created before the change keeps ₱400.00 for its hold |
| BKG-F | Active venue-scope restriction for the player | Player requests a hold at that venue | `BOOKING_NOT_ALLOWED`; response body contains no reason, category or dates |
| PAY-A | Booking `payment_pending`; no verified provider status | Browser lands on the provider success return URL | Booking stays `payment_pending`; page shows "Confirming your payment" |
| PAY-B | Webhook with the correct `x-callback-token` | Worker re-queries; provider reports capture with matching amount and currency | One transaction: payment `captured`, booking `confirmed`, balanced journal, outbox events; notifications sent once |
| PAY-C | Event E already processed | E is delivered again | 200 returned; no state change, journal or notification |
| PAY-D | Webhook with a wrong token | Received | Not processed; security event recorded; alert above threshold |
| PAY-E | Booking expired 9:14 PM; slot still free | Capture verified 9:20 PM (within 15 min) | Slot re-acquired; booking `confirmed`; player notified |
| PAY-F | Same as PAY-E but the slot was taken | Capture verified | Booking `refund_pending`; full refund including the fee requested automatically; finance can see it |
| PAY-G | Provider times out on payment-session creation | Player taps Pay | `PROVIDER_UNAVAILABLE`; hold unchanged; retry with a new key succeeds when the provider recovers |
| PAY-H | A POST with `Idempotency-Key` K succeeded | Same K with same body / different body / concurrently | Same response / `422 IDEMPOTENCY_KEY_REUSED` / `IDEMPOTENCY_IN_PROGRESS` |
| FIN-A | Pass-through ON configuration: base 40,000 centavos, rate 50,000 ppm, fee 1,500 passed to the customer | Payment captured | `customer_total` 41,500; commission 2,000; `venue_net` 38,000; capture journal equals doc 01 §4.2 and balances |
| FIN-A2 | Default configuration (pass-through OFF, doc 23 D-05): same booking | Payment captured; provider reports a 1,500 fee at reconciliation | `customer_total` 40,000; commission 2,000; `venue_net` 38,000; 1,500 posted to `platform:gateway_fee_expense`; platform net 500 |
| FIN-B | Commissionable bases 12,345 and 12,350 at 50,000 ppm | Commission computed | 617 and 618 centavos (half-up, once per component, integer math) |
| FIN-C | Agreement changes 50,000 → 40,000 ppm effective Nov 1, 2026 | A booking confirmed Oct 20 for play on Nov 5 completes | Its commission remains at 50,000 ppm (snapshot) |
| FIN-D | Venue payable already paid out | A ₱200.00 player refund succeeds (50% commission reversal) | Venue payable is −₱190.00 and the next statement shows the recovery |
| FIN-E | Application database role | Attempts UPDATE/DELETE on ledger entries, or commits an unbalanced journal | Both fail; corrections only via reversing journals |
| REF-A | Standard policy v3; paid ₱415.00 (₱400.00 + ₱15.00 fee) | Player cancels at 25 h / 10 h / 5 h before start | Refund ₱400.00 / ₱200.00 / ₱0.00 (booking `cancelled`, no refund record); fee not refunded in any case |
| REF-B | Same booking | Venue cancels (`court_unavailable`) | Refund ₱415.00 including fee; platform absorbs the fee in the ledger |
| REF-C | Goodwill refund ₱1,200.00 requested by a member with `refunds.request` only | Submitted | `pending_approval` until a member with `refunds.approve` approves with MFA; above ₱5,000 also needs `platform.refunds.approve` |
| TEN-A | Member of Hub Sports Co. | Requests any `/v1/businesses/{rallyPointId}/...` route, or a Rally Point object ID under their own business path | `404 NOT_FOUND`; security event; direct SQL as the app role with Hub Sports context returns zero Rally Point rows |
| TEN-B | `receptionist` | Calls the refund endpoint | `403 FORBIDDEN`; audited |
| TEN-C | `business_manager` with `staff.manage` | Assigns a role that includes `refunds.approve` | `FORBIDDEN` — cannot grant a permission not held |
| ADM-A | Agreement drafted by user M | M approves; then a different holder approves with MFA | First: `APPROVAL_REQUIRED`; second: approved; both actors audited |
| ADM-B | Support agent with `platform.support.impersonate` | Starts a session with a 10-character reason; then with a valid reason and ticket; then attempts a write | Rejected (`VALIDATION_FAILED`); session starts (max 30 min); write returns `SUPPORT_MODE_READ_ONLY`; every request audited with actor and subject |
| EVT-A | Capacity 16 with 16 seats held, pending or confirmed | Another player registers; then a confirmed player withdraws | `EVENT_FULL` and waitlist offered; first waitlisted becomes `offered` with expiry; on expiry the next person is offered |
| PRD-A | Order `PU-3H8R6W` claimed | The code is scanned again | `CONFLICT` showing who claimed and when; exactly one `pickup_claims` row |
| AUD-A | Audit entries in a business chain | App role attempts UPDATE/DELETE; a test fixture alters a row directly | Writes fail; integrity verification reports the break and raises an alert |
| PRV-A | Verified player | Requests a data export | Archive ready within 24 h (target); link valid 7 days, only for that account; request and download audited |
| PRV-B | Player with no blockers requests deletion | 14-day grace passes | Personal data erased or pseudonymized; ledger, payment and audit records retained under a pseudonymous reference; sign-in impossible |
| PAY-I | Owner changes the payout account | Submits | Requires `business_owner` and MFA step-up; all finance-permission holders notified; audited; payouts held 48 h after the change where the platform controls the destination (doc 23 D-10) |

## 4. Explicit MVP exclusions

- Cash or offline payments recorded as paid; any manual "mark as paid".
- Holding venue funds (Option B) before legal and regulatory approval.
- Saved cards or linked e-wallets; split payments; deposits; platform credit.
- Native apps, installable PWA with offline mode, Web Push.
- Brackets, match results, leagues, partner/team accounts, official win/loss.
- Venue-verified and external ratings; platform recreational rating.
- Memberships, loyalty, recurring bookings, referral programs.
- Coaching marketplace; equipment rental with returns; business API integrations.
- Write-enabled support mode.
- Languages other than English (en-PH); currencies other than PHP.
- Sponsored listings or any paid ranking.

## 5. Launch-readiness checklist

| Area | Item | Owner | Evidence |
|---|---|---|---|
| Legal and compliance | Privacy notice, terms, cookie policy reviewed | Counsel | Published, versioned documents |
| Legal and compliance | DPO designated; NPC registration as required; PIA for booking, payments, location, restrictions, support mode | DPO | Registration record, PIA |
| Legal and compliance | RA 11967 e-marketplace duties mapped: merchant verification incl. BIR COR, merchant details on venue pages, redress SLA, takedown workflow (doc 23 D-04) | Counsel | Compliance matrix |
| Legal and compliance | RA 11127 opinion on OPS status under Option A; Option B stays disabled (doc 23 D-03) | Counsel | Opinion letter |
| Legal and compliance | Fee pass-through decision per method, in writing (default OFF for all methods; doc 23 D-05) | Counsel, finance | Decision record |
| Legal and compliance | BIR: platform registration, invoicing under EOPT, RR 16-2023 withholding agent, VAT on commission (doc 23 D-11 to D-13) | Tax counsel | Opinion letter; configuration set |
| Legal and compliance | E-invoicing (EIS) applicability and readiness; first-wave date reported as 31 Dec 2026 (doc 23 D-13) | Tax counsel, engineering | Opinion; integration plan or confirmed exemption |
| Legal and compliance | Processor DPAs (AWS, Xendit, SMS, maps, email, error tracking) and processor inventory | Counsel | Executed agreements |
| Provider onboarding | Xendit account, KYB, xenPlatform enabled; MANAGED vs OWNED decided | Product owner | Live keys in Secrets Manager |
| Provider onboarding | Contracted fee schedule per method loaded (placeholders removed) | Finance | Configuration with contract reference |
| Provider onboarding | Split rules, refunds per method (incl. QR Ph route), payouts and reports verified in sandbox | Engineering | Contract-test report |
| Provider onboarding | Webhook token set; source-IP allowlist if published | Engineering | Configuration |
| Provider onboarding | SMS sender ID registered; SES production access; SPF/DKIM/DMARC; maps keys restricted | Engineering, product owner | Confirmations |
| Security | Threat model (doc 14) risks mitigated or formally accepted | Security lead | Sign-off |
| Security | SAST, dependency and container scans: no open critical/high | Engineering | CI reports |
| Security | DAST baseline (OWASP ZAP) clean of high findings | Security | Report |
| Security | Third-party penetration test; criticals and highs fixed and retested | External vendor | Report and retest letter |
| Security | No long-lived cloud keys (GitHub OIDC); secrets rotated; break-glass procedure | DevOps | Evidence |
| Security | Production access review (least privilege) | Security | Review record |
| Performance | k6 load tests meet doc 22 targets at 3× projected launch peak | Engineering | k6 report |
| Performance | Booking concurrency test: zero double bookings at 200 concurrent attempts | Engineering | Test report |
| Resilience | Restore from backup into a fresh environment within the RTO target; PITR drill | DevOps | Drill report |
| Resilience | Dashboards and paging for payments, webhook lag, queue depth, `holds.expire`, reconciliation, error rates; on-call rota | DevOps | Paging test |
| Support | Support channels, hours, SLAs, macros, escalation to platform finance | Operations | Runbook |
| Support | Runbooks: webhook backlog, reconciliation mismatch, refund failure, payout failure, provider outage, security incident, personal-data breach (72-hour NPC notification) | Operations, security | `docs/runbooks/*` |
| Support | Incident-response tabletop exercise | Operations | Exercise notes |
| Content | Help Center, policy texts, email/SMS templates, How It Works, Pricing page with calculator | Product | Published |
| Content | Venue onboarding kit and receptionist training | Operations | Materials |
| Quality | External accessibility audit (WCAG 2.2 AA) passed | Design | Audit report |
| Data | No synthetic or demo data or test accounts in production | Engineering | Checklist |
| Flags | Option B off; fee pass-through off for every method not cleared under D-05; platform-funded promotions off until D-31; unfinished P2 features off | Engineering | Flag configuration export |

## 6. Dependencies on product-owner inputs

Milestone IDs follow doc 23 (M0 design sign-off · M1 provider onboarding · M2 pilot readiness · M3 production launch); BM1–BM6 are the build milestones in doc 19 §A.2.

| Input | Needed for | Needed by | Status |
|---|---|---|---|
| Platform legal entity registrations (SEC/DTI, BIR, business permit) and platform bank account | Provider KYB, invoices, commission settlement | M1 | Open |
| Xendit account, KYB, xenPlatform approval (doc 23 D-01) | Payments (build steps 8–9) | M1 (sandbox keys before BM3); live keys by M2 | Open — all values PLACEHOLDER |
| Fee contract per method | Fee display and pass-through | M2 | Open (placeholders: QR Ph ₱15.00 flat, GCash 2.3%, Maya 2.0%) |
| Sub-account type, MANAGED vs OWNED (irreversible per sub-account, doc 23 D-02) | Onboarding and payouts design | M1, before the first live venue | Open |
| Legal review (privacy, terms, RA 11967, RA 11127, fee pass-through) | Launch | M2 | Open |
| Tax counsel (VAT on commission, withholding, invoicing, e-invoicing) | Statements, receipts, EIS | M2; e-invoicing assessment immediately (D-13) | Open |
| Brand and trademark clearance; domain `courtko.ph` (doc 23 D-25) | Public launch | M3 | Working name only |
| SMS aggregator and registered sender ID (doc 23 D-22) | OTP and notifications | M2 (start registration during BM1) | Open (registration lead time) |
| Maps provider account (doc 23 D-23) | Discovery | Before BM2 (build step 5) | Open |
| DPO appointment and NPC registration (doc 23 D-19) | Privacy program | M2 | Open |
| Support contact channels and hours | Help, notifications | M2 | Open |
| Pilot venues and confirmation of default commission and policies | Pilot | M2 | Open |
