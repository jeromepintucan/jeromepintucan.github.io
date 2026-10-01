# 16 — Wireframes for Critical Screens

| Field | Value |
|---|---|
| Document | 16 of 23 — Text wireframes |
| Status | Draft v1.0 |
| Owner | Product design (Senior UX/UI) |
| Last updated | 2026-09-30 |
| Related | [04 Journeys](04-key-user-journeys.md) · [05 IA](05-information-architecture.md) · [06 Sitemap](06-sitemap.md) · [17 Design system](17-design-system.md) · [07 Booking](07-booking-state-machine.md) and [08 Payment](08-payment-state-machine.md) state machines · [14 Threat model](14-security-threat-model.md) · [23 Assumptions](23-assumptions-and-decisions.md) |

Mobile frames represent a 390 px viewport (about 40 characters of content); desktop frames represent 1280 px. All data is synthetic and matches the journeys in doc 04 and the money examples in doc 01 §4. Payment-fee rates are PLACEHOLDERS (online banking flat ₱15.00, GCash 2.3%, Maya 2.0%; QR Ph and cards never carry a customer fee). Frames that show a customer-paid fee illustrate pass-through ON; the default is OFF for every method until counsel confirms each one (doc 23 D-05).

**Notation:** `[ Button ]` · `( )` / `(•)` radio or chip, `[x]` checkbox, `[Sat 3]` selected chip · `v` dropdown · `>` link or disclosure · `►` selected slot · `--` unavailable · `♡` favorite toggle · `!` exception.

**Rules for every screen**
- **Loading:** skeletons that match the final layout; sections load independently; a spinner is never shown alone for more than 1 s without text.
- **Empty:** say why it is empty and offer the next action.
- **Error:** what happened, what to do, a retry; business and admin screens add "Ref: {correlationId}". Players never see raw error codes.
- **Success:** inline confirmation or toast; money actions always show the resulting status, not just "Done".
- Every time shows its zone context; every amount comes from the server quote or ledger, never computed in the browser.
- Sticky headers, bars and banners never cover the focused element (WCAG 2.2 SC 2.4.11).

| § | Screen | Route | Primary actor |
|---|---|---|---|
| 1 | Home / search | `/` | Player |
| 2 | Find a Court (list, map, filters) | `/courts` | Player |
| 3 | Venue details | `/venues/:slug` | Player |
| 4 | Availability timeline and slot selection | `/app/book/:venueSlug` (step 1) | Player |
| 5 | Checkout review | `/app/book/:venueSlug` (step 2) | Player |
| 6 | Provider sandbox page (demo only) | `/pay/:sessionId` | Demo presenter |
| 7 | Payment processing and confirmation | `/app/checkout/:id` | Player |
| 8 | Booking detail with cancel and refund preview | `/app/bookings/:id` | Player |
| 9 | Player activity dashboard | `/app/activity` | Player |
| 10 | Business overview | `/biz` | Owner, manager |
| 11 | Business calendar | `/biz/calendar` | Staff |
| 12 | Walk-in booking | `/biz/walk-in` | Receptionist |
| 13 | Pricing rules and price simulator | `/biz/pricing` | Owner, manager |
| 14 | Court block conflict dialog | `/biz/courts`, `/biz/calendar` | Court or business manager |
| 15 | Staff and custom role permission editor | `/biz/staff` | Owner, manager |
| 16 | Settlement statement | `/biz/payouts` (Statements) | Owner, finance viewer |
| 17 | SuperAdmin overview | `/admin` | Platform staff |
| 18 | Business verification review | `/admin/businesses/:id` | Platform compliance |
| 19 | Commission agreement (maker-checker) | `/admin/commissions` | Platform finance + checker |
| 20 | Reconciliation view | `/admin/transactions` (Reconciliation) | Platform finance |
| 21 | Support-mode banner | all surfaces during support mode | Platform support |
| 22 | Audit log with hash-chain verification | `/admin/audit`, `/biz/audit` | Compliance, owner |

---

## 1. Home / search

**Purpose.** Get a player from landing to relevant courts in one action, with or without sharing location.

```text
┌──────────────────────────────────────────┐
│ CourtKo                    Log in   Menu │
├──────────────────────────────────────────┤
│ Book pickleball courts across            │
│ the Philippines.                         │
│ ┌──────────────────────────────────────┐ │
│ │ Where? Area, landmark or venue       │ │
│ └──────────────────────────────────────┘ │
│ [ Use my location ]       Why we ask (i) │
│ When  (Today) (Tomorrow) [Sat 3] (>)     │
│ Time  [ Any time                   v ]   │
│ [             Find courts             ]  │
├──────────────────────────────────────────┤
│ Courts near Kapitolyo, Pasig     See all │
│ ┌──────────────────┐┌──────────────────┐ │
│ │ [ cover photo  ] ││ [ cover photo  ] │ │
│ │ Pasig Pickle Hub ││ Makati Dink Club │ │
│ │ ~2.4 km · ★ 4.7  ││ ~5.1 km · ★ 4.5  │ │
│ │ From ₱300/hr     ││ From ₱450/hr     │ │
│ │ Next: 7:00 PM    ││ Next: 8:30 PM    │ │
│ │ 2 indoor free ♡  ││ 1 covered free ♡ │ │
│ └──────────────────┘└──────────────────┘ │
├──────────────────────────────────────────┤
│ Events this week                 See all │
│ > Fri, Oct 9 · Open Play · ₱250 · 4 left │
│ > Sat, Oct 10 · Clinic · ₱600 · 8 left   │
├──────────────────────────────────────────┤
│ Own a venue?        [ List your courts ] │
├──────────────────────────────────────────┤
│ Help · Terms · Privacy · Cookie settings │
└──────────────────────────────────────────┘
```

- **Desktop:** one-row hero search (Where · When · Time · Find courts), four-column venue grid, events rail, business band; header per doc 05 §3.1.
- **States:** search works before rails load; rails show skeleton cards. Empty: "No courts near Kapitolyo yet. Try Pasig City or another date." Error: "Couldn't load courts near you. Retry" (search still works). Location denied: the rail becomes "Popular in Metro Manila" with no repeated prompt.
- **Accessibility:** h1 is the tagline, each rail an h2. The Where field is an ARIA combobox with grouped suggestions (City, Barangay, Landmark, Venue). "Use my location" explains before the browser prompt. Date chips are a radio group. Each venue card is one link plus a separate favorite toggle (`aria-pressed`, "Save Pasig Pickle Hub to favorites").

## 2. Find a Court (list, map, filters)

**Purpose.** Compare venues for a place and time, switch between list and map, and narrow with filters.

