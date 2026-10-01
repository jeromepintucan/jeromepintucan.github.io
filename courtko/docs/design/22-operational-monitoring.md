# 22 — Operational Monitoring Plan

| | |
|---|---|
| Product | CourtKo (working name) |
| Artifact | Design output 22 of 23 |
| Status | Draft for review. PRODUCTION monitoring design. Every SLO, threshold and capacity figure is a **target pending load-test and production evidence**; no performance is guaranteed. Provider behaviour (Xendit webhooks, reconciliation reports) is to be confirmed at contracting (doc 23 D-01). |
| Last updated | 2026-09-30 |
| Related | [14 Threat model](./14-security-threat-model.md) · [20 Testing](./20-testing-strategy.md) · [21 Deployment](./21-deployment-architecture.md) · [23 Decisions](./23-assumptions-and-decisions.md) |

## 1. Observability stack

| Signal | Producer | Transport | Store | Retention (target) |
|---|---|---|---|---|
| Logs | pino structured JSON from `packages/observability` with PII redaction | stdout → CloudWatch Logs (one log group per service) | CloudWatch Logs; security-relevant subsets exported to the log-archive account | Prod 30 days (exports 1 year); staging 14 days; dev 7 days |
| Metrics | OpenTelemetry metrics SDK; CloudWatch embedded metric format for business counters; AWS service metrics | ADOT collector sidecar | CloudWatch Metrics | CloudWatch standard (15 months, down-sampled) |
| Traces | OpenTelemetry auto-instrumentation (HTTP, Fastify, pg, fetch) + manual spans for pricing, holds, checkout, ledger; W3C `traceparent` from BFF → API → outbox → worker | ADOT → X-Ray | X-Ray | 30 days |
| Errors | Sentry-compatible SDK (server + browser), `sendDefaultPii: false`, `beforeSend` scrubbing, source maps uploaded privately | HTTPS | Error-tracking service (vendor/region per D-27) | 90 days |
| Real-user performance | Web Vitals (LCP, INP, CLS) collected without cross-site identifiers; analytics-consent rules apply where cookies are used | HTTPS | RUM store | 30 days |
| Security signals | `security_events`, `audit_logs`, WAF logs, GuardDuty, Security Hub | EventBridge / S3 | DB + security account | Per doc 14 §10 and doc 15 |
| Synthetic checks | CloudWatch Synthetics canaries (§10) | — | CloudWatch | 30 days of artifacts |

Alarms publish to SNS topics per severity, which fan out to the paging tool, the team chat channel and the ticket queue (§7).

## 2. Structured logging and redaction

Every log line carries: `ts` (UTC ISO 8601), `level`, `service`, `env`, `version` (git SHA), `msg`, `correlationId`, `traceId`, `spanId`, and where applicable `route` (templated, e.g. `/v1/me/bookings/:id`, query strings removed), `method`, `status`, `latencyMs`, `actorType`, `actorId` (pseudonymous UUID), `businessId`, `errorCode`, `jobName`, `jobId`, `attempt`.

| Level | Use |
|---|---|
| `error` | Needs action or indicates a failed invariant; always paired with an error code |
| `warn` | Recoverable anomalies (retries, provider timeouts, rejected webhooks) |
| `info` | State transitions (booking, payment, refund, payout), job runs, deploys |
| `debug` | Disabled in production |

