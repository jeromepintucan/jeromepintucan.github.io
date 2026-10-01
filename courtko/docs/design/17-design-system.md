# 17 — Design System and Component Inventory

| Field | Value |
|---|---|
| Document | 17 of 23 — Design system and component list |
| Status | Draft v1.0 |
| Owner | Product design (Senior UX/UI); implemented in `packages/ui` |
| Last updated | 2026-09-30 |
| Related | [05 IA](05-information-architecture.md) (labels, glossary) · [16 Wireframes](16-wireframes.md) · [20 Testing strategy](20-testing-strategy.md) (accessibility tests) · [23 Assumptions](23-assumptions-and-decisions.md) |

Token **values** below are canonical and implemented exactly by the interactive demo. Token **names** (CSS variables) and the elevation and easing values are proposals for `packages/ui` and are marked as such.

## 1. Design principles

1. **Money is never a surprise.** Every fee, tax and discount appears before payment and again on receipts. Totals are server-computed and shown in full.
2. **State you can trust.** Every booking, payment and refund shows its current status in words, with time and zone. "Confirmed" appears only after verified payment.
3. **Fast on a phone.** One-thumb flows, 44 px targets, small payloads, skeletons instead of blank screens, resilient to dropped connections.
4. **Accessible by default.** WCAG 2.2 AA is the floor, not a phase. Color is never the only signal.
5. **Calm operations.** Staff screens are dense, predictable and exception-first; destructive actions always state their consequences.
6. **Respectful by design.** Neutral wording for restrictions, no dark patterns, minimal data on screen for each role.

## 2. Tokens

### 2.1 Color

| Token (proposed name) | Value | Role | Contrast notes |
|---|---|---|---|
| `--ck-color-primary` | `#0F7A5A` | Court green: primary buttons, links, selection, focus ring on light | White text 5.31:1 (AA). On ink only 3.28:1 → large text/UI only |
| `--ck-color-primary-dark` | `#0B3B2E` | Headers, dark surfaces, hover for primary | White text 12.51:1 |
| `--ck-color-accent` | `#C8F169` | Optic lime: highlights on dark surfaces, focus ring on dark | Use only on dark surfaces or with dark text: ink on lime 13.47:1, primary-dark on lime 9.67:1. Lime on white 1.29:1 and lime on primary 4.11:1 — never for normal text |
| `--ck-color-ink` | `#0B1B2B` | Primary text, support-mode banner background | 17.41:1 on white |
| `--ck-slate-50` | `#F8FAFC` | Page background (app) | slate-500 text 4.55:1 (passes, minimum) |
| `--ck-slate-100` | `#F1F5F9` | Subtle surfaces, pill backgrounds | slate-500 text fails (4.34:1) → use slate-600 (6.92:1) |
| `--ck-slate-200` | `#E2E8F0` | Dividers, table borders (decorative) | 1.23:1 — never for text or input borders |
| `--ck-slate-300` | `#CBD5E1` | Hatch pattern, disabled borders | 1.48:1 — decorative only |
| `--ck-slate-400` | `#94A3B8` | Disabled text; secondary text on dark | 2.56:1 on white (disabled only, exempt); 6.79:1 on ink |
| `--ck-slate-500` | `#64748B` | Secondary text on white, **input borders** | 4.76:1 on white (text AA; non-text 3:1 met) |
| `--ck-slate-600` | `#475569` | Secondary text on tinted surfaces | 7.58:1 on white |
| `--ck-slate-700` | `#334155` | Neutral status text, body on tinted surfaces | 10.35:1 on white, 9.45:1 on slate-100 |
| `--ck-slate-800` | `#1E293B` | Headings on light (alt) | 14.63:1 |
| `--ck-slate-900` | `#0F172A` | Admin dark chrome | 17.85:1 |
| `--ck-color-info` | `#0369A1` | Informational status, checked-in | 5.93:1 on white; 5.42:1 on slate-100 |
| `--ck-color-success` | `#15803D` | Success, confirmed | 5.02:1 on white; 4.58:1 on slate-100 |
| `--ck-color-warning` / `-bg` | `#B45309` on `#FEF3C7` | Pending, held, attention | 4.51:1 — passes AA at the minimum; do not lighten either color |
| `--ck-color-danger` / `-bg` | `#B91C1C` on `#FEE2E2` | Errors, failed, disputed, suspended | 5.30:1; 6.47:1 on white |
| `--ck-color-event` | `#6D28D9` | Events, waitlists | 7.10:1 on white; 6.49:1 on slate-100 |

