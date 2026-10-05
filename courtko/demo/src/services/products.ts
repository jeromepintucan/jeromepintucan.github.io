/**
 * Products and venue pickup (build step 13): catalog, variants, append-only inventory, standalone orders,
 * fulfilment states and single-use claim codes (double claims are blocked by a unique constraint).
 */

import { fail, invalid, type FieldError } from '../domain/errors.ts';
import { hmacSha256, toHex, timingSafeEqual } from '../domain/crypto.ts';
import { bookingCode, newId, normalizeCode } from '../domain/ids.ts';
import { pesos, formatPHP } from '../domain/money.ts';
import { ORDER_TRANSITIONS, transition } from '../domain/state.ts';
import { MINUTE } from '../domain/time.ts';
import { assertNotRestricted, buildQuoteSafe, resolveAddOns, saveSnapshot, taxProfile, type AddOnRequest } from './checkout.ts';
import { adjustStock, productStock, reserveStock, stockLevels } from './inventory.ts';
import type { Checkout, Id, Order, Product } from './model.ts';
import { createRefund } from './refunds.ts';
import { ConstraintViolation } from './store.ts';
import { audit, commissionTermsFor, displayName, notify, requireBusiness, requireUser, requireVerifiedUser, requireWritable, settings, type Svc } from './svc.ts';

const CLAIM_KEY = 'demo-pickup-claim-key-rotate-in-production'; // PLACEHOLDER secret

export function orderClaimToken(o: Order): string {
  return `PU1.${o.id}.${toHex(hmacSha256(CLAIM_KEY, `${o.id}.${o.code}`)).slice(0, 20)}`;
}

export function venueShop(s: Svc, input: { venueId: Id; purpose?: 'booking' | 'event' | 'standalone' }) {
  const venue = s.db.get('venues', input.venueId);
  if (!venue || venue.status !== 'published') fail('NOT_FOUND', 'Venue not found.');
  const purpose = input.purpose ?? 'standalone';
  return s.db
    .filter('products', (p) => p.venueId === venue.id && p.status === 'active' && (purpose === 'booking' ? p.fulfillment.bookingAddOn : purpose === 'event' ? p.fulfillment.eventAddOn : p.fulfillment.standalone))
    .map((p) => ({ product: p, available: productStock(s.db, p).available, variants: p.variants.map((v) => ({ ...v, available: stockLevels(s.db, p.id, v.id).available })) }));
}

export function createStandaloneOrder(s: Svc, input: { venueId: Id; items: AddOnRequest[] }) {
  requireWritable(s);
  const user = requireVerifiedUser(s);
  const venue = s.db.get('venues', input.venueId);
  if (!venue || venue.status !== 'published') fail('NOT_FOUND', 'Venue not found.');
  const business = s.db.must('businesses', venue.businessId);
  assertNotRestricted(s, user.id, business.id, venue.id);
  const { quoteAddOns, orderItems, stockItems } = resolveAddOns(s.db, venue, input.items, 'standalone');
  if (!orderItems.length) invalid([{ field: 'items', message: 'Add at least one item.' }]);
  const { terms } = commissionTermsFor(s.db, business.id, s.now);
  const expiresAt = s.now + 10 * MINUTE;
  const quote = buildQuoteSafe({ addOns: quoteAddOns, tax: taxProfile(s, business), fee: null, commission: terms });
  const snap = saveSnapshot(s, business.id, quote, expiresAt);
  const checkoutId = newId('chk');
  const order: Order = { id: newId('ord'), code: `PU-${bookingCode().slice(3)}`, businessId: business.id, venueId: venue.id, userId: user.id, checkoutId, bookingId: null, registrationId: null, items: orderItems, status: 'pending_payment', history: [], total: orderItems.reduce((a, i) => a + i.total, 0), createdAt: s.now, paidAt: null, readyAt: null, claimedAt: null, claimedBy: null };
  s.db.insert('orders', order);
  reserveStock(s, business.id, stockItems, order.id);
  const checkout: Checkout = { id: checkoutId, kind: 'product_order', userId: user.id, businessId: business.id, venueId: venue.id, status: 'open', history: [], createdAt: s.now, expiresAt, maxExpiresAt: s.now + settings(s.db).maxHoldLifetimeMinutes * MINUTE, snapshotId: snap.id, paymentMethod: null, paymentIds: [], orderId: order.id, promoCode: null, redemptionId: null, addOns: input.items, policyKey: 'standard', policyVersion: 1, policyAcceptedAt: null, source: 'online', createdBy: user.id };
  s.db.insert('checkouts', checkout);
  return { checkoutId, orderId: order.id, expiresAt };
}

