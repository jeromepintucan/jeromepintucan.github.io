/**
 * Authentication: registration with email/mobile verification, password login with lockout, TOTP MFA,
 * sessions (opaque tokens stored as SHA-256 digests), password reset/change and session revocation.
 */

import { fail, invalid, type FieldError } from '../domain/errors.ts';
import { hashPassword, newOpaqueToken, randomBytes, sha256Hex, timingSafeEqual, verifyPassword } from '../domain/crypto.ts';
import { newId } from '../domain/ids.ts';
import { newRecoveryCodes, newTotpSecret, otpauthUri, verifyTotp, totpAt } from '../domain/totp.ts';
import { isEmail, maskEmail, maskPhone, normalizeEmail, normalizePhMobile, passwordProblems } from '../domain/validation.ts';
import type { Id, Preferences, Profile, Session, User } from './model.ts';
import {
  ADMIN_IDLE_MS,
  audit,
  DEFAULT_SOCIAL,
  notify,
  requireUser,
  requireWritable,
  securityEvent,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  suggestUsername,
  userBusinessPermissions,
  type Svc,
} from './svc.ts';

export const DEMO_PASSWORD = 'CourtKo!2026';
const CODE_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5;
const LOCK_THRESHOLD = 5;
const LOCK_WINDOW_MS = 15 * 60_000;
const LOCK_DURATION_MS = 15 * 60_000;
const DUMMY_HASH = hashPassword('not-a-real-password-used-for-timing', 20_000, new Uint8Array(16));

export function defaultPreferences(userId: Id, marketingOptIn = false): Preferences {
  const on = { inApp: true, email: true, sms: false, push: false };
  return {
    id: userId,
    userId,
    notifications: {
      account_security: { ...on },
      booking_updates: { ...on },
      payment_updates: { ...on },
      reminders: { inApp: true, email: false, sms: false, push: true },
      events: { inApp: true, email: true, sms: false, push: false },
      orders: { ...on },
      business_ops: { inApp: true, email: false, sms: false, push: false },
      payouts: { ...on },
      social: { inApp: true, email: false, sms: false, push: true },
      marketing: { inApp: marketingOptIn, email: marketingOptIn, sms: false, push: false },
    },
    marketingOptIn,
    locationConsent: 'unset',
    cookieAnalytics: null,
  };
}

function sixDigitCode(): string {
  const b = randomBytes(4);
  const n = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
  return String(n % 1_000_000).padStart(6, '0');
}

function parseIdentifier(identifier: string): { email: string | null; phone: string | null } {
  const raw = identifier.trim();
  if (raw.includes('@')) return { email: normalizeEmail(raw), phone: null };
  return { email: null, phone: normalizePhMobile(raw) };
}

function findByIdentifier(s: Svc, identifier: string): User | undefined {
  const { email, phone } = parseIdentifier(identifier);
  if (email) return s.db.find('users', (u) => u.email === email && u.status !== 'deleted');
  if (phone) return s.db.find('users', (u) => u.phone === phone && u.status !== 'deleted');
  return undefined;
}

function maskIdentifier(identifier: string): string {
  const { email, phone } = parseIdentifier(identifier);
  return email ? maskEmail(email) : phone ? maskPhone(phone) : '(invalid identifier)';
}

function issueCode(s: Svc, user: User, purpose: 'verify_contact' | 'password_reset'): { verificationId: Id; channel: 'email' | 'sms'; demoCode: string } {
  const code = sixDigitCode();
  const channel: 'email' | 'sms' = user.email ? 'email' : 'sms';
  const id = newId('vc');
  s.db.insert('verificationCodes', { id, userId: user.id, channel, purpose, digest: sha256Hex(`${id}:${code}`), expiresAt: s.now + CODE_TTL_MS, attempts: 0, consumedAt: null, createdAt: s.now });
  const text = purpose === 'verify_contact' ? `Your CourtKo verification code is ${code}. It expires in 10 minutes. Never share this code.` : `Your CourtKo password reset code is ${code}. It expires in 10 minutes. If you didn't ask for this, ignore this message.`;
  s.db.insert('outbound', {
    id: newId('out'),
    notificationId: '',
    userId: user.id,
    channel,
    to: channel === 'email' ? maskEmail(user.email!) : maskPhone(user.phone!),
    subject: purpose === 'verify_contact' ? 'Verify your CourtKo account' : 'Reset your CourtKo password',
    body: text,
    createdAt: s.now,
  });
  return { verificationId: id, channel, demoCode: code };
}