Contrast ratios computed with the WCAG 2.x relative-luminance formula. Required minimums: 4.5:1 normal text, 3:1 large text (≥ 24 px, or ≥ 18.66 px bold) and non-text UI (borders, focus indicators, chart marks).

### 2.2 Typography

| Step | Size / line height (line height proposed) | Use |
|---|---|---|
| xs | 12 / 16 | Captions, footnotes, status pills (weight 600) |
| sm | 14 / 20 | Secondary text, dense table cells (business/admin) |
| base | 16 / 24 | Body; minimum for body text on mobile and for **all form inputs** (prevents iOS zoom) |
| lg | 18 / 28 | Card titles, lead text |
| xl | 20 / 28 | Section headings |
| 2xl | 24 / 32 | Page titles on mobile |
| 3xl | 30 / 36 | Page titles on desktop |
| 4xl | 36 / 40 | Marketing hero only |

- Font stack: `Inter, ui-sans-serif, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial`. Self-host Inter with Latin and Latin Extended subsets; verify the peso sign (U+20B1) and ñ render in the subset.
- Weights: 400 body · 500 labels and buttons · 600 headings and emphasis · 700 totals and hero.
- **Tabular numerals** (`font-variant-numeric: tabular-nums`) for all money, times in tables, countdowns and codes.

### 2.3 Spacing, radius, elevation, breakpoints

| Group | Values |
|---|---|
| Spacing (4-pt) | 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 px. Mobile page padding 16; card padding 16; form field gap 16; section gap 24 (mobile) / 32 (desktop); table cell 8 × 12 |
| Radius | 6 px (inputs, small chips) · 10 px (buttons, cards) · 16 px (sheets, dialogs, large cards) · pill (status pills, filter chips, segmented controls) |
| Elevation (proposed; not in the brief) | e0 flat with borders · e1 cards `0 1px 2px rgb(15 23 42 / .06), 0 1px 3px rgb(15 23 42 / .10)` · e2 sticky bars and menus `0 4px 12px rgb(15 23 42 / .12)` · e3 dialogs and drawers `0 12px 32px rgb(15 23 42 / .18)` with scrim `rgb(11 27 43 / .55)`. Elevation is never the only separator |
| Breakpoints | 640 (sm) · 768 (md) · 1024 (lg) · 1280 (xl). < 1024: bottom tabs, single column. ≥ 1024: sidebar navigation, split views. Admin is desktop-first (≥ 1024) |
| Touch targets | ≥ 44 × 44 px with ≥ 8 px between adjacent targets (exceeds WCAG 2.2 SC 2.5.8 minimum of 24 × 24) |

### 2.4 Motion and focus

- Durations: **150 ms** for micro-interactions (hover, press, toggle), **250 ms** for enter/exit (sheets, drawers, toasts). Easing (proposed): standard `cubic-bezier(0.2, 0, 0, 1)`, exit `cubic-bezier(0.4, 0, 1, 1)`.
- Under `prefers-reduced-motion: reduce` all transitions and animations are disabled, including skeleton shimmer and countdown emphasis. No parallax, no auto-advancing carousels.
- Focus: **3 px solid `#0F7A5A` with 2 px offset** on light surfaces; **lime `#C8F169`** on dark surfaces (ink, primary-dark, primary). Shown on `:focus-visible`, never removed. Pages set `scroll-padding` so sticky bars never hide the focused element.

### 2.5 Implementation (illustrative)

Tailwind CSS v4 ships an OKLCH default palette whose slate values differ slightly from the brief, so `packages/ui` defines every color explicitly:

```css
/* packages/ui/src/tokens/tokens.css (illustrative) */
@import "tailwindcss";
@theme {
  --color-primary: #0F7A5A;  --color-primary-dark: #0B3B2E;  --color-accent: #C8F169;
  --color-ink: #0B1B2B;      --color-info: #0369A1;          --color-success: #15803D;
  --color-warning: #B45309;  --color-warning-bg: #FEF3C7;
  --color-danger: #B91C1C;   --color-danger-bg: #FEE2E2;     --color-event: #6D28D9;
  --color-slate-50: #F8FAFC; --color-slate-100: #F1F5F9; --color-slate-200: #E2E8F0;
  --color-slate-300: #CBD5E1; --color-slate-400: #94A3B8; --color-slate-500: #64748B;
  --color-slate-600: #475569; --color-slate-700: #334155; --color-slate-800: #1E293B;
  --color-slate-900: #0F172A;
  --font-sans: Inter, ui-sans-serif, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial;
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px;
  --breakpoint-sm: 640px; --breakpoint-md: 768px; --breakpoint-lg: 1024px; --breakpoint-xl: 1280px;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
}
```

