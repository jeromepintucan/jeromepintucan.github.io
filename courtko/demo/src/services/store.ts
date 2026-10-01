/**
 * In-browser transactional store.
 *
 * - The synthetic "base" dataset is regenerated deterministically on every load from (seed, seedDate), and only
 *   rows changed since then ("overlays") are persisted to localStorage, keeping storage small and fast.
 * - `transact()` serializes writes across tabs (Web Locks when available), re-syncs from storage first, and
 *   rolls back every touched row if the body throws — the same all-or-nothing behavior as a DB transaction.
 * - Constraints mirror the production schema: unique keys, append-only tables, and the booking_slots
 *   no-overlap rule that makes double booking impossible (PostgreSQL: EXCLUDE USING gist).
 */

import { AppError } from '../domain/errors.ts';
import { TABLES, emptyTables, type BookingSlot, type DbMeta, type DbState, type DbTables, type Id, type Row, type TableName } from './model.ts';

export class ConstraintViolation extends Error {
  readonly constraint: string;
  readonly table: TableName;
  readonly conflictingId: Id | null;
  constructor(constraint: string, table: TableName, message: string, conflictingId: Id | null = null) {
    super(message);
    this.name = 'ConstraintViolation';
    this.constraint = constraint;
    this.table = table;
    this.conflictingId = conflictingId;
  }
}

const APPEND_ONLY: TableName[] = ['audit', 'journals', 'inventory', 'securityEvents', 'loginEvents', 'outbound', 'ruleHistory'];
/** Financial and identity records are never hard-deleted (status changes or anonymization instead). */
const NO_DELETE: TableName[] = ['payments', 'refunds', 'payouts', 'disputes', 'bookings', 'checkouts', 'snapshots', 'orders', 'users', 'webhookEvents', 'businesses'];

type UniqueKey<T extends TableName> = { name: string; key: (row: Row<T>) => string | null };

const UNIQUE: { [T in TableName]?: UniqueKey<T>[] } = {
  users: [
    { name: 'users_email_key', key: (u) => (u.email && u.status !== 'deleted' ? u.email.toLowerCase() : null) },
    { name: 'users_phone_key', key: (u) => (u.phone && u.status !== 'deleted' ? u.phone : null) },
  ],
  members: [{ name: 'business_members_business_user_key', key: (m) => (m.status === 'removed' ? null : `${m.businessId}:${m.userId}`) }],
  businesses: [{ name: 'businesses_slug_key', key: (b) => b.slug }],
  venues: [{ name: 'venues_slug_key', key: (v) => v.slug }],
  bookings: [{ name: 'bookings_code_key', key: (b) => b.code }],
  orders: [{ name: 'orders_code_key', key: (o) => o.code }],
  pickupClaims: [{ name: 'pickup_claims_order_key', key: (p) => p.orderId }],
  reviews: [{ name: 'reviews_booking_key', key: (r) => r.bookingId }],
  webhookEvents: [{ name: 'webhook_events_provider_event_key', key: (w) => `${w.provider}:${w.providerEventId}` }],
  payments: [{ name: 'payments_idempotency_key', key: (p) => p.idempotencyKey }],
  promotions: [{ name: 'promotions_code_scope_key', key: (p) => (p.status === 'archived' ? null : `${p.businessId ?? 'platform'}:${p.code.toUpperCase()}`) }],
};

function slotsOverlap(a: BookingSlot, b: BookingSlot): boolean {
  return a.courtId === b.courtId && a.startMs < b.occupiedEndMs && b.startMs < a.occupiedEndMs;
}

export class Db {
  readonly state: DbState;
  private tx: TxRecorder | null = null;

  constructor(state: DbState) {
    this.state = state;
  }

  attach(tx: TxRecorder | null): void {
    this.tx = tx;
  }

  get<T extends TableName>(table: T, id: Id | null | undefined): Row<T> | undefined {
    if (!id) return undefined;
    return (this.state[table] as Record<Id, Row<T>>)[id];
  }

  must<T extends TableName>(table: T, id: Id | null | undefined, label = 'record'): Row<T> {
    const row = this.get(table, id);
    if (!row) throw new AppError('NOT_FOUND', `That ${label} was not found.`);
    return row;
  }

  all<T extends TableName>(table: T): Row<T>[] {
    return Object.values(this.state[table] as Record<Id, Row<T>>);
  }

  filter<T extends TableName>(table: T, pred: (row: Row<T>) => boolean): Row<T>[] {
    const out: Row<T>[] = [];
    for (const row of Object.values(this.state[table] as Record<Id, Row<T>>)) if (pred(row)) out.push(row);
    return out;
  }