function orderView(s: Svc, o: Order) {
  const venue = s.db.must('venues', o.venueId);
  return { order: o, venue, customer: displayName(s.db, o.userId), claimToken: ['paid', 'preparing', 'ready_for_pickup'].includes(o.status) ? orderClaimToken(o) : null, pickupInstructions: [...new Set(o.items.map((i) => s.db.get('products', i.productId)?.pickupInstructions).filter(Boolean))] };
}

export function myOrders(s: Svc) {
  const u = requireUser(s);
  return s.db
    .filter('orders', (o) => o.userId === u.id && o.status !== 'pending_payment' && !(o.status === 'cancelled' && !o.paidAt))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((o) => orderView(s, o));
}

export function myOrder(s: Svc, input: { orderId: Id }) {
  const u = requireUser(s);
  const o = s.db.get('orders', input.orderId);
  if (!o || o.userId !== u.id) fail('NOT_FOUND', 'Order not found.');
  return orderView(s, o);
}

// ---------------------------------------------------------------- business side

export function businessProducts(s: Svc, input: { businessId: Id; venueId?: Id }) {
  requireBusiness(s, input.businessId, 'business.view');
  return s.db
    .filter('products', (p) => p.businessId === input.businessId && (!input.venueId || p.venueId === input.venueId))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ product: p, stock: productStock(s.db, p), variants: p.variants.map((v) => ({ variant: v, stock: stockLevels(s.db, p.id, v.id) })), movements: s.db.filter('inventory', (m) => m.productId === p.id).sort((a, b) => b.at - a.at).slice(0, 8) }));
}

export function saveProduct(
  s: Svc,
  input: { businessId: Id; productId?: Id; venueId: Id; name: string; description: string; category: Product['category']; price: number; variants: { id?: Id; name: string; price: number | null }[]; maxPerOrder: number; fulfillment: Product['fulfillment']; pickupInstructions: string; taxable: boolean; status: Product['status']; initialStock?: number },
) {
  requireBusiness(s, input.businessId, 'products.manage', { venueId: input.venueId, write: true });
  const venue = s.db.get('venues', input.venueId);
  if (!venue || venue.businessId !== input.businessId) fail('NOT_FOUND', 'Venue not found.');
  const errors: FieldError[] = [];
  if (!input.name?.trim() || input.name.length > 60) errors.push({ field: 'name', message: 'Product name is required (up to 60 characters).' });
  if (!(input.price >= pesos(1) && input.price <= pesos(50_000))) errors.push({ field: 'price', message: 'Price must be between ₱1 and ₱50,000.' });
  if (!(input.maxPerOrder >= 1 && input.maxPerOrder <= 50)) errors.push({ field: 'maxPerOrder', message: 'Max per order must be 1–50.' });
  if (!Object.values(input.fulfillment).some(Boolean)) errors.push({ field: 'fulfillment', message: 'Choose at least one way to sell this product.' });
  if (errors.length) invalid(errors);
  const existing = input.productId ? s.db.get('products', input.productId) : undefined;
  if (input.productId && (!existing || existing.businessId !== input.businessId)) fail('NOT_FOUND', 'Product not found.');
  const product: Product = {
    id: existing?.id ?? newId('prd'),
    businessId: input.businessId,
    venueId: venue.id,
    name: input.name.trim(),
    description: input.description.trim().slice(0, 400),
    category: input.category,
    price: input.price,
    variants: input.variants.filter((v) => v.name.trim()).map((v) => ({ id: v.id ?? newId('var'), name: v.name.trim(), price: v.price })),
    maxPerOrder: input.maxPerOrder,
    fulfillment: input.fulfillment,
    pickupInstructions: input.pickupInstructions.trim().slice(0, 200),
    taxable: input.taxable,
    status: input.status,
    art: existing?.art ?? { hue: Math.floor(Math.random() * 360), glyph: input.category },
    createdAt: existing?.createdAt ?? s.now,
  };
  if (existing) s.db.update('products', existing.id, (x) => Object.assign(x, product));
  else {
    s.db.insert('products', product);
    if (input.initialStock && input.initialStock > 0) {
      if (product.variants.length) for (const v of product.variants) adjustStock(s, input.businessId, product.id, v.id, input.initialStock, 'initial', 'Opening stock');
      else adjustStock(s, input.businessId, product.id, null, input.initialStock, 'initial', 'Opening stock');
    }
  }
  audit(s, { action: existing ? 'product.updated' : 'product.created', targetType: 'product', targetId: product.id, businessId: input.businessId, summary: `${existing ? 'Updated' : 'Created'} ${product.name} (${formatPHP(product.price)})` });
  return s.db.must('products', product.id);
}