```text
┌──────────────────────────────────────────┐  ┌──────────────────────────────────────────┐
│ < Back                      Find a Court │  │ < Back                      Find a Court │
│ ┌──────────────────────────────────────┐ │  │ List [Map]   Filters (2)   Sort: Soonest │
│ │ Kapitolyo, Pasig · Sat 3 · 6-9 PM    │ │  │ ┌──────────────────────────────────────┐ │
│ └──────────────────────────────────────┘ │  │ │         [₱450]                       │ │
│ [List] Map   Filters (2)   Sort: Soonest │  │ │                       [₱400]         │ │
│ Indoor ×   Evening ×           Clear all │  │ │    [₱300]◄                           │ │
│ 12 venues · rates per hour · Manila time │  │ │                 [₱350]               │ │
│ ┌──────────────────────────────────────┐ │  │ │                                      │ │
│ │ [          cover photo           ]   │ │  │ │          [ Search this area ]        │ │
│ │ Pasig Pickle Hub         ★ 4.7 (128) │ │  │ └──────────────────────────────────────┘ │
│ │ Kapitolyo, Pasig · ~2.4 km         ♡ │ │  │ ┌──────────────────────────────────────┐ │
│ │ From ₱300/hr · Indoor · Covered      │ │  │ │ Pasig Pickle Hub               ★ 4.7 │ │
│ │ Next: 7:00 PM · 2 courts free        │ │  │ │ From ₱300/hr · Next: 7:00 PM         │ │
│ │ Parking · Restrooms · Lights · +3    │ │  │ │ ~2.4 km · 2 courts free              │ │
│ └──────────────────────────────────────┘ │  │ │ [ View venue ]                       │ │
│ ┌──────────────────────────────────────┐ │  │ └──────────────────────────────────────┘ │
│ │ Makati Dink Club          ★ 4.5 (86) │ │  └──────────────────────────────────────────┘
│ │ Makati · ~5.1 km                   ♡ │ │
│ │ From ₱450/hr · Covered               │ │
│ │ Next: 8:30 PM · 1 court free         │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│ Filters                            Close │
├──────────────────────────────────────────┤
│ Distance  (2) (5) [10] (25 km)           │
│ Time      (AM) (Noon) [Eve] (Late)       │
│ Duration  (30) [60] (90) (120) min       │
│ Price/hr  ₱0 ──o──────────o── ₱1,000     │
│ Setting   [x] Indoor  [ ] Covered        │
│           [ ] Outdoor                    │
│ Amenities [ ] Parking [ ] Showers        │
│           [ ] Air-con [ ] Night lights   │
│ Rating    (Any) (4.0+) (4.5+)            │
│ Events    [ ] Open play this week        │
│ Access    [ ] Wheelchair access          │
├──────────────────────────────────────────┤
│ [ Clear ]             [ Show 12 venues ] │
└──────────────────────────────────────────┘
```

Desktop (filters left, results center, map right, sticky):

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ CourtKo   Find a Court   Events   How It Works   For Business   Pricing         Log in   Sign up │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Filters                 Results (12) · Sort: Soonest          Map                                │
│ Distance 10 km          ┌ Pasig Pickle Hub   ★ 4.7 ┐             [₱450]        [₱400]            │
│ Evening · 60 min        │ ~2.4 km · From ₱300/hr   │                  [₱300]◄                    │
│ [x] Indoor              │ Next 7:00 PM · 2 free    │                         [₱350]              │
│ Amenities ...           └──────────────────────────┘             [ Search this area ]            │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Behavior:** active filters stay visible as removable chips; the count updates live. List and map share selection (tap a pin → its card; hover a card → pin highlight). "Search this area" appears after panning; the map never re-queries on its own.
- **States:** skeleton list and "Loading map". Empty: "No courts match. Removing 'Indoor' shows 5 more." plus "Try another date". Error: results fail → message, retry, no stale list. Map provider fails → list continues with "Map unavailable".
- **Accessibility:** result count in an `aria-live="polite"` region. The list is the complete, accessible representation; the map is supplementary. The filter sheet is a modal dialog (focus trap, Esc closes, "Show 12 venues" applies). Chips read "Remove filter: Indoor". The price range has numeric inputs as an alternative to the slider.

## 3. Venue details

**Purpose.** Everything needed to decide and start booking: location, courts, rates, rules, policy, amenities, reviews.

```text
┌──────────────────────────────────────────┐
│ < Back                         Share   ♡ │
│ [     photo gallery · 1 of 6      ]      │
│ Pasig Pickle Hub              [Verified] │
│ ★ 4.7 (128 reviews) · Kapitolyo, Pasig   │
│ Landmark: beside Kapitolyo church        │
│ 2 indoor · 2 covered · acrylic surface   │
│ From ₱300/hr · Peak ₱400/hr 5-10 PM      │
├──────────────────────────────────────────┤
│ Amenities: Parking · Restrooms · Showers │
│ Night lights · Drinking water · +4 more  │
├──────────────────────────────────────────┤
│ Courts                                   │
│ Court 1  Indoor · Full      from ₱300/hr │
│ Court 2  Indoor · Full      from ₱300/hr │
│ Court 3  Covered · Full     from ₱300/hr │
│ Court 4  Covered · Full     from ₱300/hr │
├──────────────────────────────────────────┤
│ Cancellation: Standard policy (v3)       │
│ Full refund 24 h+ before · 50% 6-24 h    │
│ No refund under 6 h · payment fee kept   │
│ [ Read full policy ]       House rules > │
├──────────────────────────────────────────┤
│ Events here: Fri, Oct 9 Open Play >      │
│ Add-ons: paddle rental, balls, water     │
│ Reviews: "Great lights at night" >       │
│ Report this listing                      │
├──────────────────────────────────────────┤
│ [ Sat, Oct 3 v ]  [ Check availability ] │
└──────────────────────────────────────────┘
```

- **Desktop:** content left; sticky booking card right (date chips + mini availability). The policy summary is visible before the booking call-to-action on both layouts. The verified badge explains "Documents reviewed by CourtKo".
- **States:** skeleton; unpublished or suspended venue → system "Not found" page; sections with no data are omitted (no "No events" filler); favorites prompt sign-in and return here.
- **Accessibility:** gallery buttons "Previous photo" / "Next photo" with "Photo 1 of 6" and venue-provided alt text; rating read as "4.7 out of 5 from 128 reviews"; the sticky bar reserves bottom padding so focus is never hidden; "Report this listing" opens a form dialog.

## 4. Availability timeline and slot selection

**Purpose.** Choose court, date, start and duration, then hold the slot.

```text
┌──────────────────────────────────────────┐
│ < Pasig Pickle Hub           Step 1 of 3 │
│ Choose a court and time                  │
│ (Fri 2) [Sat 3] (Sun 4) (Mon 5) (Tue 6)  │
│ Duration  [60 min] (90) (120)            │
│ Times in Manila time (UTC+08:00)         │
├──────────────────────────────────────────┤
│ Court [1 Indoor] (2 Indoor) (3) (4) >    │
├──────────────────────────────────────────┤
│ Evening                                  │
│ [ 5:00 PM ₱400 ]   [ 5:30 PM  --  ]      │
│ [ 6:00 PM  --  ]   [ 6:30 PM  --  ]      │
│ [►7:00 PM ₱400 ]   [ 7:30 PM  --  ]      │
│ [ 8:00 PM  --  ]   [ 8:30 PM  --  ]      │
│ [ 9:00 PM ₱400 ]   [ 9:30 PM ₱400 ]      │
│ --  unavailable (booked, held or closed) │
│ ►   selected                             │
├──────────────────────────────────────────┤
│ Court 1 · Sat, Oct 3 · 7:00-8:00 PM      │
│ ₱400.00 · 60 min            [ Continue ] │
└──────────────────────────────────────────┘
```

