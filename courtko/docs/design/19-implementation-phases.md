# 19 — Implementation Phases and Production Build Plan

| Field | Value |
|---|---|
| Document | 19 of 23 — Implementation phases |
| Status | Draft v1.0 |
| Owner | Product (Senior PM) with the tech lead |
| Last updated | 2026-09-30 |
| Related | [01 Product requirements](01-product-requirements.md) · [18 MVP scope](18-mvp-scope.md) · [10 Multi-tenant architecture](10-multi-tenant-architecture.md) · 11 System architecture · [12 Database ERD](12-database-erd.md) · [13 API design](13-api-design.md) · [14 Threat model](14-security-threat-model.md) · [20 Testing strategy](20-testing-strategy.md) · [21 Deployment architecture](21-deployment-architecture.md) · [22 Monitoring plan](22-operational-monitoring.md) · [23 Assumptions & decisions](23-assumptions-and-decisions.md) |

Part A is the phase plan. Part B is the 20-step production build in the required order. Effort is relative (S < M < L < XL) with no calendar commitments. Every provider credential, fee rate, sub-account ID and bank detail is a **PLACEHOLDER** until the product owner has the contracts; the build keeps them behind ports and configuration so they can be filled in later.

> **Repository location.** Clone the production repository **outside any OneDrive-synced folder** (for example `C:\dev\courtko`, or `~/code/courtko` inside WSL2) **before running `pnpm install`**. OneDrive tries to sync the tens of thousands of files and links under `node_modules` and pnpm's store, which causes file-lock errors (`EPERM`, `EBUSY`), very slow installs and builds, and sync conflicts. The Git remote is the source of truth; design documents may stay in OneDrive. On Windows also run `git config --global core.longpaths true` and keep LF line endings (`.gitattributes`).

---

# Part A — Phase plan

## A.1 Phases

| Phase | Goal | Scope | Exit criteria | Relative effort |
|---|---|---|---|---|
| **Phase 0 — Interactive demo (done)** | Validate flows and economics with venue owners and partners | Zero-install `CourtKo-Demo.html` (source in `demo/`) running real pricing, availability, commission, ledger, refund and state-machine logic in the browser with synthetic data and a mock provider standing in for Xendit | Delivered; used for presentations. Not production: no real money, no real personal data | Done |
| **MVP** | First production release: real venues, players and money in Metro Manila | Doc 18 §2 "MVP" rows; build steps 1–20 below; closed pilot then public launch | Doc 18 launch-readiness checklist complete; pilot exit criteria met | XL overall |
| **Phase 2** | Deepen engagement, money options and competition | Saved methods, split payments, deposits, platform credit (if allowed), second provider, e-invoicing integration; installable PWA (offline QR, push) and native apps; social, invites, recurring bookings, memberships, loyalty, advanced promotions, recommendations; advanced tournaments (brackets, results, partner/team), venue-verified and external ratings via official APIs; equipment rental, coaching marketplace, business integrations, custom reports; Facebook/Apple sign-in, passkeys, fil-PH, write-enabled support mode with approvals | Each item ships behind a flag with its own acceptance criteria | XL |
| **Phase 3** | Scale beyond one market and deepen intelligence | Multi-country and multi-currency, franchise management, dynamic pricing recommendations, advanced fraud detection, enterprise accounts, labeled sponsorship/ads, advanced league and bracket management, platform recreational rating, automated KYB | Per initiative | XL |

## A.2 MVP build milestones

Build milestones are labeled BM1–BM6 so they do not clash with the programme milestones in doc 23: **M0** design sign-off (before BM1) · **M1** provider onboarding — Xendit account, KYB, sandbox keys (needed before BM3) · **M2** pilot readiness (end of BM6, first venues with real money) · **M3** production launch (general availability).

| Milestone | Build steps | Outcome | Relative effort | Exit criteria |
|---|---|---|---|---|
| BM1 Foundations | 1–3 | Monorepo, CI, design system, authentication with MFA, tenancy with RLS and RBAC | L | Auth and tenant-isolation suites green; UI kit axe-clean |
| BM2 Supply | 4–6 | Onboarding and verification, venues and courts, availability and pricing engine | L | A synthetic venue can be verified, configured, priced and published; pricing golden tests pass |
| BM3 Transaction core | 7–9 | Booking workflow, Xendit sandbox integration, ledger, commission, settlement, reconciliation | XL | Sandbox booking → capture → ledger → statement end to end; every money scenario in doc 18 §3.2 passes |
| BM4 Operations and engagement | 10–13 | Business portal, player dashboard, events, products | XL | Journeys J3–J10 (doc 04) pass end to end |
| BM5 Platform control | 14–16 | SuperAdmin control center, notifications, reporting | L | J11–J13 pass; reports reconcile to the ledger |
| BM6 Hardening and launch | 17–20 | Audit and security controls, full automated test suites, production deployment, documentation | L | Doc 18 §5 checklist complete (= doc 23 M2) |
| Pilot | — | Starts with 3–5 Metro Manila venues and grows toward the doc 23 A-07 planning figure (20 venues), with real money and a limited player base | M | Four consecutive weeks (target) with zero double bookings, clean daily reconciliation, no severity-1 incidents |
| General availability (doc 23 M3) | — | Public launch in Metro Manila | — | Pilot exit plus support and marketing readiness |

| Build step | Effort | Build step | Effort |
|---|---|---|---|
| 1 Project structure and design system | M | 11 Player dashboard | M |
| 2 Authentication | L | 12 Events | L |
| 3 Tenant and authorization | L | 13 Products | M |
| 4 Business onboarding | M | 14 SuperAdmin portal | L |
| 5 Venue and court setup | M | 15 Notifications | M |
| 6 Availability and pricing engine | L | 16 Reporting | M |
| 7 Booking workflow | XL | 17 Audit and security controls | L |
| 8 Payment integration | XL | 18 Automated tests | L |
| 9 Commission and ledger | XL | 19 Deployment configuration | L |
| 10 Business operations portal | L | 20 Documentation | S |

```mermaid
flowchart LR
    S1["1 Structure and design system"] --> S2["2 Authentication"] --> S3["3 Tenancy and authorization"]
    S3 --> S4["4 Onboarding"] --> S5["5 Venues and courts"] --> S6["6 Availability and pricing"]
    S6 --> S7["7 Booking"] --> S8["8 Payments"] --> S9["9 Ledger and commission"]
    S10["10 Business ops"]
    S11["11 Player dashboard"]
    S12["12 Events"]
    S13["13 Products"]
    S9 --> S10
    S9 --> S11
    S9 --> S12
    S9 --> S13
    S14["14 SuperAdmin"]
    S10 --> S14
    S11 --> S14
    S12 --> S14
    S13 --> S14
    S14 --> S15["15 Notifications"] --> S16["16 Reporting"]
    S16 --> S17["17 Audit and security"] --> S18["18 Automated tests"] --> S19["19 Deployment"] --> S20["20 Documentation"]
```

## A.3 Sequencing rationale

1. **Identity and tenancy first.** Every later feature depends on authentication, authorization and isolation; retrofitting row-level security is expensive and risky.
2. **Supply before demand.** Venues must be onboarded and priced before bookings can be exercised with realistic data.
3. **Booking before real payments.** The booking state machine and concurrency guarantees are proven with the mock adapter behind the same `PaymentGateway` port, independent of provider timelines.
4. **No money without a ledger.** Payments (8) and ledger (9) complete together before any real transaction; live keys are enabled only after steps 8, 9 and 17.
5. **Operations before engagement.** Venues need check-in, walk-ins and refunds on day one; social and loyalty can wait.
6. **Events and products reuse the core** (slots, payments, ledger), so they follow once it is stable.
7. **Cross-cutting consolidation** (SuperAdmin, notifications, reporting) comes after data flows exist; minimal slices are pulled forward where needed without changing the order: CI from step 1, the `audit_logs` table in step 3, OTP email/SMS in step 2, verification review in step 4, and a staging environment with public HTTPS by step 8 for sandbox webhooks.
8. **Hardening closes the MVP**, but security scanning and tests run from step 1; steps 17–19 raise them to launch grade.
9. **Provider-dependent work sits behind ports and flags**, so contract delays never block unrelated work.

## A.4 Team composition (MVP)

| Role | Allocation | Responsibilities |
|---|---|---|
| Product owner (Jerome) | Part-time | Priorities; provider, legal and tax inputs; pilot venues |
| Senior product manager | 1.0 | Backlog, acceptance criteria, launch readiness |
| Senior product designer | 1.0, then 0.5 after BM4 | Flows, design system, usability and accessibility testing |
| Tech lead / architect | 1.0 | Architecture, domain model, reviews, security design |
| Full-stack TypeScript engineers | 3–4 | Features across apps and packages |
| Senior payments and ledger engineer | 1.0 from BM2 | Steps 7–9, provider integration, reconciliation |
| QA / SDET | 1.0 from BM2 | Automation, end-to-end, load and accessibility tests |
| DevOps / SRE | 0.5, then 1.0 in BM6 | Terraform, CI/CD, observability, DR |
| Security engineer | 0.25 plus external pen test | Threat model, reviews, pen-test coordination |
| DPO / privacy counsel, tax counsel | As needed | PIA, notices, NPC registration; VAT, withholding, invoicing |
| Support and operations lead | From BM5 | Runbooks, support desk, venue onboarding |

## A.5 Risks

| Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|
| Provider onboarding or xenPlatform approval delayed | Medium | High | Mock adapter behind the port; sandbox as early as possible; start KYB now | Product owner |
| Provider capability gaps (split rules, QR Ph refunds, session expiry, sub-account payouts) | Medium | High | Sandbox contract tests; designed alternatives (netting, transfers, disbursement refunds); flags | Payments engineer |
| Regulatory exposure (fee pass-through, OPS registration for Option B, RA 11967 duties) | Medium | High | Option A default; pass-through off for every method until cleared (doc 23 D-05); counsel opinions before pilot | Product owner, counsel |
| Unclear tax treatment (VAT on commission, withholding, invoicing) | High | Medium | Configurable tax settings; early tax counsel; complete statement breakdowns | Finance |
| Venue adoption (Messenger and cash habits) | Medium | High | Hands-on pilot onboarding; walk-in QR flow; transparent fee calculator | Product |
| Concurrency bugs causing double bookings or money errors | Low | Critical | Exclusion constraint, idempotency, property and concurrency tests, reconciliation | Tech lead |
| SMS sender-ID registration lead time | Medium | Medium | Start registration during BM1; email OTP fallback; SMS templates without links (doc 23 D-22) | Product owner |
| Security incident or personal-data breach | Low | Critical | Threat model, pen test, MFA, least privilege, monitoring, breach runbook | Security |
| Key-person dependency on payments and ledger | Medium | High | Pairing, ADRs, runbooks, code ownership rules | Tech lead |
| Scope creep from demo feedback | High | Medium | Doc 18 scope table as the contract; Phase 2 backlog | PM |
| Windows/OneDrive tooling problems | High | Low | Repository outside OneDrive; WSL2 recommended | Tech lead |
| Maps and SMS costs above plan | Medium | Low | Caching within provider terms, budgets and alerts, provider ports | DevOps |

---

# Part B — Production build steps

## B.0 Conventions for every step

**Workspace names.** Apps: `web`, `business`, `admin`, `api`, `worker`. Packages: `@courtko/domain`, `@courtko/core`, `@courtko/db`, `@courtko/payments`, `@courtko/contracts`, `@courtko/security`, `@courtko/notifications`, `@courtko/observability`, `@courtko/ui`, `@courtko/web-kit`. Root scripts proxy to Turborepo, so `pnpm dev --filter api` runs `turbo run dev --filter api`.

**Local stack (`docker-compose.yml`).**