export function adjustInventory(s: Svc, input: { businessId: Id; productId: Id; variantId: Id | null; delta: number; note: string }) {
  const p = s.db.get('products', input.productId);
  if (!p || p.businessId !== input.businessId) fail('NOT_FOUND', 'Product not found.');
  requireBusiness(s, input.businessId, 'inventory.manage', { venueId: p.venueId, write: true });
  if (!Number.isInteger(input.delta) || input.delta === 0 || Math.abs(input.delta) > 1000) invalid([{ field: 'delta', message: 'Enter a whole number between −1000 and 1000 (not zero).' }]);
  if (!input.note?.trim()) invalid([{ field: 'note', message: 'Add a reason for the adjustment.' }]);
  adjustStock(s, input.businessId, p.id, input.variantId, input.delta, input.delta > 0 ? 'restock' : 'adjustment', input.note.trim());
  audit(s, { action: 'inventory.adjusted', targetType: 'product', targetId: p.id, businessId: p.businessId, summary: `Stock ${input.delta > 0 ? '+' : ''}${input.delta} for ${p.name}: ${input.note.trim()}` });
  return stockLevels(s.db, p.id, input.variantId);
}

export function businessOrders(s: Svc, input: { businessId: Id; status?: string }) {
  const acc = requireBusiness(s, input.businessId, 'orders.fulfill');
  return s.db
    .filter('orders', (o) => o.businessId === input.businessId && o.status !== 'pending_payment' && !(o.status === 'cancelled' && !o.paidAt) && (!input.status || o.status === input.status) && (!acc.member.venueIds || acc.member.venueIds.includes(o.venueId)))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((o) => ({ ...orderView(s, o), booking: o.bookingId ? s.db.get('bookings', o.bookingId) ?? null : null }));
}

export function setOrderStatus(s: Svc, input: { businessId: Id; orderId: Id; status: 'preparing' | 'ready_for_pickup' }) {
  const o = s.db.get('orders', input.orderId);
  if (!o || o.businessId !== input.businessId) fail('NOT_FOUND', 'Order not found.');
  const acc = requireBusiness(s, input.businessId, 'orders.fulfill', { venueId: o.venueId, write: true });
  s.db.update('orders', o.id, (x) => {
    if (input.status === 'ready_for_pickup') x.readyAt = s.now;
    transition(ORDER_TRANSITIONS, x, input.status, s.now, acc.user.id, input.status === 'preparing' ? 'Preparing' : 'Ready for pickup', 'order');
  });
  if (input.status === 'ready_for_pickup') notify(s, o.userId, 'orders', { title: `Ready for pickup · ${o.code}`, body: `Show your pickup code at the ${s.db.must('venues', o.venueId).name} counter.`, link: `#/app/orders/${o.id}`, smsBody: `CourtKo: Order ${o.code} is ready for pickup at the counter.` });
  return s.db.must('orders', o.id);
}