/** Business owners/managers and platform staff must use MFA (doc 03). */
export function mfaRequiredFor(s: Svc, user: User): boolean {
  if (user.platformRole) return true;
  return s.db
    .filter('members', (m) => m.userId === user.id && m.status === 'active')
    .some((m) => {
      const perms = userBusinessPermissions(s.db, user.id, m.businessId);
      return perms.has('staff.manage') || perms.has('refunds.approve') || perms.has('finance.manage_payout_account');
    });
}

function createSession(s: Svc, user: User, mfaVerified: boolean): { token: string; session: Session } {
  const { token, digest } = newOpaqueToken();
  const idle = user.platformRole ? ADMIN_IDLE_MS : SESSION_IDLE_MS;
  const session: Session = {
    id: digest,
    userId: user.id,
    createdAt: s.now,
    lastSeenAt: s.now,
    idleExpiresAt: s.now + idle,
    absoluteExpiresAt: s.now + SESSION_ABSOLUTE_MS,
    revokedAt: null,
    mfaVerifiedAt: mfaVerified ? s.now : null,
    device: s.req.device,
    ip: s.req.ip,
    supportSessionId: null,
  };
  s.db.insert('sessions', session);
  const seenDevice = s.db.find('sessions', (x) => x.userId === user.id && x.id !== digest && x.device === s.req.device);
  s.db.update('users', user.id, (u) => {
    u.lastLoginAt = s.now;
  });
  if (!seenDevice && s.db.count('sessions', (x) => x.userId === user.id) > 1) {
    securityEvent(s, { type: 'suspicious_login', severity: 'info', userId: user.id, businessId: null, detail: `New device: ${s.req.device}` });
    notify(s, user.id, 'account_security', { title: 'New sign-in to your account', body: `We noticed a sign-in from ${s.req.device}. If this wasn't you, change your password and sign out of all devices.`, link: '#/app/settings' });
  }
  return { token, session };
}

