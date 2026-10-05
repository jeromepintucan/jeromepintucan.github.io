# CourtKo demo — presenter guide

`CourtKo-Demo.html` is a single file that works end to end. It needs no install and no internet connection. It covers four sports (pickleball, basketball, volleyball and tennis), multi-sport courts, Open Play with a live attendance desk, social player profiles and a My Sports dashboard. All data is **synthetic**, and payments run through a **sandbox provider**, so no real money moves. Payment details, fee rates and legal copy are placeholders until you have a merchant account.

## Before every presentation

1. Open the file in **Chrome or Edge**, either directly or from your GitHub Pages link.
2. Click **Demo controls** (bottom right, or press Shift + Alt + D), open **Simulate**, and click **Reset demo data**. Bookings and Open Play sessions are generated relative to today, so reset if you last used the demo a few days ago.
3. If you are presenting between 6:00 AM and 8:30 PM Manila time, a pickleball Open Play session is already **live** at Dink District BGC. At any other time, use **Simulate → Start a live Open Play now**.
4. Optional: turn on **Phone frame** under Personas to show the mobile layout on a big screen, and **Fast API** to remove the simulated network delay.

To sign in manually, use any persona email with the password `CourtKo!2026`. For MFA accounts, the login page shows the current authenticator code. The persona buttons are faster.

## Personas

| Persona | Who | Show this |
|---|---|---|
| Juan dela Cruz (@juan.delacruz) | Player: pickleball, basketball, tennis | Sport picker, booking, My Sports dashboard, Open Play pass, team captain, followers |
| Bea Santiago (@bea.santiago) | Player 2: pickleball, tennis | Has Juan's **pending tennis-partner invite**; second player for the race scenarios |
| Maria Santos | Owner, Dink District (pickleball courts + a basketball/volleyball hall) | Courts & layouts, calendar with half courts, Open Play setup, refunds, payouts |
| Ramon Cruz | Business Manager | Attendance corrections and reversals (MFA), day-to-day operations |
| Paolo Reyes | Receptionist (BGC only) | **Open Play desk**: check-in, rotation, games. Cannot correct attendance or see money pages |
| Rafael Lim | New business owner (Iloilo) | Onboarding, waiting for platform approval |
| Andrea Villanueva | SuperAdmin | **Sports catalog**, Open Play overview, moderation of reported profiles, commissions, audit |
| Carla Mendoza | Finance Ops | Second approver for commission changes, reconciliation, payouts |

**Side by side:** in Demo controls → Personas, click the ↗ icon next to a persona to open them in a new tab. Each tab has its own session, and changes sync live between tabs. For example, Juan's phone on the left and Paolo's desk on the right.

## Suggested 20-minute walkthrough

1. **Pick a sport (2 min).** On the home page, tap a sport (Pickleball, Basketball, Volleyball, Tennis). Venues, Open Play and events filter to that sport. On Find a court, show the filters for full or half court, surface and "Has Open Play".
2. **Full court or half court (3 min).** Sign in as Juan and open Hoopsville Cubao. Choose Basketball, then switch between Full court and Half court. Pick a time and pay with GCash on the sandbox page. Then run **Simulate → Full court vs half court race**: only one booking can win, because both layouts share the same floor. On Baseline Racquet Club, show that Court 1 can be booked as one tennis court **or** two pickleball courts.
3. **Courts & layouts (2 min).** As Maria, open **Courts & layouts**. The Hall is split into spaces A and B. The table shows what each layout blocks when booked, plus the changeover time between basketball and volleyball. Open **Calendar**: half-court bookings fill half a column.
4. **Open Play: join (3 min).** As Juan, open **Open Play**, pick a session and register. The pass page shows a **rotating QR** (it refreshes every 10 minutes and contains no personal data) and a privacy-safe live summary: counts plus your own place in the queue. On the Saturday basketball run, show **Weekend Warriors**, Juan's team with open spots. As Bea, open **Invites** and accept or decline Juan's tennis-partner invite. If she declines, Juan stays registered and is marked as needing a partner.
5. **Open Play: run the desk (4 min).** As Paolo, open **Open Play → Drop-in Open Play** (or the pop-up session).
   - Fifteen live counters show registered, checked in, waiting, on court, no-shows, rejected scans and more.
   - Load a sample pass (**valid**, **duplicate**, **expired**, **wrong session**, **tampered**) and press **Check in**. Only the valid one works, and every rejection is logged.
   - Click **Next game** on a court. The rotation suggests players and staff confirm them. Players count as "on court" only after that.
   - End a game with a score. Players go back to the queue.
   - Open **Attendance log**: it is append-only. As Ramon, reverse a check-in; this needs a reason and adds a new entry rather than editing the old one.
6. **Social profiles & My Sports (3 min).** As Juan, open **Profile**. The My Sports dashboard shows sessions, hours, games, W–L, favourite venues and upcoming games for each sport, and Juan can set a self-declared level for each. Open **Players** to search by name or @username and follow someone. Bea's profile shows only what she allows. Show **Block** (it hides both profiles from each other and doesn't affect bookings) and **Report**.
7. **SuperAdmin (2 min).** As Andrea, open **Sports catalog**. Every sport's formats, player counts, skill levels and Open Play defaults come from here; nothing is hard-coded. Changes are versioned and audited.
8. **Money & security (1 min).** Transactions are reconciled and balanced. Simulate → **Send a forged webhook** gets rejected. Audit → **Verify chain**.

## Sandbox payment test values

| Method | How to succeed or fail |
|---|---|
| Card | `4242 4242 4242 4242` succeeds · `4000 0000 0000 0002` is declined · `4000 0000 0000 3220` requires 3-D Secure · `4000 0566 5566 5556` is an international card (higher fee) |
| GCash / Maya / GrabPay | Approve or decline on the sandbox wallet page |
| QR Ph | "Simulate: scanned & paid". No customer fee (not permitted) |
| Online banking | Pick a bank and approve |

## Good to know

- Changes are saved in this browser only (localStorage). Other people who open the file start from fresh synthetic data.
- The demo is a static file, so it works on GitHub Pages or any static host with no server.
- Time travel (+1 hr / +1 day) moves the demo clock so reminders, completions, no-shows (at the Open Play late-arrival cutoff) and payouts happen on cue. **Real time** returns to now.
- "Sample pass" buttons on the desk and "Start a live Open Play now" are **demo helpers**. In production, staff scan the player's phone with a camera, and sessions are created by the venue.
- The in-app preview inside Claude doesn't allow browser storage, so changes there won't survive a reload. Use Chrome or Edge.