## 3. Status mapping

Status pills = tone foreground text + icon + label on the tone background. Only brief tokens are used.

| Tone | Text / icon | Background | Contrast |
|---|---|---|---|
| success | `#15803D` | `#F1F5F9` | 4.58:1 |
| info | `#0369A1` | `#F1F5F9` | 5.42:1 |
| warning | `#B45309` | `#FEF3C7` | 4.51:1 |
| danger | `#B91C1C` | `#FEE2E2` | 5.30:1 |
| neutral | `#334155` | `#F1F5F9` | 9.45:1 |
| event | `#6D28D9` | `#F1F5F9` | 6.49:1 |

Icons below refer to the icon set in §4. "—" means the status is never shown to that audience.

**Booking**

| Value | Player label | Staff label | Tone | Icon |
|---|---|---|---|---|
| `draft` | — | Draft | neutral | circle-dashed |
| `slot_held` | Held — finish checkout | Held | warning | clock |
| `payment_pending` | Confirming payment | Payment pending | warning | hourglass |
| `confirmed` | Confirmed | Confirmed | success | check-circle |
| `checked_in` | Checked in | Checked in | info | scan-line |
| `completed` | Completed | Completed | neutral | flag |
| `cancelled` | Cancelled | Cancelled | neutral | x-circle |
| `refund_pending` | Refund in progress | Refund pending | warning | rotate-ccw |
| `partially_refunded` | Partially refunded | Partially refunded | neutral | receipt |
| `refunded` | Refunded | Refunded | neutral | receipt |
| `no_show` | No-show recorded | No-show | warning | user-x |
| `disputed` | Under review | Disputed | danger | alert-triangle |
| `failed` | Payment failed | Failed | danger | alert-octagon |
| `expired` | Expired | Expired | neutral | timer-off |

**Payment**

| Value | Player label | Staff/admin label | Tone |
|---|---|---|---|
| `created` | — | Created | neutral |
| `pending` | Awaiting payment | Pending | warning |
| `authorized` | Authorized | Authorized | info |
| `captured` | Paid | Captured | success |
| `failed` | Failed | Failed | danger |
| `expired` | Expired | Expired | neutral |
| `cancelled` | Cancelled | Cancelled | neutral |
| `partially_refunded` | Partially refunded | Partially refunded | neutral |
| `refunded` | Refunded | Refunded | neutral |
| `disputed` | Under review | Disputed | danger |
| `chargeback` | Reversed by your bank | Chargeback | danger |

**Refund · Payout · Dispute**

| Catalog | Value | Label (player / staff) | Tone |
|---|---|---|---|
| Refund | `requested` | Requested | warning |
| Refund | `pending_approval` | Awaiting approval | warning |
| Refund | `approved` | Approved | info |
| Refund | `processing` | Processing | info |
| Refund | `succeeded` | Refunded / Succeeded | success |
| Refund | `failed` | Delayed — we're on it / Failed | danger |
| Refund | `rejected` | Not approved / Rejected | neutral |
| Payout | `scheduled` | Scheduled | info |
| Payout | `processing` | Processing | info |
| Payout | `paid` | Paid | success |
| Payout | `failed` | Failed | danger |
| Payout | `reversed` | Reversed | danger |
| Dispute | `open` | Open | warning |
| Dispute | `evidence_submitted` | Evidence submitted | info |
| Dispute | `won` | Won | success |
| Dispute | `lost` | Lost | danger |

**Product order · Event registration**

