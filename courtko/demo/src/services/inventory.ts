/**
 * Inventory is an append-only movement log (initial, restock, reservation, release, sale, adjustment, return).
 * Stock is reserved when a checkout is created, so an item can't sell out during payment.
 */

import { fail } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import type { Db } from './store.ts';
import type { Id, InventoryMovement, Product } from './model.ts';
import type { Svc } from './svc.ts';

export function stockLevels(db: Db, productId: Id, variantId: Id | null): { onHand: number; reserved: number; available: number } {
  let onHand = 0;
  let reserved = 0;
  for (const m of db.all('inventory')) {
    if (m.productId !== productId || (m.variantId ?? null) !== (variantId ?? null)) continue;
    onHand += m.onHandDelta;
    reserved += m.reservedDelta;
  }
  return { onHand, reserved, available: onHand - reserved };
}

export function productStock(db: Db, product: Product): { onHand: number; reserved: number; available: number } {
  if (!product.variants.length) return stockLevels(db, product.id, null);
  return product.variants.reduce(
    (acc, v) => {
      const l = stockLevels(db, product.id, v.id);
      return { onHand: acc.onHand + l.onHand, reserved: acc.reserved + l.reserved, available: acc.available + l.available };
    },
    { onHand: 0, reserved: 0, available: 0 },
  );
}

function move(s: Svc, m: Omit<InventoryMovement, 'id' | 'at' | 'by'> & { by?: Id }): void {
  s.db.insert('inventory', { id: newId('inv'), at: s.now, by: m.by ?? s.actor.realUser?.id ?? 'system', ...m });
}

export function reserveStock(s: Svc, businessId: Id, items: { productId: Id; variantId: Id | null; qty: number; name: string }[], refId: Id): void {
  for (const it of items) {
    const lvl = stockLevels(s.db, it.productId, it.variantId);
    if (lvl.available < it.qty) fail('OUT_OF_STOCK', `${it.name} has only ${Math.max(0, lvl.available)} left.`, { meta: { productId: it.productId } });
    move(s, { businessId, productId: it.productId, variantId: it.variantId, type: 'reservation', onHandDelta: 0, reservedDelta: it.qty, refId, note: 'Reserved during checkout' });
  }
}

export function releaseStock(s: Svc, businessId: Id, items: { productId: Id; variantId: Id | null; qty: number }[], refId: Id, note = 'Released: checkout ended'): void {
  for (const it of items) move(s, { businessId, productId: it.productId, variantId: it.variantId, type: 'release', onHandDelta: 0, reservedDelta: -it.qty, refId, note });
}

export function sellStock(s: Svc, businessId: Id, items: { productId: Id; variantId: Id | null; qty: number }[], refId: Id): void {
  for (const it of items) move(s, { businessId, productId: it.productId, variantId: it.variantId, type: 'sale', onHandDelta: -it.qty, reservedDelta: -it.qty, refId, note: 'Sold (payment captured)' });
}

export function returnStock(s: Svc, businessId: Id, items: { productId: Id; variantId: Id | null; qty: number }[], refId: Id): void {
  for (const it of items) move(s, { businessId, productId: it.productId, variantId: it.variantId, type: 'return', onHandDelta: it.qty, reservedDelta: 0, refId, note: 'Returned to stock (order cancelled)' });
}

export function adjustStock(s: Svc, businessId: Id, productId: Id, variantId: Id | null, delta: number, type: 'restock' | 'adjustment' | 'initial', note: string): void {
  const lvl = stockLevels(s.db, productId, variantId);
  if (lvl.onHand + delta < lvl.reserved) fail('CONFLICT', `Stock can't go below the ${lvl.reserved} unit(s) reserved in open checkouts.`);
  move(s, { businessId, productId, variantId, type, onHandDelta: delta, reservedDelta: 0, refId: null, note });
}