Desktop timeline (courts × 30-minute cells):

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Sat, Oct 3, 2026 · Manila time (UTC+08:00)                              Duration [60] (90) (120) │
│                 5:00 PM     6:00 PM     7:00 PM     8:00 PM     9:00 PM                          │
│ Court 1 Indoor  [open][open][ -- ][ -- ][►SEL][►SEL][ -- ][ -- ][open][open]                     │
│ Court 2 Indoor  [open][open][ -- ][ -- ][ -- ][open][open][open][open][open]                     │
│ Court 3 Covered [open][open][ -- ][ -- ][open][open][open][open][open][open]                     │
│ Court 4 Covered [ -- ][ -- ][open][open][open][open][ -- ][ -- ][ -- ][ -- ]                     │
│                                                                                                  │
│ Selected: Court 1 · 7:00-8:00 PM · ₱400.00                                          [ Continue ] │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Behavior:** mobile chips list only start times that fit the selected duration (with 60 min selected, 7:30 PM is unavailable because 8:00 PM is taken). Desktop: select a start cell; duration extends the selection — no dragging required. Unavailable cells explain why on focus or tap (booked, being booked, closed for maintenance, outside hours, beyond the advance-booking limit). Players never see who holds a slot.
- **States:** skeleton grid. Empty day: "No open times on Sat, Oct 3. Next available: Sun, Oct 4, 6:00 AM" [Go]. Error: "Couldn't load availability. Retry"; stale data is never bookable — Continue always re-validates. Continue errors: `SLOT_UNAVAILABLE` (refresh plus nearest alternatives), `HOLD_LIMIT_REACHED`, `BOOKING_NOT_ALLOWED` (neutral copy), `VALIDATION_FAILED` (venue rule text).
- **Accessibility:** grid pattern with roving tabindex, arrow keys, Home/End per row; each slot is a button named like "Court 1, Saturday October 3, 7:00 to 8:00 PM, ₱400, available"; unavailable slots are `aria-disabled` with the reason; state uses text or pattern plus color; targets at least 44 × 44 px; no drag needed (SC 2.5.7).

## 5. Checkout review

**Purpose.** Show everything that affects price and refunds before payment, collect the method and policy acceptance, and start payment.

```text
┌──────────────────────────────────────────┐
│ < Back                       Step 2 of 3 │
│ Review and pay                           │
│ ┌──────────────────────────────────────┐ │
│ │ Court held for 09:41, then released  │ │
│ └──────────────────────────────────────┘ │
├──────────────────────────────────────────┤
│ Pasig Pickle Hub · Court 1 (Indoor)      │
│ Sat, Oct 3, 2026 · 7:00-8:00 PM          │
│ Manila time · 60 min                     │
│ Players (optional)         [ Add names ] │
├──────────────────────────────────────────┤
│ Add-ons                                  │
│ Paddle rental     [-] 2 [+]      ₱200.00 │
│ Bottled water     [-] 2 [+]       ₱60.00 │
│ Pickleballs 3-pack    [+]     ₱250.00 ea │
│ Promo [ WELCOME50  ]             Applied │
├──────────────────────────────────────────┤
│ Price details                            │
│ Court fee (60 min)               ₱400.00 │
│ Add-ons                          ₱260.00 │
│ Discount (WELCOME50)             −₱50.00 │
│ Subtotal                         ₱610.00 │
│   VAT (12%, included)             ₱65.36 │
│ Payment fee (GCash)               ₱14.37 │
│ Total                            ₱624.37 │
├──────────────────────────────────────────┤
│ Pay with                                 │
│ ( ) QR Ph                         No fee │
│ (•) GCash                        +₱14.37 │
│ ( ) Maya                         +₱12.45 │
│ ( ) Card (Visa, Mastercard)       No fee │
│ Fees are set by the payment provider.    │
├──────────────────────────────────────────┤
│ Cancellation: Standard policy (v3)       │
│ · 24 h+ before start: 100% of court fee  │
│ · 6-24 h: 50% · under 6 h: no refund     │
│ · Payment fee kept if you cancel         │
│ · Venue cancels: full refund incl. fee   │
│ · Reschedule once, up to 12 h before     │
│ [x] I agree to the cancellation policy   │
│     (v3) and the Terms of Use.           │
├──────────────────────────────────────────┤
│ [        Pay ₱624.37 with GCash        ] │
│ Next: the payment provider's page.       │
└──────────────────────────────────────────┘
```

- **Price lines:** Court fee · Add-ons · Discount (code only — `funded_by` is stored, never shown to players) · Subtotal · VAT (12%, included) as information, not added · Payment fee for the selected method · Total. Changing the method re-quotes on the server; the Pay button always states the exact total. The frame shows pass-through ON for the e-wallet and online-banking methods to illustrate disclosure; QR Ph and Card always show "No fee" because customer surcharges are not permitted for QR Ph (BSP) and are restricted for cards, so the platform absorbs those fees. With the default configuration (pass-through OFF for all methods, doc 23 D-05) every method shows "No fee" and the total equals the subtotal.
- **Hold timer:** announced at 5, 2 and 1 minutes; warning banner at 2 minutes; at expiry a dialog returns to slot selection. The "Need more time?" extension follows doc 23 D-33 (pending decision) and must respect the provider session expiry and the maximum hold lifetime in doc 07.
- **Desktop:** two columns — add-ons, method and policy left; sticky summary with price details and Pay right.
- **States:** "Updating total…" replaces the total while quoting and Pay is disabled. `QUOTE_EXPIRED` → banner with old and new price and re-confirmation; `PROMO_INVALID` inline; `OUT_OF_STOCK` removes the item and re-quotes; `PAYMENT_METHOD_UNAVAILABLE` disables that method with a reason; `PROVIDER_UNAVAILABLE` banner with retry, hold unchanged; `POLICY_NOT_ACCEPTED` inline on the checkbox. Success → provider page.
- **Accessibility:** price details are a table with row headers; new totals announced politely; method radios include the fee in their names ("GCash, payment fee ₱14.37"); the policy opens in a dialog; the checkbox label names the version; an error summary links to each field; nothing is pre-selected (no add-ons, no marketing consent).

## 6. Provider sandbox page (demo only)

**Purpose.** In the interactive demo, stand in for the provider's hosted checkout so every payment outcome can be shown safely.

```text
╔══════════════════════════════════════════╗
║ SANDBOX · MOCK PROVIDER · NO REAL MONEY  ║
╠══════════════════════════════════════════╣
║ Merchant   Pasig Pickle Hub (demo)       ║
║ Amount     ₱624.37 PHP                   ║
║ Method     GCash (simulated)             ║
║ Session    ps_demo_7f3k2                 ║
║ Expires    9:14 PM Manila time           ║
╠══════════════════════════════════════════╣
║ Choose an outcome to simulate            ║
║ [ Pay successfully                   ]   ║
║ [ Decline the payment                ]   ║
║ [ Cancel and return to CourtKo       ]   ║
║ [ Pay; webhook arrives in 2 min      ]   ║
║ [ Pay, then close the browser        ]   ║
║ [ Pay; send a duplicate webhook      ]   ║
║ [ Pay after the hold expired         ]   ║
╠══════════════════════════════════════════╣
║ Demo only. Stands in for Xendit hosted   ║
║ checkout. Never deployed to production.  ║
╚══════════════════════════════════════════╝
```

- Each outcome drives the same webhook → re-query → state-transition path as production. **Production has no such page:** players use Xendit's hosted checkout; CourtKo controls only amount, expiry and return URL.
- **States:** unknown session → not found; expired session → "This payment session has expired" with a return link; after any outcome → `/app/checkout/:id`.
- **Accessibility:** "SANDBOX" is text, not only color; buttons are named by outcome; page title "Sandbox payment — CourtKo demo".

## 7. Payment processing and confirmation

**Purpose.** After the provider redirect, show only verified server state; confirm with QR and booking code.

