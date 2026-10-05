/**
 * Background jobs (design doc 11 job catalog). In production these run on the worker via pg-boss; in the demo a
 * scheduler tick runs them in the browser. Every job is idempotent and runs in its own transaction.
 */

import { localDate, localParts } from '../domain/time.ts';
import { completeFinishedBookings, sendReminders } from './booking.ts';
import { expireCheckout } from './checkout.ts';
import { expireWaitlistOffers } from './events.ts';
import { openPlayJobs } from './openplay.ts';
import { handleProviderWebhook, reconcilePending, syncPayment } from './payments.ts';
import { runPayouts } from './payouts.ts';
import { processDeletions } from './profile.ts';
import * as provider from './provider.ts';
import { retryStuckRefunds } from './refunds.ts';
import { expireRestrictions } from './restrictions.ts';
import { expireSupportSessions } from './admin.ts';
import type { Store } from './store.ts';
import { makeSvc, PROVIDER_ACTOR, settings, SYSTEM_ACTOR, type Svc } from './svc.ts';

export interface JobReport {
  name: string;
  count: number;
}

const SYSTEM_REQ = { correlationId: 'job', ip: '10.0.0.10', device: 'worker', sessionToken: null };

async function run(store: Store, name: string, fn: (s: Svc) => number, actor = SYSTEM_ACTOR): Promise<JobReport> {
  try {
    const count = await store.transact((tx) => fn(makeSvc(tx.db, tx.now, tx.meta, actor, { ...SYSTEM_REQ, correlationId: `job_${name}` })));
    return { name, count };
  } catch (e) {
    console.error(`job ${name} failed`, e);
    return { name, count: -1 };
  }
}

/** Delivers due sandbox webhooks to the platform endpoint, one transaction per delivery (like real HTTP calls). */
export async function deliverWebhooks(store: Store, onDelivery?: (info: { type: string; status: number; result: string; duplicate: boolean }) => void): Promise<number> {
  const due = store.read((db, now) => db.filter('providerDeliveries', (d) => d.status === 'pending' && d.deliverAt <= now).map((d) => d.id));
  let n = 0;
  for (const id of due) {
    const outcome = await store
      .transact((tx) => {
        const s = makeSvc(tx.db, tx.now, tx.meta, PROVIDER_ACTOR, { ...SYSTEM_REQ, correlationId: `whk_${id.slice(-8)}` });
        const d = tx.db.get('providerDeliveries', id);
        if (!d || d.status !== 'pending') return null;
        const mode = settings(tx.db).demo.webhookMode;
        if (mode === 'fail_first' && d.attempts === 0 && !d.duplicateOf) {
          provider.markDelivery(s, id, 503);
          return { type: d.type, status: 503, result: 'Platform endpoint returned 503 (simulated outage) — provider will retry with backoff', duplicate: false };
        }
        const res = handleProviderWebhook(s, { headers: { 'x-callback-token': provider.SANDBOX_CALLBACK_TOKEN }, body: d.payload as never });
        provider.markDelivery(s, id, res.status);
        return { type: d.type, status: res.status, result: res.result, duplicate: !!d.duplicateOf };
      })
      .catch((e) => {
        console.error('webhook delivery failed', e);
        return null;
      });
    if (outcome) {
      n++;
      onDelivery?.(outcome);
    }
  }
  return n;
}

let lastPayoutDate = '';

export async function runJobs(store: Store, onDelivery?: Parameters<typeof deliverWebhooks>[1]): Promise<JobReport[]> {
  const reports: JobReport[] = [];
  reports.push(await run(store, 'provider.expire_sessions', (s) => provider.expireSessions(s), PROVIDER_ACTOR));
  reports.push(await run(store, 'provider.refunds', (s) => provider.processRefunds(s), PROVIDER_ACTOR));
  reports.push(await run(store, 'provider.payouts', (s) => provider.processPayouts(s), PROVIDER_ACTOR));
  reports.push(await run(store, 'provider.settle', (s) => provider.settlePayments(s), PROVIDER_ACTOR));
  reports.push({ name: 'webhooks.deliver', count: await deliverWebhooks(store, onDelivery) });
  reports.push(
    await run(store, 'holds.expire', (s) => {
      let n = 0;
      for (const c of s.db.filter('checkouts', (x) => (x.status === 'open' || x.status === 'payment_pending') && x.expiresAt <= s.now)) {
        // Ask the provider first: a payment may have completed without a webhook yet.
        for (const pid of c.paymentIds) if (s.db.get('payments', pid)?.status === 'pending') syncPayment(s, pid, 'reconciliation');
        const fresh = s.db.must('checkouts', c.id);
        if (fresh.status === 'open' || fresh.status === 'payment_pending') {
          expireCheckout(s, c.id, 'Hold expired');
          n++;
        }
      }
      return n;
    }),
  );
  reports.push(await run(store, 'payments.reconcile', (s) => reconcilePending(s)));
  reports.push(await run(store, 'refunds.retry', (s) => retryStuckRefunds(s)));
  reports.push(await run(store, 'bookings.complete', (s) => completeFinishedBookings(s)));
  reports.push(await run(store, 'bookings.remind', (s) => sendReminders(s)));
  reports.push(await run(store, 'events.waitlist_offers', (s) => expireWaitlistOffers(s)));
  reports.push(await run(store, 'openplay.lifecycle', (s) => openPlayJobs(s)));
  reports.push(await run(store, 'restrictions.expire', (s) => expireRestrictions(s)));
  reports.push(await run(store, 'support.expire', (s) => expireSupportSessions(s)));
  reports.push(await run(store, 'privacy.erase', (s) => processDeletions(s)));
  // Daily payouts at 06:00 Manila time.
  const now = store.now();
  const today = localDate(now);
  if (localParts(now).minute >= 6 * 60 && lastPayoutDate !== today) {
    lastPayoutDate = today;
    reports.push(await run(store, 'payouts.daily', (s) => runPayouts(s).length));
  }
  return reports.filter((r) => r.count !== 0);
}

/**
 * DEMO time travel: moving the clock forward would otherwise expire every session (30-min idle timeout), so
 * active sessions and support sessions are shifted by the same amount. Production has no such control.
 */
export async function shiftSessions(store: Store, deltaMs: number): Promise<void> {
  if (deltaMs <= 0) return;
  await store.transact((tx) => {
    for (const s of tx.db.filter('sessions', (x) => !x.revokedAt)) {
      tx.db.update('sessions', s.id, (x) => {
        x.lastSeenAt += deltaMs;
        x.idleExpiresAt += deltaMs;
        x.absoluteExpiresAt += deltaMs;
      });
    }
    for (const s of tx.db.filter('pendingLogins', () => true)) tx.db.update('pendingLogins', s.id, (x) => {
      x.expiresAt += deltaMs;
    });
  });
}

export async function travel(store: Store, deltaMs: number | 'reset'): Promise<void> {
  const before = store.state.meta.clockOffsetMs;
  await store.shiftClock(deltaMs);
  await shiftSessions(store, store.state.meta.clockOffsetMs - before);
}

export async function runPayoutsNow(store: Store): Promise<number> {
  return store.transact((tx) => runPayouts(makeSvc(tx.db, tx.now, tx.meta, SYSTEM_ACTOR, SYSTEM_REQ)).length);
}
