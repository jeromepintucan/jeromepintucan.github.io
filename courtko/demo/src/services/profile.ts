/** Player profile, preferences, favorites, notifications, activity stats, ratings and privacy rights. */

import { fail, invalid } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { formatDateLong, DAY, HOUR } from '../domain/time.ts';
import type { ChannelPrefs, Id, NotificationCategory, SkillLevel, Visibility } from './model.ts';
import { myMemberships } from './staff.ts';
import { audit, isLockedCategory, notify, requirePlatform, requireUser, requireWritable, securityEvent, type Svc } from './svc.ts';

export function getMe(s: Svc) {
  const u = s.actor.user;
  if (!u) return null;
  const profile = s.db.get('profiles', u.id);
  return {
    user: { id: u.id, email: u.email, phone: u.phone, status: u.status, mfaEnabled: !!u.mfa, platformRole: s.actor.realUser?.platformRole ?? null, persona: u.persona ?? null, deletion: u.deletion ?? null, createdAt: u.createdAt },
    profile,
    preferences: s.db.get('preferences', u.id),
    memberships: myMemberships(s).filter((m) => m.member.status === 'active'),
    invitations: myMemberships(s).filter((m) => m.member.status === 'invited'),
    support: s.actor.support,
    realUserName: s.actor.realUser ? s.db.get('profiles', s.actor.realUser.id)?.displayName ?? '' : '',
    mfaVerified: s.actor.mfaVerified,
    unread: s.db.count('notifications', (n) => n.userId === u.id && !n.readAt),
  };
}

export function updateProfile(s: Svc, input: { firstName?: string; lastName?: string; displayName?: string; city?: string; bio?: string; skillSelf?: SkillLevel | null; visibility?: { profile?: Visibility; activity?: Visibility; ratings?: Visibility } }) {
  requireWritable(s);
  const u = requireUser(s);
  const errs = [];
  if (input.displayName !== undefined && (!input.displayName.trim() || input.displayName.length > 40)) errs.push({ field: 'displayName', message: 'Display name is required (up to 40 characters).' });
  if (input.bio !== undefined && input.bio.length > 300) errs.push({ field: 'bio', message: 'Bio is limited to 300 characters.' });
  if (errs.length) invalid(errs);
  s.db.update('profiles', u.id, (p) => {
    if (input.firstName !== undefined) p.firstName = input.firstName.trim().slice(0, 60);
    if (input.lastName !== undefined) p.lastName = input.lastName.trim().slice(0, 60);
    if (input.displayName !== undefined) p.displayName = input.displayName.trim();
    if (input.city !== undefined) p.city = input.city.trim().slice(0, 60);
    if (input.bio !== undefined) p.bio = input.bio.trim();
    if (input.skillSelf !== undefined) p.skillSelf = input.skillSelf;
    if (input.visibility) p.visibility = { ...p.visibility, ...input.visibility };
  });
  if (input.skillSelf !== undefined) {
    const r = s.db.find('ratings', (x) => x.userId === u.id && x.source === 'self_declared');
    const label = input.skillSelf ? input.skillSelf[0]!.toUpperCase() + input.skillSelf.slice(1) : 'Not set';
    if (r) s.db.update('ratings', r.id, (x) => {
      x.label = label;
      x.updatedAt = s.now;
    });
    else s.db.insert('ratings', { id: newId('rtg'), userId: u.id, source: 'self_declared', value: null, label, verifiedByBusinessId: null, updatedAt: s.now, history: [] });
  }
  return s.db.must('profiles', u.id);
}

export function updateNotificationPrefs(s: Svc, input: { category: NotificationCategory; channel: keyof ChannelPrefs; enabled: boolean }) {
  requireWritable(s);
  const u = requireUser(s);
  if (isLockedCategory(input.category) && (input.channel === 'inApp' || input.channel === 'email') && !input.enabled) fail('FORBIDDEN', 'Account, booking, payment and payout messages are required and cannot be turned off.');
  s.db.update('preferences', u.id, (p) => {
    p.notifications[input.category][input.channel] = input.enabled;
    if (input.category === 'marketing') p.marketingOptIn = p.notifications.marketing.email || p.notifications.marketing.inApp;
  });
  if (input.category === 'marketing') s.db.insert('consents', { id: newId('cns'), userId: u.id, kind: 'marketing', version: '2026-07', granted: input.enabled, at: s.now });
  return s.db.must('preferences', u.id);
}