```text
┌──────────────────────────────────────────┐  ┌──────────────────────────────────────────┐
│ CourtKo                                  │  │ CourtKo                                  │
├──────────────────────────────────────────┤  ├──────────────────────────────────────────┤
│ Confirming your payment                  │  │ Booking confirmed                        │
│ [==========                    ]         │  │ Pasig Pickle Hub · Court 1 (Indoor)      │
│ Waiting for GCash to confirm. This       │  │ Sat, Oct 3, 2026 · 7:00-8:00 PM          │
│ usually takes a few seconds.             │  │ Manila time                              │
│                                          │  │             ┌─────────────┐              │
│ Court 1 · Sat, Oct 3 · 7:00-8:00 PM      │  │             │ ▓▓▓ ▓ ▓ ▓▓▓ │              │
│ Court held for 07:12                     │  │             │ ▓ ▓  ▓▓ ▓ ▓ │              │
│                                          │  │             │ ▓▓▓ ▓ ▓ ▓▓▓ │              │
│ You can close this page. We will notify  │  │             │   ▓▓ ▓▓  ▓  │              │
│ you in the app, by email and by SMS.     │  │             │ ▓▓▓ ▓  ▓▓ ▓ │              │
└──────────────────────────────────────────┘  │             │ ▓ ▓ ▓▓ ▓  ▓ │              │
                                              │             │ ▓▓▓  ▓ ▓▓▓▓ │              │
                                              │             └─────────────┘              │
                                              │ Booking code  CK-9T2B6H                  │
                                              │ Show at the desk. Check-in opens 6:30 PM │
                                              │ Paid ₱624.37 · GCash                     │
                                              │ Add-ons: PU-3H8R6W, pick up at desk      │
                                              │ [ Add to calendar ]       [ Directions ] │
                                              │ [ View receipt ]               [ Share ] │
                                              └──────────────────────────────────────────┘
```

| State | Copy and actions |
|---|---|
| Still pending after 60 s | "Still confirming. You can close this page — we'll notify you." Link to Bookings |
| Failed, hold still valid | "Payment didn't go through. Court still held for 04:50." [Try again] [Choose another method] |
| Expired, unpaid | "Your hold ended. No payment was taken." [Pick a new time] |
| Late capture, slot recovered | "Your payment arrived and your booking is confirmed." |
| Late capture, slot taken | "Your payment arrived after the hold ended and the court was taken. A full refund of ₱624.37 has started." |

- **Accessibility:** a `role="status"` region announces changes; focus moves to the new heading; the confirmation never auto-redirects away; the QR has a text alternative and the booking code is shown as text; "Increase screen brightness" hint.

## 8. Booking detail with cancel and refund preview

**Purpose.** Everything about one booking, and a safe cancellation that shows the exact refund first.

```text
┌──────────────────────────────────────────┐  ┌──────────────────────────────────────────┐
│ < Bookings                   [Confirmed] │  │ Cancel this booking?                     │
│ Pasig Pickle Hub · Court 2 (Indoor)      │  │ Court 2 · Sat, Oct 3 · 6:00-7:00 PM      │
│ Sat, Oct 3, 2026 · 6:00-7:00 PM          │  │ You are cancelling 10 h before start.    │
│ Manila time · Code CK-7Q4M2P             │  ├──────────────────────────────────────────┤
│ [        Show check-in QR         ]      │  │ Paid                             ₱415.00 │
├──────────────────────────────────────────┤  │ Refund: court fee (50%)          ₱200.00 │
│ Paid                                     │  │ Not refunded                             │
│ Court fee                        ₱400.00 │  │   Court fee (50%)                ₱200.00 │
│   VAT (12%, included)             ₱42.86 │  │   Payment fee (Bank)              ₱15.00 │
│ Payment fee (Bank)                ₱15.00 │  ├──────────────────────────────────────────┤
│ Total paid                       ₱415.00 │  │ Refund to: original payment method       │
│ [ View receipt ]                         │  │ Timing: depends on the provider and      │
├──────────────────────────────────────────┤  │ method, usually a few business days.     │
│ Policy: Standard (v3), accepted          │  │ This amount is valid until 12:00 PM.     │
│ Sep 30, 2026, 9:12 PM                    │  ├──────────────────────────────────────────┤
│ Players: Bea S. + 3             [ Edit ] │  │ [           Keep booking            ]    │
│ History: Confirmed Sep 30, 9:13 PM >     │  │ [     Cancel and refund ₱200.00     ]    │
├──────────────────────────────────────────┤  └──────────────────────────────────────────┘
│ [ Reschedule ]        [ Cancel booking ] │
└──────────────────────────────────────────┘
```

- The preview uses the **accepted** policy version and a server cancellation quote. Reschedule shows eligibility; when ineligible it is disabled with the reason ("Reschedule closes 12 hours before start").
- **States:** skeleton lines while quoting with the destructive button disabled; `QUOTE_EXPIRED` re-quotes in place with an explanation; zero-refund variant labels the button "Cancel without refund"; after confirming, status "Refund in progress" with steps Requested → Processing → Refunded; refund failure shows "Taking longer than usual. No action needed."
- **Accessibility:** `role="alertdialog"`; initial focus on "Keep booking"; Esc keeps the booking; amounts in a table; the destructive button names the amount; focus returns to the status pill afterwards.

## 9. Player activity dashboard

**Purpose.** Personal stats and history with honest sources and privacy control up front.

```text
┌──────────────────────────────────────────┐
│ Activity           Visible to: Private v │
│ (30 d) [90 d] (12 mo) (All)              │
├──────────────────────────────────────────┤
│ ┌──────────────────┐┌──────────────────┐ │
│ │ Sessions         ││ Hours played     │ │
│ │ 18               ││ 24.5             │ │
│ └──────────────────┘└──────────────────┘ │
│ ┌──────────────────┐┌──────────────────┐ │
│ │ Venues visited   ││ Upcoming         │ │
│ │ 4                ││ 2                │ │
│ └──────────────────┘└──────────────────┘ │
├──────────────────────────────────────────┤
│ Sessions per month        [ Table view ] │
│ Jul  ████████                  4         │
│ Aug  ████████████              6         │
│ Sep  ████████████████          8         │
│ Up from 4 in July to 8 in September.     │
├──────────────────────────────────────────┤
│ Skill level                              │
│ Intermediate · Self-declared    [ Edit ] │
│ Venue-verified level: Phase 2            │
│ External rating: Phase 2 (official API)  │
├──────────────────────────────────────────┤
│ Events joined 3 · upcoming 1             │
│ Results appear when officially recorded  │
├──────────────────────────────────────────┤
│ Spent (payment date, 90 d)     ₱5,460.00 │
│ [ Booking and spending history > ]       │
│ Most visited: Pasig Pickle Hub (9)       │
└──────────────────────────────────────────┘
```

- **Desktop:** four tiles in a row; chart and skill card side by side.
- **States:** skeleton tiles. Empty (new player): "Your stats appear after your first completed game." [Find a court]. Error: tiles show "—" with retry. Visibility change → toast "Now visible to event organizers".
- **Accessibility:** each chart has a table view and a one-line text summary; tiles are headings with values; rating sources are text labels; the visibility select explains each level (Private, Event organizers, Public).

## 10. Business overview

