/**
 * Service context, actor resolution, authorization, audit (hash-chained), security events and notifications.
 * Every API handler receives a `Svc`; authorization is enforced here, server-side, never by hiding UI.
 */

import { AppError, fail } from '../domain/errors.ts';
import { canonicalJson, sha256Hex } from '../domain/crypto.ts';
import { newId } from '../domain/ids.ts';
import { MFA_REQUIRED_PERMISSIONS, PLATFORM_ROLE_TEMPLATES, platformRoleHas, type BusinessPermission, type PlatformPermission } from '../domain/rbac.ts';
import type { CommissionTerms, FeeSchedule, PaymentMethodCode } from '../domain/pricing.ts';
import { maskEmail, maskPhone } from '../domain/validation.ts';
import type { Db } from './store.ts';
import type {
  AppNotification,
  AuditEntry,
  Business,
  BusinessMember,
  CommissionAgreement,
  DbMeta,
  Id,
  NotificationCategory,
  PlatformSettings,
  Profile,
  SecurityEvent,
  Session,
  SocialSettings,
  SupportSession,
  User,
} from './model.ts';

export interface RequestInfo {
  correlationId: string;
  ip: string;
  device: string;
  sessionToken: string | null;
}

export interface Actor {
  kind: 'anonymous' | 'user' | 'system' | 'provider';
  /** Effective user (the impersonated user while support mode is active). */
  user: User | null;
  /** The human who is authenticated (the admin during support mode). */
  realUser: User | null;
  session: Session | null;
  support: SupportSession | null;
  mfaVerified: boolean;
}

export interface Svc {
  db: Db;
  now: number;
  meta: DbMeta;
  actor: Actor;
  req: RequestInfo;
  /** Security events raised during the request; flushed in a separate write even if the request fails. */
  deferred: Omit<SecurityEvent, 'id'>[];
  /**
   * Writes that must survive a rollback (failed-login counters, code attempt counters, lockouts).
   * The API layer runs them in a follow-up transaction whether or not the main request succeeded.
   */
  after: ((s: Svc) => void)[];
}

export const SYSTEM_ACTOR: Actor = { kind: 'system', user: null, realUser: null, session: null, support: null, mfaVerified: true };
export const PROVIDER_ACTOR: Actor = { kind: 'provider', user: null, realUser: null, session: null, support: null, mfaVerified: true };

export const SESSION_IDLE_MS = 30 * 60_000;
export const ADMIN_IDLE_MS = 15 * 60_000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60_000;

export function resolveActor(db: Db, now: number, req: RequestInfo): Actor {
  if (!req.sessionToken) return { kind: 'anonymous', user: null, realUser: null, session: null, support: null, mfaVerified: false };
  const session = db.get('sessions', sha256Hex(req.sessionToken));
  if (!session || session.revokedAt || now > session.absoluteExpiresAt || now > session.idleExpiresAt) {
    return { kind: 'anonymous', user: null, realUser: null, session: null, support: null, mfaVerified: false };
  }
  const realUser = db.get('users', session.userId) ?? null;
  if (!realUser || realUser.status === 'suspended' || realUser.status === 'deleted') {
    return { kind: 'anonymous', user: null, realUser: null, session: null, support: null, mfaVerified: false };
  }
  let support: SupportSession | null = null;
  let user = realUser;
  if (session.supportSessionId) {
    const sup = db.get('supportSessions', session.supportSessionId);
    if (sup && !sup.endedAt && now < sup.expiresAt) {
      support = sup;
      user = db.get('users', sup.targetUserId) ?? realUser;
    }
  }
  return { kind: 'user', user, realUser, session, support, mfaVerified: !!session.mfaVerifiedAt };
}

export function makeSvc(db: Db, now: number, meta: DbMeta, actor: Actor, req: RequestInfo): Svc {
  return { db, now, meta, actor, req, deferred: [], after: [] };
}

// ---------------------------------------------------------------- authorization

export function requireUser(s: Svc): User {
  if (!s.actor.user) fail('UNAUTHENTICATED');
  return s.actor.user;
}

export function requireWritable(s: Svc): void {
  if (s.actor.support) fail('SUPPORT_MODE_READ_ONLY', 'Support mode is read-only. End the support session to make changes.');
}

export function requireVerifiedUser(s: Svc): User {
  const u = requireUser(s);
  if (u.status !== 'active') fail('FORBIDDEN', 'Verify your email or mobile number first.');
  return u;
}

