# CourtKo demo — presenter guide

`CourtKo-Demo.html` is a single file that works end to end. It needs no install and no internet connection. It covers four sports (pickleball, basketball, volleyball and tennis), multi-sport courts, Open Play with live status and a live attendance desk, social player profiles, a My Sports dashboard and payment-gateway exception handling. All data is **synthetic**, and payments run through a **sandbox provider**, so no real money moves. Payment details, fee rates and legal copy are placeholders until you have a merchant account.

## Before every presentation

1. Open the file in **Chrome or Edge**, either directly or from your GitHub Pages link.
2. Click **Demo controls** (bottom right, or press Shift + Alt + D), open **Simulate**, and click **Reset demo data**. Bookings and Open Play sessions are generated relative to the moment you reset, so reset just before you present.
3. Between 6:00 AM and 8:30 PM Manila time:
   - a pickleball Open Play is already **live** at Dink District BGC (Courts 5–6);
   - Juan is registered for **After-Work Open Play** starting in about an hour (Courts 1–2), with check-in already open and a few early arrivals.

   At other times, use **Simulate → Start a live Open Play now**, or time-travel forward to the session.
4. Optional: turn on **Phone frame** under Personas to show the mobile layout on a big screen, and **Fast API** to remove the simulated network delay.

To sign in manually, use any persona email with the password `CourtKo!2026`. For MFA accounts, the login page shows the current authenticator code. The persona buttons are faster.

## The venues (realistic mix)

| Venue | Sports | What it shows |
|---|---|---|
| Dink District BGC & Alabang | Pickleball only | A typical pickleball club: six courts, Open Play nights |
| Hoopsville Cubao | Basketball + volleyball | Gym 1 books as a full court or two half courts. Gym 2 is a shared floor for basketball or volleyball, with a changeover gap |
| Riverside Hoops Marikina | Basketball | One covered court that books whole or by half |
| Baseline Racquet Club | Tennis + pickleball | Court 1 and 2 convert from one tennis court to two pickleball courts. Court 3 is clay, tennis only |
| Spikehouse Mandaue | Volleyball | Team Open Play with per-team pricing |

Most venues offer one sport. Multi-sport venues are the exception, as in real life.

## Personas

| Persona | Who | Show this |
|---|---|---|
| Juan dela Cruz (@juan.delacruz) | Player: pickleball, basketball, tennis | Sport picker, booking, **live status for his Open Play later today**, My Sports dashboard, team captain, followers |
| Bea Santiago (@bea.santiago) | Player 2: pickleball, tennis | **#1 in the waiting rotation** in the live session; has Juan's pending tennis-partner invite |
| Maria Santos | Owner, Dink District (pickleball, BGC & Alabang) | Open Play setup and publishing, **Payment issues**, refunds, payouts |
| Gabriel Tan | Owner, Hoopsville Cubao (multi-sport) | **Courts & layouts**, half courts, shared floor, basketball/volleyball Open Play |
| Ramon Cruz | Business Manager, Dink District | Attendance corrections and reversals (MFA), cancelling bookings |
| Paolo Reyes | Receptionist (BGC only) | **Open Play desk**: check-in, rotation, games. Cannot correct attendance or see money pages |
| Rafael Lim | New business owner (Iloilo) | Onboarding, waiting for platform approval |
| Andrea Villanueva | SuperAdmin | **Payment exceptions**, sports catalog, Open Play overview, moderation, audit |
| Carla Mendoza | Finance Ops | Second approver for commission changes, reconciliation, payouts |

**Side by side:** in Demo controls → Personas, click the ↗ icon next to a persona to open them in a new tab. Each tab has its own session, and changes sync live between tabs. For example, Juan's phone on the left and Paolo's desk on the right.

## Suggested 25-minute walkthrough

1. **Pick a sport (2 min).** On the home page, tap a sport. Venues, Open Play and events filter to that sport. On Find a court, show the filters for full or half court, surface and "Has Open Play".
2. **Full court or half court (3 min).** As Juan, open Hoopsville Cubao, choose Basketball, then switch between Full court and Half court. Pick a time and pay with GCash on the sandbox page. Then run **Simulate → Full court vs half court race**: only one booking can win, because both layouts share the same floor. On Baseline Racquet Club, show that Court 1 books as one tennis court **or** two pickleball courts.
3. **Courts & layouts (2 min).** As Gabriel, open **Courts & layouts**. Each gym is split into spaces, and the table shows what each layout blocks when booked, plus the basketball ↔ volleyball changeover. Open **Calendar**: half-court bookings fill half a column.
4. **Open Play: live status (3 min).** As Juan, the home page shows **After-Work Open Play**: "starts in …, *n* already checked in". Open it. The live status shows:
   - how many of the registered players are already here, and how many arrived in the last 15 minutes;
   - waiting, playing and not-here-yet counts, and whether each court is in use;
   - Juan's own status, and once he is checked in, his place in line and an estimated wait.

   It refreshes on its own. Open the presenter panel and click **Simulate → Simulate Open Play arrivals** while Juan's pass is on screen: the counts go up within seconds. Counts only — other players' names are never shown. Then sign in as Bea in another tab: she is **#1 in line** in the live session.