| Catalog | Value | Player label | Staff label | Tone |
|---|---|---|---|---|
| Order | `pending_payment` | Awaiting payment | Pending payment | warning |
| Order | `paid` | Order placed | Paid | info |
| Order | `preparing` | Preparing | Preparing | info |
| Order | `ready_for_pickup` | Ready for pickup | Ready | success |
| Order | `claimed` | Picked up | Claimed | neutral |
| Order | `cancelled` | Cancelled | Cancelled | neutral |
| Order | `refunded` | Refunded | Refunded | neutral |
| Order | `partially_refunded` | Partially refunded | Partially refunded | neutral |
| Registration | `held` | Spot held — finish payment | Held | warning |
| Registration | `pending_payment` | Confirming payment | Payment pending | warning |
| Registration | `confirmed` | Registered | Confirmed | success |
| Registration | `waitlisted` | Waitlisted (#3) | Waitlisted | event |
| Registration | `offered` | Spot offered — pay by 9:30 PM | Offered | event |
| Registration | `checked_in` | Checked in | Checked in | info |
| Registration | `withdrawn` | Withdrawn | Withdrawn | neutral |
| Registration | `cancelled` | Cancelled | Cancelled | neutral |
| Registration | `refunded` | Refunded | Refunded | neutral |

**Business · Venue · Restriction · Appeal** (staff and admin only; players see only the "Verified business" badge for `active`)

| Catalog | Value | Label | Tone |
|---|---|---|---|
| Business | `draft` | Draft | neutral |
| Business | `pending_verification` | Under review | warning |
| Business | `active` | Active · Verified | success |
| Business | `rejected` | Changes needed (owner view) / Rejected (admin view) | danger |
| Business | `suspended` | Suspended | danger |
| Venue | `draft` / `published` / `unpublished` / `suspended` | Draft / Published / Unpublished / Suspended | neutral / success / neutral / danger |
| Restriction | `active` / `lifted` / `expired` | Active / Lifted / Expired | danger / neutral / neutral |
| Appeal | `none` / `submitted` / `upheld` / `overturned` | — / Appeal submitted / Upheld / Overturned | — / warning / neutral / success |

Restrictions never render as a pill to the player; the player sees only the neutral notice (§5.5).

**Calendar blocks** (always color + pattern + text label)

| Item | Fill / pattern | Label text | Contrast |
|---|---|---|---|
| `confirmed` | Solid `#15803D` | White | 5.02:1 |
| `slot_held`, `payment_pending` | Amber diagonal stripes `#B45309` on `#FEF3C7` | Ink label chip on `#FEF3C7` | 15.64:1 |
| `checked_in` | Solid `#0369A1` | White | 5.93:1 |
| `completed` | Solid `#64748B` | White | 4.76:1 |
| Block / maintenance | Grey hatch `#CBD5E1` on `#F1F5F9` | `#334155` | 9.45:1 |
| Event reservation | Solid `#6D28D9` | White | 7.10:1 |
| `no_show` | White with 2 px `#B45309` outline | `#B45309` | 5.02:1 |
| Selected | 3 px primary outline + check icon | — | 5.31:1 |

## 4. Iconography

- One open-source outline icon set on a 24 px grid with 1.5–2 px strokes (proposed: Lucide, ISC license). Sizes 16, 20, 24; icons inherit `currentColor`.
- Icons accompany text for every status and action. Icon-only buttons need an `aria-label` and a tooltip; decorative icons are `aria-hidden="true"`.
- Fixed meanings: `calendar` date · `clock` hold/time · `map-pin` venue location · `locate` use my location · `qr-code` check-in or claim · `scan-line` scanner · `wallet` payment method · `receipt` receipt/refund · `shield-check` verified business · `lock` permission required · `eye` support mode · `alert-triangle` warning · `info` information · `check-circle` success · `x-circle` cancelled/error · `user-x` no-show · `timer-off` expired · `rotate-ccw` refund in progress · `trophy` tournament · `users` open play/social · `graduation-cap` clinic · `package` orders · `heart` favorite.
- No emoji, no flags, no peso sign used as an icon.

## 5. Content style guide

### 5.1 Voice and tone
Voice: **friendly, athletic, clear.** Friendly = plain, warm, direct ("You're booked."). Athletic = active verbs, short sentences, momentum ("Find a court", "Book again"). Clear = exact amounts, times and next steps.

| Context | Tone | Example |
|---|---|---|
| Success | Upbeat, brief | "You're booked. See you on court at 7:00 PM." |
| Money | Precise, neutral | "Refund of ₱200.00 to your original payment method." |
| Errors | Calm, helpful, no blame | "That time was just booked. Here are the next open times." |
| Restrictions | Neutral, respectful | "Your bookings at Pasig Pickle Hub are paused until Mon, Nov 2, 2026." |
| Security | Direct, specific | "New sign-in to your account from Chrome on Android. Not you? Reset your password." |
| Staff tools | Terse, operational | "Checked in · Court 3 · 5:52 PM" |

No sports puns in errors, money or safety messages. English (en-PH) at launch; strings are externalized for fil-PH; avoid idioms that do not translate.

### 5.2 Money
- Format with `Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })` → "₱415.00", "₱1,284,650.00". Two decimals wherever money changes hands (checkout, receipts, refunds, statements).
- Compact whole-peso form only on discovery cards: "From ₱300/hr".
- Negative amounts: true minus sign before the peso sign ("−₱50.00"), via `formatToParts`; never parentheses in player UI. CSV exports use plain numbers with a hyphen-minus and a separate currency column (`PHP`).
- Rates: percent with up to two decimals ("5%", "4.25%"); ppm appears only in admin views alongside the percent.
- Label every fee by name and method: "Payment fee (GCash)". "VAT (12%, included)" is informational and indented under the subtotal.
- Never display centavo integers; APIs carry `{ "amount": 41500, "currency": "PHP" }`.

### 5.3 Dates, times and time zones
- Dates: `Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })` → "Sat, Oct 3, 2026". Never numeric-only dates (MM/DD vs DD/MM ambiguity).
- Times: 12-hour with AM/PM ("7:00 PM"); ranges with an en dash ("7:00–8:00 PM"). Noon and midnight follow the Philippine convention "12:00 NN" and "12:00 MN" to avoid AM/PM confusion.
- Zones: player and business UI say "Manila time" (or the venue's city for non-Manila zones); admin and audit views show UTC plus "UTC+08:00". Do not use `Intl` short zone names — en-PH renders "PST", which readers confuse with US Pacific time.
- Relative time only as a supplement: "Starts in 45 min (7:00 PM)". Durations: "60 min", "1 h 30 min".

### 5.4 Codes, numbers and masking
- Booking code `CK-7Q4M2P`, pickup code `PU-3H8R6W`, ticket `SUP-1042`: uppercase, alphabet without I, L, O, U.
- Phone "+63 917 000 0001", masked "+63 917 ••• 0001". Email masked "b•••@example.com". Staff without `customers.view_contact` see names as "Bea S.".
- Cards: brand and last four only ("Visa •••• 4242"); e-wallets by provider name. Nothing more is ever stored or shown.

### 5.5 Restrictions and sensitive moments

| Don't | Do |
|---|---|
| "You are banned from Pasig Pickle Hub." | "Your bookings at Pasig Pickle Hub are paused until Mon, Nov 2, 2026. If you think this is a mistake, you can ask CourtKo Support to review it." |
| "Blocked for repeated no-shows." | Show no reason to the player; the appeal path explains how to ask for a review. |
| Staff: "This user is banned." | Staff: "Booking not allowed for this customer. A manager can review." |
| "Suspicious account detected." | "We couldn't complete this booking. Contact Support if you need help." |
| "You didn't show up." | "We recorded a no-show for your 6:00 PM booking at Pasig Pickle Hub. If this is wrong, contact the venue or CourtKo Support." |

### 5.6 Error messages
Pattern: **what happened** + **why** (only if safe and useful) + **what to do** + **"Ref: {correlationId}"** in business, admin and support contexts. Keep the user's input; never blame; never "Oops" or a bare "Something went wrong".

| Code | Default copy |
|---|---|
| `VALIDATION_FAILED` | Field-level, e.g. "Enter a mobile number like +63 917 000 0001." |
| `UNAUTHENTICATED` | "Please sign in to continue." |
| `MFA_REQUIRED` | "Enter the 6-digit code from your authenticator app to continue." |
| `FORBIDDEN` | Staff: "You don't have access to do this. Ask your business owner to update your role." Player: "You can't do this with your account." |
| `NOT_FOUND` | "We can't find that page or item." |
| `CONFLICT` | "This was just changed by someone else. Refresh to see the latest." |
| `SLOT_UNAVAILABLE` | "That time was just booked. Here are the next open times." |
| `HOLD_EXPIRED` | "Your hold ended, so the court was released. Pick a time again." |
| `HOLD_LIMIT_REACHED` | "You already have 2 courts on hold. Finish or release one to continue." |
| `BOOKING_NOT_ALLOWED` | "We can't complete this booking. This venue isn't taking bookings from your account right now. Contact Support if you need help." |
| `QUOTE_EXPIRED` | "The price changed from ₱400.00 to ₱450.00. Review the new total to continue." |
| `PROMO_INVALID` | "This code can't be used for this booking." Add a safe reason when known: "It expired on Sep 30." / "Minimum spend is ₱500.00." |
| `POLICY_NOT_ACCEPTED` | "Please agree to the cancellation policy to continue." |
| `PAYMENT_METHOD_UNAVAILABLE` | "GCash is unavailable right now. Choose another method." |
| `IDEMPOTENCY_KEY_REUSED` | Not user-facing (client defect): "Something went wrong on our side. Please try again." + Ref |
| `IDEMPOTENCY_IN_PROGRESS` | "We're still processing your last request. This takes a few seconds." |
| `RATE_LIMITED` | "Too many attempts. Try again in 30 seconds." (from `Retry-After`) |
| `PROVIDER_UNAVAILABLE` | "We couldn't reach the payment provider. Your court is still held for 06:12. Try again." |
| `OUT_OF_STOCK` | "Bottled water is sold out and was removed from your order." |
| `EVENT_FULL` | "This event is full. Join the waitlist to get the next open spot." |
| `INVALID_STATE_TRANSITION` | "This booking can't be changed now — it's already checked in." (state-specific) |
| `SUPPORT_MODE_READ_ONLY` | "Not available in support mode." |
| `APPROVAL_REQUIRED` | "This change needs approval from a different authorized admin." |

### 5.7 Buttons and links
Verb first, outcome explicit: "Pay ₱624.37", "Cancel and refund ₱200.00", "Keep booking". One primary button per view. In booking dialogs never use a bare "Cancel" (ambiguous); use "Keep booking" / "Cancel booking". Links describe their destination ("Read the Standard policy"), never "Click here".

## 6. Accessibility standard — WCAG 2.2 AA checklist

| Principle | Criteria and how CourtKo meets them |
|---|---|
| Perceivable | **1.1.1** alt text required for venue photos before publish; QR codes have text alternatives; decorative icons hidden. **1.3.1** semantic headings, tables with headers, labeled fields and fieldsets. **1.3.4** portrait and landscape (desk tablets). **1.3.5** `autocomplete` tokens (`email`, `tel`, `name`, `one-time-code`, `new-password`, `current-password`). **1.4.1** status text/icons; calendar patterns. **1.4.3** pairs in §2.1. **1.4.4 / 1.4.10** 200% zoom and 320 px reflow; wide tables and the calendar offer list alternatives. **1.4.11** input borders slate-500, focus ring and chart marks ≥ 3:1. **1.4.12** text spacing tolerated. **1.4.13** tooltips dismissible, hoverable, persistent |
| Operable | **2.1.1 / 2.1.2** everything by keyboard, including timeline, calendar and scanner (manual code entry); dialogs trap focus but Esc exits. **2.2.1** hold timer warns at 2 min and offers an extension per doc 23 D-33 (pending decision); idle-session warning 2 min before expiry with "Stay signed in" (player and business); admin re-authentication is security-essential but warned. **2.2.2** no auto-advancing content; live calendars never move focus. **2.3.1** no flashing. **2.4.1–2.4.7** skip link, descriptive page titles ("Review and pay — CourtKo"), logical focus order, visible focus. **2.4.11 (new)** focus never hidden by sticky elements. **2.5.1–2.5.4** no path or multi-touch gestures required, labels match names, no motion actuation. **2.5.7 (new)** every drag (calendar, slider, map) has a click or keyboard alternative. **2.5.8 (new)** targets ≥ 24 px; CourtKo standard 44 px |
| Understandable | **3.1.1 / 3.1.2** `lang="en-PH"`, Filipino phrases marked. **3.2.1 / 3.2.2** selecting a method updates the total but never submits. **3.2.3 / 3.2.4** consistent navigation and names. **3.2.6 (new)** Help in the same place on every page. **3.3.1–3.3.3** errors identified in text with suggestions. **3.3.4** financial actions reviewable (review step, refund preview, confirmation dialogs). **3.3.7 (new)** no re-entry of known data (profile reused at checkout; walk-in reuses customer). **3.3.8 (new)** paste and password managers allowed, OTP autofill, no cognitive tests; if a challenge is ever shown, an accessible alternative exists |
| Robust | **4.1.2** ARIA patterns for combobox, tabs, dialog, grid, menu; **4.1.3** status messages via live regions (totals, result counts, payment status, countdown thresholds) |

Verification: axe-core in Playwright on every critical route (zero serious or critical violations), manual keyboard pass, screen readers (VoiceOver on iOS Safari, TalkBack on Android Chrome, NVDA on Windows Chrome), 200% zoom and 320 px reflow, reduced motion, Windows forced-colors mode; an external accessibility audit before launch (doc 18).

## 7. Component inventory

All components live in `packages/ui` (React + Radix primitives + Tailwind v4), are documented with usage and accessibility notes, and are tested with axe.

### 7.1 Actions and inputs

| Component | Variants | States | Key props | Accessibility |
|---|---|---|---|---|
| Button | primary, secondary, tertiary, danger, link; md 44 px, lg 52 px, sm 36 px visual (44 px hit area, dense desktop only) | default, hover, active, focus-visible, disabled, loading | `variant`, `size`, `iconStart`, `iconEnd`, `loading`, `fullWidth`, `type` | Native `<button>`; loading keeps the label and sets `aria-busy`; use `aria-disabled` plus a visible reason when users need to know why |
| Icon button | ghost, filled | as Button | `icon`, `label` (required) | `aria-label` + tooltip; 44 × 44 px |
| Text input | text, email, tel, search, number | default, focus, filled, error, disabled, read-only | `label`, `hint`, `error`, `required`, `prefix`, `suffix`, `autoComplete`, `inputMode` | Visible label (never placeholder-only); `aria-describedby` for hint/error; `aria-invalid`; 16 px text |
| Phone input | PH (+63) fixed at MVP | as input | `valueE164` | `autocomplete="tel"`, `inputmode="tel"`, example format in hint |
| Money input | pesos with ₱ prefix | as input | `valueCentavos`, `min`, `max` | Integer parsing (no floats); label states the unit ("Rate per hour, in pesos") |
| Select / combobox | native select; async combobox (location, customer search) | open, loading, empty, error | `options`, `onSearch`, `groupBy` | ARIA 1.2 combobox; grouped options; result count announced |
| Checkbox, radio, switch | switch for instant settings only; checkbox for consent and multi-select | checked, unchecked, indeterminate, disabled | `label`, `description` | Clickable labels; groups use fieldset/legend |
| OTP input | single field, visually segmented (6 digits) | idle, filling, verifying, error (attempts left), locked (retry time), success | `length`, `onComplete`, `resendCooldownSec` | `autocomplete="one-time-code"`, `inputmode="numeric"`, paste allowed; one field (not six) for screen readers; resend countdown announced |
| Password field + meter | new, current | hidden, shown, weak/fair/strong, error | `mode`, `minLength` (12 or 15, per doc 23 D-28) | Show/hide button with `aria-pressed`; meter text in a polite live region; breached/common-password check on the server; paste allowed |
| File upload | dropzone, button | idle, uploading (progress), scanning, ready, rejected (type, size, malware), error | `accept`, `maxBytes`, `multiple`, `purpose` | Keyboard button; progress and scan status announced; errors name file and reason |

### 7.2 Selection, scheduling and time

| Component | Variants | States | Key props | Accessibility |
|---|---|---|---|---|
| Date chips | 14-day scroller + "More dates" calendar | default, selected, today, disabled (beyond advance limit) | `start`, `days`, `selected`, `disabledAfter` | Radio group; arrow keys; names like "Saturday, October 3" |
| Time-slot chip | player chip | available, selected, unavailable (reason), past, too far ahead | `start`, `durationMin`, `priceCentavos`, `state`, `reason` | Button with full name (court, time, price, state); `aria-pressed` when selected; `aria-disabled` with reason |
| Availability timeline | player grid; staff resource calendar | loading, stale, live | `courts`, `date`, `slotMinutes` (30), `items`, `mode` | Grid with roving tabindex; list-view alternative; no drag required; legend in text |
| Stepper | horizontal (checkout), vertical (onboarding) | complete, current, upcoming, error | `steps`, `current` | Ordered list; `aria-current="step"` |
| Segmented control | 2–4 options (List/Map, Day/Week, periods) | selected, disabled | `options`, `value` | Radio group (tabs only if it swaps panels) |
| Tabs | line, contained | selected, disabled | `tabs`, `value`, `syncToUrl` | ARIA tabs; URL-synced via `?tab=` |
| Filters | desktop bar, mobile bottom sheet, active chips | applied count, clear | `facets`, `values`, `resultCount` | Sheet is a modal dialog; count in live region; chips "Remove filter: Indoor" |
| Countdown | hold, waitlist offer, support session, idle warning | normal, warning (≤ 2 min), expired | `expiresAt` (server time), `thresholds`, `onExpire` | `role="timer"` with `aria-live="off"` plus announcements at thresholds; server-time offset; no pulsing under reduced motion |

### 7.3 Cards, money and content

| Component | Variants | States | Key props | Accessibility |
|---|---|---|---|---|
| Venue card | compact (rail), full (list), map popup | loading, no slots for filter | `venue`, `distanceKm` (rounded), `nextAvailable`, `favorite` | One link (name) + separate favorite toggle (`aria-pressed`); venue alt text |
| Event card | list, compact | open, few spots, full (waitlist), closed | `event`, `spotsLeft`, `waitlistOpen` | Type conveyed in text, not only purple |
| Booking card | upcoming, past | by booking status | `booking`, `primaryAction` | Status pill text; time with zone |
| Order card | list | by order status | `order` | Claim action names the code |
| Status pill | sm, md | per §3 | `catalog`, `value`, `audience` | Text is the label; icon hidden |
| Price breakdown | player (no `funded_by`), business (funder, commission, venue net), admin (+ ledger references) | loading (re-quote), stale, final | `lines` (server quote or snapshot), `audience` | Table with row headers; tabular numerals; total announced on change |
| QR display | booking check-in, pickup claim, payment (walk-in) | loading, valid, expired → refresh | `token` (signed, short-lived), `code` | Text alternative with the code; brightness hint |
| Map | results map, venue location | loading, error (list continues), no location | `markers`, `selected`, `onSearchArea` | Supplementary to the list; markers mirrored in list; no scroll trap |
| Rating | display, input (1–5) | empty, set | `value`, `count` | "4.7 out of 5, 128 reviews"; input is a radio group |
| Avatar | 24, 32, 40, 64 px; image or initials | — | `name`, `src` | Empty alt when the name is adjacent |

### 7.4 Data display and feedback

| Component | Variants | States | Key props | Accessibility |
|---|---|---|---|---|
| Data table | standard, dense, selectable; cards under 768 px | loading rows, empty, error, partial | `columns` (permission-aware), `rows`, `sort`, `cursor` | Caption, `th` scope, `aria-sort`; numbers right-aligned; "Load more" instead of infinite scroll |
| KPI tile | value, value + delta | loading, error ("—"), stale | `label`, `value`, `delta`, `dateBasis` | Heading + value; delta in words ("up 12% vs last 7 days") |
| Charts | bar, line, stacked bar, utilization heatmap | loading, empty, error | `series`, `dateBasis` | Text summary + data-table toggle; patterns plus color; no hover-only data |
| Toast | success, info | visible, paused (hover/focus) | `message`, `action` | `role="status"`; ≥ 6 s; never for errors that need action |
| Banner | info, success, warning, danger; environment; offline; hold warning | — | `tone`, `title`, `action`, `dismissible` | `role="status"` (danger: `role="alert"`) |
| Modal / confirm dialog | dialog, alertdialog (destructive), mobile full-screen sheet | open, submitting, error | `title`, `description`, `confirmLabel`, `tone`, `requireTypedConfirmation` (irreversible admin actions) | Focus trap; Esc closes; focus returns; destructive dialogs focus the safe action first |
| Drawer | right side sheet (desktop), bottom sheet (mobile) | open, loading | `title`, `modal` | Modal drawers use dialog semantics; non-modal drawers are labeled regions |
| Empty / skeleton / error states | page, section, inline | — | `title`, `body`, `action`, `correlationId` | Skeleton containers set `aria-busy="true"`; error states include retry and Ref |

### 7.5 Business, admin and presenter

| Component | Variants | States | Key props | Accessibility |
|---|---|---|---|---|
| Permission matrix | role editor, role comparison | granted, not granted, not assignable (Owner-only), unavailable (actor lacks), changed | `permissions` (code, meaning, risk), `roles`, `actorPermissions` | Table semantics; reasons as visible text; risk as text |
| Audit row | compact, expanded | intact, chain-break flag | `entry` (time, actor, subject, action, target, scope, IP, correlation ID, hashes) | Expand button with `aria-expanded`; before/after as labeled lists; local time and UTC |
| Support-mode banner | desktop, mobile | active, warning (≤ 5 min), ending | `subject`, `ticket`, `expiresAt` | Non-dismissible labeled region; first in tab order |
| Business / venue switcher | single, multi-venue | loading, one option (static label) | `memberships`, `venueScopes` | Menu button showing the current value |
| Scanner | camera + manual code | permission prompt, scanning, success, invalid, already used | `mode` (booking, event, pickup) | Manual entry always available; results announced; sound/haptics never the only feedback |
| Phone frame (presenter) | iPhone-size, Android-size outline | on, off | `device`, `children` | Demo-only wrapper for client presentations, excluded from production bundles; frame chrome `aria-hidden`; content fully accessible |

## 8. Do's and don'ts

| Do | Don't |
|---|---|
| Show the full total, including the payment fee, on the Pay button | Add fees on the provider page or after payment (drip pricing) |
| Leave add-ons and marketing opt-ins unselected | Pre-check add-ons or consent boxes |
| Use real availability ("2 courts free") | Fake scarcity or countdowns that reset |
| Make cancelling as easy as booking, with the refund shown first | Hide cancellation or require contacting support |
| Confirm destructive actions with outcome and amount in the button | Use "OK / Cancel" for destructive choices |
| Offer a neutral "No thanks" | Confirmshaming ("No, I don't like saving money") |
| Label every rating with its source | Present self-declared or platform ratings as official |
| Show "Confirming payment" until the server verifies it | Show "Paid" because the provider redirected back |
| Keep one primary action per view | Place two equal-weight primary buttons side by side |
| Use neutral language for restrictions | Accuse, shame, or reveal reasons to the player or other businesses |
| Show disabled staff actions with the reason when it helps | Rely on hidden buttons for security |
| Label any sponsored placement clearly (Phase 3 at the earliest) | Mix paid placement into "Recommended" |