export function claimOrder(s: Svc, input: { businessId: Id; code: string }) {
  const raw = (input.code ?? '').trim();
  if (!raw) invalid([{ field: 'code', message: 'Enter or scan the pickup code.' }]);
  let order: Order | undefined;
  if (raw.startsWith('PU1.')) {
    const m = /^PU1\.([a-z0-9_]+)\.([0-9a-f]{20})$/.exec(raw);
    const o = m ? s.db.get('orders', m[1]!) : undefined;
    if (o && timingSafeEqual(orderClaimToken(o).split('.')[2]!, m![2]!)) order = o;
  } else {
    const code = normalizeCode(raw);
    order = s.db.find('orders', (o) => o.code === code);
  }
  if (!order || order.businessId !== input.businessId) fail('NOT_FOUND', 'No order with that code here.');
  const acc = requireBusiness(s, input.businessId, 'orders.fulfill', { venueId: order.venueId, write: true });
  if (order.status === 'claimed') fail('CONFLICT', `Already claimed on ${new Date(order.claimedAt!).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}.`);
  if (!['paid', 'preparing', 'ready_for_pickup'].includes(order.status)) fail('INVALID_STATE_TRANSITION', `This order is ${order.status.replace(/_/g, ' ')}.`);
  try {
    s.db.insert('pickupClaims', { id: newId('pkc'), orderId: order.id, businessId: order.businessId, claimedBy: acc.user.id, at: s.now, method: raw.startsWith('PU1.') ? 'qr' : 'code' });
  } catch (e) {
    if (e instanceof ConstraintViolation) fail('CONFLICT', 'This order was already claimed.');
    throw e;
  }
  s.db.update('orders', order.id, (x) => {
    x.claimedAt = s.now;
    x.claimedBy = acc.user.id;
    if (x.status === 'paid') transition(ORDER_TRANSITIONS, x, 'ready_for_pickup', s.now, acc.user.id, 'Handed over', 'order');
    if (x.status === 'preparing') transition(ORDER_TRANSITIONS, x, 'ready_for_pickup', s.now, acc.user.id, 'Handed over', 'order');
    transition(ORDER_TRANSITIONS, x, 'claimed', s.now, acc.user.id, 'Claimed at counter', 'order');
  });
  return { order: s.db.must('orders', order.id), customer: displayName(s.db, order.userId) };
}

export function cancelOrderByVenue(s: Svc, input: { businessId: Id; orderId: Id; reason: string }) {
  const o = s.db.get('orders', input.orderId);
  if (!o || o.businessId !== input.businessId) fail('NOT_FOUND', 'Order not found.');
  const acc = requireBusiness(s, input.businessId, 'orders.fulfill', { venueId: o.venueId, write: true });
  if (!['paid', 'preparing', 'ready_for_pickup'].includes(o.status)) fail('INVALID_STATE_TRANSITION', 'This order cannot be cancelled.');
  const payment = s.db.filter('payments', (p) => p.checkoutId === o.checkoutId && ['captured', 'partially_refunded'].includes(p.status))[0];
  s.db.update('orders', o.id, (x) => transition(ORDER_TRANSITIONS, x, 'cancelled', s.now, acc.user.id, input.reason || 'Cancelled by venue', 'order'));
  let refunded = 0;
  if (payment) {
    const quote = s.db.must('snapshots', payment.snapshotId).quote;
    const onlyOrder = quote.items.every((i) => i.kind === 'addon');
    const r = createRefund(s, { payment, components: { items: o.items.map((i) => ({ ref: i.ref, sharePpm: 1_000_000 })), refundGatewayFee: onlyOrder }, reason: `Order ${o.code} cancelled by venue`, initiator: 'venue', orderId: o.id });
    refunded = r?.amount ?? 0;
  }
  notify(s, o.userId, 'orders', { title: `Order cancelled · ${o.code}`, body: `${input.reason || 'The venue cancelled this order.'}${refunded ? ` ${formatPHP(refunded)} is being refunded.` : ''}`, link: `#/app/orders/${o.id}` });
  audit(s, { action: 'order.cancelled_by_venue', targetType: 'order', targetId: o.id, businessId: o.businessId, summary: `Cancelled order ${o.code}, refund ${formatPHP(refunded)}` });
  return { refunded };
}