export function register(
  s: Svc,
  input: { firstName: string; lastName: string; email?: string; phone?: string; password: string; acceptTerms: boolean; acceptPrivacy: boolean; marketingOptIn?: boolean; city?: string },
): { status: 'code_sent'; verificationId: Id; channel: 'email' | 'sms'; destination: string; demoCode: string | null } {
  requireWritable(s);
  const errors: FieldError[] = [];
  const firstName = (input.firstName ?? '').trim();
  const lastName = (input.lastName ?? '').trim();
  if (!firstName) errors.push({ field: 'firstName', message: 'First name is required.' });
  if (!lastName) errors.push({ field: 'lastName', message: 'Last name is required.' });
  if (firstName.length > 60 || lastName.length > 60) errors.push({ field: 'firstName', message: 'Names must be at most 60 characters.' });
  let email: string | null = null;
  let phone: string | null = null;
  if (input.email?.trim()) {
    if (!isEmail(input.email)) errors.push({ field: 'email', message: 'Enter a valid email address.' });
    else email = normalizeEmail(input.email);
  }
  if (input.phone?.trim()) {
    phone = normalizePhMobile(input.phone);
    if (!phone) errors.push({ field: 'phone', message: 'Enter a valid Philippine mobile number (09XX XXX XXXX).' });
  }
  if (!email && !phone && !errors.some((e) => e.field === 'email' || e.field === 'phone')) errors.push({ field: 'email', message: 'Enter an email address or a mobile number.' });
  for (const p of passwordProblems(input.password ?? '', [firstName, lastName, email ?? ''])) errors.push({ field: 'password', message: p });
  if (!input.acceptTerms) errors.push({ field: 'acceptTerms', message: 'Please accept the Terms of Service.' });
  if (!input.acceptPrivacy) errors.push({ field: 'acceptPrivacy', message: 'Please acknowledge the Privacy Notice.' });
  if (errors.length) invalid(errors);

  const existing = (email && s.db.find('users', (u) => u.email === email && u.status !== 'deleted')) || (phone && s.db.find('users', (u) => u.phone === phone && u.status !== 'deleted'));
  if (existing) {
    // Enumeration-safe: respond exactly as for a new account, and tell the real owner instead.
    notify(s, existing.id, 'account_security', { title: 'Someone tried to sign up with your details', body: 'If this was you, sign in instead or reset your password. No new account was created.' });
    return { status: 'code_sent', verificationId: newId('vc'), channel: email ? 'email' : 'sms', destination: email ? maskEmail(email) : maskPhone(phone!), demoCode: null };
  }

  const userId = newId('usr');
  const user: User = {
    id: userId,
    email,
    phone,
    passwordHash: hashPassword(input.password),
    status: 'pending_verification',
    emailVerifiedAt: null,
    phoneVerifiedAt: null,
    mfa: null,
    platformRole: null,
    createdAt: s.now,
    lastLoginAt: null,
    lockedUntil: null,
    deletion: null,
  };
  s.db.insert('users', user);
  const profile: Profile = {
    id: userId,
    userId,
    firstName,
    lastName,
    displayName: `${firstName} ${lastName.slice(0, 1)}.`,
    city: (input.city ?? '').trim(),
    skillSelf: null,
    bio: '',
    avatarHue: Math.floor(Math.random() * 360),
    visibility: { profile: 'public', activity: 'private', ratings: 'organizers' },
    username: suggestUsername(s.db, firstName, lastName),
    social: { ...DEFAULT_SOCIAL },
  };
  s.db.insert('profiles', profile);
  s.db.insert('preferences', defaultPreferences(userId, !!input.marketingOptIn));
  for (const [kind, granted] of [['terms', true], ['privacy', true], ['marketing', !!input.marketingOptIn]] as const) {
    s.db.insert('consents', { id: newId('cns'), userId, kind, version: '2026-07', granted, at: s.now });
  }
  const code = issueCode(s, user, 'verify_contact');
  audit(s, { action: 'user.registered', targetType: 'user', targetId: userId, summary: `Account created (${email ? maskEmail(email) : maskPhone(phone!)})` });
  return { status: 'code_sent', verificationId: code.verificationId, channel: code.channel, destination: code.channel === 'email' ? maskEmail(email!) : maskPhone(phone!), demoCode: code.demoCode };
}

export function verifyContact(s: Svc, input: { verificationId: Id; code: string }): { token: string; userId: Id } {
  requireWritable(s);
  const vc = s.db.get('verificationCodes', input.verificationId);
  if (!vc || vc.purpose !== 'verify_contact' || vc.consumedAt) fail('VALIDATION_FAILED', 'This code is invalid or has expired. Request a new one.', { fields: [{ field: 'code', message: 'Invalid or expired code.' }] });
  if (s.now > vc.expiresAt) fail('VALIDATION_FAILED', 'This code has expired. Request a new one.', { fields: [{ field: 'code', message: 'Code expired.' }] });
  if (vc.attempts >= MAX_CODE_ATTEMPTS) fail('RATE_LIMITED', 'Too many attempts. Request a new code.');
  const ok = timingSafeEqual(sha256Hex(`${vc.id}:${(input.code ?? '').trim()}`), vc.digest);
  if (!ok) {
    s.after.push((s2) => countCodeAttempt(s2, vc.id));
    fail('VALIDATION_FAILED', "That code doesn't match.", { fields: [{ field: 'code', message: "That code doesn't match." }] });
  }
  s.db.update('verificationCodes', vc.id, (v) => {
    v.attempts += 1;
    v.consumedAt = s.now;
  });
  const user = s.db.must('users', vc.userId, 'account');
  s.db.update('users', user.id, (u) => {
    u.status = 'active';
    if (vc.channel === 'email') u.emailVerifiedAt = s.now;
    else u.phoneVerifiedAt = s.now;
  });
  notify(s, user.id, 'account_security', { title: 'Welcome to CourtKo!', body: 'Your account is verified. Find a court near you and book in a few taps.', link: '#/app' });
  const { token } = createSession(s, user, false);
  return { token, userId: user.id };
}

