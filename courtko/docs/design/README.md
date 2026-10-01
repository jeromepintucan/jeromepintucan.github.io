# CourtKo design package

These are the 23 design documents for the production build. They cover product, architecture, security, operations, and open decisions. All people, venues, amounts, and provider fee rates in them are **synthetic or placeholders**.

| # | Document | What it answers |
|---|---|---|
| 01 | [Product requirements](01-product-requirements.md) | Scope, goals, money examples (₱400 + ₱15 fee → commission ₱20, venue net ₱380) |
| 02 | [User personas](02-user-personas.md) | Who uses it and what they need |
| 03 | [Role & permission matrix](03-role-permission-matrix.md) | Permission codes, role templates, MFA-required actions |
| 04 | [Key user journeys](04-key-user-journeys.md) | Step-by-step flows, including failure paths |
| 05 | [Information architecture](05-information-architecture.md) | Navigation per portal |
| 06 | [Sitemap](06-sitemap.md) | Every route |
| 07 | [Booking state machine](07-booking-state-machine.md) | Holds, extensions, confirmation, cancellation, no-shows |
| 08 | [Payment state machine](08-payment-state-machine.md) | Sessions, webhooks, re-query, late captures |
| 09 | [Refund & payout flow](09-refund-and-payout-flow.md) | Ledger journals, approvals, payouts, chargebacks |
| 10 | [Multi-tenant architecture](10-multi-tenant-architecture.md) | Tenant isolation, row-level security (RLS), support mode |
| 11 | [System architecture](11-system-architecture.md) | Services, packages, outbox, jobs |
| 12 | [Database ERD](12-database-erd.md) + [schema.sql](schema.sql) | Tables, constraints, the exclusion constraint that prevents double booking |
| 13 | [API design](13-api-design.md) | Conventions, endpoint catalog, worked JSON examples, OpenAPI |
| 14 | [Security threat model](14-security-threat-model.md) | STRIDE threats and controls |
| 15 | [Privacy & data retention](15-privacy-data-retention-matrix.md) | Data Privacy Act (RA 10173), retention periods, deletion |
| 16 | [Wireframes](16-wireframes.md) | Critical screens (mobile and desktop) |
| 17 | [Design system](17-design-system.md) | Tokens, components, accessibility |
| 18 | [MVP scope](18-mvp-scope.md) | In and out of the MVP |
| 19 | [Implementation phases](19-implementation-phases.md) | The 20-step production build plan |
| 20 | [Testing strategy](20-testing-strategy.md) | Unit, integration, concurrency, E2E, security |
| 21 | [Deployment architecture](21-deployment-architecture.md) | AWS Singapore (ap-southeast-1) |
| 22 | [Operational monitoring](22-operational-monitoring.md) | SLOs, alerts, runbooks |
| 23 | [Assumptions & decisions](23-assumptions-and-decisions.md) | Open items for legal, finance, and the product owner |

The interactive demo (`../../CourtKo-Demo.html`, source in `../../demo`) implements the booking, payment, refund, ledger, permission, and audit rules described here. It does this in the browser, using a sandbox payment provider in place of Xendit.