export function activeMembership(db: Db, userId: Id, businessId: Id): BusinessMember | undefined {
  return db.find('members', (m) => m.businessId === businessId && m.userId === userId && m.status === 'active');
}

export function membershipPermissions(db: Db, member: BusinessMember, venueId?: Id | null): Set<string> {
  const perms = new Set<string>();
  if (venueId && member.venueIds && !member.venueIds.includes(venueId)) return perms;
  for (const roleId of member.roleIds) {
    const role = db.get('roles', roleId);
    if (!role || (role.businessId && role.businessId !== member.businessId)) continue;
    for (const p of role.permissions) perms.add(p);
  }
  if (perms.size) perms.add('business.view');
  return perms;
}

export function userBusinessPermissions(db: Db, userId: Id, businessId: Id, venueId?: Id | null): Set<string> {
  const m = activeMembership(db, userId, businessId);
  return m ? membershipPermissions(db, m, venueId) : new Set();
}

export interface BusinessAccess {
  user: User;
  member: BusinessMember;
  business: Business;
  perms: Set<string>;
}

function denied(s: Svc, detail: string, businessId: Id | null): never {
  s.deferred.push({
    at: s.now,
    type: 'authz_denied',
    severity: 'warning',
    userId: s.actor.realUser?.id ?? null,
    businessId,
    detail,
    ip: s.req.ip,
  });
  fail('FORBIDDEN', detail);
}

/**
 * Tenant-scoped authorization. A user with no membership gets NOT_FOUND (the business's existence is not
 * revealed); a member lacking the permission gets FORBIDDEN and a security event.
 */
export function requireBusiness(s: Svc, businessId: Id, perm: BusinessPermission, opts: { venueId?: Id | null; write?: boolean } = {}): BusinessAccess {
  const user = requireUser(s);
  const business = s.db.get('businesses', businessId);
  const member = business ? activeMembership(s.db, user.id, businessId) : undefined;
  if (!business || !member) fail('NOT_FOUND', 'Business not found.');
  const perms = membershipPermissions(s.db, member, opts.venueId ?? null);
  if (!perms.has(perm)) denied(s, `Missing permission ${perm}`, businessId);
  if (opts.write) {
    requireWritable(s);
    if (business.status === 'suspended' && perm !== 'business.view') fail('FORBIDDEN', 'This business is suspended. Contact CourtKo Support.');
  }
  if ((MFA_REQUIRED_PERMISSIONS as string[]).includes(perm) && opts.write && !s.actor.mfaVerified) fail('MFA_REQUIRED', 'This action needs two-step verification. Sign in again with your authenticator code.');
  return { user, member, business, perms };
}

export function requirePlatform(s: Svc, perm: PlatformPermission, opts: { write?: boolean } = {}): User {
  const real = s.actor.realUser;
  if (!real || !real.platformRole) fail('NOT_FOUND', 'Page not found.');
  if (!s.actor.mfaVerified) fail('MFA_REQUIRED', 'Platform access requires two-step verification.');
  if (!platformRoleHas(real.platformRole, perm)) denied(s, `Missing permission ${perm}`, null);
  if (opts.write && s.actor.support) fail('SUPPORT_MODE_READ_ONLY', 'End the support session before making platform changes.');
  return real;
}

export function isPlatformUser(u: User | null | undefined): boolean {
  return !!u?.platformRole;
}

// ---------------------------------------------------------------- display helpers

export function profileOf(db: Db, userId: Id | null | undefined): Profile | undefined {
  return userId ? db.get('profiles', userId) : undefined;
}

// ---------------------------------------------------------------- usernames & social defaults (doc 24 SOC)

export const DEFAULT_SOCIAL: SocialSettings = { discoverable: true, allowFollows: true, requireApproval: false, showFollowers: true, showFollowing: true, showSports: true };

const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'courtko', 'support', 'help', 'staff', 'system', 'root', 'security', 'official', 'moderator', 'superadmin', 'api', 'me', 'null', 'undefined']);

export function usernameProblem(raw: string): string | null {
  const u = raw.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._]{1,18})[a-z0-9]$/.test(u)) return 'Use 3–20 letters, numbers, dots or underscores (start and end with a letter or number).';
  if (/[._]{2}/.test(u)) return 'Dots and underscores can’t be next to each other.';
  if (RESERVED_USERNAMES.has(u) || u.startsWith('courtko')) return 'That username is reserved.';
  if (/^\+?\d{10,}$/.test(u) || u.includes('@')) return 'Usernames can’t be phone numbers or emails.';
  return null;
}