  find<T extends TableName>(table: T, pred: (row: Row<T>) => boolean): Row<T> | undefined {
    for (const row of Object.values(this.state[table] as Record<Id, Row<T>>)) if (pred(row)) return row;
    return undefined;
  }

  count<T extends TableName>(table: T, pred: (row: Row<T>) => boolean): number {
    let n = 0;
    for (const row of Object.values(this.state[table] as Record<Id, Row<T>>)) if (pred(row)) n++;
    return n;
  }

  private requireTx(op: string): TxRecorder {
    if (!this.tx) throw new Error(`${op} outside a transaction`);
    return this.tx;
  }

  insert<T extends TableName>(table: T, row: Row<T>): Row<T> {
    const tx = this.requireTx('insert');
    const rows = this.state[table] as Record<Id, Row<T>>;
    const id = (row as { id: Id }).id;
    if (rows[id]) throw new ConstraintViolation(`${table}_pkey`, table, `Duplicate primary key ${id} in ${table}`, id);
    this.checkConstraints(table, row);
    rows[id] = row;
    tx.inserted(table, id);
    return row;
  }

  /** Updates a row through a mutator; the original is snapshotted for rollback. */
  update<T extends TableName>(table: T, id: Id, mutate: (row: Row<T>) => void): Row<T> {
    const tx = this.requireTx('update');
    if (APPEND_ONLY.includes(table)) throw new ConstraintViolation('append_only', table, `${table} is append-only`);
    const rows = this.state[table] as Record<Id, Row<T>>;
    const row = rows[id];
    if (!row) throw new AppError('NOT_FOUND', `That record was not found.`);
    tx.touched(table, id, row);
    mutate(row);
    this.checkConstraints(table, row);
    return row;
  }

  /** Hard delete for configuration-style rows only (never ledger, audit, payments). */
  remove<T extends TableName>(table: T, id: Id): void {
    const tx = this.requireTx('remove');
    if (APPEND_ONLY.includes(table) || NO_DELETE.includes(table)) throw new ConstraintViolation('no_delete', table, `${table} rows cannot be deleted`);
    const rows = this.state[table] as Record<Id, Row<T>>;
    const row = rows[id];
    if (!row) return;
    tx.touched(table, id, row);
    delete rows[id];
  }

  private checkConstraints<T extends TableName>(table: T, row: Row<T>): void {
    const id = (row as { id: Id }).id;
    const uniques = UNIQUE[table] as UniqueKey<T>[] | undefined;
    if (uniques) {
      for (const u of uniques) {
        const k = u.key(row);
        if (k === null) continue;
        for (const other of Object.values(this.state[table] as Record<Id, Row<T>>)) {
          if ((other as { id: Id }).id !== id && u.key(other) === k) {
            throw new ConstraintViolation(u.name, table, `duplicate key value violates unique constraint "${u.name}"`, (other as { id: Id }).id);
          }
        }
      }
    }
    if (table === 'slots') {
      const slot = row as BookingSlot;
      if (slot.status === 'active') {
        if (!(slot.occupiedEndMs >= slot.endMs && slot.endMs > slot.startMs)) throw new ConstraintViolation('booking_slots_range_check', 'slots', 'invalid slot range');
        for (const other of Object.values(this.state.slots)) {
          if (other.id !== slot.id && other.status === 'active' && slotsOverlap(slot, other)) {
            throw new ConstraintViolation('booking_slots_no_overlap', 'slots', 'conflicting key value violates exclusion constraint "booking_slots_no_overlap"', other.id);
          }
        }
      }
    }
  }
}

export class TxRecorder {
  readonly insertedRows: { table: TableName; id: Id }[] = [];
  readonly originals = new Map<string, { table: TableName; id: Id; row: unknown }>();
  readonly metaBefore: DbMeta;

  constructor(meta: DbMeta) {
    this.metaBefore = { ...meta };
  }

  inserted(table: TableName, id: Id): void {
    this.insertedRows.push({ table, id });
  }

  touched(table: TableName, id: Id, row: unknown): void {
    const key = `${table}/${id}`;
    if (this.originals.has(key) || this.insertedRows.some((r) => r.table === table && r.id === id)) return;
    this.originals.set(key, { table, id, row: structuredClone(row) });
  }

