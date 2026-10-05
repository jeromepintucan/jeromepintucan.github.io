/**
 * SANDBOX hosted payment page — stands in for Xendit's hosted checkout. It belongs to the "provider", not to
 * CourtKo: card numbers typed here are never sent to CourtKo (only brand/last 4 come back), and the platform
 * learns the result only through the webhook + authoritative query, never from this redirect.
 */

import { formatPHP } from '../../domain/money.ts';
import { BANK_TEST_OUTCOMES, paymentFailure, TEST_CARDS, WALLET_TEST_OUTCOMES } from '../../domain/paymentFailures.ts';
import { encodeQr, qrToSvg } from '../../domain/qr.ts';
import * as provider from '../../services/provider.ts';
import { makeSvc, PROVIDER_ACTOR } from '../../services/svc.ts';
import { action, app, form, route, str } from '../app.ts';
import { alertBox, btn, countdown, field, select } from '../components.ts';
import { html, raw } from '../html.ts';
import { icon } from '../icons.ts';

function session(id: string) {
  return app.store.read((db) => db.get('providerSessions', id));
}

async function providerAct(fn: (s: ReturnType<typeof makeSvc>) => unknown): Promise<void> {
  await app.store.transact((tx) => fn(makeSvc(tx.db, tx.now, tx.meta, PROVIDER_ACTOR, { correlationId: 'provider', ip: '198.51.100.20', device: 'provider', sessionToken: null })));
}

function returnUrl(sessionId: string): string {
  const s = session(sessionId);
  const pay = s ? app.store.read((db) => db.get('payments', s.externalId)) : undefined;
  return pay ? `#/app/checkout/${pay.checkoutId}?return=1` : '#/app/bookings';
}

route('/pay/:id', 'bare', 'Secure payment (sandbox)', (ctx) => {
  const s = session(ctx.params.id!);
  if (!s) return html`<div class="pay-page"><div class="pay-card"><div class="pay-body">${alertBox('danger', 'Payment session not found')}</div></div></div>`;
  const expired = s.status === 'PENDING' && app.store.now() > s.expiresAt;
  const done = s.status !== 'PENDING' || expired;
  const m = s.method;
  const body = done
    ? html`${alertBox(s.status === 'COMPLETED' ? 'success' : 'warning', s.status === 'COMPLETED' ? 'Payment successful' : expired ? 'This payment session has expired' : paymentFailure(s.failureCode).title, s.status === 'COMPLETED' ? 'You can return to the merchant.' : `${paymentFailure(s.failureCode).message} (${s.failureCode ?? 'EXPIRED'})`)}${btn('Return to merchant', { href: returnUrl(s.id), variant: 'primary', block: true, size: 'lg' })}`
    : m === 'card'
      ? html`<form data-form="pay.card" data-id="${s.id}" class="stack-sm"><div class="card-sim"><div class="xs" style="opacity:.7">SANDBOX CARD</div><div style="font-size:1.1rem;margin:10px 0">•••• •••• •••• ••••</div><div class="xs" style="opacity:.7">Card data stays on this provider page</div></div>
        ${field({ name: 'number', label: 'Card number', inputmode: 'numeric', autocomplete: 'cc-number', value: '4242 4242 4242 4242', hint: 'Pick a sandbox test card below or type one.' })}
        <div class="test-cards">${TEST_CARDS.map((c) => html`<button type="button" class="chip" data-action="pay.fillcard" data-n="${c.number}" title="${c.number}">${c.label}</button>`)}</div>
        <div class="form-grid">${field({ name: 'exp', label: 'Expiry (MM/YY)', value: '12/29', autocomplete: 'cc-exp' })}${field({ name: 'cvc', label: 'CVC', value: '123', type: 'password', autocomplete: 'cc-csc', maxlength: 4 })}</div>
        ${btn(`Pay ${formatPHP(s.amount)}`, { type: 'submit', variant: 'primary', block: true, size: 'lg', icon: 'lock' })}</form>`
      : m === 'qrph'
        ? html`<div class="center stack-sm"><p class="small">Scan with any bank or e-wallet app that supports QR Ph.</p><div style="display:inline-block">${raw(qrToSvg(encodeQr(`00020101021228QRPH.SANDBOX.${s.id}.${s.amount}`, 'M'), { size: 200, label: 'QR Ph code' }))}</div>${btn('Simulate: scanned & paid', { action: 'pay.approve', data: { id: s.id, last4: '0000' }, variant: 'primary', block: true, size: 'lg' })}${btn('Simulate: bank app error', { action: 'pay.decline', data: { id: s.id, code: 'PROCESSOR_ERROR' }, variant: 'secondary', block: true })}<p class="xs muted">Leaving this page without paying keeps the payment pending until the session expires — CourtKo re-checks the status with the provider in the background.</p></div>`
        : m === 'online_banking'
          ? html`<form data-form="pay.bank" data-id="${s.id}" class="stack-sm">${select({ name: 'bank', label: 'Choose your bank', options: [{ value: 'BPI', label: 'BPI Online' }, { value: 'UBP', label: 'UnionBank Online' }] })}<p class="small muted">You'll be asked to approve the debit in your bank's app (simulated).</p>${btn(`Approve ${formatPHP(s.amount)}`, { type: 'submit', variant: 'primary', block: true, size: 'lg' })}<div class="sim-fails"><span class="xs muted">Simulate a bank-side failure:</span>${BANK_TEST_OUTCOMES.map((code) => btn(paymentFailure(code).title, { action: 'pay.decline', data: { id: s.id, code }, variant: 'ghost', size: 'sm' }))}</div></form>`
          : html`<div class="wallet-screen wallet-${m}"><div class="small" style="opacity:.85">${provider.METHOD_LABEL[m]} · sandbox</div><div style="font-size:1.8rem;font-weight:800;margin:6px 0">${formatPHP(s.amount)}</div><div class="small">to ${s.merchantName}</div><div class="small" style="margin-top:10px;opacity:.8">Wallet ending 0001 · balance ₱5,000.00</div></div>
            <div class="stack-sm" style="margin-top:14px">${btn('Authorize payment', { action: 'pay.approve', data: { id: s.id, last4: '0001' }, variant: 'primary', block: true, size: 'lg' })}<div class="sim-fails"><span class="xs muted">Simulate a wallet-side failure:</span>${WALLET_TEST_OUTCOMES.map((code) => btn(paymentFailure(code).title, { action: 'pay.decline', data: { id: s.id, code }, variant: 'ghost', size: 'sm' }))}</div></div>`;
  return html`<div class="pay-page"><div class="stack" style="width:min(460px,100%)"><div class="pay-card">
    <div class="pay-head"><div class="row-between"><span class="row" style="gap:8px">${icon('lock', 16)}<b>Secure checkout</b></span><span class="sandbox">SANDBOX</span></div><div class="small" style="opacity:.8;margin-top:8px">Paying ${s.merchantName}</div><div class="pay-amount">${formatPHP(s.amount)}</div><div class="xs" style="opacity:.75">${provider.METHOD_LABEL[m]} · ${s.description} · expires in ${countdown(s.expiresAt)}</div></div>
    <div class="pay-body">${body}${!done ? btn('Cancel and return', { action: 'pay.decline', data: { id: s.id, code: 'USER_CANCELLED' }, variant: 'ghost', block: true }) : ''}</div>
  </div><p class="xs center muted">Mock payment provider standing in for Xendit (placeholder — no real money). Reference ${s.id}${s.forUserId ? ` · sub-account ${s.forUserId}` : ''} · split to platform ${formatPHP(s.splitPlatformAmount)}</p></div></div>`;
});

