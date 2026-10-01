# CourtKo demo — presenter guide

`CourtKo-Demo.html` is a single file that works end to end. It needs no install and no internet connection. All data is **synthetic**, and payments run through a **sandbox provider**, so no real money moves. Payment details, fee rates, and legal copy are placeholders until you have a merchant account.

## Before every presentation

1. Open the file in **Chrome or Edge** (double-click it, or drag it into the browser).
2. Click **Demo controls** (bottom right, or press Shift + Alt + D), open **Simulate**, and click **Reset demo data**. Bookings are generated relative to today, so reset if you last used the demo a few days ago.
3. Optional: turn on **Phone frame** under Personas to show the mobile layout on a big screen.
4. Optional: turn on **Fast API** to remove the simulated network delay.

To sign in manually, use any persona email with password `CourtKo!2026`. For MFA accounts, the login page shows the current authenticator code. The persona buttons are faster.

## Personas

| Persona | Who | Show this |
|---|---|---|
| Juan dela Cruz | Player | Discover, book, pay, QR check-in, cancel with refund, events |
| Bea Santiago | Player 2 | Second player for the double-booking race |
| Maria Santos | Business Owner (Dink District) | Calendar, walk-ins, refunds approval, payouts, reports, staff |
| Ramon Cruz | Business Manager | Day-to-day operations. Can request but not approve his own refunds |
| Paolo Reyes | Receptionist (BGC only) | Check-in and walk-ins only. Money pages are hidden |
| Rafael Lim | New business owner (Iloilo) | Onboarding, waiting for platform approval |
| Andrea Villanueva | SuperAdmin | Businesses, verification, commissions, support mode, audit |
| Carla Mendoza | Finance Ops | Second approver for commission changes, reconciliation, payouts |

**Side by side:** in Demo controls → Personas, click the ↗ icon next to a persona to open them in a new tab. Each tab has its own session, and changes sync live between tabs.

## Suggested 15-minute walkthrough

1. **Player books a court (4 min).** Sign in as Juan. Go to Discover → Dink District BGC → pick a time later today (so check-in works in step 2). The checkout shows the 10-minute hold, add-ons, the promo code `DINK50` (₱50 off, venue-funded), and the fee for each payment method. Pay with GCash on the sandbox page. Show the confirmation, the QR code, and the receipt. Point out that the booking is confirmed only after the provider's webhook arrives, not when the browser returns from the payment page.
2. **Venue sees it instantly (2 min).** In a second tab as Maria, open Calendar. The new booking is already there. Click **Check in** and enter Juan's booking code (in production, staff scan the QR). Check-in opens 30 minutes before the start, so use **+1 hr** time travel in Demo controls if needed.
3. **No double booking (1 min).** Demo controls → Simulate → **Two players grab the same slot**. One player wins and the other gets "slot unavailable". The rule is enforced in the data layer, not in the UI.
4. **Cancellation and refund (2 min).** As Juan, cancel a future booking. The quote shows the policy tier and the exact refund. The refund follows the payment's original price snapshot.
5. **Money is always explainable (3 min).** As Andrea or Carla, open Transactions: payments, double-entry ledger journals, and reconciliation (balanced). Open Commissions and propose a new rate. The same person cannot approve their own change. Switch to Carla and approve it.
6. **Security and trust (2 min).** Simulate → **Send a forged webhook**: it is rejected and logged in Security. Open Audit → **Verify chain**. As Paolo, show that pages he has no permission for are hidden and blocked.
7. **Resilience (1 min).** Set webhook delivery to **Drop payment webhooks**, make a payment, and watch reconciliation heal it by re-querying the provider.

## Sandbox payment test values

| Method | How to succeed or fail |
|---|---|
| Card | `4242 4242 4242 4242` succeeds · `4000 0000 0000 0002` is declined · `4000 0000 0000 3220` requires 3-D Secure · `4000 0566 5566 5556` is an international card (higher fee) |
| GCash / Maya / GrabPay | Approve or decline on the sandbox wallet page |
| QR Ph | "Simulate: scanned & paid". No customer fee (not permitted) |
| Online banking | Pick a bank and approve |

## Good to know

- Changes are saved in this browser only (localStorage). Other people who open the file start from fresh synthetic data.
- To share a link instead of a file, upload `CourtKo-Demo.html` to any static host (e.g. Netlify Drop). No server is needed.
- Time travel (+1 hr / +1 day) moves the demo clock so reminders, completions, no-shows, and payouts happen on cue. **Real time** returns to now.
- The in-app preview inside Claude doesn't allow browser storage, so changes there won't survive a reload. Use Chrome or Edge.
