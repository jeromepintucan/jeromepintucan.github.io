/**
 * Player restrictions (doc 01 §10): business- or venue-level (and platform-level for Trust & Safety).
 * Restrictions are never public; players get a neutral notice and can appeal. Only restrictions.manage
 * sees internal notes; restrictions.view sees status and reason category only.
 */

import { fail, invalid } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { formatDateLong } from '../domain/time.ts';
import type { Id, Restriction, RestrictionReason } from './model.ts';
import { audit, displayName, notify, notifyBusiness, requireBusiness, requirePlatform, requireUser, requireWritable, type Svc } from './svc.ts';

export const REASON_LABEL: Record<RestrictionReason, string> = {
  repeated_no_shows: 'Repeated no-shows',
  misconduct: 'Misconduct on premises',
  payment_abuse: 'Payment abuse',
  safety_concern: 'Safety concern',
  policy_violation: 'Venue policy violation',
  other: 'Other',
};

export function listRestrictions(s: Svc, input: { businessId: Id }) {
  const acc = requireBusiness(s, input.businessId, 'restrictions.view');
  const canManage = acc.perms.has('restrictions.manage');
  return s.db
    .filter('restrictions', (r) => r.businessId === input.businessId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({
      restriction: canManage ? r : { ...r, internalNotes: '', evidenceRef: '' },
      player: displayName(s.db, r.userId),
      venue: r.venueId ? s.db.get('venues', r.venueId)?.name ?? '' : 'All venues',
      createdBy: displayName(s.db, r.createdBy),
      canManage,
    }));
}

export function createRestriction(s: Svc, input: { businessId: Id; userId: Id; venueId?: Id | null; reasonCategory: RestrictionReason; internalNotes: string; endAt: number | null; evidenceRef?: string }) {
  const acc = requireBusiness(s, input.businessId, 'restrictions.manage', { write: true });
  if (!s.db.get('users', input.userId)) fail('NOT_FOUND', 'Player not found.');
  if (!(input.reasonCategory in REASON_LABEL)) invalid([{ field: 'reasonCategory', message: 'Choose a reason category.' }]);
  if (!input.internalNotes?.trim() || input.internalNotes.length > 1000) invalid([{ field: 'internalNotes', message: 'Describe what happened (internal only, up to 1000 characters).' }]);
  if (input.endAt !== null && input.endAt <= s.now) invalid([{ field: 'endAt', message: 'End date must be in the future.' }]);
  const isOwner = acc.member.roleIds.some((rid) => s.db.get('roles', rid)?.key === 'business_owner');
  if (input.endAt === null && !isOwner) fail('APPROVAL_REQUIRED', 'Permanent restrictions must be created or approved by the Business Owner.');
  if (input.venueId && s.db.get('venues', input.venueId)?.businessId !== input.businessId) fail('NOT_FOUND', 'Venue not found.');
  if (s.db.find('restrictions', (r) => r.userId === input.userId && r.businessId === input.businessId && r.status === 'active' && (r.venueId ?? null) === (input.venueId ?? null))) fail('CONFLICT', 'This player already has an active restriction here.');
  const r: Restriction = {
    id: newId('rst'),
    userId: input.userId,
    businessId: input.businessId,
    venueId: input.venueId ?? null,
    scope: input.venueId ? 'venue' : 'business',
    reasonCategory: input.reasonCategory,
    internalNotes: input.internalNotes.trim(),
    startAt: s.now,
    endAt: input.endAt,
    createdBy: acc.user.id,
    approvedBy: isOwner ? acc.user.id : null,
    evidenceRef: (input.evidenceRef ?? '').trim(),
    status: 'active',
    appeal: { status: 'none' },
    createdAt: s.now,
    liftedAt: null,
    liftedBy: null,
    liftReason: null,
  };
  s.db.insert('restrictions', r);
  const where = r.venueId ? s.db.must('venues', r.venueId).name : acc.business.tradeName;
  // Neutral wording: never reveals the reason or internal notes.
  notify(s, input.userId, 'account_security', {
    title: `Booking access paused at ${where}`,
    body: `You can't book at ${where}${r.endAt ? ` until ${formatDateLong(r.endAt)}` : ' until further notice'}. Other venues on CourtKo are not affected. If you think this is a mistake, you can submit an appeal.`,
    link: '#/app/notifications',
  });
  audit(s, { action: 'restriction.created', targetType: 'user', targetId: input.userId, businessId: input.businessId, summary: `Restricted ${displayName(s.db, input.userId)} at ${where} (${REASON_LABEL[r.reasonCategory]}${r.endAt ? `, until ${formatDateLong(r.endAt)}` : ', permanent'})` });
  return r;
}