async function approve(id: string, last4: string, international = false): Promise<void> {
  await providerAct((s) => provider.customerApprove(s, id, { last4, international }));
  app.pushFeed(`Provider: payment approved on the hosted page (${formatPHP(session(id)!.amount)}). Webhook queued.`, 'success');
  app.navigate(returnUrl(id));
}

action('pay.approve', async (el) => {
  await app.run(el, () => approve(el.dataset.id!, el.dataset.last4 ?? '0001'));
});
action('pay.decline', async (el) => {
  const id = el.dataset.id!;
  await app.run(el, () => providerAct((s) => provider.customerDecline(s, id, el.dataset.code as never)));
  app.pushFeed(`Provider: payment ${el.dataset.code === 'USER_CANCELLED' ? 'cancelled' : 'declined'} (${el.dataset.code}).`, 'warning');
  app.navigate(returnUrl(id));
});
form('pay.card', async (fd, f) => {
  const id = f.dataset.id!;
  const num = str(fd, 'number').replace(/\D/g, '');
  f.reset(); // card data is discarded immediately
  if (num.length < 15) return app.toast('Enter a valid card number.', 'warning');
  const test = TEST_CARDS.find((c) => c.number.replace(/\s/g, '') === num);
  if (test && !['success', '3ds', 'international'].includes(test.outcome)) {
    await providerAct((s) => provider.customerDecline(s, id, test.outcome));
    app.pushFeed(`Provider: card declined (${test.outcome}).`, 'warning');
    return app.navigate(returnUrl(id));
  }
  if (test?.outcome === '3ds') {
    const ok = window.confirm('3-D Secure (sandbox): approve this payment in your bank app?');
    if (!ok) {
      await providerAct((s) => provider.customerDecline(s, id, 'AUTHENTICATION_FAILED'));
      return app.navigate(returnUrl(id));
    }
  }
  await approve(id, num.slice(-4), num === '4000056655665556');
});
action('pay.fillcard', (el) => {
  const input = document.querySelector<HTMLInputElement>('form[data-form="pay.card"] input[name=number]');
  if (input) input.value = el.dataset.n ?? '';
});
form('pay.bank', async (_fd, f) => {
  await approve(f.dataset.id!, '4821');
});