**Purpose.** Tell an owner or manager what needs a decision now, then what is happening today, then money.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ CourtKo Business  [Hub Sports Co. v]  [Pasig Pickle Hub v]           [Scan]  Alerts 3  Joel R. v │
├────────────────┬─────────────────────────────────────────────────────────────────────────────────┤
│ Operate        │ Overview · Sat, Oct 3, 2026 · 5:40 PM · all times Manila time                   │
│ > Overview     │                                                                                 │
│   Calendar     │ Needs attention (4)                                                             │
│   Bookings     │ ! Payment pending 18 min · CK-5J9X2C · Court 3, 7:00 PM            [ Re-check ] │
│   Walk-in      │ ! Goodwill refund awaiting approval · ₱1,200.00                      [ Review ] │
│   Orders       │ ! Block request · Court 4, Sun 2:00-10:00 PM · 3 conflicts             [ Open ] │
│ Venue setup    │ ! Payout failed · ₱9,840.00 · bank account rejected                    [ View ] │
│   Venues       │                                                                                 │
│   Courts       │ Today                                                                           │
│   Pricing      │ 38 bookings · 6 check-ins due in the next hour · 2 past no-show grace           │
│   Events       │ 5 orders ready for pickup · utilization 71% of open court-hours                 │
│   Products     │ Next: 6:00 PM Court 1 L. Cruz · Court 2 R. dela Cruz · Court 3 Rina A.          │
│ People         │                                                                                 │
│   Customers    │ Money · by payment date · last 7 days (members with finance.view_summary)       │
│   Restrictions │ ┌───────────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐ │
│   Staff        │ │ Customer payments     │  │ Platform commission   │  │ Venue net             │ │
│   Reviews      │ │ ₱48,215.00            │  │ ₱2,120.00             │  │ ₱44,980.00            │ │
│ Money          │ └───────────────────────┘  └───────────────────────┘  └───────────────────────┘ │
│   Payments     │ Gateway fees paid by customers ₱1,115.00 · Next payout Mon, Oct 5 (scheduled)   │
│   Payouts      │                                                                                 │
│   Reports      │                                                                                 │
│ Admin          │                                                                                 │
│   Settings     │                                                                                 │
│   Audit Log    │                                                                                 │
└────────────────┴─────────────────────────────────────────────────────────────────────────────────┘
```

- Exceptions come first, each with a direct action, filtered to actions the member may take. Money tiles appear only with `finance.view_summary` and always name their date basis. A receptionist sees the exceptions they can act on and Today, with no money section. Mobile stacks the same order; bottom bar per doc 05 §3.3.
- **States:** skeleton per section; "Nothing needs your attention." when clear; per-widget error with retry and Ref; "All venues" aggregates within the member's venue scope.
- **Accessibility:** exception count in the heading; buttons name the item ("Re-check payment for CK-5J9X2C"); no auto-refresh that moves focus.

## 11. Business calendar (courts × time)

**Purpose.** See and act on every court's day at a glance.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Calendar  [<] Today [>]  Sat, Oct 3, 2026   [Day] Week   [List view]          Pasig Pickle Hub v │
│ All times Manila time (UTC+08:00) · live updates · now 5:40 PM                                   │
│ Legend  ■ Confirmed   / Held (checkout)   ▓ Checked in   · Completed   # Block   E Event         │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Court       4 PM        5 PM        6 PM        7 PM        8 PM        9 PM        10 PM        │
│                                 ▼ now                                                            │
│ Court 1 In  · J. Tan ··|▓ M. Ong ▓▓|■ L. Cruz ■|■ Bea S. ■■|/ Held ////|                         │
│ Court 2 In                          ■ R. dela Cruz ■■|                  ■ K. Uy ■■■|             │
│ Court 3 Cov · P. Lee ··|            ■ Rina A. ■|/ Held ////|                                     │
│ Court 4 Cov # Maintenance #########|                        E Saturday Social EEEEE|             │
│                                                                                                  │
│ ┌─ Drawer ───────────────────────────────────────────────────┐                                   │
│ │ Booking CK-9T2B6H                              [Confirmed] │                                   │
│ │ Court 1 · 7:00-8:00 PM · Bea S. (+3 players)               │                                   │
│ │ Paid ₱624.37 (GCash) · add-ons PU-3H8R6W                   │                                   │
│ │ [ Check in ] opens 6:30 PM   [ Reschedule ]   [ Cancel ]   │                                   │
│ └────────────────────────────────────────────────────────────┘                                   │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Status mapping follows doc 17 §3: confirmed green `■`, held amber striped `/`, checked-in blue `▓`, completed slate `·`, block grey hatched `#`, event purple `E`; each block also carries a text label. Week view shows utilization per court per day. Mobile shows one court at a time with a vertical time list.
- **States:** skeleton rows; an empty day still shows the open grid; refresh failure: "Couldn't refresh — showing data from 5:38 PM" with retry, and actions stay disabled until refreshed; live updates via server-sent events or 15-second polling.
- **Accessibility:** List view is the accessible equivalent; each block is a button ("Court 1, 7:00 to 8:00 PM, Confirmed, Bea S."); arrow-key navigation; click-to-create instead of drag.

## 12. Walk-in booking

**Purpose.** Sell a court at the desk in under a minute with verified digital payment.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Walk-in · Pasig Pickle Hub · Sat, Oct 3, 2026                                        Manila time │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1  Court and time                                                                                │
│    Court [ Court 4 (Covered) v ]   Start [ 6:00 PM v ]   Duration [60] (90) (120)                │
│    Court 4 is free from 6:00 PM (starts in 2 min).                                               │
│ 2  Customer                                                                                      │
│    Mobile or email [ +63 917 000 0042          ]   Existing customer (details hidden)            │
│    Name for the check-in list [ Jun P.            ]                                              │
│ ┌────────────────────────────────────────────┐    ┌────────────────────────────────────────────┐ │
│ │ 3  Price (calculated by CourtKo)           │    │ 4  Payment                                 │ │
│ │ Court fee (60 min)                 ₱400.00 │    │ ( ) Send payment link by SMS               │ │
│ │   VAT (12%, included)               ₱42.86 │    │ (•) Show payment QR on this screen         │ │
│ │ Payment fee (Bank)                  ₱15.00 │    │ Digital payment only.                      │ │
│ │ Total                              ₱415.00 │    │ [ Create booking and show QR ]             │ │
│ └────────────────────────────────────────────┘    └────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Waiting for payment · court held for 09:12                                                       │
│ ┌─────────────┐                                                                                  │
│ │ ▓▓▓ ▓ ▓ ▓▓▓ │   Scan with any QR Ph-enabled bank or e-wallet app.                              │
│ │ ▓ ▓  ▓▓ ▓ ▓ │   Link also sent by SMS to +63 917 ••• 0042.                                     │
│ │ ▓▓▓ ▓ ▓ ▓▓▓ │                                                                                  │
│ │   ▓▓ ▓▓  ▓  │   Status: Awaiting payment    [ Re-check status ]                                │
│ │ ▓▓▓ ▓  ▓▓ ▓ │   Staff cannot mark a payment as paid.                                           │
│ │ ▓ ▓ ▓▓ ▓  ▓ │                                                                                  │
│ │ ▓▓▓  ▓ ▓▓▓▓ │                                                                                  │
│ └─────────────┘                                                                                  │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Paid · Booking CK-2F8K5R confirmed                                              [ Check in now ] │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Price always comes from the server. Staff can re-check status (`payments.confirm_status`) but can never mark a payment as paid. The on-screen QR is the default; "Send payment link by SMS" appears only once SMS links are cleared under doc 23 D-22 (telcos may block SMS containing clickable links).
- **States:** `SLOT_UNAVAILABLE`: "Court 4 was just booked online. Next free: Court 2 at 7:30 PM, or Court 3 at 8:00 PM." `BOOKING_NOT_ALLOWED`: "Booking not allowed for this customer. A manager can review." `PROVIDER_UNAVAILABLE`: retry banner. Hold expiry: "Payment not received in time. The court was released." Success → confirmed, then "Check in now".
- **Accessibility:** steps are fieldsets with legends; payment status is a live region; the QR has an alternative (send the link by SMS); the contact field uses `inputmode="tel"` or email.