export function resendVerification(s: Svc, input: { identifier: string }): { verificationId: Id | null; demoCode: string | null } {
  requireWritable(s);
  const user = findByIdentifier(s, input.identifier);
  if (!user || user.status !== 'pending_verification') return { verificationId: null, demoCode: null };
  const c = issueCode(s, user, 'verify_contact');
  return { verificationId: c.verificationId, demoCode: c.demoCode };
}

function recordLogin(s: Svc, userId: Id | null, identifier: string, outcome: 'success' | 'failed' | 'locked' | 'mfa_failed' | 'mfa_success' | 'reset'): void {
  s.db.insert('loginEvents', { id: newId('lge'), userId, identifierMasked: maskIdentifier(identifier), at: s.now, outcome, device: s.req.device, ip: s.req.ip });
}

function countCodeAttempt(s: Svc, verificationId: Id): void {
  if (s.db.get('verificationCodes', verificationId)) {
    s.db.update('verificationCodes', verificationId, (v) => {
      v.attempts += 1;
    });
  }
}

/** Runs in a follow-up transaction so failed attempts and lockouts persist even though the login rolled back. */
function recordFailedLogin(s: Svc, userId: Id | null, identifier: string): void {
  recordLogin(s, userId, identifier, 'failed');
  const failures = s.db.count('loginEvents', (e) => e.identifierMasked === maskIdentifier(identifier) && e.outcome === 'failed' && s.now - e.at < LOCK_WINDOW_MS);
  securityEvent(s, { type: 'login_failed', severity: failures >= 3 ? 'warning' : 'info', userId, businessId: null, detail: `Failed sign-in for ${maskIdentifier(identifier)} (${failures} in 15 min)` });
  const user = userId ? s.db.get('users', userId) : undefined;
  if (user && failures >= LOCK_THRESHOLD && !(user.lockedUntil && user.lockedUntil > s.now)) {
    s.db.update('users', user.id, (u) => {
      u.lockedUntil = s.now + LOCK_DURATION_MS;
    });
    securityEvent(s, { type: 'account_locked', severity: 'warning', userId: user.id, businessId: null, detail: `Locked for 15 minutes after ${LOCK_THRESHOLD} failed attempts` });
    notify(s, user.id, 'account_security', { title: 'Account temporarily locked', body: 'We locked sign-in for 15 minutes after several failed attempts. If this wasn’t you, reset your password.' });
  }
}

export type LoginResult =
  | { status: 'signed_in'; token: string; mfaSetupRequired: boolean }
  | { status: 'mfa_required'; challengeToken: string; destinationHint: string }
  | { status: 'verify_required'; verificationId: Id; demoCode: string };

