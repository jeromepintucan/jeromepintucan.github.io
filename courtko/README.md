# CourtKo: court booking and Open Play for the Philippines

CourtKo is a multi-tenant marketplace for **pickleball, basketball, volleyball and tennis** venues. This folder contains two things:

1. **`CourtKo-Demo.html`**: an interactive demo you can show to clients. It works end to end in one file and covers:
   - the public site and player app, with a sport picker, full and half courts, Open Play, social profiles and a My Sports dashboard;
   - checkout with a sandbox payment provider;
   - the business portal: courts & layouts, a calendar, the Open Play live desk, and staff roles;
   - the SuperAdmin console, including the sports catalog.

   See **[docs/demo-guide.md](docs/demo-guide.md)** for the presenter walkthrough.
2. **`docs/design/`**: the production blueprint, covering architecture, database schema, API, security, privacy, testing, deployment and open decisions. Doc 24 covers the multi-sport, Open Play and social change request. Start at [docs/design/README.md](docs/design/README.md).

All data is **synthetic**. Payment methods, fee rates, merchant details and legal copy are **placeholders**. Nothing connects to a real payment provider.

## Open the demo

Open `CourtKo-Demo.html` in Chrome or Edge, either from disk or from GitHub Pages. No install or internet connection is needed.

## Rebuild or test the demo (optional)

Requires Node.js 22.13 or newer. There are no dependencies to install.

```bash
cd demo
node scripts/build.mjs      # rebuilds dist/index.html and ../CourtKo-Demo.html
npm test                    # 75 tests: domain, flows, multi-sport/Open Play/social, UI smoke tests
```

`demo/src` is organised in three layers:

- `domain/`: pure money, pricing, policy, ledger, state machines, the sports catalog, check-in tokens and crypto
- `services/`: the in-browser "backend", including authorization, the transactional store, the sandbox provider, Open Play, social and background jobs
- `ui/`: views for every portal

## What is real and what is simulated

| Real in the demo (same rules as production) | Simulated in the demo |
|---|---|
| Integer-centavo money, commission, fee gross-up, VAT, refunds from the original price snapshot | The payment provider (a Xendit-style sandbox with webhooks, split payments, refunds and payouts) |
| Double-booking prevention per **space unit**: a full court blocks its halves, and a shared floor hosts one sport at a time with a changeover gap | The database (an in-browser store that enforces the same constraints) |
| Signed, time-limited Open Play check-in passes; an append-only attendance log; rejected scans recorded | Camera QR scanning (staff paste a pass, or load a demo sample pass) |
| Permission checks on every call, tenant isolation, MFA (TOTP), password hashing (PBKDF2) | Email, SMS and push (shown in an in-app outbox) |
| Double-entry ledger, reconciliation, hash-chained audit log | Maps, geolocation and file scanning |
| Privacy-safe public profiles, blocks enforced in both directions, data export including the social graph | Live push updates (cross-tab sync stands in for Server-Sent Events) |

## Moving to production

The production build follows [docs/design/19-implementation-phases.md](docs/design/19-implementation-phases.md), plus the CR-01 steps in [doc 24 §10](docs/design/24-change-impact-multisport.md). The stack is a TypeScript monorepo with Next.js, Fastify, PostgreSQL + PostGIS on AWS Singapore, and Xendit xenPlatform. Before building:

- Get a Xendit (or PayMongo) merchant account and confirm fee rates, settlement, and refund support for each method.
- Resolve the legal and tax items in [doc 23](docs/design/23-assumptions-and-decisions.md) with PH counsel and a tax adviser, plus the CR-01 open questions in [doc 24 §12](docs/design/24-change-impact-multisport.md) (for example, the minimum age for social features).
- Keep the production repository outside synced folders (OneDrive/Dropbox) before running `pnpm install`.