export function setLocationConsent(s: Svc, input: { consent: 'granted' | 'denied' }) {
  if (!s.actor.user || s.actor.support) return { ok: true };
  const u = s.actor.user;
  s.db.update('preferences', u.id, (p) => {
    p.locationConsent = input.consent;
  });
  s.db.insert('consents', { id: newId('cns'), userId: u.id, kind: 'location', version: '2026-07', granted: input.consent === 'granted', at: s.now });
  return { ok: true };
}

export function setCookieConsent(s: Svc, input: { analytics: boolean }) {
  if (!s.actor.user || s.actor.support) return { ok: true };
  s.db.update('preferences', s.actor.user.id, (p) => {
    p.cookieAnalytics = input.analytics;
  });
  s.db.insert('consents', { id: newId('cns'), userId: s.actor.user.id, kind: 'cookies_analytics', version: '2026-07', granted: input.analytics, at: s.now });
  return { ok: true };
}

export function toggleFavorite(s: Svc, input: { venueId: Id }) {
  requireWritable(s);
  const u = requireUser(s);
  if (!s.db.get('venues', input.venueId)) fail('NOT_FOUND', 'Venue not found.');
  const id = `${u.id}:${input.venueId}`;
  if (s.db.get('favorites', id)) {
    s.db.remove('favorites', id);
    return { favorite: false };
  }
  s.db.insert('favorites', { id, userId: u.id, venueId: input.venueId, createdAt: s.now });
  return { favorite: true };
}

export function myFavorites(s: Svc) {
  const u = requireUser(s);
  return s.db.filter('favorites', (f) => f.userId === u.id).map((f) => s.db.get('venues', f.venueId)).filter((v) => !!v && v.status === 'published');
}

export function myNotifications(s: Svc) {
  const u = requireUser(s);
  return s.db.filter('notifications', (n) => n.userId === u.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 80);
}

export function markNotificationsRead(s: Svc, input: { notificationId?: Id }) {
  if (s.actor.support) return { ok: true };
  const u = requireUser(s);
  for (const n of s.db.filter('notifications', (x) => x.userId === u.id && !x.readAt && (!input.notificationId || x.id === input.notificationId))) s.db.update('notifications', n.id, (x) => {
    x.readAt = s.now;
  });
  return { ok: true };
}

/** Demo "inbox": the emails/SMS that would have been sent to this user (masked destinations). */
export function myMessages(s: Svc) {
  const u = requireUser(s);
  return s.db.filter('outbound', (o) => o.userId === u.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 40);
}

export function myActivity(s: Svc) {
  const u = requireUser(s);
  const mine = s.db.filter('bookings', (b) => b.userId === u.id || b.participants.some((p) => p.userId === u.id));
  const played = mine.filter((b) => b.status === 'completed' || b.status === 'checked_in');
  const hours = played.reduce((a, b) => a + b.durationMinutes, 0) / 60;
  const venues = new Set(played.map((b) => b.venueId));
  const byWeek: { weekStart: number; sessions: number; hours: number }[] = [];
  for (let w = 11; w >= 0; w--) {
    const end = s.now - w * 7 * DAY;
    const start = end - 7 * DAY;
    const inWeek = played.filter((b) => b.startMs >= start && b.startMs < end);
    byWeek.push({ weekStart: start, sessions: inWeek.length, hours: inWeek.reduce((a, b) => a + b.durationMinutes, 0) / 60 });
  }
  const venueCounts = [...venues].map((id) => ({ venue: s.db.get('venues', id)!, sessions: played.filter((b) => b.venueId === id).length })).sort((a, b) => b.sessions - a.sessions);
  const matches = s.db.filter('matches', (m) => m.sideA.includes(u.id) || m.sideB.includes(u.id));
  const wins = matches.filter((m) => (m.sideA.includes(u.id) ? m.scoreA > m.scoreB : m.scoreB > m.scoreA)).length;
  const spent = s.db.filter('payments', (p) => p.userId === u.id && ['captured', 'partially_refunded', 'refunded'].includes(p.status)).reduce((a, p) => a + p.amount - p.refundedAmount, 0);
  const first = played.length ? Math.min(...played.map((b) => b.startMs)) : s.now;
  const weeksActive = Math.max(1, (s.now - first) / (7 * DAY));
  const badges = [
    { key: 'first_serve', label: 'First serve', earned: played.length >= 1, detail: 'Played your first booked game' },
    { key: 'ten_sessions', label: 'Regular', earned: played.length >= 10, detail: '10 sessions played' },
    { key: 'explorer', label: 'Court explorer', earned: venues.size >= 3, detail: 'Played at 3 different venues' },
    { key: 'early_bird', label: 'Early bird', earned: played.some((b) => new Date(b.startMs + 8 * HOUR).getUTCHours() < 8), detail: 'Played before 8:00 AM' },
    { key: 'competitor', label: 'Competitor', earned: matches.length > 0, detail: 'Played in an officially recorded match' },
  ];
  return {
    totals: { sessions: played.length, bookings: mine.filter((b) => !['draft', 'expired', 'failed'].includes(b.status)).length, hours, venues: venues.size, upcoming: mine.filter((b) => b.status === 'confirmed' && b.startMs > s.now).length, cancelled: mine.filter((b) => ['cancelled', 'refunded', 'partially_refunded'].includes(b.status)).length, perWeek: played.length / weeksActive, spent },
    byWeek,
    venues: venueCounts,
    matches: { played: matches.length, wins, losses: matches.length - wins, recent: matches.sort((a, b) => b.recordedAt - a.recordedAt).slice(0, 5).map((m) => ({ match: m, event: s.db.get('events', m.eventId)?.name ?? '' })) },
    ratings: s.db.filter('ratings', (r) => r.userId === u.id),
    events: s.db.count('registrations', (r) => r.userId === u.id && ['confirmed', 'checked_in'].includes(r.status)),
    badges,
  };
}