export function login(s: Svc, input: { identifier: string; password: string }): LoginResult {
  requireWritable(s);
  const identifier = (input.identifier ?? '').trim();
  const { email, phone } = parseIdentifier(identifier);
  if (!email && !phone) invalid([{ field: 'identifier', message: 'Enter your email or Philippine mobile number.' }]);
  const user = findByIdentifier(s, identifier);
  if (user?.lockedUntil && user.lockedUntil > s.now) {
    s.after.push((s2) => recordLogin(s2, user.id, identifier, 'locked'));
    fail('ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes or reset your password.');
  }
  // Always run a hash comparison so response time doesn't reveal whether the account exists.
  const passwordOk = user?.passwordHash ? verifyPassword(input.password ?? '', user.passwordHash) : (verifyPassword(input.password ?? '', DUMMY_HASH), false);
  if (!user || !passwordOk) {
    const uid = user?.id ?? null;
    s.after.push((s2) => recordFailedLogin(s2, uid, identifier));
    fail('UNAUTHENTICATED', 'Incorrect email/mobile or password.');
  }
  if (user.status === 'suspended') fail('FORBIDDEN', 'This account is suspended. Contact CourtKo Support.');
  if (user.status === 'pending_verification') {
    const c = issueCode(s, user, 'verify_contact');
    return { status: 'verify_required', verificationId: c.verificationId, demoCode: c.demoCode };
  }
  if (user.mfa) {
    const { token, digest } = newOpaqueToken();
    s.db.insert('pendingLogins', { id: digest, userId: user.id, createdAt: s.now, expiresAt: s.now + 5 * 60_000, attempts: 0, device: s.req.device });
    return { status: 'mfa_required', challengeToken: token, destinationHint: 'your authenticator app' };
  }
  recordLogin(s, user.id, identifier, 'success');
  const { token } = createSession(s, user, false);
  return { status: 'signed_in', token, mfaSetupRequired: mfaRequiredFor(s, user) };
}

export function verifyMfa(s: Svc, input: { challengeToken: string; code: string }): { token: string } {
  requireWritable(s);
  const pending = s.db.get('pendingLogins', sha256Hex(input.challengeToken ?? ''));
  if (!pending || s.now > pending.expiresAt) fail('UNAUTHENTICATED', 'Your sign-in attempt expired. Please sign in again.');
  if (pending.attempts >= 5) fail('RATE_LIMITED', 'Too many attempts. Please sign in again.');
  const user = s.db.must('users', pending.userId, 'account');
  const code = (input.code ?? '').replace(/\s/g, '').toUpperCase();
  let ok = false;
  if (user.mfa && /^\d{6}$/.test(code)) {
    const step = verifyTotp(user.mfa.totpSecret, code, s.now, user.mfa.lastUsedStep);
    if (step !== null) {
      ok = true;
      s.db.update('users', user.id, (u) => {
        u.mfa!.lastUsedStep = step;
      });
    }
  } else if (user.mfa && /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code)) {
    const digest = sha256Hex(code);
    if (user.mfa.recoveryDigests.includes(digest)) {
      ok = true;
      s.db.update('users', user.id, (u) => {
        u.mfa!.recoveryDigests = u.mfa!.recoveryDigests.filter((d) => d !== digest);
      });
      notify(s, user.id, 'account_security', { title: 'Recovery code used', body: 'A recovery code was used to sign in. Generate new codes if you are running low.' });
    }
  }
  if (!ok) {
    const pendingId = pending.id;
    s.after.push((s2) => {
      if (s2.db.get('pendingLogins', pendingId)) {
        s2.db.update('pendingLogins', pendingId, (p) => {
          p.attempts += 1;
        });
      }
      securityEvent(s2, { type: 'mfa_failed', severity: 'warning', userId: user.id, businessId: null, detail: 'Invalid two-step verification code' });
      s2.db.insert('loginEvents', { id: newId('lge'), userId: user.id, identifierMasked: user.email ? maskEmail(user.email) : maskPhone(user.phone ?? ''), at: s2.now, outcome: 'mfa_failed', device: s2.req.device, ip: s2.req.ip });
    });
    fail('VALIDATION_FAILED', "That code didn't work. Check your authenticator app and try again.", { fields: [{ field: 'code', message: 'Invalid code.' }] });
  }
  s.db.update('pendingLogins', pending.id, (p) => {
    p.attempts += 1;
    p.expiresAt = s.now;
  });
  s.db.insert('loginEvents', { id: newId('lge'), userId: user.id, identifierMasked: user.email ? maskEmail(user.email) : maskPhone(user.phone ?? ''), at: s.now, outcome: 'mfa_success', device: s.req.device, ip: s.req.ip });
  securityEvent(s, { type: 'login_succeeded', severity: 'info', userId: user.id, businessId: null, detail: `Signed in with two-step verification on ${s.req.device}` });
  const { token } = createSession(s, user, true);
  return { token };
}

