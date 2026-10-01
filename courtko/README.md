# CourtKo: pickleball court booking for the Philippines

This folder contains two things:

1. **`CourtKo-Demo.html`**: an interactive demo you can show to clients. It works end to end in one file: the public site, the player app, checkout with a sandbox payment provider, the business portal, staff roles, and the SuperAdmin console. See **[docs/demo-guide.md](docs/demo-guide.md)** for the presenter walkthrough.
2. **`docs/design/`**: the 23-part production blueprint, covering architecture, database schema, API, security, privacy, testing, deployment, and open decisions. Start at [docs/design/README.md](docs/design/README.md).

All data is **synthetic**. Payment methods, fee rates, merchant details, and legal copy are **placeholders**. Nothing connects to a real payment provider.

## Open the demo

Double-click `CourtKo-Demo.html` and open it in Chrome or Edge. No install or internet connection is needed. To share a link, drag the file onto a static host such as Netlify Drop.

## Rebuild or test the demo (optional)

Requires Node.js 22.13 or newer. There are no dependencies to install.

```bash
cd demo
node scripts/build.mjs      # rebuilds dist/index.html and ../CourtKo-Demo.html
npm test                    # domain, flow and UI smoke tests (Node's built-in test runner)
```

`demo/src` is organised in three layers:

- `domain/`: pure money, pricing, policy, ledger, state-machine, and crypto logic
- `services/`: the in-browser "backend", including authorization, the transactional store, the sandbox provider, and background jobs
- `ui/`: views for every portal

## What is real and what is simulated

| Real in the demo (same rules as production) | Simulated in the demo |
|---|---|
| Integer-centavo money, commission, fee gross-up, VAT, refunds from the original price snapshot | The payment provider (a Xendit-style sandbox with webhooks, split payments, refunds, payouts) |
| Double-booking prevention, holds and expiry, idempotency keys | The database (an in-browser store that enforces the same constraints) |
| Permission checks on every call, tenant isolation, MFA (TOTP), password hashing (PBKDF2) | Email, SMS, and push (shown in an in-app outbox) |
| Double-entry ledger, reconciliation, hash-chained audit log | Maps, geolocation, and file scanning |

## Moving to production

The production build follows [docs/design/19-implementation-phases.md](docs/design/19-implementation-phases.md): a TypeScript monorepo with Next.js, Fastify, PostgreSQL + PostGIS on AWS Singapore, and Xendit xenPlatform. Before building:

- Get a Xendit (or PayMongo) merchant account and confirm fee rates, settlement, and refund support for each method.
- Resolve the legal and tax items in [doc 23](docs/design/23-assumptions-and-decisions.md) with PH counsel and a tax adviser. These include customer fees per payment method, whether operator registration is needed, BIR withholding (RR 16-2023), e-invoicing, and data privacy (NPC).
- Move the repository out of OneDrive before running `pnpm install`, because sync and `node_modules` don't mix well.
