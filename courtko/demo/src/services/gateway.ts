/**
 * Resilient provider calls (doc 08 §6). Every outbound call to the payment provider goes through `callProvider`:
 *  - transient failures (HTTP 5xx, timeouts) are retried up to 3 times with exponential backoff and the SAME
 *    idempotency key, so a retry after a lost response returns the original session instead of creating a second
 *    one (no double charge);
 *  - a channel outage fails fast with PAYMENT_METHOD_UNAVAILABLE so the player can pick another method;
 *  - an exhausted retry budget fails with PROVIDER_UNAVAILABLE — the player's hold is kept;
 *  - every failed or recovered call is recorded as a provider incident (failed ones are written even though the
 *    request rolls back), which drives the payment-status banner and the exceptions center.
 * In production the backoff is real (250 ms, 500 ms, 1 s + jitter) behind a circuit breaker per channel.
 */

import { fail } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import type { PaymentMethodCode } from '../domain/pricing.ts';
import type { ProviderIncident } from './model.ts';
import { METHOD_LABEL, ProviderError } from './provider.ts';
import type { Svc } from './svc.ts';

export const RETRY_BACKOFF_MS = [250, 500, 1_000];
const MAX_ATTEMPTS = 3;

function incident(op: ProviderIncident['op'], ctx: { method?: PaymentMethodCode | null; businessId?: string | null }, outcome: ProviderIncident['outcome'], attempts: number, errors: string[], now: number, detail: string): ProviderIncident {
  return { id: newId('pin'), at: now, op, method: ctx.method ?? null, businessId: ctx.businessId ?? null, outcome, attempts, errors, detail };
}

export function callProvider<T>(s: Svc, op: ProviderIncident['op'], ctx: { method?: PaymentMethodCode | null; businessId?: string | null }, fn: () => T): T {
  const errors: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = fn();
      if (errors.length) s.db.insert('providerIncidents', incident(op, ctx, 'recovered', attempt, errors, s.now, `Recovered after ${errors.length} failed attempt(s) (${errors.join(', ')}); idempotency key reused, no duplicate created`));
      return result;
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      errors.push(`${e.status} ${e.message}`);
      if (e.kind === 'channel_unavailable') {
        const row = incident(op, ctx, 'failed', attempt, errors, s.now, `${ctx.method ? METHOD_LABEL[ctx.method] : 'Channel'} reported down by the provider`);
        s.after.push((s2) => void s2.db.insert('providerIncidents', row));
        fail('PAYMENT_METHOD_UNAVAILABLE', `${ctx.method ? METHOD_LABEL[ctx.method] : 'This payment method'} is having problems right now and can't take payments. You were not charged and your hold is kept — please choose another method.`);
      }
      // backoff RETRY_BACKOFF_MS[attempt - 1] (not slept in the sandbox)
    }
  }
  const row = incident(op, ctx, 'failed', MAX_ATTEMPTS, errors, s.now, `Gave up after ${MAX_ATTEMPTS} attempts (${errors.join(', ')})`);
  s.after.push((s2) => void s2.db.insert('providerIncidents', row));
  fail('PROVIDER_UNAVAILABLE', op === 'create_session' ? "The payment provider isn't responding right now. You were not charged and your hold is kept — try again in a minute or choose another method." : 'The payment provider is not responding. The request is kept and retried automatically.');
}

/** Payment status for the checkout banner: provider status + channels with recent failures. */
export function paymentStatus(s: Svc, health: { status: 'operational' | 'degraded' | 'down'; channelDown: PaymentMethodCode | null }) {
  const since = s.now - 10 * 60_000;
  const recent = s.db.filter('providerIncidents', (i) => i.at >= since && i.op === 'create_session');
  const failing = new Set(recent.filter((i) => i.outcome === 'failed' && i.method).map((i) => i.method!));
  if (health.channelDown) failing.add(health.channelDown);
  const methods = (Object.keys(METHOD_LABEL) as PaymentMethodCode[]).map((m) => ({ method: m, label: METHOD_LABEL[m], status: health.status === 'down' ? ('down' as const) : health.channelDown === m ? ('down' as const) : failing.has(m) ? ('degraded' as const) : ('operational' as const) }));
  const status = health.status === 'down' ? 'down' : methods.some((m) => m.status !== 'operational') || recent.some((i) => i.outcome === 'failed') ? 'degraded' : 'operational';
  return {
    status,
    methods,
    message:
      status === 'down'
        ? "Online payments are temporarily unavailable. Your hold is kept while we retry — you won't be charged twice."
        : status === 'degraded'
          ? `${methods.filter((m) => m.status !== 'operational').map((m) => m.label).join(', ') || 'Some payment methods'} ${methods.filter((m) => m.status !== 'operational').length === 1 ? 'is' : 'are'} having problems. Other methods work normally.`
          : null,
    recentIncidents: recent.length,
  };
}