5. **Open Play: run the desk (4 min).** As Paolo, open **Open Play → Drop-in Open Play**.
   - Fifteen live counters show registered, checked in, waiting, on court, no-shows, rejected scans and more.
   - Load a sample pass (**valid**, **duplicate**, **expired**, **wrong session**, **tampered**) and press **Check in**. Only the valid one works, and every rejection is logged.
   - Click **Next game** on a court. The rotation suggests players and staff confirm them. Players count as "on court" only after that.
   - End a game with a score. Players go back to the queue.
   - Open **Attendance log**: it is append-only. As Ramon, reverse a check-in; this needs a reason and adds a new entry rather than editing the old one.
6. **Publishing with real calendars (2 min).** As Maria, create an Open Play session (or duplicate one) on courts that already have bookings and click **Publish**. Instead of a generic error, CourtKo lists exactly what is in the way (booking codes, blocks, events, changeover gaps) and offers:
   - **Use Court X & Y and publish** — free courts for the whole session, so nobody is affected;
   - **Cancel the bookings (full refund) and publish** — needs the "Cancel bookings" permission;
   - **Change time or courts**.

   Saved drafts mark each court chip "free" or "in use".
7. **Payments when things go wrong (4 min).** This is what venue owners worry about most.
   - **Declines:** as Juan, book a court and on the sandbox page pick a failure, for example **Wallet limit reached** or the **Insufficient funds** test card. The checkout explains what happened, that no money was taken, and what to do next. The hold is kept. After 5 failed attempts, payments for that checkout are paused (card-testing guard).
   - **Provider faults** (Simulate → Provider API faults):
     - *Next call fails once* is retried automatically.
     - *Next call times out* returns the **same** session on retry, so there is no double charge.
     - *All calls fail* shows "not charged, hold kept".
     - *Payment channel down* (e.g. GCash) greys out that method with a banner, and the others still work.
   - **Wrong amount:** turn on *Provider reports a wrong amount on the next payment*, then pay. The booking is **not** confirmed; it appears under SuperAdmin → **Payment exceptions** for a full refund.
   - **Payment issues** (Maria → Payments): a refund the channel can't process through the API (QR Ph). Record the bank-transfer reference to complete it. The page also shows the payment success rate, why payments failed this week, channel status, and items that were handled automatically (late payments, duplicates, retries).
8. **Social profiles & My Sports (2 min).** As Juan, open **Profile**. The My Sports dashboard shows sessions, hours, games, W–L, favourite venues and upcoming games for each sport. Open **Players** to search and follow. Show **Block** (hides both profiles from each other; bookings unaffected) and **Report**.
9. **SuperAdmin (2 min).** As Andrea, open **Sports catalog** (nothing is hard-coded) and **Payment exceptions**. Run Simulate → **Send a forged webhook** (rejected) and Audit → **Verify chain**.

## Sandbox payment test values

| Method | How to succeed or fail |
|---|---|
| Card | Tap a test card on the payment page. `4242 4242 4242 4242` succeeds. `…3220` asks for 3-D Secure (cancel to fail verification). `…5556` is an international card (higher fee). `…0002` is declined by the bank. `…9995` has insufficient funds. `…0069` is expired. `…0127` has an incorrect CVC. `4100 0000 0000 0019` is an issuer risk decline. `…0119` is a processor error |
| GCash / Maya / GrabPay | Authorize, or simulate: not enough balance, declined in the app, wallet limit reached, OTP timed out, or no response from the app |
| QR Ph | "Simulate: scanned & paid", or a bank-app error. No customer fee (not permitted) |
| Online banking | Approve, or simulate a bank-side failure |

## Good to know

- Changes are saved in this browser only (localStorage). Other people who open the file start from fresh synthetic data.
- The demo is a static file, so it works on GitHub Pages or any static host with no server.
- Time travel (+1 hr / +1 day) moves the demo clock so reminders, completions, no-shows (at the Open Play late-arrival cutoff) and payouts happen on cue. **Real time** returns to now.
- "Sample pass", "Simulate arrivals", "Start a live Open Play now" and the provider fault switches are **demo helpers**. In production, staff scan the player's phone with a camera, sessions are created by the venue, and faults come from the real provider.
- The in-app preview inside Claude doesn't allow browser storage, so changes there won't survive a reload. Use Chrome or Edge.