export function logout(s: Svc): { ok: true } {
  const session = s.actor.session;
  if (session) {
    s.db.update('sessions', session.id, (x) => {
      x.revokedAt = s.now;
      x.revokeReason = 'signed_out';
    });
    if (session.supportSessionId) {
      s.db.update('supportSessions', session.supportSessionId, (x) => {
        x.endedAt = x.endedAt ?? s.now;
      });
    }
  }
  return { ok: true };
}

export function listMySessions(s: Svc): (Session & { current: boolean })[] {
  const u = requireUser(s);
  return s.db
    .filter('sessions', (x) => x.userId === u.id && !x.revokedAt && s.now < x.absoluteExpiresAt && s.now < x.idleExpiresAt)
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map((x) => ({ ...x, current: x.id === s.actor.session?.id }));
}

export function loginHistory(s: Svc): { at: number; outcome: string; device: string; ip: string }[] {
  const u = requireUser(s);
  return s.db
    .filter('loginEvents', (e) => e.userId === u.id)
    .sort((a, b) => b.at - a.at)
    .slice(0, 20)
    .map((e) => ({ at: e.at, outcome: e.outcome, device: e.device, ip: e.ip }));
}

export function revokeSession(s: Svc, input: { sessionId: Id }): { ok: true } {
  requireWritable(s);
  const u = requireUser(s);
  const target = s.db.get('sessions', input.sessionId);
  if (!target || target.userId !== u.id) fail('NOT_FOUND', 'Session not found.');
  s.db.update('sessions', target.id, (x) => {
    x.revokedAt = s.now;
    x.revokeReason = 'revoked_by_user';
  });
  return { ok: true };
}

export function revokeAllSessions(s: Svc, input: { keepCurrent: boolean }): { revoked: number } {
  requireWritable(s);
  const u = requireUser(s);
  let revoked = 0;
  for (const x of s.db.filter('sessions', (y) => y.userId === u.id && !y.revokedAt)) {
    if (input.keepCurrent && x.id === s.actor.session?.id) continue;
    s.db.update('sessions', x.id, (y) => {
      y.revokedAt = s.now;
      y.revokeReason = 'revoke_all';
    });
    revoked++;
  }
  securityEvent(s, { type: 'sessions_revoked', severity: 'info', userId: u.id, businessId: null, detail: `${revoked} session(s) signed out` });
  audit(s, { action: 'user.sessions_revoked', targetType: 'user', targetId: u.id, summary: `Signed out of ${revoked} session(s)` });
  notify(s, u.id, 'account_security', { title: 'Signed out of other devices', body: `${revoked} session(s) were signed out.` });
  return { revoked };
}

export function requestPasswordReset(s: Svc, input: { identifier: string }): { status: 'sent'; verificationId: Id; demoCode: string | null } {
  requireWritable(s);
  const user = findByIdentifier(s, input.identifier ?? '');
  if (!user || user.status === 'suspended') return { status: 'sent', verificationId: newId('vc'), demoCode: null };
  const c = issueCode(s, user, 'password_reset');
  return { status: 'sent', verificationId: c.verificationId, demoCode: c.demoCode };
}