  dirty(): { table: TableName; id: Id }[] {
    const seen = new Set<string>();
    const out: { table: TableName; id: Id }[] = [];
    for (const r of [...this.insertedRows, ...[...this.originals.values()].map((o) => ({ table: o.table, id: o.id }))]) {
      const k = `${r.table}/${r.id}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(r);
      }
    }
    return out;
  }
}

export interface StorageDriver {
  readonly persistent: boolean;
  load(): string | null;
  save(data: string): void;
  clear(): void;
  onExternalChange(cb: () => void): void;
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}

export class MemoryDriver implements StorageDriver {
  readonly persistent = false;
  private data: string | null = null;
  load(): string | null {
    return this.data;
  }
  save(data: string): void {
    this.data = data;
  }
  clear(): void {
    this.data = null;
  }
  onExternalChange(): void {}
  withLock<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

interface Persisted {
  meta: DbMeta;
  overlays: Partial<Record<TableName, Record<Id, unknown>>>;
}

export interface Clock {
  realNow(): number;
}

export const systemClock: Clock = { realNow: () => Date.now() };

export interface GeneratedBase {
  tables: DbTables;
  counters: Pick<DbMeta, 'auditSeq' | 'auditHead' | 'journalSeq'>;
}

export interface StoreOptions {
  buildId: string;
  schema: number;
  generate: (seed: number, seedDate: string, seededAt: number) => GeneratedBase;
  initialize?: (tx: TxContext) => void;
  seedDateFor: (now: number) => string;
  clock?: Clock;
}

export interface TxContext {
  db: Db;
  now: number;
  meta: DbMeta;
}

export class Store {
  state: DbState;
  db: Db;
  readonly driver: StorageDriver;
  readonly opts: StoreOptions;
  readonly clock: Clock;
  private overlays: Persisted['overlays'] = {};
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(external: boolean) => void>();
  private inTx = false;

  private constructor(driver: StorageDriver, opts: StoreOptions) {
    this.driver = driver;
    this.opts = opts;
    this.clock = opts.clock ?? systemClock;
    this.state = { ...emptyTables(), meta: this.freshMeta(0) };
    this.db = new Db(this.state);
  }

  static async open(driver: StorageDriver, opts: StoreOptions): Promise<Store> {
    const store = new Store(driver, opts);
    await store.load();
    driver.onExternalChange(() => store.syncFromStorage(true));
    return store;
  }

  now(): number {
    return this.clock.realNow() + this.state.meta.clockOffsetMs;
  }

  subscribe(listener: (external: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(external: boolean): void {
    for (const l of this.listeners) {
      try {
        l(external);
      } catch (e) {
        console.error(e);
      }
    }
  }

  private freshMeta(seededAt: number): DbMeta {
    const seed = 20260930;
    return {
      schema: this.opts.schema,
      buildId: this.opts.buildId,
      seed,
      seedDate: this.opts.seedDateFor(seededAt || this.clock.realNow()),
      seededAt: seededAt || this.clock.realNow(),
      clockOffsetMs: 0,
      rev: 0,
      auditSeq: 0,
      auditHead: 'GENESIS',
      journalSeq: 0,
      initialized: false,
    };
  }

  private buildState(meta: DbMeta, overlays: Persisted['overlays']): GeneratedBase['counters'] {
    const base = this.opts.generate(meta.seed, meta.seedDate, meta.seededAt);
    const state = { ...base.tables, meta: { ...meta } } as DbState;
    for (const table of TABLES) {
      const rows = overlays[table];
      if (!rows) continue;
      const target = state[table] as Record<Id, unknown>;
      for (const [id, row] of Object.entries(rows)) {
        if (row === null) delete target[id];
        else target[id] = row;
      }
    }
    this.state = state;
    this.db = new Db(state);
    this.overlays = overlays;
    return base.counters;
  }

  private parse(): Persisted | null {
    const raw = this.driver.load();
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as Persisted;
      if (!p.meta || p.meta.schema !== this.opts.schema || p.meta.buildId !== this.opts.buildId) return null;
      return p;
    } catch {
      return null;
    }
  }

  private async load(): Promise<void> {
    const p = this.parse();
    if (p) {
      this.buildState(p.meta, p.overlays ?? {});
      if (!this.state.meta.initialized) await this.runInitialize();
      return;
    }
    const meta = this.freshMeta(this.clock.realNow());
    const counters = this.buildState(meta, {});
    Object.assign(this.state.meta, counters);
    this.persist();
    await this.runInitialize();
  }

  private async runInitialize(): Promise<void> {
    if (!this.opts.initialize) {
      this.state.meta.initialized = true;
      this.persist();
      return;
    }
    await this.transact((tx) => {
      this.opts.initialize!(tx);
      tx.meta.initialized = true;
    });
  }

  /** Applies changes committed by another tab. */
  syncFromStorage(external = false): void {
    if (this.inTx && external) return;
    const raw = this.driver.load();
    if (!raw) return;
    let p: Persisted;
    try {
      p = JSON.parse(raw) as Persisted;
    } catch {
      return;
    }
    if (!p.meta || p.meta.rev === this.state.meta.rev) return;
    if (p.meta.seededAt !== this.state.meta.seededAt || p.meta.buildId !== this.state.meta.buildId) {
      this.buildState(p.meta, p.overlays ?? {});
    } else {
      for (const table of TABLES) {
        const rows = p.overlays?.[table];
        if (!rows) continue;
        const target = this.state[table] as Record<Id, unknown>;
        for (const [id, row] of Object.entries(rows)) {
          if (row === null) delete target[id];
          else target[id] = row;
        }
      }
      this.state.meta = p.meta;
      this.overlays = p.overlays ?? {};
    }
    if (external) this.notify(true);
  }

  private persist(): void {
    const payload: Persisted = { meta: this.state.meta, overlays: this.overlays };
    this.driver.save(JSON.stringify(payload));
  }

  /** Read-only access for queries (no lock; always sees the latest committed state of this tab). */
  read<T>(fn: (db: Db, now: number) => T): T {
    return fn(this.db, this.now());
  }

  transact<T>(body: (tx: TxContext) => T | Promise<T>): Promise<T> {
    const run = () =>
      this.driver.withLock(async () => {
        this.syncFromStorage(false);
        const recorder = new TxRecorder(this.state.meta);
        this.db.attach(recorder);
        this.inTx = true;
        const ctx: TxContext = { db: this.db, now: this.now(), meta: this.state.meta };
        try {
          const result = await body(ctx);
          this.commit(recorder);
          return result;
        } catch (e) {
          this.rollback(recorder);
          throw e;
        } finally {
          this.db.attach(null);
          this.inTx = false;
        }
      });
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next as Promise<T>;
  }

  private commit(recorder: TxRecorder): void {
    const dirty = recorder.dirty();
    // No-op transactions (e.g. a job with nothing to do) don't bump the revision or wake other tabs.
    if (!dirty.length && JSON.stringify(recorder.metaBefore) === JSON.stringify(this.state.meta)) return;
    for (const { table, id } of dirty) {
      const rows = (this.overlays[table] ??= {});
      rows[id] = (this.state[table] as Record<Id, unknown>)[id] ?? null; // null = deleted
    }
    this.state.meta.rev += 1;
    this.persist();
    this.notify(false);
  }

  private rollback(recorder: TxRecorder): void {
    for (const { table, id } of recorder.insertedRows) delete (this.state[table] as Record<Id, unknown>)[id];
    for (const o of recorder.originals.values()) (this.state[o.table] as Record<Id, unknown>)[o.id] = o.row;
    Object.assign(this.state.meta, recorder.metaBefore);
  }

  async reset(): Promise<void> {
    await this.driver.withLock(async () => {
      this.driver.clear();
      const meta = this.freshMeta(this.clock.realNow());
      const counters = this.buildState(meta, {});
      Object.assign(this.state.meta, counters);
      this.persist();
    });
    await this.runInitialize();
    this.notify(false);
  }

  /** Presenter time travel: shifts the demo clock for every tab. */
  async shiftClock(deltaMs: number | 'reset'): Promise<void> {
    await this.transact((tx) => {
      tx.meta.clockOffsetMs = deltaMs === 'reset' ? 0 : tx.meta.clockOffsetMs + deltaMs;
    });
  }

  storageBytes(): number {
    return (this.driver.load() ?? '').length;
  }
}

/** Browser driver: localStorage + storage events + BroadcastChannel + Web Locks (when available). */
export function browserDriver(key: string): StorageDriver {
  let available = false;
  try {
    const probe = `${key}:probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    available = true;
  } catch {
    available = false;
  }
  if (!available) return new MemoryDriver();
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(key) : null;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return {
    persistent: true,
    load: () => localStorage.getItem(key),
    save: (data: string) => {
      try {
        localStorage.setItem(key, data);
      } catch (e) {
        console.error('Demo storage is full; changes will not persist across reloads.', e);
      }
      channel?.postMessage('changed');
    },
    clear: () => localStorage.removeItem(key),
    onExternalChange: (cb) => {
      window.addEventListener('storage', (e) => {
        if (e.key === key) cb();
      });
      channel?.addEventListener('message', () => cb());
    },
    withLock: <T>(fn: () => Promise<T>) => (locks ? (locks.request(key, fn) as Promise<T>) : fn()),
  };
}