| Service | Image | Port | Purpose |
|---|---|---|---|
| `db` | `postgis/postgis:16-3.4` | 5432 | PostgreSQL 16 with PostGIS; init script creates `courtko_owner` (migrations) and `courtko_app` (runtime, non-owner, `NOBYPASSRLS`) |
| `redis` | `redis:7-alpine` | 6379 | Rate limiting, short-lived caches |
| `mailpit` | `axllent/mailpit` | 1025 / 8025 | Captures email locally (UI at http://localhost:8025) |
| `minio` | `minio/minio` | 9000 / 9001 | S3-compatible buckets: uploads-quarantine, uploads-clean, reports, audit-archive |

**Common commands.**

| Command | Does |
|---|---|
| `pnpm install` | Install workspace dependencies (frozen lockfile in CI) |
| `pnpm dev:certs` | Create local TLS certificates (mkcert) — `__Host-` cookies require HTTPS |
| `docker compose up -d` | Start the local stack |
| `pnpm db:migrate` | Apply forward-only migrations with `DATABASE_MIGRATION_URL` |
| `pnpm db:seed --profile synthetic` | Load the deterministic synthetic dataset (labeled synthetic; `example.com` emails, +63 917 000 00xx numbers) |
| `pnpm dev --filter api` (and `web`, `business`, `admin`, `worker`) | Run one app in watch mode; web https://localhost:3000, business :3001, admin :3002, API http://localhost:4000 (called server-side by the BFFs) |
| `pnpm test`, `pnpm test:integration`, `pnpm test:e2e` | Unit (Vitest), integration (Vitest + Testcontainers with PostGIS 16 and Redis), end-to-end (Playwright + axe) |
| `pnpm lint`, `pnpm typecheck` | ESLint and `tsc --noEmit` across the workspace |

**Environment variables.** `.env.example` is committed without secrets; developers copy it to `.env.local` (git-ignored). Each app validates its environment with a Zod schema at startup and refuses to start on missing or invalid values. In AWS, values come from Secrets Manager and SSM Parameter Store; ECS tasks use IAM roles, never access keys. Tables mark secrets with **[secret]**. **Business configuration — commission rates, fee schedules, hold TTL, policies, grace periods — lives in the database** (`platform_settings`, commission agreements, payment-method configuration), never in environment variables.

**Migrations.** `packages/db/migrations/NNNN_name.sql`, forward-only, expand/contract: additive change first, code that uses it next, removal in a later release. `CREATE INDEX CONCURRENTLY` runs in its own migration. Production migrations run as a one-off ECS task before the new version rolls out.

**Tests.** Test file paths in this document are indicative; doc 20 defines the authoritative test layout, coverage floors and CI gates.

**Definition of done for each step.** Code, migration, tests (unit, integration, authorization, end-to-end where applicable) green in CI; security considerations reviewed; environment variables documented; this document and the related design docs updated; demo parity checked where the demo covers the feature.

## Step 1 — Project structure and design system

**Goal.** A working monorepo with tooling, CI, local stack, observability baseline, health endpoints and the core design-system components. No business features.

**Files created/changed**
- Root: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.nvmrc` (Node 24 LTS), `.npmrc`, `.editorconfig`, `.gitattributes`, `.gitignore`, `eslint.config.mjs`, `prettier.config.mjs`, `CODEOWNERS`, `.env.example`, `docker-compose.yml`
- `infra/local/postgres/init.sql` (roles), `infra/local/minio/create-buckets.sh`
- `.github/workflows/ci.yml` (lint, typecheck, unit tests, build, dependency audit, secret scan, SAST), `.github/dependabot.yml`
- `apps/api/src/{server.ts,app.ts,env.ts}`, `apps/api/src/plugins/{correlation-id.ts,problem-json.ts,security-headers.ts,rate-limit.ts}`, `apps/api/src/routes/v1/health.ts`
- `apps/worker/src/{index.ts,env.ts,queues.ts}`
- `apps/web/app/layout.tsx`, `apps/web/app/(public)/page.tsx`, `apps/web/middleware.ts` (CSP nonce, security headers, host routing for `courtko.ph` and `app.courtko.ph`); equivalent skeletons in `apps/business` and `apps/admin`, whose `next.config.ts` set `basePath: '/biz'` and `basePath: '/admin'` so production paths match the demo (doc 05 §7.1)
- `packages/ui/src/tokens/tokens.css`, `packages/ui/src/components/{Button,IconButton,TextField,StatusPill,Banner,Toast,Dialog,Skeleton,EmptyState}.tsx`, `packages/ui/.storybook/`
- `packages/domain/src/money/{money.ts,ppm.ts,rounding.ts}`; `packages/web-kit/src/format/{peso.ts,datetime.ts}`
- `packages/contracts/src/{errors.ts,problem.ts}` (error codes, RFC 9457 schema)
- `packages/observability/src/{logger.ts,redact.ts,otel.ts}`
- `packages/db/src/client.ts`, `packages/db/scripts/{migrate.ts,seed.ts}`
- `tests/e2e/playwright.config.ts`, `tests/e2e/smoke/health.spec.ts`

**Database migration** — `packages/db/migrations/0001_extensions_and_settings.sql`
- `CREATE EXTENSION IF NOT EXISTS postgis, btree_gist, pg_trgm, citext, pgcrypto`.
- Schema `app` with helpers `app.current_scope()`, `app.current_business_id()`, `app.current_user_id()` reading `current_setting('app.scope', true)` etc.
- `platform_settings` (key PK, value jsonb, updated_by, updated_at) and `feature_flags` (key PK, enabled, rules jsonb).
- Grants to `courtko_app`. Database roles themselves are created by `infra/local/postgres/init.sql` locally and by a bootstrap task in RDS, not by migrations.

**Environment variables**

| Name | Purpose | Example | |
|---|---|---|---|
| `APP_ENV` | Environment name | `local` | |
| `LOG_LEVEL` | Log verbosity | `info` | |
| `DATABASE_URL` | Runtime connection as `courtko_app` | `postgres://courtko_app:***@localhost:5432/courtko` | [secret] |
| `DATABASE_MIGRATION_URL` | Migration connection as `courtko_owner` | `postgres://courtko_owner:***@localhost:5432/courtko` | [secret] |
| `REDIS_URL` | Redis | `redis://localhost:6379` | |
| `API_PORT`, `API_BASE_URL_INTERNAL` | API listener; BFF → API URL | `4000`, `http://localhost:4000` | |
| `WEB_ORIGIN`, `BUSINESS_ORIGIN`, `ADMIN_ORIGIN` | Allowed origins per surface | `https://localhost:3000` … `:3002` | |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Traces (optional locally) | `http://localhost:4318` | |
| `ERROR_TRACKING_DSN` | Sentry-compatible error tracking | empty locally | [secret] |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Local MinIO only (AWS uses task roles) | `http://localhost:9000`, `minio`, `***` | [secret] |

**Security considerations**
- Pinned Node 24 LTS and lockfile; `pnpm install --frozen-lockfile` in CI; dependency audit and SAST on every pull request; secret scanning in pre-commit and CI.
- Security headers from the start: CSP with nonces, HSTS, `X-Content-Type-Options`, `frame-ancestors 'none'`, `Referrer-Policy`.
- Logger redaction list (authorization, cookies, passwords, tokens, OTPs, card-like numbers; email and phone masked).
- Problem+json errors never include stack traces; every response carries `X-Correlation-Id`.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `packages/domain/test/money/rounding.test.ts` | Unit | Half-up rounding with BigInt; no floating point |
| `packages/web-kit/test/format/peso.test.ts` | Unit | "₱415.00", thousands separators, "−₱50.00" |
| `packages/web-kit/test/format/datetime.test.ts` | Unit | "Sat, Oct 3, 2026", "12:00 NN", "Manila time" label |
| `packages/observability/test/redact.test.ts` | Unit | Secrets and PII never reach log output |
| `apps/api/test/health.test.ts` | Integration | Liveness and readiness (DB, Redis) |
| `packages/ui/test/a11y/components.test.tsx` | Unit + axe | No accessibility violations in core components |
| `tests/e2e/smoke/health.spec.ts` | E2E | Apps boot and render |

**How to run locally**
```bash
git clone <repo-url> C:/dev/courtko && cd C:/dev/courtko   # outside OneDrive
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev:certs
docker compose up -d
pnpm db:migrate
pnpm dev --filter api
pnpm dev --filter web
pnpm test
```

**How to validate**
1. `curl http://localhost:4000/v1/health/live` → `200 {"status":"ok"}`; `/v1/health/ready` → 200 only when DB and Redis are reachable.
2. Responses include `X-Correlation-Id`; an unknown route returns `application/problem+json` with `code: "NOT_FOUND"`.
3. Storybook shows the components with tokens from doc 17; axe reports no violations.
4. A pull request runs the full CI pipeline green.

**Provider-dependent assumptions.** None. Error-tracking vendor is a PLACEHOLDER (any Sentry-compatible service with PII scrubbing).

## Step 2 — Authentication

**Goal.** Registration, verification, login, MFA, sessions, password reset and the BFF session model for all three surfaces.

**Files created/changed**
- `packages/security/src/{password.ts,tokens.ts,totp.ts,recovery-codes.ts,envelope.ts}`
- `packages/core/src/auth/{register.ts,verify-contact.ts,login.ts,mfa.ts,sessions.ts,reset-password.ts,risk.ts}`; ports `packages/core/src/ports/{email-sender.ts,sms-sender.ts,clock.ts}`
- `packages/contracts/src/auth.ts`
- `apps/api/src/routes/v1/auth/{register,verify,login,logout,mfa,sessions,password-reset,oidc-google}.ts`; `apps/api/src/plugins/session.ts`
- `packages/web-kit/src/bff/{proxy.ts,session-cookie.ts,csrf.ts}`; BFF route `app/api/bff/[...path]/route.ts` in each Next.js app
- `apps/web/app/(auth)/{login,signup,verify,mfa,forgot,reset}/page.tsx`; login, MFA and reset pages in `apps/business` and `apps/admin`
- `packages/notifications/src/channels/{smtp-dev.ts,ses.ts,sms-console.ts,sms-aggregator.ts}` (minimal, for OTP and reset only)

**Database migration** — `packages/db/migrations/0002_identity.sql`
- `users` (id, email citext unique, phone_e164 unique, password_hash PHC string, status, email_verified_at, phone_verified_at, timestamps, deleted_at; CHECK email or phone present).
- `user_profiles`, `user_preferences`, `user_addresses`, `identities` (UNIQUE(provider, subject)).
- `sessions` (token_hash bytea UNIQUE — SHA-256 of a 256-bit random token; surface `web|business|admin`; mfa_verified_at; last_seen_at; idle_expires_at; absolute_expires_at; revoked_at; ip inet; user_agent; device_label).
- `refresh_tokens` (family_id, token_hash, used_at, revoked_at) for "remember me" and future native apps, with reuse detection.
- `mfa_factors` (TOTP secret envelope-encrypted, key_id, confirmed_at), `mfa_recovery_codes` (hashed, used_at), `verification_challenges` (purpose, channel, target_hash, code_hash, attempts, expires_at), `password_reset_tokens` (hashed, single use), `security_events`.

**Environment variables**

| Name | Purpose | Example | |
|---|---|---|---|
| `ARGON2_MEMORY_KIB`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM` | Password hashing parameters (tune to ~250 ms) | `19456`, `2`, `1` | |
| `SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS`, `ADMIN_SESSION_IDLE_MINUTES`, `REMEMBER_ME_DAYS` | Session limits | `30`, `12`, `15`, `30` | |
| `ENVELOPE_KMS_KEY_ID` | KMS key for MFA secret envelope encryption (AWS) | `alias/courtko-mfa` | |
| `LOCAL_ENVELOPE_KEY` | Local-only 32-byte key replacing KMS | base64 value | [secret] |
| `EMAIL_FROM`, `SMTP_URL`, `SES_REGION` | Email sending (SMTP → Mailpit locally) | `no-reply@courtko.ph` (PLACEHOLDER), `smtp://localhost:1025`, `ap-southeast-1` | |
| `SMS_PROVIDER` | `console` locally; aggregator in cloud | `console` | |
| `SMS_API_BASE_URL`, `SMS_API_KEY`, `SMS_SENDER_ID` | PH SMS aggregator | PLACEHOLDER | [secret] key |
| `GOOGLE_OIDC_CLIENT_ID`, `GOOGLE_OIDC_CLIENT_SECRET` | Google sign-in | PLACEHOLDER | [secret] secret |
| `OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS` | OTP policy | `600`, `5` | |

**Security considerations**
- Identical responses and timing bands for existing and unknown accounts on sign-up and reset (no enumeration; dummy hash on unknown users).
- Rate limits per IP and per identifier in Redis with exponential backoff; temporary lockout after repeated failures; owner notified; risk signals (new device, unusual location) trigger step-up; CAPTCHA-style challenges only through AWS WAF on elevated risk.
- Length-based password policy with a breached/common-password blocklist; paste and password managers allowed.
- Session token rotated at login, at MFA completion and at privilege change; `__Host-` cookies (Secure, HttpOnly, `SameSite=Lax` for web and business, `Strict` for admin, `Path=/`); BFF mutations require Origin checks plus a CSRF token.
- MFA mandatory for platform staff, `business_owner` and `business_manager`; recovery codes hashed; all authentication events recorded in `security_events` and the audit log.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `packages/security/test/password.test.ts` | Unit | Argon2id PHC format, parameters, rehash-on-login |
| `packages/security/test/totp.test.ts` | Unit | RFC 6238 test vectors, drift window |
| `apps/api/test/integration/auth/register-verify.test.ts` | Integration | Verification required before booking-capable state |
| `apps/api/test/integration/auth/login-lockout.test.ts` | Integration | Throttling and lockout behavior |
| `apps/api/test/integration/auth/session-timeouts.test.ts` | Integration | Idle and absolute expiry (fake clock) |
| `apps/api/test/integration/auth/revoke-all-sessions.test.ts` | Integration | Password reset and "sign out everywhere" revoke sessions |
| `apps/api/test/integration/auth/enumeration.test.ts` | Integration | Same status, body and timing band for known/unknown accounts |
| `apps/api/test/integration/auth/mfa-required.test.ts` | Integration | Owners and admins get `MFA_REQUIRED` until TOTP succeeds |
| `tests/e2e/auth/signup-verify-login.spec.ts`, `tests/e2e/auth/mfa-enrollment.spec.ts` | E2E | Full flows in the browser |

**How to run locally**
```bash
docker compose up -d
pnpm db:migrate
pnpm dev --filter api
pnpm dev --filter web
# OTP codes print in the API console (SMS_PROVIDER=console); emails appear at http://localhost:8025
```

**How to validate**
1. Sign up as `bea.santos@example.com` (synthetic) → verification email in Mailpit → verify → sign in.
2. Enroll TOTP with an authenticator app; sign out and back in → code required.
3. Six wrong passwords → throttling message; the account owner receives a security notice.
4. "Sign out everywhere" in settings → a second browser session is rejected on its next request.
5. Browser devtools show `__Host-` cookies with Secure, HttpOnly and the expected SameSite value.

**Provider-dependent assumptions.** SMS aggregator and registered sender ID — PLACEHOLDER (email OTP fallback until available). Google OIDC credentials — PLACEHOLDER. SES production access and domain verification (SPF, DKIM, DMARC) for `courtko.ph` — PLACEHOLDER.

## Step 3 — Tenant and authorization

**Goal.** Businesses, memberships, roles and permissions, PostgreSQL RLS, route-level and object-level authorization, platform staff roles, and the base audit log.

**Files created/changed**
- `packages/domain/src/rbac/{permissions.ts,platform-permissions.ts,role-templates.ts,evaluate.ts}` (exact codes and templates from the brief)
- `packages/core/src/authz/{authorize.ts,load-memberships.ts,escalation-guard.ts}`, `packages/core/src/audit/record.ts`
- `packages/db/src/rls/with-scope.ts` (`SET LOCAL app.scope`, `app.business_id`, `app.user_id` inside each transaction), `packages/db/src/repositories/{businesses,members,roles}.ts`
- `apps/api/src/plugins/{authz.ts,tenant-context.ts}`, `apps/api/src/routes/v1/staff/memberships.ts` (`GET /v1/staff/me/memberships`), `apps/api/src/routes/v1/businesses/[businessId]/{members,roles}.ts`
- `apps/business/src/nav/permission-nav.ts` (doc 05 §9), `apps/business/app/(portal)/staff/*` (first version)

**Database migration** — `packages/db/migrations/0003_tenancy.sql`
- `businesses` (status enum `draft|pending_verification|active|rejected|suspended`, trade/legal names, entity type, `settlement_model` default `provider_split`, `vat_registered`, `prices_include_vat` default true).
- `permissions` (code PK, scope, risk), `roles` (business_id NULL for system templates), `role_permissions`, `business_members` (UNIQUE(business_id, user_id)), `business_member_roles` (member_id, role_id, venue_id NULL; FK to venues added in 0005), `platform_staff`, `platform_staff_roles`.
- `audit_logs` with the record fields of doc 14 §10.2 (ULID `id`, `occurred_at`, `chain_id`, `seq`, `actor_type`, `actor_user_id`, `actor_roles`, `impersonator_user_id`, `support_session_id`, `action`, `target_type`, `target_id`, `business_id`, `venue_id`, redacted `before`/`after`, `reason`, `ticket_ref`, `outcome`, `ip`, `device_id`, `user_agent_hash`, `correlation_id`, `retention_class`); application roles get INSERT only and a trigger rejects UPDATE and DELETE. Hash columns are populated from step 17.
- RLS: `ENABLE` and `FORCE ROW LEVEL SECURITY` on every tenant table; policy `tenant_isolation` `USING (app.current_scope() IN ('platform','system') OR business_id = app.current_business_id())` with matching `WITH CHECK`; seeded permission codes and role templates.

**Environment variables**

| Name | Purpose | Example | |
|---|---|---|---|
| `PERMISSION_CACHE_TTL_SECONDS` | Redis cache of effective permissions (invalidated on role change) | `30` | |

**Security considerations**
- Default deny: every route declares its required permission in route config; a test fails the build if a route has none.
- Objects are always loaded by `(business_id, id)`; cross-tenant IDs return 404 and log a security event.
- RLS is defense in depth: `courtko_app` is not the table owner and has `NOBYPASSRLS`; `SET LOCAL` only inside transactions, so pooled connections never leak context.
- Escalation guard (cannot grant unheld permissions), last-owner protection, MFA step-up for granting high-risk permissions, audit with before/after for every role change.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `packages/domain/test/rbac/role-templates.test.ts` | Unit | Templates exactly match the brief |
| `packages/domain/test/rbac/evaluate.test.ts` | Unit | Venue-scoped evaluation, implicit `business.view` |
| `apps/api/test/authz/route-permission-coverage.test.ts` | Authorization | Every route declares a permission; generated role × route matrix |
| `apps/api/test/authz/tenant-isolation.test.ts` | Tenant isolation | Foreign `businessId` or object ID → 404 for every route family |
| `packages/db/test/rls/rls-enforced.test.ts` | Integration | Missing or wrong context returns zero rows; cross-tenant INSERT rejected |
| `apps/api/test/authz/escalation.test.ts`, `apps/api/test/authz/last-owner.test.ts` | Authorization | No privilege escalation; last owner protected |

**How to run locally**
```bash
pnpm db:migrate
pnpm db:seed --profile synthetic      # Hub Sports Co., Rally Point Ventures Inc., synthetic staff
pnpm dev --filter api
pnpm dev --filter business
```

**How to validate**
1. Sign in as the synthetic receptionist → navigation shows only permitted items.
2. As a Hub Sports member, `GET /v1/businesses/{rallyPointId}/bookings` → 404 with `code: "NOT_FOUND"`.
3. In `psql` as `courtko_app` without `SET app.*`, `SELECT count(*) FROM business_members` → 0.
4. As a business manager, assigning a role that includes `refunds.approve` → 403 `FORBIDDEN`.

**Provider-dependent assumptions.** None.

## Step 4 — Business onboarding

**Goal.** Registration wizard, verification documents with malware scanning, platform review (approve, reject, suspend, reactivate), sub-account provisioning and payout-account connection through the `PaymentGateway` port (mock adapter until step 8).

**Files created/changed**
- `packages/core/src/onboarding/{create-business.ts,submit-verification.ts,review-verification.ts,suspend-business.ts}`
- `packages/core/src/uploads/{create-upload.ts,finalize-upload.ts,on-scan-result.ts}`; ports `packages/core/src/ports/{object-storage.ts,malware-scanner.ts,payment-gateway.ts}` (`createSubAccount`, `connectPayoutAccount`)
- `packages/payments/src/mock/sub-accounts.ts`
- `apps/api/src/routes/v1/uploads.ts`, `apps/api/src/routes/v1/businesses/[businessId]/verification.ts`, `apps/api/src/routes/v1/admin/businesses/*.ts`
- `apps/worker/src/jobs/{uploads.scan-result.ts,images.process.ts,providers.provision-sub-account.ts}`
- `apps/business/app/(portal)/onboarding/*`, `apps/admin/app/(console)/businesses/*` (queue and verification review, doc 16 §18)

**Database migration** — `packages/db/migrations/0004_onboarding.sql`
- `file_uploads` (purpose, bucket, object_key, sha256, mime_type, size_bytes, `scan_status` pending|clean|infected|error).
- `business_verifications` (status submitted|approved|rejected, reviewer, decision notes), `verification_documents` (doc_type, review_result, reason_code), `verification_checklist_items`.
- `business_provider_accounts` (provider, provider_account_id, account_type, status; UNIQUE(provider, provider_account_id)).
- `payout_accounts` (provider_ref, bank_name, account_last4, masked account name, status, verified_at, changed_by) — masked data only.

**Environment variables**

| Name | Purpose | Example | |
|---|---|---|---|
| `S3_BUCKET_UPLOADS_QUARANTINE`, `S3_BUCKET_UPLOADS_CLEAN` | Upload buckets | `courtko-local-uploads-quarantine`, `courtko-local-uploads-clean` | |
| `UPLOAD_MAX_BYTES`, `UPLOAD_URL_TTL_SECONDS` | Upload limits | `10485760`, `300` | |
| `MALWARE_SCAN_MODE` | `stub` locally (flags the EICAR test file); `guardduty` in AWS | `stub` | |
| `DOC_VIEW_URL_TTL_SECONDS` | Reviewer document link lifetime | `60` | |

**Security considerations**
- Presigned PUT with content-type and content-length conditions; magic-byte validation after upload; quarantine → scan → copy to clean bucket; reviewers can open only clean files through short-lived presigned GETs; every view is watermarked and audited.
- SSE-KMS encryption, no public bucket access, TLS-only bucket policies, retention per doc 15.
- Documents visible only to the business owner and holders of `platform.businesses.verify`; images re-encoded with metadata stripped.
- Approval, rejection, suspension and reactivation are audited with reviewer and reasons.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `apps/api/test/integration/onboarding/full-flow.test.ts` | Integration | `draft` → `pending_verification` → `active`/`rejected` → resubmission |
| `apps/api/test/integration/uploads/validation.test.ts` | Integration | Renamed executable rejected; > 10 MB rejected; EICAR marked infected and never viewable |
| `apps/api/test/authz/verification-docs-access.test.ts` | Authorization | Other businesses → 404; receptionist → 403 |
| `tests/e2e/business/onboarding.spec.ts`, `tests/e2e/admin/verification-review.spec.ts` | E2E | Journey J5 and J11 part A |

**How to run locally**
```bash
docker compose up -d
pnpm db:migrate
pnpm dev --filter api
pnpm dev --filter worker
pnpm dev --filter business
pnpm dev --filter admin
```

**How to validate**
1. Submit the synthetic documents → business shows "Under review".
2. Upload the EICAR test file → "Blocked: malware detected"; reviewers cannot open it.
3. Approve in the admin console → business `active`; mock sub-account record created; owner notified; audit entries present.
4. Reject with a reason → only the flagged item reopens for the owner.

**Provider-dependent assumptions.** xenPlatform sub-account creation, KYC/KYB requirements and account type (MANAGED vs OWNED) — PLACEHOLDER; payout-account linking flow — PLACEHOLDER. The mock adapter implements the port until step 8.

## Step 5 — Venue and court setup

**Goal.** Venues, courts, hours, special hours, booking settings, policies, amenities, media, public venue search and pages.

**Files created/changed**
- `packages/domain/src/venue/{operating-hours.ts,special-hours.ts,slug.ts,publish-checklist.ts}`
- `packages/core/src/venues/*`, port `packages/core/src/ports/geocoder.ts`, adapters `apps/api/src/adapters/geocoding/{google.ts,mapbox.ts,osm-dev.ts}`
- `apps/api/src/routes/v1/businesses/[businessId]/{venues,courts,policies}.ts`, `apps/api/src/routes/v1/public/{venues.ts,venue-search.ts}`
- `apps/business/app/(portal)/{venues,courts}/*`, `apps/web/app/(public)/courts/page.tsx`, `apps/web/app/(public)/venues/[slug]/page.tsx`
- `packages/db/seeds/psgc/import-psgc.ts` (PSGC reference import)

**Database migration** — `packages/db/migrations/0005_venues_courts.sql`
- `psgc_areas` (code, name, level, parent_code; trigram index).
- `venues` (business_id, slug citext UNIQUE, name, status `draft|published|unpublished|suspended`, timezone default `Asia/Manila`, `location geography(Point,4326)`, address fields with PSGC codes and landmark, booking settings `min_duration_min`, `max_duration_min`, `increment_min CHECK (increment_min IN (30,60,90))`, `advance_days`, `buffer_min`, `check_in_required`, `check_in_window_before_min` default 30, `no_show_grace_min` default 15, `policy_id`), `venue_slug_redirects`.
- `venue_operating_hours` (weekday, opens_at, closes_at, closes_next_day), `venue_special_hours` (date, closed, hours, reason).
- `courts` (business_id, venue_id, name, format, environment, surface, tags, active, sort_order), `amenities`, `venue_amenities`, `taxonomy_terms`, `venue_media` (alt_text NOT NULL).
- `cancellation_policies` and `cancellation_policy_versions` (tiers jsonb, published_at; immutable once published; seeded Standard, Flexible, Strict, Non-refundable).
- FK `business_member_roles.venue_id → venues(id)`; GIST index on `location`; trigram index on venue name.

**Environment variables**

| Name | Purpose | Example | |
|---|---|---|---|
| `MAPS_PROVIDER` | `osm-dev` locally; `google` or `mapbox` in cloud | `osm-dev` | |
| `MAPS_SERVER_API_KEY` | Server-side geocoding | PLACEHOLDER | [secret] |
| `NEXT_PUBLIC_MAPS_BROWSER_KEY` | Browser map tiles (referrer-restricted, not secret) | PLACEHOLDER | |
| `GEOCODE_CACHE_TTL_HOURS` | Cache within provider terms | `720` | |
| `IMAGE_MAX_BYTES`, `PUBLIC_ASSET_BASE_URL` | Venue images | `5242880`, `http://localhost:9000/courtko-local-public` | |

**Security considerations**
- Public queries return only `published` venues of `active` businesses (public-scope RLS policy plus query filter).
- Geocoding runs server-side; OpenStreetMap services used only for low-volume development per their usage policy.
- Slugs sanitized; EXIF (including GPS) stripped; alt text required to publish; court configuration changes audited.
- Publish checklist enforced by the API.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `packages/domain/test/venue/operating-hours.test.ts` | Unit | Overnight spans; special hours override weekly hours |
| `packages/domain/test/venue/publish-checklist.test.ts` | Unit | Each checklist item (doc 04 J5) |
| `apps/api/test/integration/public/venue-search.test.ts` | Integration | Nearby ordering (PostGIS), radius, PSGC/landmark search, unpublished excluded, coordinates never logged |
| `apps/api/test/authz/venues-courts.test.ts` | Authorization | `venues.manage` / `courts.manage` / venue scope |
| `tests/e2e/business/venue-setup-publish.spec.ts` | E2E | Create venue → checklist → publish → visible on `/courts` |

**How to run locally**
```bash
pnpm db:migrate
pnpm db:seed --profile synthetic      # Pasig Pickle Hub, Makati Dink Club, ...
pnpm dev --filter api
pnpm dev --filter web
pnpm dev --filter business
```

**How to validate**
1. Create a venue → Publish is blocked until the checklist passes → publish → appears on `/courts`.
2. Search "Kapitolyo" → Pasig Pickle Hub appears; "near me" sorts by rounded distance.
3. Rename the slug → the old URL 301-redirects.

**Provider-dependent assumptions.** Maps/geocoding provider, pricing and caching terms — PLACEHOLDER. PSGC dataset version and update cadence (Philippine Statistics Authority publications) — to confirm.

## Step 6 — Availability and pricing engine

**Goal.** Pricing rules, simulator, promotions, taxes, gateway-fee calculation, court blocks and the `booking_slots` table that makes double booking impossible.

**Files created/changed**
- `packages/domain/src/pricing/{rule.ts,resolve.ts,slices.ts,quote.ts,minimum-charge.ts}`, `packages/domain/src/availability/{compute.ts,grid.ts}`, `packages/domain/src/fees/gateway-fee.ts`, `packages/domain/src/tax/vat.ts`, `packages/domain/src/promotions/{validate.ts,apply.ts}`
- `packages/core/src/pricing/{manage-rules.ts,simulate.ts}`, `packages/core/src/availability/get-availability.ts`, `packages/core/src/blocks/{create-block.ts,detect-conflicts.ts}`
- `apps/api/src/routes/v1/public/availability.ts` (`GET /v1/public/venues/{venueId}/availability?date=`), `apps/api/src/routes/v1/businesses/[businessId]/{pricing-rules,price-simulations,promotions,court-blocks}.ts`, `apps/api/src/routes/v1/admin/holidays.ts`
- `apps/business/app/(portal)/pricing/*`, `packages/ui/src/components/{AvailabilityTimeline,TimeSlotChip,DateChips}.tsx`

**Database migration** — `packages/db/migrations/0006_availability_pricing.sql`
- `holidays` (date, name, type, source reference) — platform-managed.
- `pricing_rules` (business_id, venue_id, court_id NULL, rule_type, weekdays bitmask, start/end time, effective_from/to, priority, `rate_per_hour_centavos bigint CHECK (> 0)`, `min_charge_centavos`, plan refundable|non_refundable, status, version, created_by, updated_by) and `pricing_rule_versions` (history).
- `promotions` (scope business|platform, code citext, fixed or percent value, applies_to, min spend, total and per-user limits, validity, `funded_by venue|platform`; unique code per scope).
- `court_blocks` (court_id, `range tstzrange`, reason_type, note, created_by, removed_at).
- `booking_slots` (business_id, court_id, play_range, occupied_range tstzrange, status active|released, source_type hold|booking|block|event, source_id) with `EXCLUDE USING gist (court_id WITH =, occupied_range WITH &&) WHERE (status = 'active')`.

**Environment variables**

| Name | Purpose | Example | |
|---|---|---|---|
| `AVAILABILITY_CACHE_TTL_SECONDS` | Short cache, invalidated on any slot change | `10` | |

Fee schedules (`payment_method_configs`, step 8) and commission rates (step 9) are database configuration, not environment variables.

**Security considerations**
- `pricing.manage` is high risk: every change audited with before/after; changes apply to new quotes only.
- The server is the only price authority; quotes carry a pricing-version hash so stale quotes are detected.
- The public availability endpoint is rate-limited and exposes free/busy only, never who booked.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `packages/domain/test/pricing/resolve.test.ts` | Unit | Priority, scope tie-break, same-priority conflict detection |
| `packages/domain/test/pricing/slices.test.ts` | Unit | Fri, Oct 2, 4:30–6:00 PM = ₱150.00 + ₱400.00 = ₱550.00 |
| `packages/domain/test/pricing/minimum-charge.test.ts` | Unit | Minimum charge applied once |
| `packages/domain/test/fees/gateway-fee.test.ts` | Unit | Gross-up: ₱610.00 at 2.3% → ₱14.37 and the provider fee on the total is covered; flat ₱15.00 → ₱15.00 |
| `packages/domain/test/tax/vat.test.ts` | Unit | ₱400.00 VAT-inclusive → "VAT (12%, included)" ₱42.86 |
| `packages/domain/test/money/properties.test.ts` | Property (fast-check) | Slices sum to the total; results are integers; no float drift |
| `packages/db/test/booking-slots-exclusion.test.ts` | Integration | Overlaps (including buffer) rejected; released rows never block |
| `apps/api/test/integration/availability.test.ts` | Integration | Hours, special hours, blocks, buffers and advance limits reflected |

**How to run locally**
```bash
pnpm test --filter @courtko/domain
pnpm db:migrate
pnpm dev --filter api
pnpm dev --filter business
```

**How to validate**
1. Simulator: Court 1, Fri, Oct 2, 2026, 4:30 PM, 90 min → booking base ₱550.00; commission ₱27.50 and venue net ₱522.50; with pass-through ON and the placeholder QR Ph fee the customer pays ₱565.00 (with the default OFF, ₱550.00).
2. Saving a second rule at the same priority and scope with overlapping times is blocked and names the conflicting rule.
3. With a 10-minute buffer after a 6:00–7:00 PM booking, 7:00 PM is not offered and 7:30 PM is.

**Provider-dependent assumptions.** Gateway fee schedules per method — PLACEHOLDER (illustrative: QR Ph flat ₱15.00, GCash 2.3%, Maya 2.0%); pass-through is OFF for every method until counsel confirms it (doc 23 D-05), so the gross-up path is exercised in tests but disabled in configuration. The holiday list is platform-maintained from official proclamations with venue overrides (doc 23 D-21).

## Step 7 — Booking workflow

**Goal.** Holds, checkout with locked quote and policy acceptance, payment sessions through the port (mock adapter), confirmation, QR and booking code, cancellation with quote, reschedule, hold expiry and completion jobs, idempotency and the transactional outbox.

**Files created/changed**
- `packages/domain/src/booking/{state-machine.ts,transitions.ts,cancellation-quote.ts,reschedule.ts,booking-code.ts}`
- `packages/core/src/booking/{create-hold.ts,release-hold.ts,create-checkout.ts,create-payment-session.ts,confirm-booking.ts,cancel-booking.ts,reschedule-booking.ts,expire-holds.ts,complete-bookings.ts}`; ports `packages/core/src/ports/{payment-gateway.ts,unit-of-work.ts,outbox.ts}`
- `packages/payments/src/mock/{gateway.ts,sandbox-page.ts,webhook-simulator.ts}` (local/dev/test only)
- `packages/security/src/qr-token.ts`
- `apps/api/src/plugins/idempotency.ts`, `apps/api/src/routes/v1/me/{booking-holds,checkouts,bookings}.ts`
- `apps/worker/src/jobs/{holds.expire.ts,bookings.complete.ts,outbox.dispatch.ts}`
- `apps/web/app/(player)/app/book/[venueSlug]/*`, `apps/web/app/(player)/app/checkout/[id]/page.tsx`, `apps/web/app/(player)/app/bookings/*`

**Database migration** — `packages/db/migrations/0007_booking.sql`
- Enum `booking_status` with the exact 14 values from the brief.
- `booking_holds` (user_id, business_id, court_id, slot_id → `booking_slots`, expires_at, status active|converted|released|expired).
- `checkouts` (user_id, business_id, venue_id, status, quote jsonb, quote_hash, pricing_version, policy_version_id, expires_at).
- `bookings` (business_id, venue_id, court_id, user_id, `booking_code` UNIQUE, status, play_range, slot_id, checkout_id, policy_version_id, accepted_policy_at, source online|walk_in, created_by_user_id, `reschedule_count CHECK (reschedule_count <= 1)`, currency default `PHP`, version for optimistic locking).
- `booking_participants`, `booking_status_history` (from, to, trigger, actor, at).
- `booking_price_snapshots` (booking_id, version, lines jsonb, booking_base, discount_total, tax_included, gateway_fee, customer_total, commissionable_base, commission_rate_ppm, commission_amount, commission_agreement_id; UNIQUE(booking_id, version)) with a trigger rejecting UPDATE and DELETE.
- `promotion_redemptions` (reserved|redeemed|released; unique per promotion and checkout).
- `idempotency_keys` (scope, key, request_hash, status in_progress|completed, response_status, response_body, locked_until, expires_at; PRIMARY KEY(scope, key)).
- `outbox_events` (aggregate, event_type, payload, created_at, dispatched_at, attempts, last_error).

**Environment variables**

| Name | Purpose | Example | |
|---|---|---|---|
| `PAYMENT_GATEWAY` | Adapter; `mock` is refused when `APP_ENV` is `staging` or `prod` | `mock` | |
| `QR_TOKEN_SIGNING_KEY` | Local HMAC key for check-in and claim QR tokens | base64 value | [secret] |
| `QR_TOKEN_KMS_KEY_ID` | AWS KMS HMAC key in cloud environments | `alias/courtko-qr-hmac` | |

Database settings (not env): `holds.ttl_seconds = 600`, `holds.max_active_per_user = 2`, `payments.late_grace_seconds = 900`, `idempotency.ttl_hours = 24`.

**Security considerations**
- `Idempotency-Key` required on POSTs that create holds, checkouts, payment sessions, cancellations and reschedules; request hash compared; same key with a different body → 422 `IDEMPOTENCY_KEY_REUSED`.
- Restriction checked at hold creation and again at confirmation; responses use `BOOKING_NOT_ALLOWED` only.
- The server recomputes and locks the quote at checkout; browsers never send prices.
- QR tokens are HMAC-signed, bound to booking, venue and check-in window, contain no personal data, and are checked against current booking status at scan time (so screenshots of cancelled bookings fail). Tokens are stable per booking so they work offline at venues with weak signal.
- Booking codes use a random unambiguous alphabet and are not usable as URL keys.
- State transitions go through the domain state machine with optimistic locking; invalid transitions return `INVALID_STATE_TRANSITION`.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `packages/domain/test/booking/state-machine.test.ts` | Unit | Every allowed transition from the brief; all others rejected |
| `packages/domain/test/booking/cancellation-quote.test.ts` | Unit | Standard tiers at 25 h / 10 h / 5 h; fee handling by reason |
| `apps/api/test/concurrency/same-slot.test.ts` | Concurrency | 50 parallel holds → exactly one succeeds |
| `apps/api/test/integration/idempotency.test.ts` | Integration | Replay, reuse with a different body, in-progress |
| `apps/api/test/integration/booking/hold-expiry.test.ts`, `hold-limit.test.ts` | Integration | TTL expiry within 60 s; 2-hold limit |
| `apps/api/test/integration/booking/rate-change-during-checkout.test.ts` | Integration | `QUOTE_EXPIRED` before lock; locked quote honored |
| `apps/api/test/integration/booking/restricted-during-checkout.test.ts` | Integration | Capture after restriction → `refund_pending` |
| `apps/api/test/integration/booking/court-blocked-during-checkout.test.ts` | Integration | Block cannot overlap an active hold; "block anyway" releases it and any late capture is refunded |
| `apps/api/test/integration/booking/reschedule.test.ts` | Integration | Atomic swap; once only; ≥ 12 h |
| `tests/e2e/player/book-with-mock-payment.spec.ts` | E2E | Journey J1 with the mock provider |

**How to run locally**
```bash
pnpm db:migrate
pnpm db:seed --profile synthetic
pnpm dev --filter api
pnpm dev --filter worker
pnpm dev --filter web
# PAYMENT_GATEWAY=mock serves a sandbox page equivalent to the demo's /pay/:sessionId (local/dev only)
```

**How to validate**
1. Book Court 1, Sat 7:00–8:00 PM → countdown on review → mock "Pay successfully" → confirmed with QR and booking code.
2. Two browsers race for the same slot → one sees "That time was just booked".
3. Leave a hold untouched for 10 minutes → booking `expired`, slot bookable again.
4. With a fake clock at 25 h, 10 h and 5 h before start, the cancellation preview shows ₱400.00, ₱200.00 and ₱0.00 for the canonical booking.
5. Start the API with `APP_ENV=prod PAYMENT_GATEWAY=mock` → it refuses to start.

**Provider-dependent assumptions.** None; the real provider arrives in step 8 behind the same port.

## Step 8 — Payment integration

**Goal.** Xendit xenPlatform adapter (payment sessions on behalf of sub-accounts with split rules), webhook endpoint with token verification and authoritative re-query, pending reconciliation, late-payment handling, refunds and disputes.

**Files created/changed**
- `packages/payments/src/xendit/{client.ts,sessions.ts,webhook.ts,refunds.ts,sub-accounts.ts,split-rules.ts,payouts.ts,reports.ts,mapper.ts,errors.ts}`, `packages/payments/src/index.ts` (adapter factory)
- `packages/core/src/payments/{handle-provider-update.ts,requery-payment.ts,late-payment.ts,request-refund.ts,process-refund.ts,record-dispute.ts}`
- `apps/api/src/routes/v1/webhooks/xendit.ts` (`POST /v1/webhooks/xendit`), `apps/api/src/routes/v1/me/payments.ts`
- `apps/worker/src/jobs/{payments.process-webhook.ts,payments.reconcile.ts,refunds.sync.ts}`
- `apps/web/app/(player)/app/payments/page.tsx`
- `packages/payments/test/fixtures/xendit/*.json` (synthetic payloads shaped like sandbox responses)
- `scripts/payments-replay.ts` (posts a fixture webhook to the local API)

**Database migration** — `packages/db/migrations/0008_payments.sql`
- `payment_method_configs` (method_code, provider, enabled, pass_through, bearer platform|venue, fee_pct_ppm, fee_fixed_centavos, effective_from, contract_ref, approved_by) seeded with PLACEHOLDER values and pass-through **off for every method** until counsel confirms each one (doc 23 D-05).
- `payment_customers`; `payment_method_tokens` (created now, unused until Phase 2 saved methods).
- `payments` (business_id, checkout_id, provider, `provider_payment_id` UNIQUE, provider_session_id UNIQUE, for_user_id, split_rule_ref, method_code, amount_centavos, currency, expected_fee_centavos, actual_fee_centavos, status `payment_status`, captured_at, failure_code, expires_at, version).
- `payment_events` (from, to, source webhook|requery|reconcile, webhook_event_id, at).
- `webhook_events` (provider, provider_event_id, event_type, received_at, token_valid, payload_redacted, processing_status, processed_at, attempts; `UNIQUE(provider, provider_event_id)`).
- `refunds` (payment_id, booking_id, order_item_id, amount_centavos, currency, reason_code, status `refund_status`, requested_by, approved_by, approval_level, `provider_refund_id` UNIQUE, failure_code).
- `disputes` (payment_id, `provider_dispute_id` UNIQUE, status `dispute_status`, amount, evidence_due_at, outcome_at).

**Environment variables**

| Name | Purpose | Example | |
|---|---|---|---|
| `PAYMENT_GATEWAY` | Adapter selection | `xendit` | |
| `XENDIT_API_BASE_URL` | Provider API | `https://api.xendit.co` | |
| `XENDIT_SECRET_KEY` | API key (test key in dev/staging, live key in prod only) | PLACEHOLDER | [secret] |
| `XENDIT_WEBHOOK_TOKEN` | Account callback verification token | PLACEHOLDER | [secret] |
| `XENDIT_PLATFORM_ACCOUNT_ID` | Master account that receives commission | PLACEHOLDER | |
| `PAYMENT_RETURN_URL_BASE` | Return page base | `https://localhost:3000/app/checkout` (production: `https://app.courtko.ph/app/checkout`) | |
| `PAYMENTS_RECONCILE_PENDING_AFTER_SECONDS` | Re-query pending payments older than this | `300` | |
| `WEBHOOK_SOURCE_ALLOWLIST` | Optional CIDRs if the provider publishes them | PLACEHOLDER | |

**Security considerations**
- Constant-time comparison of `x-callback-token`; failures are rejected, recorded as security events and alerted above a threshold.
- The webhook is an untrusted notification: store with `UNIQUE(provider, provider_event_id)`, return 200 fast, then the worker re-queries the provider and checks amount, currency and sub-account before any transition. Out-of-order events cannot regress a status.
- Hosted checkout only — no card data, CVV, OTPs or wallet PINs ever reach CourtKo; stored payloads are redacted.
- Provider keys only in the API and worker task roles via Secrets Manager; outbound egress restricted to provider endpoints where feasible.
- The mock adapter cannot run in staging or production (startup guard plus build flag).

**Tests**

| Test | Type | Proves |
|---|---|---|
| `packages/payments/test/xendit/webhook-verify.test.ts` | Unit | Token check, constant-time comparison |
| `packages/payments/test/xendit/mapper.test.ts` | Unit | Provider statuses map to the canonical payment catalog |
| `apps/api/test/webhooks/duplicate.test.ts` | Payment webhook | Duplicate event → no second state change, journal or notification |
| `apps/api/test/webhooks/invalid-token.test.ts` | Payment webhook | Rejected and recorded; nothing processed |
| `apps/api/test/webhooks/out-of-order.test.ts` | Payment webhook | Re-query wins; no status regression |
| `apps/api/test/integration/payments/late-payment.test.ts` | Integration | Recovery within grace; full refund when slot taken or after grace |
| `apps/api/test/integration/payments/provider-unavailable.test.ts` | Integration | `PROVIDER_UNAVAILABLE`, hold preserved |
| `apps/api/test/integration/payments/capture-confirm-failure.test.ts` | Integration | Capture succeeds but confirmation fails → retried → confirmed or refunded; no lost money |
| `apps/api/test/integration/refunds/partial-refund.test.ts` | Refund | Partial refund lifecycle to `partially_refunded` |
| `packages/payments/test/contract/xendit-sandbox.test.ts` | Contract (nightly, needs test key) | Real sandbox behavior matches the adapter |

**How to run locally**
```bash
pnpm dev --filter api
pnpm dev --filter worker
pnpm payments:replay packages/payments/test/fixtures/xendit/payment-succeeded.json
# For live sandbox webhooks, expose the local API over HTTPS with a tunnel (tool: PLACEHOLDER)
# or use the staging environment, which has a public webhook URL.
```

**How to validate**
1. Sandbox payment → webhook → re-query → booking `confirmed`; replaying the same webhook changes nothing.
2. A webhook with a wrong token is rejected and appears in `/admin/security`.
3. Kill the worker mid-processing → the job retries and the booking is confirmed exactly once.
4. A partial refund reaches `succeeded` and the booking becomes `partially_refunded`.

**Provider-dependent assumptions (PLACEHOLDER).** Exact API resources and versions (payment sessions vs payment requests vs invoices); channel codes for QR Ph, GCash, Maya and cards; control of session expiry to match the 10-minute hold; split-rule creation per payment or per business; `for-user-id` behavior; refund support per channel (partial refunds, QR Ph); webhook event catalog, retries and source IPs; sandbox coverage per channel.

## Step 9 — Commission and ledger

**Goal.** Append-only double-entry ledger, commission agreements with maker-checker, posting rules for captures, fees, refunds, payouts and adjustments, daily settlement statements, payout tracking and daily reconciliation.

**Files created/changed**
- `packages/domain/src/ledger/{accounts.ts,journal.ts,posting-rules.ts,balance.ts}`, `packages/domain/src/commission/{resolve-agreement.ts,compute.ts}`, `packages/domain/src/settlement/{statement.ts,netting.ts}`
- `packages/core/src/ledger/{post-capture.ts,post-provider-fee.ts,post-refund.ts,post-payout.ts,post-adjustment.ts}`, `packages/core/src/commission/{propose-agreement.ts,approve-agreement.ts}`, `packages/core/src/approvals/{request.ts,decide.ts}`, `packages/core/src/reconciliation/{run-daily.ts,match.ts,resolve-exception.ts}`
- `apps/worker/src/jobs/{settlements.generate.ts,payouts.sync.ts}` and the daily mode of `payments.reconcile.ts`
- `apps/api/src/routes/v1/admin/{commission-agreements,approvals,ledger,reconciliation}.ts`, `apps/api/src/routes/v1/businesses/[businessId]/{settlements,payouts}.ts`
- `apps/business/app/(portal)/payouts/*`, `apps/admin/app/(console)/{transactions,commissions}/*`

**Database migration** — `packages/db/migrations/0009_ledger.sql`
- `ledger_accounts` (the canonical accounts: `platform:provider_clearing`, `platform:commission_revenue`, `platform:gateway_fee_recovery`, `platform:gateway_fee_expense`, `platform:gateway_fee_variance`, `platform:promotions_expense`, `platform:chargeback_losses`, `platform:adjustments`, `platform:withholding_tax_payable`, `venue:{business_id}:payable`).
- `ledger_journals` (journal_type, reference, business_id, currency, posted_at, effective_date in Manila time, reverses_journal_id, created_by, correlation_id).
- `financial_ledger_entries` (journal_id, account_code, business_id, direction debit|credit, `amount_centavos bigint CHECK (amount_centavos > 0)`, entry_type from the canonical list, currency) with a `DEFERRABLE INITIALLY DEFERRED` constraint trigger that rejects unbalanced journals at commit, and an append-only trigger.
- `commission_agreements` (business_id, `rate_ppm CHECK (rate_ppm BETWEEN 0 AND 1000000)`, commissionable_items, fee_bearer, settlement_model, effective range, status draft|pending_approval|approved|active|superseded|rejected, contract file, reason, maker, checker; exclusion constraint preventing overlapping approved ranges per business).
- `commissions` (booking or payment, commissionable_base, rate_ppm, amount, agreement_id), `approval_requests` (kind, payload, status, maker, checker; `CHECK (maker_user_id <> checker_user_id)`).
- `settlements` (business_id, statement_date, status provisional|final, totals), `settlement_lines`, `payouts` (`provider_payout_id` UNIQUE, amount, currency, status `payout_status`, scheduled_for, paid_at, failure_code).
- `reconciliation_runs` (run_date, kind pending|daily, status, stats), `reconciliation_items` (item_type, internal and provider refs and amounts, status open|auto_resolved|resolved, resolution_note, resolved_by).
- Seed `platform_settings`: `commission.default_rate_ppm = 50000`.

**Environment variables**

| Name | Purpose | Example | |
|---|---|---|---|
| `SETTLEMENTS_CRON` | Daily statements (UTC; = 03:00 Manila) | `0 19 * * *` | |
| `RECONCILE_DAILY_CRON` | Daily full reconciliation (UTC; = 04:00 Manila) | `0 20 * * *` | |
| `S3_BUCKET_REPORTS` | Statement PDFs and CSVs | `courtko-local-reports` | |

The default commission rate lives in `platform_settings`, never in an environment variable.

**Security considerations**
- No UPDATE or DELETE grants on ledger tables for `courtko_app`; triggers enforce append-only; corrections are reversing journals.
- Maker ≠ checker enforced in the service and by a database CHECK; approvals require MFA step-up; agreement changes and adjustments are audited.
- All arithmetic in integer centavos and ppm with BigInt intermediates; rounding once per component.
- Reports and reconciliation read from the replica through a read-only role.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `packages/domain/test/ledger/canonical-example.test.ts` | Unit | ₱400 / ₱15 / ₱415 / ₱20 / ₱380 capture journal matches the brief and balances |
| `packages/domain/test/ledger/refund-reversal.test.ts` | Unit | 50% refund: refund 20,000, commission reversal 1,000, venue −19,000 |
| `packages/domain/test/ledger/platform-funded-discount.test.ts` | Unit | Discount booked to `platform:promotions_expense`; venue unaffected |
| `packages/domain/test/commission/rounding.test.ts` | Unit | 12,345 → 617 and 12,350 → 618 at 50,000 ppm |
| `packages/domain/test/ledger/properties.test.ts` | Property | Random bookings and refunds: every journal balances; Σ venue payable = Σ venue net |
| `packages/db/test/ledger-integrity.test.ts` | Integration | Unbalanced journal fails at commit; UPDATE rejected |
| `apps/api/test/integration/commission/maker-checker.test.ts` | Integration | Self-approval → `APPROVAL_REQUIRED`; second approver succeeds |
| `apps/api/test/integration/commission/agreement-snapshot.test.ts` | Integration | Confirmed bookings keep their snapshotted rate |
| `apps/api/test/integration/refund-after-payout.test.ts` | Refund / payout reconciliation | Venue payable goes negative and nets on the next statement |
| `apps/worker/test/reconciliation/daily.test.ts` | Payout reconciliation | Fixtures produce missing-webhook, fee-variance and amount-mismatch exceptions |

**How to run locally**
```bash
pnpm dev --filter api
pnpm dev --filter worker
pnpm dev --filter business
pnpm dev --filter admin
pnpm worker:run settlements.generate --date 2026-10-03     # manual trigger locally
```

**How to validate**
1. After synthetic bookings, the Oct 3 statement for Pasig Pickle Hub matches doc 16 §16 line by line (venue net ₱1,305.00).
2. A commission change drafted by one admin cannot be approved by the same admin; a second admin approves with MFA.
3. The reconciliation fixture run produces exactly three exceptions of the expected types.

**Provider-dependent assumptions (PLACEHOLDER).** Split-rule semantics for commission and fee recovery; how refunds and commission reversals are funded under `provider_split` (netting against future splits or platform-to-sub-account transfers); transfer capability for platform-funded discounts; transaction/report API for reconciliation; payout API for sub-accounts; settlement timing per channel.

## Step 10 — Business operations portal

**Goal.** The day-to-day portal: overview with exceptions, calendar, bookings, check-in, no-shows, walk-ins, court-block conflicts, customers, restrictions, staff and roles, payments view and settings.

**Files created/changed**
- `apps/business/app/(portal)/{page.tsx,calendar,bookings,walk-in,customers,restrictions,staff,payments,settings}/*`
- `packages/core/src/ops/{check-in.ts,mark-no-show.ts,create-walk-in.ts,venue-cancel.ts,move-booking.ts,recheck-payment.ts,overview.ts}`
- `packages/core/src/restrictions/{create.ts,lift.ts,appeal.ts,expire.ts}`
- `apps/api/src/routes/v1/businesses/[businessId]/{overview,bookings,check-ins,walk-ins,restrictions,customers}.ts`
- `apps/worker/src/jobs/restrictions.expire.ts`
- `packages/ui/src/components/{ResourceCalendar,Scanner,ConflictDialog,PermissionMatrix}.tsx`

**Database migration** — `packages/db/migrations/0010_business_ops.sql`
- `booking_check_ins` (booking_id UNIQUE, method qr|code|manual, checked_in_by, at).
- `venue_user_restrictions` (scope platform|business|venue, business_id NULL only for platform scope, venue_id, user_id, reason_category, starts_at, ends_at, is_permanent, status `active|lifted|expired`, created_by, approved_by, evidence_ref, appeal_status `none|submitted|upheld|overturned`).
- `restriction_notes` (separate table so internal notes are selected only for `restrictions.manage`), `restriction_events` (history).
- View `business_customers_v` (per-business customer list derived from bookings, without contact fields).

**Environment variables.** None new. Check-in window, no-show grace and similar defaults are venue settings in the database.

**Security considerations**
- Check-in verifies the QR signature, venue scope and window; repeated scans are idempotent and show who checked in.
- Contact fields are omitted by the API serializer without `customers.view_contact`; walk-in contact entry never reveals an existing customer's details.
- Restriction notes only with `restrictions.manage`; no-show, venue cancellation, restriction and role changes are audited.
- The block-conflict apply is a single transaction; venue-initiated cancellations always refund in full including the fee.
- Staff can re-check payment status but never set a payment to paid.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `apps/api/test/authz/receptionist-matrix.test.ts` | Authorization | Allowed and forbidden actions for the receptionist template (e.g. refund → 403) |
| `apps/api/test/integration/ops/check-in-window.test.ts` | Integration | Before window rejected; idempotent re-scan |
| `apps/api/test/integration/ops/no-show-grace.test.ts` | Integration | No-show only after start + 15 min |
| `apps/api/test/integration/ops/walk-in.test.ts` | Integration | Same pricing, restriction and payment verification as online |
| `apps/api/test/integration/ops/block-conflict-apply.test.ts` | Integration | Moves, cancellations and block insert succeed or fail together |
| `apps/api/test/integration/restrictions/effects.test.ts` | Integration | Neutral error; notes hidden; other businesses unaffected |
| `tests/e2e/business/receptionist-shift.spec.ts`, `tests/e2e/business/block-conflict.spec.ts` | E2E | Journeys J6 and J7 |

**How to run locally**
```bash
pnpm db:seed --profile synthetic --with-bookings
pnpm dev --filter api
pnpm dev --filter worker
pnpm dev --filter business
pnpm dev --filter web
```

**How to validate**
1. Sign in as the synthetic receptionist; scan the QR shown in the player app → `checked_in`; scan again → "Already checked in at … by …".
2. Refund actions are absent; calling the refund endpoint directly returns 403.
3. Block a court with bookings → conflict dialog → apply → players notified; refunds visible in Payments.
4. Restrict a synthetic player → their booking attempt shows the neutral message.

**Provider-dependent assumptions (PLACEHOLDER).** Payment-link or dynamic QR Ph support for walk-ins; SMS delivery of payment links, which Philippine telcos may block when SMS contain clickable links (doc 23 D-22) — the on-screen QR is the default.

## Step 11 — Player dashboard

**Goal.** Player home, bookings, activity and stats, favorites, reviews, content reports, profile and settings (security, privacy, notifications), payments history, data export and account deletion.

**Files created/changed**
- `apps/web/app/(player)/app/{page.tsx,activity,favorites,profile,settings,payments}/*`
- `packages/core/src/player/{activity-stats.ts,favorites.ts,reviews.ts,content-reports.ts,ratings.ts}`
- `packages/core/src/privacy/{request-export.ts,build-export.ts,request-deletion.ts,execute-erasure.ts}`
- `apps/api/src/routes/v1/me/{activity,favorites,reviews,reports,privacy-requests,profile,sessions}.ts`
- `apps/worker/src/jobs/{privacy.export.ts,privacy.erase.ts}`

**Database migration** — `packages/db/migrations/0011_player.sql`
- `user_favorites` (user_id, venue_id; PK both).
- `reviews` (business_id, venue_id, `booking_id` UNIQUE, user_id, `rating CHECK (rating BETWEEN 1 AND 5)`, body, status published|hidden|removed, reply_body, replied_by).
- `reports` (content reports: reporter, target_type, target_id, reason, details, status, handled_by).
- `player_ratings` (user_id, source `self_declared|venue_verified|external|platform_recreational`, value, level_label, verified_by_business_id, visibility) and `rating_history`.
- `privacy_requests` (user_id, type export|erasure, status, requested_at, grace_until, completed_at, artifact_key, artifact_expires_at, handled_by).
- `player_activity_daily` (projection: sessions, minutes, spend by payment date, venues).

**Environment variables**

| Name | Purpose | Example | |
|---|---|---|---|
| `S3_BUCKET_PRIVACY_EXPORTS` | Encrypted export archives | `courtko-local-privacy-exports` | |

Export availability (7 days) and deletion grace (14 days) are platform settings under compliance control.

**Security considerations**
- Review eligibility enforced on the server (completed booking, one per booking); content reports rate-limited.
- Export and deletion require re-authentication (and MFA if enabled); each download mints a 60-second presigned URL for the requesting account only; requests and downloads audited.
- Erasure is idempotent: personal fields erased or pseudonymized; ledger, payment and audit records retained under a pseudonymous reference per doc 15.
- Stat visibility enforced by the API; rating source always returned with the value.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `apps/api/test/integration/reviews/eligibility.test.ts` | Integration | Only completed bookings; one review each |
| `apps/api/test/integration/privacy/export.test.ts` | Integration | Archive contents, masking, link restrictions, audit |
| `apps/api/test/integration/privacy/erasure.test.ts` | Integration | Blockers respected; after grace PII is gone, financial records remain, sign-in impossible |
| `packages/core/test/player/activity-stats.test.ts` | Unit | Sessions by play date, spend by payment date |
| `tests/e2e/player/activity-and-privacy.spec.ts` | E2E + axe | Journey J13 and dashboard accessibility |

**How to run locally**
```bash
pnpm dev --filter api
pnpm dev --filter worker
pnpm dev --filter web
```

**How to validate**
1. Complete a synthetic booking (fake clock plus `bookings.complete`) → "Write a review" appears.
2. Request an export → notification → download works once per click and only when signed in.
3. Request deletion with an upcoming booking → blocked with the reason; without blockers → grace period starts and sessions are revoked.

**Provider-dependent assumptions.** None at MVP. External ratings (Phase 2) only through an official partner API with the player's authorization.

## Step 12 — Events

**Goal.** Event creation and publishing, court reservations, divisions, registrations with seat holds and payment, capacity enforcement, waitlist with time-limited offers, withdrawals, event cancellation, announcements and event check-in.

**Files created/changed**
- `packages/domain/src/events/{registration-state-machine.ts,capacity.ts,waitlist.ts}`
- `packages/core/src/events/{create-event.ts,publish.ts,register.ts,withdraw.ts,offer-next.ts,expire-offers.ts,announce.ts,check-in.ts,cancel-event.ts}`
- `apps/api/src/routes/v1/public/events.ts`, `apps/api/src/routes/v1/me/event-registrations.ts`, `apps/api/src/routes/v1/businesses/[businessId]/events/*`
- `apps/worker/src/jobs/events.waitlist_offers.expire.ts`
- `apps/web/app/(public)/events/*`, `apps/web/app/(player)/app/events/*`, `apps/business/app/(portal)/events/*`

**Database migration** — `packages/db/migrations/0012_events.sql`
- `events` (type, name, description, venue, schedule, capacity, fee, currency, registration window, waitlist_enabled, `offer_window_minutes` default 120, visibility public|unlisted|private, status draft|published|unpublished|cancelled, policy_version_id, organizer_member_id, rules, match_format, prizes_text, skill range, age_category).
- `event_courts` (event_id, court_id, slot_id in `booking_slots` with source_type `event`).
- `event_divisions` (name, capacity, format singles|doubles|mixed, skill range).
- `event_registrations` (division, user, status with the nine canonical values, partner_name, seat_hold_expires_at, offer_expires_at, payment_id; partial unique index preventing duplicate active registrations per user and division).
- `event_waitlists` (division, user, position, status); `teams`, `team_members`, `matches` (minimal, feature-flagged for Phase 2).

**Environment variables.** None new; the offer window is an event setting.

**Security considerations**
- Registration checks restrictions like bookings; capacity enforced inside a transaction holding a lock on the division row, counting held, pending, offered, confirmed and checked-in seats.
- Announcements go through CourtKo notifications only (rate-limited); organizers never receive contact exports; private events are never listed.
- `event_manager` has no finance access; event QR tokens use the same signing as bookings.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `packages/domain/test/events/registration-state-machine.test.ts` | Unit | Allowed transitions only |
| `apps/api/test/concurrency/event-capacity.test.ts` | Concurrency | 30 concurrent registrations for 16 seats → exactly 16 seats held |
| `apps/api/test/integration/events/waitlist-offer.test.ts` | Integration | Offer on withdrawal; expiry cascades to the next person |
| `apps/api/test/integration/events/capacity-during-payment.test.ts` | Integration | Late payment after seat-hold expiry → re-acquire or full refund |
| `apps/api/test/integration/events/event-cancellation-refunds.test.ts` | Refund | Venue cancellation refunds all registrations in full |
| `tests/e2e/events/open-play-waitlist.spec.ts` | E2E | Journey J8 |

**How to run locally**
```bash
pnpm dev --filter api
pnpm dev --filter worker
pnpm dev --filter web
pnpm dev --filter business
```

**How to validate**
1. Create "Friday Night Open Play — Intermediate" (capacity 16, ₱250.00) → publish → visible on `/events`.
2. Fill it with synthetic players → the next player sees "Join waitlist" and position 1.
3. Withdraw one player → the waitlisted player gets an offer with a deadline; let it expire (fake clock) → the next person is offered.

**Provider-dependent assumptions.** Payments as in step 8; no event-specific provider needs.

## Step 13 — Products

**Goal.** Product catalog with variants and stock, add-ons during booking and event checkout, standalone pickup orders, fulfilment queue and claim by QR or code with double-claim prevention.

**Files created/changed**
- `packages/domain/src/products/{order-state-machine.ts,stock.ts}`
- `packages/core/src/products/{manage-products.ts,adjust-stock.ts,reserve-stock.ts,release-stock.ts,fulfil-order.ts,claim.ts,cancel-item.ts}`
- `apps/api/src/routes/v1/businesses/[businessId]/{products,inventory,orders,pickup-claims}.ts`, `apps/api/src/routes/v1/me/orders.ts`
- `apps/business/app/(portal)/{products,orders}/*`, `apps/web/app/(player)/app/orders/*`

**Database migration** — `packages/db/migrations/0013_products_orders.sql`
- `products` (venue, name, description, category, price_centavos, tax configuration, max_qty_per_order, availability schedule, pickup instructions, active).
- `product_variants` (name, sku, price_delta_centavos, `stock_qty CHECK (stock_qty >= 0)`, stock_status).
- `inventory_movements` (variant, qty_delta, reason reservation|release|sale|adjustment|return, reference, actor, at) — append-only.
- `orders` (user, venue, booking_id or event_registration_id, status with the eight canonical values, `claim_code` UNIQUE, pickup_by, totals, currency), `order_items` (variant, qty, unit price, status, refunded_qty).
- `pickup_claims` (`order_id` UNIQUE, claimed_by_staff, method qr|code, at) — the uniqueness that makes double claims impossible.

**Environment variables.** None new.

**Security considerations**
- Stock reserved and released in the same transactions as checkout creation and expiry; `OUT_OF_STOCK` before payment.
- Claim codes are random; claim QR tokens are signed; the unique constraint on `pickup_claims.order_id` prevents double claims even under concurrent scans.
- `orders.fulfill` for queue actions; stock adjustments need `inventory.manage` and are audited; images follow the media pipeline.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `apps/api/test/concurrency/stock-reservation.test.ts` | Concurrency | Last unit, two buyers → one `OUT_OF_STOCK` |
| `apps/api/test/integration/products/double-claim.test.ts` | Integration | Second claim → `CONFLICT` with who and when; one claim row |
| `apps/api/test/integration/products/partial-item-refund.test.ts` | Refund | One item of a combined order refunded; order `partially_refunded` |
| `apps/api/test/integration/products/unfulfillable-after-payment.test.ts` | Refund | Venue cancels an item → item and proportional fee share refunded |
| `tests/e2e/products/add-on-pickup.spec.ts` | E2E | Journey J9 |

**How to run locally**
```bash
pnpm dev --filter api
pnpm dev --filter worker
pnpm dev --filter web
pnpm dev --filter business
```

**How to validate**
1. Add Paddle rental ×2 and Bottled water ×2 to a booking → pay → order `paid` in `/biz/orders`.
2. Mark preparing → ready → the player is notified → scan the claim QR → `claimed`; scan again → "Already claimed at … by …".

**Provider-dependent assumptions.** Payments as in step 8.

## Step 14 — SuperAdmin portal

**Goal.** The control center: overview, businesses and verification, venues, users, cross-tenant bookings/events/products, transactions and reconciliation, commissions, payouts, refunds, disputes, reports, moderation, support mode, security, audit and platform configuration.

**Files created/changed**
- `apps/admin/app/(console)/{page.tsx,businesses,venues,users,bookings,events,products,transactions,commissions,payouts,refunds,disputes,reports,moderation,support,security,audit,config}/*`
- `apps/admin/middleware.ts` (MFA-verified session required on every request; `SameSite=Strict` cookie)
- `packages/core/src/admin/{moderation.ts,platform-restrictions.ts,config.ts,refund-approvals.ts}`, `packages/core/src/support/{start-session.ts,end-session.ts,guard.ts}`
- `apps/api/src/plugins/support-mode.ts`, `apps/api/src/routes/v1/admin/*`

**Database migration** — `packages/db/migrations/0014_platform_admin.sql`
- `support_cases` (reference `SUP-####` UNIQUE, requester, subject, status, assignee).
- `support_sessions` (agent_user_id, subject_user_id, `reason CHECK (char_length(reason) >= 15)`, ticket_ref NOT NULL, started_at, `expires_at CHECK (expires_at <= started_at + interval '30 minutes')`, ended_at, mode `read_only`).
- `moderation_actions` (report_id, action, actor, notes), `platform_content` (key, locale, body, version, published_at) for policy and help texts managed in the console.

**Environment variables**

| Name | Purpose | Example | |
|---|---|---|---|
| `ADMIN_SESSION_IDLE_MINUTES` | Admin idle timeout (from step 2) | `15` | |

The admin IP allowlist is a Terraform variable on the WAF (step 19), not an application variable. The 30-minute support-session limit is enforced in code and by the database CHECK.

**Security considerations**
- Admin host behind the WAF IP allowlist; MFA mandatory per session; step-up MFA for refund approvals, commission approvals, suspensions and configuration changes with financial effect (fee schedules, pass-through toggles go through maker-checker).
- Support mode: reason (≥ 15 characters) and ticket required; read-only enforced by the API plugin (non-GET requests and sensitive GETs — credentials, MFA, payout accounts, exports — return `SUPPORT_MODE_READ_ONLY`); every request audited with both actor and subject; platform staff accounts cannot be impersonated; the user is notified after the session.
- Cross-tenant reads only with the platform permission for that area; exports require `platform.reports.export` and are audited.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `apps/api/test/admin/mfa-enforced.test.ts` | Security | No admin route works without an MFA-verified session |
| `apps/api/test/admin/support-mode-read-only.test.ts` | Security | Every write returns `SUPPORT_MODE_READ_ONLY` |
| `apps/api/test/admin/support-mode-blocked-areas.test.ts` | Security | Credentials, MFA, payout accounts, exports, refunds, deletion blocked |
| `apps/api/test/admin/support-mode-expiry-audit.test.ts` | Security | Session ends at 30 min; each request audited with actor and subject |
| `apps/api/test/admin/platform-permission-matrix.test.ts` | Authorization | Each platform role sees exactly its routes (doc 05 §9.2) |
| `tests/e2e/admin/{verification-approval,maker-checker,support-session}.spec.ts` | E2E | Journeys J11 and J12 |

**How to run locally**
```bash
pnpm db:seed --profile synthetic      # includes synthetic platform staff for each platform role
pnpm dev --filter api
pnpm dev --filter admin
pnpm dev --filter web
```

**How to validate**
1. Sign in as synthetic `platform_support` → only Overview, Users, Bookings and Support are visible.
2. Start a support session with a short reason → rejected; with a valid reason and ticket → banner appears; cancelling a booking → "Not available in support mode".
3. Draft a commission change as `platform_finance`; approve as the same user → blocked; approve as `superadmin` with MFA → approved.

**Provider-dependent assumptions.** None beyond earlier steps.

## Step 15 — Notifications

**Goal.** Templates and channel delivery for every notification event in doc 01 NTF-02, preferences, reminders, idempotent delivery with retries and dead-lettering.

**Files created/changed**
- `packages/notifications/src/templates/*.ts` (email, SMS, in-app per event; en-PH), `packages/notifications/src/{render.ts,preferences.ts}`
- `packages/notifications/src/channels/{ses.ts,smtp-dev.ts,sms-aggregator.ts,sms-console.ts,in-app.ts,web-push.ts}` (Web Push behind a Phase 2 flag)
- `packages/core/src/notifications/{plan-notifications.ts,record-delivery.ts}`
- `apps/worker/src/jobs/{notifications.deliver.ts,bookings.remind.ts}`
- `apps/api/src/routes/v1/me/{notifications,notification-preferences}.ts`, `apps/web/app/(player)/app/notifications/page.tsx`

**Database migration** — `packages/db/migrations/0015_notifications.sql`
- `notifications` (user_id, category, title, body, deep_link, read_at, source_event_id).
- `notification_preferences` (user_id, category, channel, enabled) — mandatory categories cannot be disabled.
- `notification_deliveries` (notification_id, channel, provider_message_id, status queued|sent|delivered|failed, attempts, last_error, `idempotency_key` UNIQUE).
- `push_subscriptions` (Phase 2).

**Environment variables**

| Name | Purpose | Example | |
|---|---|---|---|
| `EMAIL_FROM`, `SES_CONFIGURATION_SET` | Sender and SES event tracking | `no-reply@courtko.ph` (PLACEHOLDER), `courtko-transactional` | |
| `SMS_PROVIDER`, `SMS_API_BASE_URL`, `SMS_API_KEY`, `SMS_SENDER_ID` | PH SMS aggregator | PLACEHOLDER | [secret] key |
| `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` | Web Push (Phase 2) | PLACEHOLDER | [secret] private key |

**Security considerations**
- Templates escape all variables; SMS and push bodies carry no payment details beyond the total and no personal data of other people; SMS templates contain no clickable links (doc 23 D-22); email and push links point to signed-in pages.
- Transactional and security messages always sent; marketing requires opt-in and has one-click opt-out.
- SES bounces and complaints suppress addresses; OTP sends rate-limited; delivery logs redact phone numbers and emails.
- Delivery is idempotent per event, recipient and channel; failures retry with backoff and dead-letter with an alert.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `packages/notifications/test/templates.test.ts` | Unit | Every template renders with all variables; SMS length and segment count within limits |
| `packages/notifications/test/preferences.test.ts` | Unit | Mandatory categories cannot be disabled |
| `apps/worker/test/notifications/idempotent-delivery.test.ts` | Integration | Replayed outbox events send once per channel |
| `apps/worker/test/notifications/retry-dead-letter.test.ts` | Integration | Backoff, dead-letter and alert |
| `apps/worker/test/bookings/remind.test.ts` | Integration | 24 h and 2 h reminders in venue time |

**How to run locally**
```bash
pnpm dev --filter api
pnpm dev --filter worker
pnpm dev --filter web
# Email in Mailpit (http://localhost:8025); SMS printed by the console adapter
```

**How to validate**
1. Confirm a booking → in-app and email confirmation (Mailpit) and an SMS line in the worker log.
2. Turn off marketing emails → promotional template suppressed; booking confirmations still sent.
3. Set a reminder test booking 24 h ahead (fake clock) → exactly one reminder per channel.

**Provider-dependent assumptions (PLACEHOLDER).** SMS aggregator API, registered sender ID, delivery-report webhooks and pricing; SES production access and domain verification; Web Push (Phase 2).

## Step 16 — Reporting

**Goal.** Platform, business and player reports from doc 01 RPT, each with an explicit date basis, asynchronous exports and reconciliation to the ledger.

**Files created/changed**
- `packages/core/src/reports/definitions/*.ts` (one definition per report with allowed date bases), `packages/core/src/reports/{run-report.ts,export-csv.ts,export-pdf.ts}`
- `packages/db/src/reporting/*.sql` (fact views and materialized views)
- `apps/worker/src/jobs/reports.generate.ts`
- `apps/api/src/routes/v1/businesses/[businessId]/reports.ts`, `apps/api/src/routes/v1/admin/reports.ts`
- `apps/business/app/(portal)/reports/*`, `apps/admin/app/(console)/reports/*`

**Database migration** — `packages/db/migrations/0016_reporting.sql`
- `report_runs` (scope, business_id, report_key, params including `date_basis`, status, requested_by, file_key, expires_at, row_count).
- Fact views `fact_bookings` (booking date, play date, payment date, refund date as separate columns), `fact_payments`, `fact_ledger_daily`; materialized `mv_business_daily_metrics` and `mv_platform_daily_metrics` refreshed by `reports.generate`.
- Indexes on each date column used as a basis.

**Environment variables**

| Name | Purpose | Example | |
|---|---|---|---|
| `REPORTING_DATABASE_URL` | Read-replica connection (read-only role, RLS applies) | `postgres://courtko_reporting:***@localhost:5432/courtko` | [secret] |
| `S3_BUCKET_REPORTS`, `REPORT_DOWNLOAD_URL_TTL_SECONDS` | Export storage and link lifetime | `courtko-local-reports`, `60` | |

**Security considerations**
- `reports.view` / `reports.export` and `platform.reports.view` / `platform.reports.export` enforced; financial reports also need `finance.view_summary`.
- Exports audited (actor, parameters, row count); CSV-injection neutralization (cells starting with `=`, `+`, `-`, `@`, tab or carriage return are prefixed); contact columns only with `customers.view_contact`.
- Reporting role is read-only on the replica with the same RLS policies.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `packages/core/test/reports/date-basis.test.ts` | Unit | A booking paid Oct 3 for play Oct 9 lands in the right bucket for each basis; bases never mix |
| `packages/core/test/reports/csv-injection.test.ts` | Security | Dangerous leading characters neutralized |
| `apps/api/test/integration/reports/export-audited.test.ts` | Integration | Export requires permission and writes an audit entry |
| `apps/api/test/integration/reports/tenant-isolation.test.ts` | Tenant isolation | Business reports never include other tenants |
| `apps/api/test/integration/reports/reconcile-to-ledger.test.ts` | Integration | Commission, fees and venue net totals equal ledger sums |

**How to run locally**
```bash
pnpm dev --filter api
pnpm dev --filter worker
pnpm dev --filter business
pnpm dev --filter admin
```

**How to validate**
1. Business Reports → Revenue by payment date for Oct 1–7 equals the sum of the daily statements.
2. Switching the basis to play date changes the bucket of a booking paid Oct 3 for Oct 9, and the header states the basis.
3. Export CSV → file downloads; the audit log shows the export.

**Provider-dependent assumptions.** Settlement-date reports depend on provider settlement data (PLACEHOLDER).

## Step 17 — Audit and security controls

**Goal.** Raise audit and security to launch grade: hash-chained audit log with daily anchors, retention enforcement, consent records, security alerting, tuned rate limits, strict CSP with reporting and access reviews.

**Files created/changed**
- `packages/core/src/audit/{hash-chain.ts,verify-chain.ts}`, `packages/observability/src/security-events.ts`
- `apps/worker/src/jobs/{audit.archive.ts,retention.enforce.ts,security.alerts.ts}`
- `apps/api/src/plugins/{rate-limit.ts,csp-report.ts}`, `apps/api/src/routes/v1/admin/{audit,security}.ts`, `apps/api/src/routes/v1/businesses/[businessId]/audit.ts`
- `apps/admin/app/(console)/{audit,security}/*`, `apps/business/app/(portal)/audit/*` (verification UI, doc 16 §22)

**Database migration** — `packages/db/migrations/0017_audit_security.sql`
- Add `prev_hash` and `hash` to `audit_logs` with UNIQUE(`chain_id`, `seq`) (`chain_id` = `platform` or `business:{id}`); function `app.append_audit(...)` computing `hash = SHA-256(prev_hash ‖ canonical_json(record))`, serialized per chain through a chain-head row lock (doc 14 §10.3).
- `audit_chain_heads` (chain_id PK, last_seq, last_hash) and `audit_archive_manifests` (chain_id, archive_date, record_count, head_seq, head_hash, file_sha256, signature, object_key).
- `retention_policies` (data_class, table_name, retention_days, action erase|pseudonymize|archive, legal_basis) seeded from doc 15; `consents` (user_id, purpose, version, granted_at, withdrawn_at); `access_reviews` (reviewer, scope, completed_at, findings).

**Environment variables**

| Name | Purpose | Example | |
|---|---|---|---|
| `S3_BUCKET_AUDIT_ARCHIVE` | Object Lock (compliance mode) archive | `courtko-local-audit-archive` | |
| `AUDIT_MANIFEST_SIGNING_KEY_ID` | KMS asymmetric key that signs daily manifests | `alias/courtko-audit-manifest` | |
| `AUDIT_ARCHIVE_CRON`, `RETENTION_ENFORCE_CRON` | Daily jobs (UTC) | `0 19 * * *`, `30 19 * * *` | |
| `SECURITY_ALERTS_TOPIC_ARN` | SNS topic for security alerts | `arn:aws:sns:ap-southeast-1:000000000000:courtko-security` (placeholder) | |
| `CSP_REPORT_URI` | CSP violation reports | `/v1/csp-reports` | |

**Security considerations**
- Audit rows are append-only for application roles and chained per `chain_id`; `audit.archive` writes each day's records as JSONL with a KMS-signed manifest to S3 Object Lock; a daily verification job recomputes the chains, and any mismatch is a SEV1 security alert (doc 14 §10.3).
- Alerts: brute-force patterns, spikes in cross-tenant 404s, webhook token failures, exclusion-constraint violations (double-booking attempts), admin actions outside normal hours, support sessions, payout failures.
- Retention job supports dry-run, logs every action, never deletes ledger, payment or audit records before their legal retention period.
- Quarterly access reviews; CSP violations monitored; rate limits per route class (auth, holds, search, webhooks).

**Tests**

| Test | Type | Proves |
|---|---|---|
| `packages/db/test/audit/append-only.test.ts` | Security | UPDATE/DELETE by the app role fail |
| `packages/core/test/audit/hash-chain.test.ts` | Unit | Tampering and gaps detected |
| `apps/worker/test/audit/archive.test.ts` | Integration | Daily manifest written, signed and matching the chain heads |
| `apps/worker/test/retention/enforce.test.ts` | Integration | Dry-run vs execute; financial records retained |
| `apps/api/test/security/rate-limits.test.ts` | Security | Limits and `RateLimit-*` / `Retry-After` headers |
| `apps/api/test/security/headers.test.ts` | Security | CSP, HSTS, cookie attributes on every surface |

**How to run locally**
```bash
pnpm db:migrate
pnpm dev --filter api
pnpm dev --filter worker
pnpm dev --filter admin
pnpm worker:run audit.archive --date 2026-10-03
```

**How to validate**
1. Audit Logs → "Verify integrity" for Oct 1–3 → "Chain intact" with the anchored head hash.
2. In a disposable local database, alter one audit row as the owner role → verification reports the break and an alert fires.
3. Run `retention.enforce --dry-run` → report lists candidate records; no ledger rows included.

**Provider-dependent assumptions.** None (AWS services only).

## Step 18 — Automated tests

**Goal.** Consolidate the test pyramid and CI gates: the brief's critical scenarios, full end-to-end journeys with accessibility checks, load tests, security scans and the disaster-recovery drill.

**Files created/changed**
- `tests/e2e/journeys/j01…j13.spec.ts` (doc 04), `tests/e2e/a11y/critical-routes.spec.ts` (axe on every route in doc 06)
- `tests/load/k6/{search.js,availability.js,booking-race.js,checkout-webhook.js,business-calendar.js}`
- `tests/security/zap/{baseline.conf,api-scan.yaml}`
- `tests/dr/restore-drill.sh` (scripted restore into a scratch environment)
- `tests/fixtures/{clock.ts,synthetic-dataset.ts}`, `packages/db/seeds/synthetic/*`
- `.github/workflows/{ci.yml,nightly.yml,release.yml}`

**Database migration.** None. Tests use the migrations above plus the deterministic synthetic seed.

**Environment variables**

| Name | Purpose | Example | |
|---|---|---|---|
| `TEST_DATABASE_URL` | Optional override; by default Testcontainers provisions a disposable PostGIS database per run | `postgres://courtko_owner:***@localhost:5433/courtko_test` | [secret] |
| `E2E_WEB_URL`, `E2E_BUSINESS_URL`, `E2E_ADMIN_URL` | End-to-end targets | `https://localhost:3000`, `:3001`, `:3002` | |
| `K6_BASE_URL`, `ZAP_TARGET` | Staging targets only | `https://staging.courtko.ph` (PLACEHOLDER domain) | |
| `XENDIT_TEST_SECRET_KEY` | Nightly sandbox contract tests | PLACEHOLDER | [secret] |

**Tests**

| Suite | Type | Proves |
|---|---|---|
| `tests/e2e/journeys/j01…j13.spec.ts` | E2E | Every doc 04 journey passes against the synthetic dataset |
| `tests/e2e/a11y/critical-routes.spec.ts` | Accessibility | Zero serious or critical axe violations on every doc 06 route |
| `tests/load/k6/*.js` | Load | Doc 22 latency targets at 3× projected launch peak; zero double bookings in `booking-race.js` |
| `tests/security/zap/*` | DAST | No high-severity findings on staging |
| `tests/dr/restore-drill.sh` | DR | Snapshot restore and PITR within doc 21 targets; ledger balances and audit chains verify after restore |

Critical scenarios from the brief mapped to the tests that prove them:

| Scenario | Test |
|---|---|
| Two users, same slot | `apps/api/test/concurrency/same-slot.test.ts`; `tests/load/k6/booking-race.js` |
| Payment succeeds after checkout timeout | `apps/api/test/integration/payments/late-payment.test.ts` |
| Duplicate webhook | `apps/api/test/webhooks/duplicate.test.ts` |
| User banned during checkout | `apps/api/test/integration/booking/restricted-during-checkout.test.ts` |
| Rate change during checkout | `apps/api/test/integration/booking/rate-change-during-checkout.test.ts` |
| Court blocked during checkout | `apps/api/test/integration/booking/court-blocked-during-checkout.test.ts` |
| Refund after payout | `apps/api/test/integration/refund-after-payout.test.ts` |
| Cross-business access attempt | `apps/api/test/authz/tenant-isolation.test.ts`; `packages/db/test/rls/rls-enforced.test.ts` |
| Unauthorized staff refund | `apps/api/test/authz/receptionist-matrix.test.ts` |
| Support impersonation | `apps/api/test/admin/support-mode-*.test.ts`; `tests/e2e/admin/support-session.spec.ts` |
| Product out of stock during checkout | `apps/api/test/concurrency/stock-reservation.test.ts` |
| Event reaches capacity during payment | `apps/api/test/integration/events/capacity-during-payment.test.ts` |
| Dispute after completion | `apps/api/test/integration/payments/dispute-after-completion.test.ts` |
| Provider temporarily unavailable | `apps/api/test/integration/payments/provider-unavailable.test.ts` |

**CI gates.** Every pull request: lint, typecheck, unit, integration (PostGIS service container), authorization and tenant-isolation suites, end-to-end smoke, dependency and secret scans. Nightly: full end-to-end with axe, Xendit sandbox contract tests, ZAP baseline against staging, k6 smoke. Before each release: full k6 load profile against staging. Quarterly: DR restore drill. Coverage targets: `@courtko/domain` ≥ 95% lines and branches, `@courtko/core` ≥ 85%.

**Security considerations.** Tests never touch production data or live credentials; the synthetic dataset is labeled; load and security scans run only against staging using the provider sandbox; flaky tests are quarantined with an owner and a deadline, never silently skipped.

**How to run locally**
```bash
pnpm test
pnpm test:integration
pnpm test:e2e
k6 run -e BASE_URL=https://staging.courtko.ph tests/load/k6/booking-race.js
```

**How to validate**
1. CI shows every gate green on a pull request; nightly results archived as artifacts.
2. k6 results meet the doc 22 targets; the booking race produces zero double bookings.
3. The DR drill restores into a scratch environment within the RTO target and the audit chain verifies.

**Provider-dependent assumptions (PLACEHOLDER).** Sandbox channel coverage and rate limits for contract tests.

## Step 19 — Deployment configuration

**Goal.** Production-grade infrastructure and delivery on AWS `ap-southeast-1`: Terraform modules and environments, container images, CI/CD with GitHub OIDC, migrations as a pre-deploy task, safe rollouts and rollback, backups and DR.

**Files created/changed**
- `infra/terraform/modules/{network,data,compute,edge,security,observability}/*.tf`
- `infra/terraform/envs/{dev,staging,prod}/{main.tf,variables.tf,backend.tf,terraform.tfvars.example}`
- `apps/{web,business,admin,api,worker}/Dockerfile` (multi-stage, non-root, minimal base)
- `.github/workflows/{deploy-dev.yml,deploy-staging.yml,deploy-prod.yml}`
- `infra/scripts/{run-migrations.sh,bootstrap-db-roles.sql}`

**What the modules provision.** VPC across 3 AZs (public subnets for ALBs and NAT, private subnets for ECS and data); Route 53, CloudFront and AWS WAF (managed rules, rate-based rules, Bot Control, admin IP allowlist); ALBs (public for web, business, admin and the webhook path; internal for BFF → API traffic); ECS Fargate services `web`, `business`, `admin`, `api`, `worker`; RDS PostgreSQL 16 Multi-AZ plus a read replica; ElastiCache Redis; S3 buckets (uploads-quarantine, uploads-clean, reports, privacy-exports, audit-archive with Object Lock); GuardDuty Malware Protection for S3; KMS CMKs (database, S3, secrets, MFA envelope, QR HMAC); Secrets Manager; SES; CloudWatch with OpenTelemetry/X-Ray; GuardDuty, Security Hub, CloudTrail, AWS Config; AWS Backup with a cross-region copy; ECR with image scanning.

**Database migration.** None new. `infra/scripts/run-migrations.sh` runs `pnpm db:migrate` as a one-off ECS task with `DATABASE_MIGRATION_URL` before each rollout; `bootstrap-db-roles.sql` creates `courtko_owner`, `courtko_app` and `courtko_reporting` once per environment.

**Environment variables and Terraform variables**

| Name | Purpose | Example | |
|---|---|---|---|
| `aws_region` | Region | `ap-southeast-1` | |
| `environment` | `dev`, `staging` or `prod` | `staging` | |
| `domain_root` | DNS root | `courtko.ph` (PLACEHOLDER until registered) | |
| `admin_allowed_cidrs` | WAF allowlist for the admin host | `["203.0.113.0/24"]` (documentation range placeholder) | |
| `rds_instance_class`, `rds_multi_az` | Database sizing | `db.r7g.large`, `true` (sizing to confirm with load tests) | |
| `backup_copy_region` | Cross-region backup destination | PLACEHOLDER — pending Data Privacy Act cross-border review | |
| `github_oidc_repository` | Repository allowed to assume deploy roles | `<org>/courtko` (PLACEHOLDER) | |
| `alarm_notification_email` | Alarm subscription | `ops@example.com` (placeholder) | |

Application variables from earlier steps are injected into ECS tasks from Secrets Manager and SSM Parameter Store at start-up; no secrets in task definitions or images.

**Security considerations**
- Separate AWS accounts per environment (recommended) under AWS Organizations; least-privilege task roles per service (only `api` and `worker` reach the database and provider; `web`, `business` and `admin` reach only the internal API).
- No public database endpoints; TLS 1.2+ everywhere; security groups deny by default; GitHub Actions uses OIDC with no long-lived AWS keys; Terraform state encrypted with locking.
- No production data in lower environments; images scanned; infrastructure scanned with `tflint` and `checkov` in CI.

**Deploy strategy.** Rolling deployments with the ECS deployment circuit breaker and automatic rollback on failed health checks (`/v1/health/ready`); risky features behind flags; rollback means redeploying the previous image digest, which is always safe because migrations are expand/contract.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `terraform validate`, `tflint`, `checkov` | Static | Valid, linted, policy-compliant infrastructure |
| `tests/e2e/smoke/*.spec.ts` against staging | Smoke | Each deployment serves the critical routes |
| `tests/dr/restore-drill.sh` | DR | Snapshot restore and PITR within targets |

**How to run locally**
```bash
cd infra/terraform/envs/dev
terraform init
terraform plan -var-file=terraform.tfvars      # sandbox AWS account via SSO; applies happen only in CI
```

**How to validate**
1. A merge to `main` deploys to dev automatically; promotion to staging and production requires approval.
2. A deliberately failing health check triggers automatic rollback.
3. The admin host is unreachable from outside the allowlist; `api` rejects traffic that does not come through the internal ALB, except the webhook path.

**Provider-dependent assumptions (PLACEHOLDER).** Domain registration and DNS for `courtko.ph`; SES domain verification; registering `https://api.courtko.ph/v1/webhooks/xendit` (and the staging equivalent) with Xendit; any provider IP allowlisting for SMS or payments.

## Step 20 — Documentation

**Goal.** Documentation that lets a new engineer, a support agent and an auditor do their jobs: as-built design docs, architecture decision records, runbooks, API reference, onboarding guides and help-center sources.

**Files created/changed**
- `docs/design/*` (these 23 documents updated to as-built)
- `docs/adr/{0001-typescript-monorepo,0002-xendit-xenplatform-provider-split,0003-postgres-rls-tenancy,0004-exclusion-constraint-booking-slots,0005-append-only-double-entry-ledger,0006-bff-host-only-sessions}.md`
- `docs/runbooks/{payment-webhook-backlog,reconciliation-mismatch,refund-failure,payout-failure,provider-outage,security-incident,personal-data-breach,dr-restore,key-rotation,support-session-review}.md`
- `docs/onboarding/{local-setup,environment,coding-standards,testing,release-process}.md` (`environment.md` generated from the Zod env schemas)
- `apps/api/openapi.json` generated at build from Zod contracts (OpenAPI 3.1), published internally
- `docs/help-center/*` (player and venue articles), `README.md`, `CONTRIBUTING.md`, `SECURITY.md` (disclosure contact PLACEHOLDER), `CHANGELOG.md`

**Database migration.** None.

**Environment variables.** None new; `docs/onboarding/environment.md` lists every variable from steps 1–19 with purpose, example and secret flag.

**Security considerations.** Documentation contains no secrets and no real personal data; sensitive runbook details (for example break-glass steps) live in access-controlled locations; the personal-data-breach runbook covers the 72-hour NPC notification path.

**Tests**

| Test | Type | Proves |
|---|---|---|
| `markdownlint`, link checker, Mermaid render check | Docs CI | Docs build and render on GitHub |
| `spectral lint apps/api/openapi.json` | API | OpenAPI is valid and follows conventions (problem+json, cursor pagination, idempotency headers) |
| `scripts/check-env-docs.ts` | Unit | Environment docs match the Zod schemas |

**How to run locally**
```bash
pnpm docs:lint
pnpm api:openapi
```

**How to validate**
1. A new engineer follows `docs/onboarding/local-setup.md` on a clean machine and reaches a running stack in under one hour (target).
2. Each runbook is walked through in a tabletop exercise before the pilot.
3. The OpenAPI document renders and matches the deployed API version.

**Provider-dependent assumptions.** A single "Provider configuration checklist" in `docs/onboarding/environment.md` lists every PLACEHOLDER (Xendit keys, webhook token, platform account ID, fee schedules, sub-account type, SMS aggregator, maps keys, SES domain) and where each value is configured once the product owner supplies it.

---

## Addendum CR-01 (2026-10-06): plan changes

The 20-step plan stays. CR-01 adds the work below to the existing steps. Ordering and demo file mapping are in [doc 24 §10](24-change-impact-multisport.md).

| Existing step | Added work |
|---|---|
| Schema & RLS | Sports catalog. Space units and court configurations, with the unit-keyed exclusion-constraint migration. Open Play, attendance (append-only trigger), parties and invites. Follows, blocks, sport profiles. RLS for every new tenant table |
| Venues & courts | Venue sports. Courts & layouts editor with a dependency preview. Changeover rules. Maintenance windows |
| Pricing | Sport and layout conditions. Simulator by sport |
| Availability & holds | Per-layout availability from unit occupancy. Changeover guard under per-unit locks |
| Events → Open Play | Open Play sessions, registration modes, waitlist, partner/team flows, walk-ins, cancellation and refunds through the existing pipeline |
| Front desk | Check-in tokens (KMS key IDs, rotation). Live desk. Court board and rotation suggestions. SSE fan-out from the outbox. No-show job at the late cutoff |
| Player app | Sport picker, Open Play pass, invites, social profiles, My Sports dashboard |
| SuperAdmin | Sports catalog (maker-checker for deactivation once two platform admins hold `platform.sports.manage`). Open Play overview. Profile moderation |
| Testing | Doc 24 §8 cases, including a 50-way concurrent full/half hold race at constraint level and the privacy-projection tests |