## 13. Pricing rules and price simulator

**Purpose.** Let owners set rates confidently and see exactly how a booking will be priced, taxed and split before saving.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Pricing · Pasig Pickle Hub   [Rules]  Simulator  Promotions                       [ + New rule ] │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Name              Type      Scope   Days     Time         Dates         P     Rate/hr  Status    │
│ Base rate         Base      Venue   Mon-Sun  6 AM-12 MN   Always        10    ₱300.00  Active    │
│ Weekday peak      Peak      Venue   Mon-Fri  5-10 PM      Always        20    ₱400.00  Active    │
│ Weekend all day   Weekend   Venue   Sat-Sun  6 AM-12 MN   Always        20    ₱400.00  Active    │
│ Holiday rate      Holiday   Venue   Holidays All day      PH holidays   30    ₱450.00  Active    │
│ November off-peak Promo     Venue   Mon-Fri  6 AM-3 PM    Nov 1-30 2026 40    ₱250.00  Scheduled │
│ Tournament prep   Override  Court 1 Sat      6-9 AM       Oct 10, 2026  90    ₱500.00  Scheduled │
│ ! Fri, Dec 25, 2026, 5-10 PM: Weekday peak (P20) and Holiday rate (P30) overlap; P30 applies.    │
│   Rules with the same priority and scope cannot overlap; saving is blocked until resolved.       │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Simulator · Court [Court 1 v] · Date [Fri, Oct 2, 2026] · Start [4:30 PM] · Duration [90 min]    │
│ Slice (Manila time)     Minutes   Rule applied                  Rate/hr        Amount            │
│ 4:30-5:00 PM                 30   Base rate (P10)               ₱300.00       ₱150.00            │
│ 5:00-6:00 PM                 60   Weekday peak (P20)            ₱400.00       ₱400.00            │
│ Booking base (minimum charge ₱300.00 not triggered)                           ₱550.00            │
│   VAT (12%, included)                                                          ₱58.93            │
│ If paid by online banking with the fee passed to the customer (placeholder fee ₱15.00):          │
│   Customer pays ₱565.00 · Commission 5% ₱27.50 · Venue net ₱522.50                               │
│ Changes apply to new quotes only. Confirmed bookings keep their price snapshot.                  │
│ [ Discard ]                                                                        [ Save rule ] │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- The rule editor (drawer) has: name, type, scope (venue or court), days, time range, effective dates, priority, hourly rate, minimum charge, refundable or non-refundable plan. The simulator is also embedded in the editor to preview unsaved changes.
- **States:** Empty: "Add a base rate that covers your opening hours" [Create base rate] (a publish-checklist item). Same-priority overlap blocks save and names the conflicting rule. Success toast: "Rule saved. New quotes use it from now; confirmed bookings keep their price." Every save is audited (`pricing.manage` is high risk).
- **Accessibility:** column headers; the rate input is labeled "Rate per hour, in pesos"; conflict warnings are text naming both rules; simulator output is a table and updates are announced.

## 14. Court block conflict dialog

**Purpose.** Prevent silent harm when blocking a court that has bookings; resolve each conflict explicitly.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Block Court 4 (Covered)?                                                                         │
│ Sun, Oct 4, 2026 · 2:00-10:00 PM · Reason: Repair (roof leak) · Manila time                      │
│ This time has 3 bookings and 1 checkout in progress.                                             │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Time            Player     Paid      Option                    Note                              │
│ 2:00-3:00 PM    Carla M.   ₱415.00   [ Move to Court 3 ]       Court 3 free, same rate           │
│ 4:00-5:00 PM    Paolo R.   ₱415.00   [ Move to Court 3 ]       Court 3 free, same rate           │
│ 7:00-8:00 PM    Anna T.    ₱415.00   [ Cancel, full refund ]   Court 3 busy                      │
│ 8:00-9:00 PM    Checkout in progress (hold ends 1:52 PM)       [ Wait ]  [ Block anyway ]        │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Summary: 2 moves · 1 cancellation with full refund ₱415.00 (incl. payment fee)                   │
│ Players are notified immediately with rebook options.                                            │
│ [ Back ]                                          [ Block free time only ]   [ Apply and block ] │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Court manager view (has courts.block, lacks bookings.cancel):                                    │
│ 7:00-8:00 PM    Anna T.    ₱415.00   [ Cancel ] disabled       Requires bookings.cancel          │
│                                      [ Ask a manager ]         Raises an Overview exception      │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─ Confirmation dialog ──────────────────────────────────────────────┐                           │
│ │ Confirm changes to Court 4?                                        │                           │
│ │ Move 2 bookings to Court 3. Cancel 1 booking and refund ₱415.00.   │                           │
│ │ This cannot be undone.                                             │                           │
│ │ [ Go back ]                                    [ Confirm changes ] │                           │
│ └────────────────────────────────────────────────────────────────────┘                           │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Options depend on permission: move where an equivalent court is free (`bookings.reschedule`), cancel with full refund including the fee (`bookings.cancel`), wait for or release active holds. Applying is a single transaction: all changes succeed or none do.
- **States:** loading conflicts; if conflicts change while open, "Conflicts changed" refreshes the list; failure → nothing changed, error with Ref; success toast "Court 4 blocked. 2 bookings moved, 1 cancelled with full refund."
- **Accessibility:** `role="alertdialog"`; conflicts in a table; action buttons name time and player; disabled actions show the reason as visible text; focus returns to the calendar block.

## 15. Staff and custom role permission editor

**Purpose.** Least-privilege staffing with clear risk labels and no privilege escalation.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Staff · Hub Sports Co.   [Members]  Roles                                       [ Invite staff ] │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Name         Email              Role (venue scope)                  MFA   Last active  Status    │
│ Joel R.      j•••@example.com   Business Owner (all venues)         On    now          Active    │
│ Paolo R.     p•••@example.com   Business Manager (all venues)       On    1 h ago      Active    │
│ Mark V.      m•••@example.com   Receptionist (Pasig Pickle Hub)     Off   5 min ago    Active    │
│ Aileen T.    a•••@example.com   Event Manager (all venues)          On    2 d ago      Active    │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Role editor · "Site Supervisor" (custom) · based on Receptionist · editing as Owner              │
│ Permission                      Meaning                           Risk      Grant                │
│ Bookings                                                                                         │
│   bookings.view                 View bookings and calendar        low       [x]                  │
│   bookings.create_walkin        Create walk-in bookings           medium    [x]                  │
│   bookings.check_in             Check players in                  low       [x]                  │
│   bookings.mark_no_show         Mark no-shows                     medium    [x]                  │
│   bookings.reschedule           Reschedule for a customer         medium    [x]  (added)         │
│   bookings.cancel               Venue cancellation, full refund   high      [ ]                  │
│ Money and people                                                                                 │
│   refunds.request               Request goodwill refunds          high      [x]  (added)         │
│   refunds.approve               Approve refunds (MFA at use)      high      [ ]                  │
│   customers.view_contact        See customer email and phone      high      [ ]                  │
│   finance.manage_payout_account Owner only                        critical  not assignable       │
│ Changes: adds bookings.reschedule (medium), refunds.request (high).                              │
│ Saving high-risk changes asks for MFA and notifies the owner. Applies on members' next request.  │
│ [ Cancel ]                                                                         [ Save role ] │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Assign roles to Mark V. · you are signed in as a Business Manager                                │
│ [x] Receptionist                 Venue scope [ Pasig Pickle Hub v ]                              │
│ [ ] Site Supervisor (custom)     Venue scope [ All venues v ]                                    │
│ [-] Finance Admin (custom)       Unavailable: includes refunds.approve, which you do not hold    │
│                                                                             [ Save assignments ] │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Rules visible in the UI: members cannot grant permissions they do not hold; `finance.manage_payout_account` is Owner-only; the last owner cannot be removed; high-risk changes require MFA and notify the owner; deactivation revokes sessions immediately.
- **States:** no custom roles: "Templates cover most teams. Create a custom role when they don't fit." Save conflict (edited elsewhere) → reload with a diff. Success toast.
- **Accessibility:** the matrix is a table with permission row headers; checkboxes are named "Grant bookings.cancel — venue cancellation"; risk is text; disabled reasons are visible.