/** A unique, privacy-safe default handle from the name (never the email or phone). */
export function suggestUsername(db: Db, first: string, last: string, salt = 0): string {
  const base = `${first}.${last}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.|\.$/g, '')
    .slice(0, 16) || 'player';
  const taken = (u: string) => !!db.find('profiles', (p) => (p.username ?? '').toLowerCase() === u);
  let candidate = base.length >= 3 ? base : `${base}player`;
  let n = salt;
  while (taken(candidate) || usernameProblem(candidate)) {
    n += 1;
    candidate = `${base.slice(0, 15)}${n}`;
  }
  return candidate;
}

export function displayName(db: Db, userId: Id | null | undefined): string {
  if (!userId) return 'System';
  const u = db.get('users', userId);
  if (u?.status === 'deleted') return 'Former player';
  return profileOf(db, userId)?.displayName ?? 'Unknown user';
}

export function actorLabel(s: Svc): string {
  if (s.actor.kind === 'system') return 'System (scheduled job)';
  if (s.actor.kind === 'provider') return 'Payment provider (sandbox webhook)';
  const real = s.actor.realUser;
  if (!real) return 'Anonymous';
  const name = displayName(s.db, real.id);
  const role = real.platformRole ? PLATFORM_ROLE_TEMPLATES[real.platformRole].name : null;
  const base = role ? `${name} (${role})` : name;
  if (s.actor.support && s.actor.user) return `${base} in support mode as ${displayName(s.db, s.actor.user.id)} [${s.actor.support.ticketRef}]`;
  return base;
}

export function contactFor(u: User): string {
  return u.email ? maskEmail(u.email) : u.phone ? maskPhone(u.phone) : '—';
}

// ---------------------------------------------------------------- audit (append-only, hash-chained)

export function audit(
  s: Svc,
  e: { action: string; targetType: string; targetId: Id | null; businessId?: Id | null; summary: string; before?: unknown; after?: unknown; reason?: string | null },
): AuditEntry {
  const seq = s.meta.auditSeq + 1;
  const base = {
    id: newId('aud'),
    seq,
    at: s.now,
    actorUserId: s.actor.realUser?.id ?? null,
    actorLabel: actorLabel(s),
    supportSessionId: s.actor.support?.id ?? null,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    businessId: e.businessId ?? null,
    summary: e.summary,
    before: e.before ?? null,
    after: e.after ?? null,
    reason: e.reason ?? null,
    ip: s.req.ip,
    device: s.req.device,
    correlationId: s.req.correlationId,
    prevHash: s.meta.auditHead,
  };
  const hash = sha256Hex(canonicalJson(base));
  const entry: AuditEntry = { ...base, hash };
  s.db.insert('audit', entry);
  s.meta.auditSeq = seq;
  s.meta.auditHead = hash;
  return entry;
}

/** Recomputes the chain; returns the first broken sequence number or null if intact. */
export function verifyAuditChain(db: Db): { ok: boolean; count: number; brokenAt: number | null } {
  const entries = db.all('audit').sort((a, b) => a.seq - b.seq);
  let prev = 'GENESIS';
  for (const e of entries) {
    const { hash, ...rest } = e;
    if (e.prevHash !== prev || sha256Hex(canonicalJson(rest)) !== hash) return { ok: false, count: entries.length, brokenAt: e.seq };
    prev = hash;
  }
  return { ok: true, count: entries.length, brokenAt: null };
}

export function securityEvent(s: Svc, e: Omit<SecurityEvent, 'id' | 'at' | 'ip'> & { at?: number; ip?: string }): void {
  s.db.insert('securityEvents', { id: newId('sec'), at: e.at ?? s.now, ip: e.ip ?? s.req.ip, type: e.type, severity: e.severity, userId: e.userId, businessId: e.businessId, detail: e.detail });
}

// ---------------------------------------------------------------- notifications

const LOCKED: NotificationCategory[] = ['account_security', 'booking_updates', 'payment_updates', 'payouts'];

export function isLockedCategory(c: NotificationCategory): boolean {
  return LOCKED.includes(c);
}

export function notify(
  s: Svc,
  userId: Id,
  category: NotificationCategory,
  msg: { title: string; body: string; link?: string | null; dedupeKey?: string; smsBody?: string },
): AppNotification | null {
  const user = s.db.get('users', userId);
  if (!user || user.status === 'deleted') return null;
  if (msg.dedupeKey && s.db.find('notifications', (n) => n.userId === userId && n.dedupeKey === msg.dedupeKey)) return null;
  const prefs = s.db.get('preferences', userId);
  const p = prefs?.notifications[category] ?? { inApp: true, email: true, sms: false, push: false };
  const locked = isLockedCategory(category);
  const wantEmail = (locked || p.email) && !!user.email;
  const wantSms = p.sms && !!user.phone;
  const wantPush = p.push;
  const n: AppNotification = {
    id: newId('ntf'),
    userId,
    category,
    title: msg.title,
    body: msg.body,
    link: msg.link ?? null,
    createdAt: s.now,
    readAt: null,
    channels: { email: user.email ? (wantEmail ? 'sent' : 'suppressed') : 'n/a', sms: user.phone ? (wantSms ? 'sent' : 'suppressed') : 'n/a', push: wantPush ? 'sent' : 'suppressed' },
    dedupeKey: msg.dedupeKey ?? null,
  };
  s.db.insert('notifications', n);
  if (wantEmail) s.db.insert('outbound', { id: newId('out'), notificationId: n.id, userId, channel: 'email', to: maskEmail(user.email!), subject: `CourtKo: ${msg.title}`, body: msg.body, createdAt: s.now });
  // Philippine telcos block SMS containing links, so SMS bodies never include URLs (doc 23 D-22).
  if (wantSms) s.db.insert('outbound', { id: newId('out'), notificationId: n.id, userId, channel: 'sms', to: maskPhone(user.phone!), subject: '', body: (msg.smsBody ?? `${msg.title}. ${msg.body}`).replace(/https?:\/\/\S+/g, '').slice(0, 300), createdAt: s.now });
  if (wantPush) s.db.insert('outbound', { id: newId('out'), notificationId: n.id, userId, channel: 'push', to: 'Web Push (PWA)', subject: msg.title, body: msg.body.slice(0, 140), createdAt: s.now });
  return n;
}

export function notifyBusiness(s: Svc, businessId: Id, perm: BusinessPermission, msg: { title: string; body: string; link?: string; dedupeKey?: string }, category: NotificationCategory = 'business_ops'): void {
  for (const m of s.db.filter('members', (x) => x.businessId === businessId && x.status === 'active')) {
    if (membershipPermissions(s.db, m).has(perm)) notify(s, m.userId, category, { ...msg, ...(msg.dedupeKey ? { dedupeKey: `${msg.dedupeKey}:${m.userId}` } : {}) });
  }
}

// ---------------------------------------------------------------- platform configuration helpers

export function settings(db: Db): PlatformSettings {
  const s = db.get('settings', 'platform');
  if (!s) throw new AppError('INTERNAL', 'Platform settings missing');
  return s;
}

export function feeSchedule(db: Db, method: PaymentMethodCode): FeeSchedule {
  const f = settings(db).feeSchedules.find((x) => x.method === method);
  if (!f || !f.enabled) fail('PAYMENT_METHOD_UNAVAILABLE', 'That payment method is not available right now.');
  return f;
}

/** Active commission terms for a business at an instant: business agreement first, else platform default. */
export function commissionTermsFor(db: Db, businessId: Id, at: number): { terms: CommissionTerms; agreement: CommissionAgreement } {
  const active = (a: CommissionAgreement) => a.status === 'active' && a.effectiveFrom <= at && (a.effectiveTo === null || at < a.effectiveTo);
  const specific = db.filter('commissionAgreements', (a) => a.businessId === businessId && active(a)).sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0];
  const global = db.filter('commissionAgreements', (a) => a.businessId === null && active(a)).sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0];
  const agreement = specific ?? global;
  if (!agreement) throw new AppError('INTERNAL', 'No commission agreement is active');
  const pct = agreement.ratePpm / 10_000;
  return {
    agreement,
    terms: {
      ratePpm: agreement.ratePpm,
      source: specific ? 'agreement' : 'global',
      agreementId: agreement.id,
      appliesToProducts: agreement.appliesToProducts,
      appliesToEvents: agreement.appliesToEvents,
      label: specific ? `${pct}% business agreement` : `${pct}% platform default`,
    },
  };
}

export function pageOf<T>(rows: T[], limit = 25, cursor?: string | null): { data: T[]; page: { nextCursor: string | null; hasMore: boolean; total: number } } {
  const start = cursor ? Math.max(0, Number(cursor) || 0) : 0;
  const size = Math.min(100, Math.max(1, limit));
  const data = rows.slice(start, start + size);
  const next = start + size < rows.length ? String(start + size) : null;
  return { data, page: { nextCursor: next, hasMore: next !== null, total: rows.length } };
}