export function resetPassword(s: Svc, input: { verificationId: Id; code: string; newPassword: string }): { ok: true } {
  requireWritable(s);
  const vc = s.db.get('verificationCodes', input.verificationId);
  if (!vc || vc.purpose !== 'password_reset' || vc.consumedAt || s.now > vc.expiresAt) fail('VALIDATION_FAILED', 'This reset code is invalid or has expired.', { fields: [{ field: 'code', message: 'Invalid or expired code.' }] });
  if (vc.attempts >= MAX_CODE_ATTEMPTS) fail('RATE_LIMITED', 'Too many attempts. Request a new code.');
  const ok = timingSafeEqual(sha256Hex(`${vc.id}:${(input.code ?? '').trim()}`), vc.digest);
  if (!ok) {
    s.after.push((s2) => countCodeAttempt(s2, vc.id));
    fail('VALIDATION_FAILED', "That code doesn't match.", { fields: [{ field: 'code', message: "That code doesn't match." }] });
  }
  const user = s.db.must('users', vc.userId, 'account');
  const problems = passwordProblems(input.newPassword ?? '', [user.email ?? '']);
  if (problems.length) invalid(problems.map((m) => ({ field: 'newPassword', message: m })));
  s.db.update('verificationCodes', vc.id, (v) => {
    v.attempts += 1;
    v.consumedAt = s.now;
  });
  s.db.update('users', user.id, (u) => {
    u.passwordHash = hashPassword(input.newPassword);
    u.lockedUntil = null;
  });
  for (const x of s.db.filter('sessions', (y) => y.userId === user.id && !y.revokedAt)) {
    s.db.update('sessions', x.id, (y) => {
      y.revokedAt = s.now;
      y.revokeReason = 'password_reset';
    });
  }
  recordLogin(s, user.id, user.email ?? user.phone ?? '', 'reset');
  securityEvent(s, { type: 'password_reset', severity: 'info', userId: user.id, businessId: null, detail: 'Password reset; all sessions signed out' });
  audit(s, { action: 'user.password_reset', targetType: 'user', targetId: user.id, summary: 'Password reset via verification code' });
  notify(s, user.id, 'account_security', { title: 'Your password was changed', body: "Your password was reset and you've been signed out everywhere. If this wasn't you, contact CourtKo Support immediately." });
  return { ok: true };
}

export function changePassword(s: Svc, input: { currentPassword: string; newPassword: string }): { ok: true } {
  requireWritable(s);
  const u = requireUser(s);
  if (!u.passwordHash || !verifyPassword(input.currentPassword ?? '', u.passwordHash)) invalid([{ field: 'currentPassword', message: 'Your current password is incorrect.' }]);
  const problems = passwordProblems(input.newPassword ?? '', [u.email ?? '']);
  if (problems.length) invalid(problems.map((m) => ({ field: 'newPassword', message: m })));
  s.db.update('users', u.id, (x) => {
    x.passwordHash = hashPassword(input.newPassword);
  });
  for (const x of s.db.filter('sessions', (y) => y.userId === u.id && !y.revokedAt && y.id !== s.actor.session?.id)) {
    s.db.update('sessions', x.id, (y) => {
      y.revokedAt = s.now;
      y.revokeReason = 'password_changed';
    });
  }
  securityEvent(s, { type: 'password_changed', severity: 'info', userId: u.id, businessId: null, detail: 'Password changed; other sessions signed out' });
  audit(s, { action: 'user.password_changed', targetType: 'user', targetId: u.id, summary: 'Password changed' });
  notify(s, u.id, 'account_security', { title: 'Your password was changed', body: "If this wasn't you, reset your password and contact CourtKo Support." });
  return { ok: true };
}

export function startTotpEnrollment(s: Svc): { secret: string; otpauthUri: string } {
  requireWritable(s);
  const u = requireUser(s);
  const secret = newTotpSecret();
  s.db.update('users', u.id, (x) => {
    x.mfaPending = { totpSecret: secret, createdAt: s.now };
  });
  return { secret, otpauthUri: otpauthUri(secret, u.email ?? u.phone ?? u.id) };
}