## 16. Settlement statement

**Purpose.** A daily statement a venue can reconcile to its payouts and hand to its accountant.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Settlement statement · Hub Sports Co. · Pasig Pickle Hub                                         │
│ Statement date Sat, Oct 3, 2026 (Manila time) · Basis: ledger posting date                       │
│ (captures by payment date, refunds by refund date) · Model: provider split, sub-account ••••7Q2  │
│ Status: Final · Generated Sun, Oct 4, 2026, 3:05 AM · reconciled with provider report            │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Summary (venue view)                                                                             │
│   Booking base (3 bookings)                                        ₱1,350.00                     │
│   Products                                                           ₱260.00                     │
│   Venue-funded discounts                                             −₱50.00                     │
│   Platform commission                                                −₱65.00                     │
│   Refunds, venue share (1)                                          −₱190.00                     │
│   Adjustments                                                          ₱0.00                     │
│   Venue net for the day                                            ₱1,305.00                     │
│   Reference: customer payments ₱1,604.37 incl. customer-paid fees ₱44.37 (not venue revenue)     │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Ref        Type     Play         Base   Prod.   Disc.    Fee      Paid   Comm.      Net    Prov. │
│ CK-2F8K5R  Capture  Oct 3      400.00    0.00    0.00  15.00    415.00   20.00   380.00     …a41 │
│ CK-8N3W5T  Capture  Oct 9      550.00    0.00    0.00  15.00    565.00   27.50   522.50     …b07 │
│ CK-5J9X2C  Capture  Oct 3      400.00  260.00  −50.00  14.37    624.37   17.50   592.50     …c19 │
│ CK-7Q4M2P  Refund   Oct 3     −200.00                                   −10.00  −190.00     …r88 │
│ Totals                       1,150.00  260.00  −50.00  44.37  1,604.37   55.00 1,305.00          │
│ Amounts in PHP. "Fee" = gateway fee paid by the customer. "Comm." = platform commission.         │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Payout: included in PO-20261005-01, scheduled Mon, Oct 5, 2026 (timing depends on the provider). │
│ [ Download CSV ]  [ Download PDF ]                   Exports need reports.export and are audited │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Line CK-2F8K5R is the canonical example (₱400.00 base, ₱15.00 fee, ₱415.00 paid, ₱20.00 commission, ₱380.00 net). Later corrections appear as new adjusting lines on the day they post; statements are never edited.
- **States:** "Provisional" until the provider settlement report reconciles, then "Final"; empty day: "No postings on this date"; error with Ref.
- **Accessibility:** column headers, right-aligned tabular numbers, minus signs with the row type stating "Refund"; CSV available for assistive-technology users; download links name the format and date.

## 17. SuperAdmin overview

**Purpose.** Platform health and exceptions at a glance for platform staff.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ CourtKo Admin · PRODUCTION             Dana U. (superadmin) · MFA verified · idle timeout 15 min │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Alerts (3)                                                                                       │
│ CRITICAL  Payout failures: 4 in the last hour (threshold 3) · 2 businesses       [ Investigate ] │
│ HIGH      Reconciliation 2026-10-03: 3 exceptions, 1 amount mismatch                    [ Open ] │
│ MEDIUM    Double-booking attempts blocked today: 17 (exclusion constraint)              [ View ] │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Queues                                                                                           │
│ ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐   │
│ │ Verifications      │  │ Refund approvals   │  │ Disputes           │  │ Moderation         │   │
│ │ 6 · oldest 1 d 4 h │  │ 2 platform-level   │  │ 1 · evidence Oct 7 │  │ 9 reports          │   │
│ └────────────────────┘  └────────────────────┘  └────────────────────┘  └────────────────────┘   │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ KPIs · date basis: payment date · last 7 days · Manila time                                      │
│ ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐   │
│ │ GBV                │  │ Commission         │  │ Gateway fees       │  │ Venue net          │   │
│ │ ₱1,284,650.00      │  │ ₱58,420.00         │  │ ₱19,730.00         │  │ ₱1,192,300.00      │   │
│ └────────────────────┘  └────────────────────┘  └────────────────────┘  └────────────────────┘   │
│ Payments 3,112 succeeded · 96 failed (3.0%) · Refunds ₱14,200.00 · Chargebacks 1                 │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Health: webhook lag p95 3.2 s · queue depth 12 · holds.expire OK 5:57 PM · reconcile OK 5:55 PM  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Tiles and queues are filtered by the viewer's platform permissions; every KPI names its date basis.
- **States:** "No active alerts"; each widget loads and fails independently; data-freshness time shown.
- **Accessibility:** severity is text; tiles are headings; refresh interval visible with a pause control; nothing moves focus automatically.

## 18. Business verification review

**Purpose.** Decide on a business application consistently, with evidence.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Businesses › Cebu Smash Courts Inc. · pending_verification · waiting 1 d 4 h                     │
│ ┌─ Documents ────────────────────────────┐  ┌─ Checklist ──────────────────────────────────────┐ │
│ │ [SEC cert] [Permit] [BIR reg]          │  │ Registered name matches documents (•) Yes ( ) No │ │
│ │ [Owner ID] [Lease]                     │  │ Registration number format valid  (•) Yes ( ) No │ │
│ │ ┌──────────────────────────────────┐   │  │ TIN format valid                  (•) Yes ( ) No │ │
│ │ │ Viewer · watermark: "CourtKo     │   │  │ Business permit valid for 2026    (•) Yes ( ) No │ │
│ │ │ review · Dana U. · 2026-10-03"   │   │  │ Owner ID matches owner account    ( ) Yes (•) No │ │
│ │ │                                  │   │  │ Right to operate the venue        (•) Yes ( ) No │ │
│ │ └──────────────────────────────────┘   │  │ Duplicate check: no other business with this TIN │ │
│ │ Malware scan: clean                    │  │ Reason for "No" (required):                      │ │
│ │ SHA-256 9f3c…e21 · 2 pages             │  │ [ Name on ID differs from owner account ]        │ │
│ │ Every document view is logged          │  │ [ Reject with reasons ]     [ Approve ] disabled │ │
│ └────────────────────────────────────────┘  └──────────────────────────────────────────────────┘ │
│ Approve is enabled only when every item is "Yes". Rejection reopens only the flagged items.      │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **States:** document still scanning → "Scanning for malware — not viewable yet"; infected → "Blocked: malware detected. The owner has been asked to upload again."; approval → "Approved. Sub-account setup started." with provisioning status; provisioning failure raises an alert.
- **Accessibility:** documents listed with names and page counts; viewer has keyboard zoom and page controls; checklist items are labeled radio groups; a rejection without reasons shows an error summary.