Sampling: 100% of `error`/`warn` and state transitions; successful GET request logs sampled at 10% (target), with ALB access logs as the complete record. The redaction list is normative in [doc 14 §6.6](./14-security-threat-model.md#66-log-redaction-list); a CI test fails if synthetic secrets reach any log sink.

## 3. SLIs and SLOs (targets)

| SLI | Measurement | SLO target | Window |
|---|---|---|---|
| Page experience (web/PWA) | RUM Largest Contentful Paint p75 on mobile; INP p75; CLS p75 | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 | 28 days |
| Server page response | HTML time-to-first-byte p95 at CloudFront | ≤ 800 ms | 28 days |
| Venue search | `GET /v1/public/venues` latency at planned peak | p95 ≤ 400 ms, p99 ≤ 1.2 s | 28 days |
| Availability | `GET /v1/public/venues/{venueId}/availability` latency | p95 ≤ 300 ms | 28 days |
| Hold creation | `POST /v1/me/booking-holds` latency; success ratio excluding business outcomes (`SLOT_UNAVAILABLE`, `HOLD_LIMIT_REACHED`, `BOOKING_NOT_ALLOWED`) | p95 ≤ 300 ms; ≥ 99.9% | 28 days |
| Quote | Server re-quote on the review screen | p95 ≤ 400 ms | 28 days |
| Business calendar | Calendar data load in the business portal | p95 ≤ 800 ms | 28 days |
| Checkout | `POST /v1/me/checkouts/{checkoutId}/payment-sessions` latency (includes provider call) | p95 ≤ 1.5 s | 28 days |
| Webhook-to-confirmation | Verified webhook receipt (`webhook_events.received_at`) → booking `confirmed`, including the provider re-query | p95 ≤ 15 s, p99 ≤ 60 s | 28 days |
| Capture-to-confirmation (incl. reconciliation fallback) | Provider capture time → booking `confirmed` | p99 ≤ 5 min | 28 days |
| Hold release timeliness | Expired hold → slot released by `holds.expire` (correctness never depends on it: stale holds are also released inside the insert transaction) | p99 ≤ 60 s after TTL | 28 days |
| API availability | Share of valid requests not returning 5xx: public browsing, booking and payment APIs / business and admin portals | 99.9% (≈ 43 min budget per 30 days) / 99.5% | 30 days |
| Payment success rate | Captured ÷ sessions submitted to the provider, per method, vs 7-day baseline | Monitored KPI; platform-attributable failures ≤ 0.5% | 7 / 30 days |
| Notification delivery | Transactional email handed to SES ≤ 60 s after trigger (p95); SES delivery ≥ 99% excluding hard bounces; push accepted ≥ 95%; SMS delivery receipts ≥ 95% once enabled | As stated | 28 days |
| Reconciliation | Captured payments matched to provider records; daily full reconciliation completion time | ≥ 99.9% within 1 h; 100% within 24 h; daily run complete by 06:00 PHT | Daily |
| Correctness (zero tolerance) | Double bookings; unbalanced journals; bookings confirmed without verified capture; cross-tenant responses | 0 | Always |
| Recovery | RPO / RTO per scenario | Per doc 21 §15 | Per drill |
| Backups | Daily backup job success; monthly restore test pass | 100% | Monthly |

## 4. Error budgets and burn-rate alerting

| Budget remaining (availability and latency SLOs) | Policy |
|---|---|
| > 50% | Normal release cadence |
| 25–50% | Releases need engineering-lead review; reliability work prioritized |
| < 25% | Freeze non-critical releases; only reliability and security fixes |
| Exhausted | Full freeze, post-mortem, product owner informed |

Correctness SLOs have no budget: any violation is SEV1. Multi-window burn-rate alerts for the 99.9% availability SLO (pattern from the Google SRE workbook): **page** when burn rate ≥ 14.4 over 1 h confirmed by 5 min (2% of the monthly budget in an hour); **page** when ≥ 6 over 6 h confirmed by 30 min; **ticket** when ≥ 1 over 3 days confirmed by 6 h. Latency SLOs use the same pattern on the share of requests slower than target.

## 5. Dashboards

| Dashboard | Key panels |
|---|---|
| Platform health | Requests, 5xx rate and p50/p95/p99 by route group; ECS CPU/memory/task counts per service; ALB target health; RDS CPU, connections, IOPS, free storage, replica lag; Redis CPU/memory/evictions; queue depth and oldest job per pg-boss queue; dead letters; SLO burn |
| Booking funnel | Searches → venue views → holds → checkouts → payment sessions → captured → confirmed; hold expiry rate; slot-conflict rate; conversion by venue; late-payment recoveries; automatic refunds (restriction / late capture) |
| Payments and reconciliation | Sessions by method and status; success rate vs baseline; webhook receipt rate, processing lag, token failures, re-query mismatches; payments pending > 5 min; daily reconciliation status (matched / missing / mismatch); `gateway_fee_variance`; refunds by status and age; disputes open and evidence due dates |
| Payouts | Scheduled / processing / paid / failed / reversed; failure reasons; venues with negative payable (receivables); settlement statement generation status |
| Security | Login success/failure, MFA failures, lockouts, new-device logins; WAF allowed/blocked/challenged by rule; `authz.denied` (foreign-ID probing); support-mode sessions; `pii.revealed` and export volume; GuardDuty and Security Hub findings; audit hash-chain verification status |
| Business KPIs (platform and per business) | GBV, platform commission, gateway fees, venue net, bookings, utilization, peak hours, cancellations, no-shows, refunds, event registrations, product sales, active venues/users — with an explicit date-basis selector (booking, play, payment, settlement, payout or refund date), never mixed |

Every deploy writes an annotation on all dashboards. Synthetic canary traffic is excluded from KPI panels (`is_synthetic`).

## 6. Alert catalog

Thresholds are initial values, reviewed after 30 days of production data. Severity definitions match doc 14 §9.2.

| ID | Alert | Condition (initial target) | Severity | Routing |
|---|---|---|---|---|
| AL-01 | Failed payment spike | Failure rate per method > 2× 7-day baseline over 15 min with ≥ 20 attempts | SEV2 | Page on-call; finance ops channel |
| AL-02 | Provider errors | `PROVIDER_UNAVAILABLE` > 5% of attempts in 5 min, or circuit breaker open | SEV2 | Page on-call |
| AL-03 | Webhook backlog | Unprocessed `webhook_events` older than 2 min (SEV3) / 10 min (SEV2) | SEV3 / SEV2 | Chat / page |
| AL-04 | Webhook silence | No webhooks for 30 min while ≥ 5 payments pending (06:00–24:00 PHT) | SEV2 | Page on-call; finance ops |
| AL-05 | Webhook token failures | > 5 invalid-token requests in 5 min | SEV3 (security) | Security on-call |
| AL-06 | Re-query contradiction | Any webhook claim contradicted by the provider re-query (status or amount) | SEV2 (security) | Security + finance ops |
| AL-07 | Aging pending payments | > 10 payments `pending` for > 30 min | SEV3 | Chat |
| AL-08 | Reconciliation mismatch | Captured payment unmatched after 24 h, or any amount/currency mismatch | SEV2 | Finance ops + page on-call |
| AL-09 | Ledger imbalance | Integrity job finds a journal with Σ debit ≠ Σ credit | SEV1 | Page on-call + engineering lead |
| AL-10 | Payout failure | Any failed payout (SEV3); > 3 in 1 h or > 5% of a batch (SEV2) | SEV3 / SEV2 | Finance ops / page |
| AL-11 | Stuck refunds | Refund `processing` > 24 h, or any `failed` | SEV3 | Finance ops |
| AL-12 | Double-booking integrity | Overlapping active `booking_slots`, or `confirmed` booking without an active slot | SEV1 | Page on-call + engineering lead |
| AL-13 | Slot-conflict surge | `SLOT_UNAVAILABLE` > 5× baseline for 10 min (bots or squatting) | SEV3 | Chat |
| AL-14 | Hold expiry lag | Oldest expired-but-active hold > 2 min, or no successful `holds.expire` run in 5 min | SEV2 | Page on-call |
| AL-15 | Dead letters | Any dead-lettered job in `payments.*`, `refunds.*`, `payouts.*`, `holds.expire`, `settlements.generate` (SEV2); other queues (SEV3) | SEV2 / SEV3 | Page / chat |
| AL-16 | Worker lag | Oldest job > 5 min in `outbox.dispatch` or `notifications.deliver` | SEV3 | Chat |
| AL-17 | Auth failure spike | Failed logins > 5× baseline for 10 min, or WAF account-takeover signals | SEV2 (security) | Security on-call |
| AL-18 | Privileged account anomaly | ≥ 3 failed MFA on a platform account; any break-glass use; any superadmin assignment change | SEV2 (security) | Security + DPO |
| AL-19 | Cross-tenant probing | > 20 `NOT_FOUND` denials on foreign IDs by one actor in 10 min | SEV2 (security) | Security on-call |
| AL-20 | WAF block surge | Blocked requests > 10× baseline for 10 min | SEV3 | Chat |
| AL-21 | API error rate | 5xx > 1% over 5 min with ≥ 100 requests (SEV2); > 5% (SEV1) | SEV2 / SEV1 | Page on-call |
| AL-22 | SLO burn | Burn-rate rules in §4 | SEV2 page / SEV3 ticket | On-call |
| AL-23 | DB CPU | > 80% for 15 min (SEV3); > 90% for 5 min (SEV2) | SEV3 / SEV2 | Chat / page |
| AL-24 | DB storage | Free storage < 20% (SEV3); < 10% (SEV2) | SEV3 / SEV2 | Chat / page |
| AL-25 | Replica lag | > 60 s for 5 min (SEV3); > 300 s (SEV2, reports stale) | SEV3 / SEV2 | Chat / page |
| AL-26 | DB connections | > 80% of `max_connections` for 10 min | SEV3 | Chat |
| AL-27 | Backup failure | Failed AWS Backup job or missing daily recovery point | SEV3 | Chat + ticket |
| AL-28 | Audit chain mismatch | Daily verification fails | SEV1 (security) | Security + DPO |
| AL-29 | Retention/archive job failure | `retention.enforce` or `audit.archive` failed | SEV3 | Chat + DPO |
| AL-30 | Email reputation | SES bounce > 2% or complaint > 0.08% over 24 h | SEV3 | Chat |
| AL-31 | Cloud security finding | GuardDuty or Security Hub high/critical | SEV2 (security) | Security on-call |
| AL-32 | Malware upload | GuardDuty Malware Protection `THREATS_FOUND` | SEV3 (security) | Security |
| AL-33 | Certificate expiry | < 21 days | SEV3 | Ticket |
| AL-34 | Cost anomaly | Cost Anomaly Detection above threshold | SEV4 | Engineering lead + product owner |

## 7. On-call and escalation

- **Rotation:** weekly primary and secondary engineers (small team, assumption A-08); paging 24×7 for SEV1/SEV2; SEV3 handled 07:00–23:00 PHT.
- **Acknowledgement targets:** SEV1 5 min, SEV2 15 min, SEV3 within 4 working hours.
- **Escalation ladder:** primary → secondary after 10 min without acknowledgement → engineering lead after 20 min; SEV1 informs the product owner immediately; security alerts go to the security lead and DPO; payment and payout incidents involve finance operations and Xendit support (contacts are placeholders until contracting).
- **Hygiene:** every page must be actionable and linked to a runbook; noisy or ignored alerts are reviewed monthly; weekly handover notes.

## 8. Runbooks

Each runbook lives in the repository next to its alert and follows Trigger → Diagnose → Act → Verify → Communicate.

| Runbook | Trigger | Key actions | Verify |
|---|---|---|---|
| RB-01 Provider outage | AL-02, AL-04, provider status page | Confirm scope (all methods or one) and that NAT egress is healthy; circuit breaker returns `PROVIDER_UNAVAILABLE`; disable affected methods via flag `ff.payments.method.<code>`; show a payments banner; holds keep their normal TTL; keep `payments.reconcile` running; after recovery run a targeted reconcile for the outage window; open a provider ticket | Success rate at baseline; no payment pending > 30 min; reconciliation clean |
| RB-02 Webhook backlog | AL-03, AL-16 | Check worker health, dead letters, DB locks and provider re-query rate limits; scale `worker`; replay dead-lettered webhook events (idempotent); if webhooks stopped arriving, temporarily poll pending payments every minute | Backlog zero; webhook-to-confirmation within SLO |
| RB-03 Reconciliation mismatch | AL-08 | Classify: captured at provider but missing internally → re-query, then late-payment recovery or automatic refund; missing at provider → freeze related payouts and investigate; amount/currency mismatch → SEV2 and freeze; fee variance → confirm automatic posting to `platform:gateway_fee_variance`. All corrections by reversing journals with maker-checker. | Re-run reconciliation: zero unexplained items |
| RB-04 Payout failure | AL-10 | Read failure reason; bank downtime → scheduled retry; invalid account or name mismatch → notify owner to update the payout account (owner-only, step-up, payout hold); reversed payout → `reversed_payout` journal restores venue payable | Payout `paid`; statement updated; owner informed |
| RB-05 Stuck refunds | AL-11 | Force `refunds.sync` re-query; check method-specific refund constraints; insufficient sub-account balance (Option A) → platform-funded advance via `platform:adjustments` with maker-checker, recovered from venue payable; keep refund to the original method; notify player with timeline | Refund `succeeded`; player notified |
| RB-06 DB failover | RDS failover event, AL-21 | Confirm new primary in RDS events; application pools reconnect with backoff; confirm pg-boss resumed and the replica re-attached; switch on kill switch `ff.kill.read_only` if instability persists | Error rate normal; integrity jobs (AL-09, AL-12) pass |
| RB-07 Restore from backup | Logical corruption or bad migration | Declare incident; switch on `ff.kill.read_only` and pause queues; choose target time; PITR to a new instance; validate (row counts, ledger balance, audit chains, spot checks); replay privacy erasure log; prefer selective repair over full cut-over; re-query provider for captures after the target time; resume | Validation checklist signed; reconciliation clean |
| RB-08 Suspected breach | AL-18, AL-19, AL-28, AL-31, reports | Follow doc 14 §9: page security and DPO, record T0, preserve evidence, contain, assess NPC notifiability within the 72-hour window | Containment confirmed; breach register updated |
| RB-09 Compromised staff account | User report, AL-17/18/19, unusual reveals or exports | Suspend the account or membership; revoke all sessions; reset MFA; review audit trail since suspected compromise (refunds, payout-account changes, exports, role changes); reverse unauthorized actions (reversing journals, cancel pending approvals); freeze payouts if the payout account changed; notify the business owner; DPO assesses data exposure | No further anomalous activity; MFA re-enrolled; actions reversed |

## 9. Health checks

| Check | Semantics | Used by |
|---|---|---|
| `GET /healthz` (liveness) | Process responsive; event-loop delay p99 < 1 s; memory below limit. No dependency calls. | ECS container health check (Node script; distroless images have no curl) |
| `GET /readyz` (readiness) | Hard dependencies only: DB `SELECT 1` within 500 ms and schema version ≥ the version the build requires. Soft dependencies (Redis, provider, SES) are reported in details but never fail readiness, so a Redis blip cannot deregister every task. Fails immediately on SIGTERM to drain. | ALB target groups (interval 10 s, healthy 2, unhealthy 3; deregistration delay 30 s) |
| Worker heartbeat | Heartbeat metric every 30 s plus pg-boss state monitoring; per-schedule "last successful run" metrics | AL-14, AL-15, AL-16 |
| Deep diagnostics | Internal-only endpoint checking provider reachability, SES and SMS | On-call during incidents |

## 10. Synthetic monitoring

CloudWatch Synthetics canaries use dedicated synthetic accounts and a hidden synthetic canary venue (excluded from search, reports and KPIs); credentials live in Secrets Manager.

| Canary | Environment | Frequency | Checks |
|---|---|---|---|
| Public pages | prod | 5 min | Home, `/courts`, a venue page; LCP budget |
| Availability API | prod | 1 min | Canary venue availability returns 200 within 300 ms |
| Login | prod | 5 min | Synthetic player login and logout |
| Hold and release | prod | 5 min | Create and delete a hold on the canary venue |
| Webhook endpoint | prod | 5 min | POST with an invalid token returns 401 (endpoint alive and rejecting) |
| Admin reachability | prod, from allowlisted egress | 15 min | Admin login page reachable only from the allowlist |
| Business calendar | prod | 15 min | Synthetic staff login; calendar loads |
| Checkout end to end | staging | 30 min | Booking with Xendit test mode (mock until available), webhook → `confirmed` |

Real payments are never exercised by production canaries.

## 11. Capacity planning

- **Planning assumptions (A-07, unverified):** pilot 20 venues / 100 courts / 5,000 players; year-1 design target 300 venues / 1,500 courts / 100,000 registered players; evening peak 18:00–22:00 PHT, weekends about 1.5× weekdays; tournament registration openings create short spikes.
- **Derived test load:** 200 availability req/s, 50 holds/min, 30 checkouts/min, 60 webhooks/min, notification bursts of 1,000/min (k6 profiles in doc 20 §5.1).
- **Headroom policy:** capacity for 2× observed peak; autoscaling maximum ≥ 3× minimum; RDS sized so peak CPU stays below 60%.
- **Leading indicators, reviewed monthly:** API CPU trend, p95 latency trend, DB CPU and connections at peak, storage growth (90-day forecast), queue lag, cache hit ratio.
- **Scaling path:** larger RDS class; read-replica offload for reports and search; short-TTL availability cache per venue-day invalidated by slot changes via the outbox; RDS Proxy; time partitioning of `booking_slots`, `payment_events`, `audit_logs`; dedicated search service in Phase 2.
- Quarterly load-test re-baseline; any SLO or sizing change is recorded in this document.

## 12. Incident post-mortems

1. Required for every SEV1/SEV2, any correctness-SLO violation, any security or personal-data incident, and any exhausted error budget.
2. Draft within 2 business days and review within 5 business days (targets); blameless format.
3. Template: summary; impact (players, venues, money, personal data); timeline in UTC and PHT; detection (how and how fast); contributing factors and root causes; what went well and poorly; SLO/error-budget impact; communications sent (including NPC and data-subject notices, if any); action items with owner, priority and due date.
4. Action items are tracked to closure and reviewed monthly; recurring themes feed the roadmap and this plan's alert thresholds.
5. A summary goes to the product owner; venues affected by multi-venue incidents receive a plain-language summary.