export function confirmTotpEnrollment(s: Svc, input: { code: string }): { recoveryCodes: string[] } {
  requireWritable(s);
  const u = requireUser(s);
  if (!u.mfaPending) fail('CONFLICT', 'Start two-step verification setup first.');
  const step = verifyTotp(u.mfaPending.totpSecret, (input.code ?? '').trim(), s.now);
  if (step === null) invalid([{ field: 'code', message: "That code didn't match. Wait for a new code and try again." }]);
  const { codes, digests } = newRecoveryCodes();
  s.db.update('users', u.id, (x) => {
    x.mfa = { totpSecret: x.mfaPending!.totpSecret, enabledAt: s.now, lastUsedStep: step, recoveryDigests: digests };
    x.mfaPending = null;
  });
  if (s.actor.session) {
    s.db.update('sessions', s.actor.session.id, (x) => {
      x.mfaVerifiedAt = s.now;
    });
  }
  securityEvent(s, { type: 'mfa_enabled', severity: 'info', userId: u.id, businessId: null, detail: 'Authenticator app enabled' });
  audit(s, { action: 'user.mfa_enabled', targetType: 'user', targetId: u.id, summary: 'Two-step verification enabled' });
  notify(s, u.id, 'account_security', { title: 'Two-step verification is on', body: 'Your account now needs a code from your authenticator app when you sign in.' });
  return { recoveryCodes: codes };
}

export function disableMfa(s: Svc, input: { code: string }): { ok: true } {
  requireWritable(s);
  const u = requireUser(s);
  if (!u.mfa) fail('CONFLICT', 'Two-step verification is not enabled.');
  if (mfaRequiredFor(s, u)) fail('FORBIDDEN', 'Two-step verification is required for your role and cannot be turned off.');
  if (verifyTotp(u.mfa.totpSecret, (input.code ?? '').trim(), s.now, u.mfa.lastUsedStep) === null) invalid([{ field: 'code', message: 'Invalid code.' }]);
  s.db.update('users', u.id, (x) => {
    x.mfa = null;
  });
  audit(s, { action: 'user.mfa_disabled', targetType: 'user', targetId: u.id, summary: 'Two-step verification disabled' });
  notify(s, u.id, 'account_security', { title: 'Two-step verification turned off', body: "If this wasn't you, reset your password immediately." });
  return { ok: true };
}

/**
 * DEMO ONLY — one-click persona sign-in for presentations. It still runs the real checks: the stored password
 * hash is verified and, for MFA users, a genuine TOTP code is computed from the enrolled secret and verified.
 */
export function demoSignIn(s: Svc, input: { persona: string }): { token: string; userId: Id } {
  requireWritable(s);
  const user = s.db.find('users', (u) => u.persona === input.persona);
  if (!user || !user.passwordHash) fail('NOT_FOUND', 'Demo persona not found.');
  const result = login(s, { identifier: user.email ?? user.phone ?? '', password: DEMO_PASSWORD });
  if (result.status === 'signed_in') return { token: result.token, userId: user.id };
  if (result.status === 'mfa_required') {
    const code = totpAt(user.mfa!.totpSecret, s.now);
    const { token } = verifyMfa(s, { challengeToken: result.challengeToken, code });
    return { token, userId: user.id };
  }
  fail('CONFLICT', 'Persona needs verification.');
}

/** DEMO ONLY — the current authenticator code for a demo persona (shown in the presenter helper). */
export function demoAuthenticatorCode(s: Svc, input: { identifier: string }): { code: string | null; secondsLeft: number } {
  const user = findByIdentifier(s, input.identifier ?? '');
  if (!user?.persona || !user.mfa) return { code: null, secondsLeft: 0 };
  return { code: totpAt(user.mfa.totpSecret, s.now), secondsLeft: 30 - (Math.floor(s.now / 1000) % 30) };
}

export function touchSession(s: Svc): void {
  const session = s.actor.session;
  if (!session || s.now - session.lastSeenAt < 60_000) return;
  const user = s.db.get('users', session.userId);
  const idle = user?.platformRole ? ADMIN_IDLE_MS : SESSION_IDLE_MS;
  s.db.update('sessions', session.id, (x) => {
    x.lastSeenAt = s.now;
    x.idleExpiresAt = Math.min(x.absoluteExpiresAt, s.now + idle);
  });
}