// ---------------------------------------------------------------- privacy rights (DPA)

export function exportMyData(s: Svc) {
  const u = requireUser(s);
  if (s.actor.support) fail('SUPPORT_MODE_READ_ONLY', 'Data exports are not available in support mode.');
  const data = {
    generatedAt: new Date(s.now).toISOString(),
    notice: 'CourtKo demo — synthetic data. Contains the personal data we hold about you. Internal notes about you written by venues are withheld where disclosure would affect others; contact the DPO to request them.',
    account: { id: u.id, email: u.email, phone: u.phone, createdAt: new Date(u.createdAt).toISOString(), mfaEnabled: !!u.mfa },
    profile: s.db.get('profiles', u.id),
    preferences: s.db.get('preferences', u.id),
    consents: s.db.filter('consents', (c) => c.userId === u.id),
    bookings: s.db.filter('bookings', (b) => b.userId === u.id).map((b) => ({ code: b.code, venue: s.db.get('venues', b.venueId)?.name, start: new Date(b.startMs).toISOString(), status: b.status, policy: b.policy })),
    payments: s.db.filter('payments', (p) => p.userId === u.id).map((p) => ({ id: p.id, amount: p.amount, currency: p.currency, method: p.methodDisplay, status: p.status, createdAt: new Date(p.createdAt).toISOString() })),
    refunds: s.db.filter('refunds', (r) => r.userId === u.id).map((r) => ({ id: r.id, amount: r.amount, status: r.status, reason: r.reason })),
    orders: s.db.filter('orders', (o) => o.userId === u.id).map((o) => ({ code: o.code, items: o.items, status: o.status })),
    eventRegistrations: s.db.filter('registrations', (r) => r.userId === u.id),
    reviews: s.db.filter('reviews', (r) => r.userId === u.id),
    notifications: s.db.filter('notifications', (n) => n.userId === u.id).map((n) => ({ title: n.title, createdAt: new Date(n.createdAt).toISOString() })),
    loginHistory: s.db.filter('loginEvents', (e) => e.userId === u.id).map((e) => ({ at: new Date(e.at).toISOString(), outcome: e.outcome, device: e.device })),
    restrictions: s.db.filter('restrictions', (r) => r.userId === u.id).map((r) => ({ scope: r.scope, status: r.status, start: new Date(r.startAt).toISOString(), end: r.endAt ? new Date(r.endAt).toISOString() : null })),
    sportProfiles: s.db.filter('sportProfiles', (x) => x.userId === u.id),
    openPlay: s.db.filter('opRegistrations', (r) => r.userId === u.id).map((r) => ({ session: s.db.get('openPlaySessions', r.sessionId)?.title, status: r.status, attendance: r.attendance, checkedInAt: r.checkedInAt ? new Date(r.checkedInAt).toISOString() : null, gamesPlayed: r.gamesPlayed, attendanceEvents: s.db.filter('attendanceEvents', (e) => e.registrationId === r.id).map((e) => ({ type: e.type, at: new Date(e.at).toISOString(), from: e.from, to: e.to })) })),
    following: s.db.filter('follows', (f) => f.followerId === u.id).map((f) => ({ username: s.db.get('profiles', f.followeeId)?.username ?? null, status: f.status, since: new Date(f.createdAt).toISOString() })),
    followers: s.db.filter('follows', (f) => f.followeeId === u.id && f.status === 'accepted').map((f) => ({ username: s.db.get('profiles', f.followerId)?.username ?? null, since: new Date(f.createdAt).toISOString() })),
    blocked: s.db.filter('blocks', (b) => b.blockerId === u.id).map((b) => ({ username: s.db.get('profiles', b.blockedId)?.username ?? null, since: new Date(b.createdAt).toISOString() })),
  };
  s.after.push((s2) => {
    securityEvent(s2, { type: 'data_export', severity: 'info', userId: u.id, businessId: null, detail: 'Personal data export downloaded' });
    audit(s2, { action: 'privacy.data_exported', targetType: 'user', targetId: u.id, summary: 'User downloaded their personal data export' });
  });
  return data;
}