export function liftRestriction(s: Svc, input: { businessId: Id; restrictionId: Id; reason: string }) {
  const r = s.db.get('restrictions', input.restrictionId);
  if (!r || r.businessId !== input.businessId) fail('NOT_FOUND', 'Restriction not found.');
  const acc = requireBusiness(s, input.businessId, 'restrictions.manage', { write: true });
  if (r.status !== 'active') fail('INVALID_STATE_TRANSITION', 'This restriction is not active.');
  if (!input.reason?.trim()) invalid([{ field: 'reason', message: 'Add a reason for lifting the restriction.' }]);
  s.db.update('restrictions', r.id, (x) => {
    x.status = 'lifted';
    x.liftedAt = s.now;
    x.liftedBy = acc.user.id;
    x.liftReason = input.reason.trim();
    if (x.appeal.status === 'submitted') x.appeal = { ...x.appeal, status: 'overturned', decidedBy: acc.user.id, decidedAt: s.now, decisionNote: input.reason.trim() };
  });
  notify(s, r.userId, 'account_security', { title: 'Booking access restored', body: `You can book at ${r.venueId ? s.db.must('venues', r.venueId).name : acc.business.tradeName} again.`, link: '#/app/discover' });
  audit(s, { action: 'restriction.lifted', targetType: 'user', targetId: r.userId, businessId: r.businessId, summary: `Lifted restriction for ${displayName(s.db, r.userId)}`, reason: input.reason });
  return s.db.must('restrictions', r.id);
}

export function decideAppeal(s: Svc, input: { businessId: Id; restrictionId: Id; decision: 'upheld' | 'overturned'; note: string }) {
  const r = s.db.get('restrictions', input.restrictionId);
  if (!r || r.businessId !== input.businessId) fail('NOT_FOUND', 'Restriction not found.');
  if (r.appeal.status !== 'submitted') fail('INVALID_STATE_TRANSITION', 'No appeal is waiting.');
  if (input.decision === 'overturned') return liftRestriction(s, { businessId: input.businessId, restrictionId: r.id, reason: `Appeal overturned: ${input.note}` });
  const acc = requireBusiness(s, input.businessId, 'restrictions.manage', { write: true });
  s.db.update('restrictions', r.id, (x) => {
    x.appeal = { ...x.appeal, status: 'upheld', decidedBy: acc.user.id, decidedAt: s.now, decisionNote: input.note.trim() };
  });
  notify(s, r.userId, 'account_security', { title: 'Appeal reviewed', body: 'The venue reviewed your appeal and the booking pause remains in place. Contact CourtKo Support if you need help.' });
  audit(s, { action: 'restriction.appeal_upheld', targetType: 'user', targetId: r.userId, businessId: r.businessId, summary: 'Appeal reviewed: restriction upheld', reason: input.note });
  return s.db.must('restrictions', r.id);
}

/** Player view: neutral information only (venue, dates, appeal status). */
export function myRestrictions(s: Svc) {
  const u = requireUser(s);
  return s.db
    .filter('restrictions', (r) => r.userId === u.id && r.status === 'active')
    .map((r) => ({ id: r.id, where: r.scope === 'platform' ? 'CourtKo' : r.venueId ? s.db.get('venues', r.venueId)?.name ?? '' : s.db.get('businesses', r.businessId ?? '')?.tradeName ?? '', endAt: r.endAt, appeal: r.appeal.status }));
}

export function submitAppeal(s: Svc, input: { restrictionId: Id; message: string }) {
  requireWritable(s);
  const u = requireUser(s);
  const r = s.db.get('restrictions', input.restrictionId);
  if (!r || r.userId !== u.id) fail('NOT_FOUND', 'Not found.');
  if (r.appeal.status !== 'none') fail('CONFLICT', 'You already submitted an appeal.');
  if (!input.message?.trim() || input.message.length > 1000) invalid([{ field: 'message', message: 'Explain your appeal (up to 1000 characters).' }]);
  s.db.update('restrictions', r.id, (x) => {
    x.appeal = { status: 'submitted', message: input.message.trim(), submittedAt: s.now };
  });
  if (r.businessId) notifyBusiness(s, r.businessId, 'restrictions.manage', { title: 'Restriction appeal received', body: `${displayName(s.db, u.id)} submitted an appeal.`, link: '#/biz/restrictions' });
  return { ok: true };
}

export function platformRestrict(s: Svc, input: { userId: Id; reasonCategory: RestrictionReason; internalNotes: string; endAt: number | null }) {
  const admin = requirePlatform(s, 'platform.restrictions.manage', { write: true });
  if (!input.internalNotes?.trim()) invalid([{ field: 'internalNotes', message: 'Notes are required.' }]);
  const r: Restriction = { id: newId('rst'), userId: input.userId, businessId: null, venueId: null, scope: 'platform', reasonCategory: input.reasonCategory, internalNotes: input.internalNotes.trim(), startAt: s.now, endAt: input.endAt, createdBy: admin.id, approvedBy: admin.id, evidenceRef: '', status: 'active', appeal: { status: 'none' }, createdAt: s.now, liftedAt: null, liftedBy: null, liftReason: null };
  s.db.insert('restrictions', r);
  notify(s, input.userId, 'account_security', { title: 'Booking access paused', body: 'Booking on CourtKo is paused for your account. Contact CourtKo Support to learn more or to appeal.' });
  audit(s, { action: 'restriction.platform_created', targetType: 'user', targetId: input.userId, summary: `Platform-level restriction (${REASON_LABEL[input.reasonCategory]})` });
  return r;
}

export function expireRestrictions(s: Svc): number {
  let n = 0;
  for (const r of s.db.filter('restrictions', (x) => x.status === 'active' && x.endAt !== null && x.endAt <= s.now)) {
    s.db.update('restrictions', r.id, (x) => {
      x.status = 'expired';
    });
    n++;
  }
  return n;
}