## 19. Commission agreement (maker-checker)

**Purpose.** Change a business's commercial terms safely, with two-person control.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Commissions › Rally Point Ventures Inc. › New agreement (draft)                                  │
│ Current: global default 5.00% (50,000 ppm) since Jan 1, 2026                                     │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Rate                     [ 4.00 ] %   = 40,000 ppm                                               │
│ Effective from           [ Sun, Nov 1, 2026 ]  00:00 Manila time                                 │
│ Commissionable items     [x] Court bookings   [ ] Products   [ ] Events                          │
│ Fee bearer (no pass-through)  (•) Platform   ( ) Venue                                           │
│ Settlement model         provider_split  (platform_payout disabled pending legal review)         │
│ Signed agreement         [ RPV-2026-011.pdf ]  scan: clean                                       │
│ Reason                   [ Multi-venue volume tier per signed agreement            ]             │
│ Impact on a ₱400.00 booking (online-banking fee passed through):                                 │
│   commission ₱20.00 → ₱16.00 · venue net ₱380.00 → ₱384.00                                       │
│ [ Save draft ]                                                           [ Submit for approval ] │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─ Checker view · Dana U. (superadmin) ────────────────────────────────────────────────────────┐ │
│ │ Requested by Nina C. (platform_finance) · Sat, Oct 3, 2026, 10:02 AM                         │ │
│ │ rate_ppm 50,000 → 40,000 · effective Nov 1, 2026 · items and bearer unchanged                │ │
│ │ Bookings confirmed before Nov 1 keep their snapshotted rate.                                 │ │
│ │ [ Reject with reason ]                                                     [ Approve ] (MFA) │ │
│ ├──────────────────────────────────────────────────────────────────────────────────────────────┤ │
│ │ Shown to Nina C.: "You submitted this change. A different authorized admin                   │ │
│ │ must approve it." Approve is disabled.                                                       │ │
│ └──────────────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Agreement statuses shown: draft, pending approval, approved (scheduled), active, superseded, rejected. Approval requires MFA step-up. Overlapping effective dates fail validation, naming the existing agreement.
- **Accessibility:** diff as a two-column table (current, proposed); the disabled Approve button has visible explanatory text; the rate input shows its ppm equivalent live via `aria-describedby`.

## 20. Reconciliation view

**Purpose.** Find and resolve differences between provider records and the ledger.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Transactions › Reconciliation   Run 2026-10-03 · daily · provider report              [ Re-run ] │
│ Provider transactions 1,284 · matched 1,281 (99.77%) · exceptions 3 · fee variance ₱0.12         │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Type                      Internal    Provider  Internal amt Provider amt Age  Status            │
│ Captured, pending inside  CK-5J9X2C   …c19      pending      ₱624.37      2 h  Auto-resolved     │
│ Fee variance              CK-2F8K5R   …a41      fee ₱15.00   fee ₱15.12   6 h  Posted: variance  │
│ Amount mismatch           CK-6P2H9Q   …d55      ₱415.00      ₱400.00      6 h  Open              │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ CK-6P2H9Q · Court 2 · play date Oct 4 · payment date Oct 3                                       │
│ Internal: journal balanced, expected capture ₱415.00 · Provider: captured ₱400.00 PHP            │
│ Related settlement flagged for review (Hub Sports Co., Oct 3).                                   │
│ [ Re-query provider ]   [ Propose adjusting journal (maker-checker) ]   [ Open provider ticket ] │
│ Resolution note (required) [                                                               ]     │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **States:** run in progress (progress and estimated finish); "All 1,284 transactions matched"; provider report missing: "Not yet available; retrying at 6:00 AM"; resolved exceptions keep their history and notes.
- **Accessibility:** table headers; statuses as text; actions name the reference they act on.

## 21. Support-mode banner

**Purpose.** Make support impersonation impossible to miss, and safe.

```text
╔══════════════════════════════════════════════════════════════════════════════════════════════════╗
║ SUPPORT MODE · Viewing as Bea S. (player) · Read-only · SUP-1042 · 28:41 left    [ End session ] ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════╝
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ CourtKo   Home  Discover  Bookings  Events                                       Bell   Bea S. v │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Bookings (as seen by the player)                                                                 │
│ Sat, Oct 3 · Court 1 · 7:00-8:00 PM · CK-9T2B6H                                      [Confirmed] │
│ [ Cancel booking ]  → "Not available in support mode" (SUPPORT_MODE_READ_ONLY)                   │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Mobile:

```text
╔══════════════════════════════════════════╗
║ SUPPORT MODE · Read-only · 28:41 left    ║
║ Viewing as Bea S. · SUP-1042     [ End ] ║
╚══════════════════════════════════════════╝
```

- Rendered above all app chrome on every page of the session; cannot be dismissed or hidden; ink background with lime text (13.47:1). Blocked actions stay visible but disabled with "Not available in support mode"; the server returns `SUPPORT_MODE_READ_ONLY` regardless of the UI. Viewing never changes user state (notifications are not marked read).
- **Accessibility:** `role="region"` named "Support mode", first in tab order; countdown announced at 5 and 1 minutes; End session is 44 px tall; at timeout a dialog explains and the session closes.

## 22. Audit log with hash-chain verification

**Purpose.** Search high-risk actions and prove the log has not been altered.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Audit Logs · Scope [Hub Sports Co.] · Actor [any] · Action [any] · Oct 1-3  [ Verify integrity ] │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Time (Manila)         Actor                   Action                    Target       Corr. ID    │
│ Oct 3, 10:14:22 AM    Joel R.                 pricing_rule.updated      Weekday peak 01J9…4QK    │
│ Oct 3, 8:00:41 AM     Bea S.                  booking.cancelled         CK-7Q4M2P    01J9…7TZ    │
│ Oct 2, 9:12:10 PM     Joel R.                 staff.roles_changed       Mark V.      01J9…9AA    │
│ Oct 2, 6:40:55 PM     system                  login.lockout             m•••@example 01J9…3RD    │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Row detail · pricing_rule.updated · Joel R. · IP 203.0.113.24 · Oct 3, 2026, 02:14:22 UTC        │
│   Changed: rate_per_hour_centavos 38000 → 40000 · updated_by Joel R.                             │
│   chain business:hub-sports · seq 18,442 · prev_hash 5b1e…90c · hash 9f3c…e21                    │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Integrity check (Hub Sports Co. chain, Oct 1-3, 2026):                                           │
│   Chain intact · 1,284 entries · head 9f3c…e21 · matches daily anchor archived Oct 3, 3:00 AM    │
│   If broken: "Break at seq 17,903: entry altered or missing." Alert raised; export disabled.     │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Each chain (`platform` or `business:{id}`) is append-only with a per-chain `seq`: `hash = SHA-256(prev_hash ‖ canonical_json(record))` (doc 14 §10). The daily `audit.archive` job writes each day's records and a signed manifest of chain heads to S3 Object Lock, and a daily verification job recomputes the chains. In the admin view support-session entries show both actor and subject ("Leo G. as Bea S."); the business view (`/biz/audit`, `audit.view`) shows only that business's chain, with support sessions labeled "CourtKo Support, ticket SUP-1042" and platform-internal fields removed.
- **States:** verification in progress; intact result; break detected → security alert, exports disabled for that range, incident process starts; empty filters; exports audited.
- **Accessibility:** table headers; before/after shown as labeled lists rather than colored diff; the drawer shows both Manila time and UTC.