export function requestDeletion(s: Svc) {
  requireWritable(s);
  const u = requireUser(s);
  const blockers: string[] = [];
  if (s.db.find('bookings', (b) => b.userId === u.id && b.status === 'confirmed' && b.startMs > s.now)) blockers.push('Cancel or finish your upcoming bookings first.');
  if (s.db.find('refunds', (r) => r.userId === u.id && ['requested', 'pending_approval', 'approved', 'processing'].includes(r.status))) blockers.push('Wait for pending refunds to complete.');
  if (s.db.find('members', (m) => m.userId === u.id && m.status === 'active' && s.db.get('roles', m.roleIds[0] ?? '')?.key === 'business_owner')) blockers.push('Transfer or close the businesses you own first.');
  if (blockers.length) fail('CONFLICT', blockers.join(' '), { meta: { blockers } });
  const scheduledFor = s.now + 14 * DAY;
  s.db.update('users', u.id, (x) => {
    x.deletion = { requestedAt: s.now, scheduledFor, status: 'scheduled' };
  });
  audit(s, { action: 'privacy.deletion_requested', targetType: 'user', targetId: u.id, summary: `Account deletion scheduled for ${formatDateLong(scheduledFor)}` });
  notify(s, u.id, 'account_security', { title: 'Account deletion scheduled', body: `Your account will be deleted on ${formatDateLong(scheduledFor)}. You can cancel before then from Settings. Financial records are kept as required by law, without your contact details.` });
  return { scheduledFor };
}

export function cancelDeletion(s: Svc) {
  requireWritable(s);
  const u = requireUser(s);
  if (u.deletion?.status !== 'scheduled') fail('CONFLICT', 'No deletion is scheduled.');
  s.db.update('users', u.id, (x) => {
    x.deletion = { ...x.deletion!, status: 'cancelled' };
  });
  audit(s, { action: 'privacy.deletion_cancelled', targetType: 'user', targetId: u.id, summary: 'Account deletion cancelled' });
  return { ok: true };
}

/** Job: anonymize accounts whose grace period ended. Financial records are retained (legal obligation). */
export function processDeletions(s: Svc): number {
  let n = 0;
  for (const u of s.db.filter('users', (x) => x.deletion?.status === 'scheduled' && x.deletion.scheduledFor <= s.now)) {
    s.db.update('users', u.id, (x) => {
      x.email = null;
      x.phone = null;
      x.passwordHash = null;
      x.mfa = null;
      x.status = 'deleted';
      x.deletion = { ...x.deletion!, status: 'completed' };
    });
    s.db.update('profiles', u.id, (p) => {
      p.firstName = 'Former';
      p.lastName = 'player';
      p.displayName = 'Former player';
      p.bio = '';
      p.city = '';
      p.username = null;
      p.social = { ...p.social, discoverable: false, allowFollows: false };
    });
    // Social graph: follows end; blocks the user made are kept (doc 24 §15 proposal) so harassment can't resume.
    for (const f of s.db.filter('follows', (x) => (x.followerId === u.id || x.followeeId === u.id) && (x.status === 'accepted' || x.status === 'pending'))) s.db.update('follows', f.id, (x) => {
      x.status = 'removed';
      x.endedAt = s.now;
    });
    for (const sp of s.db.filter('sportProfiles', (x) => x.userId === u.id)) s.db.remove('sportProfiles', sp.id);
    for (const sess of s.db.filter('sessions', (x) => x.userId === u.id && !x.revokedAt)) s.db.update('sessions', sess.id, (x) => {
      x.revokedAt = s.now;
      x.revokeReason = 'account_deleted';
    });
    audit(s, { action: 'privacy.account_anonymized', targetType: 'user', targetId: u.id, summary: 'Account anonymized after the 14-day grace period' });
    n++;
  }
  return n;
}

export function privacyRequests(s: Svc) {
  requirePlatform(s, 'platform.privacy.requests');
  return s.db.filter('users', (u) => !!u.deletion).map((u) => ({ userId: u.id, name: s.db.get('profiles', u.id)?.displayName ?? '', deletion: u.deletion! }));
}
