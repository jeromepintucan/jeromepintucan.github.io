/**
 * SuperAdmin control center (build step 14): overview & alerts, users, platform-wide lists, commission
 * agreements and fee schedules with maker-checker approval, configuration, support mode (impersonation),
 * security events and the audit log.
 */

import { canonicalJson, sha256Hex } from '../domain/crypto.ts';
import { fail, invalid } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { ACCOUNTS } from '../domain/ledger.ts';
import { formatPHP, formatPpm } from '../domain/money.ts';
import type { FeeSchedule } from '../domain/pricing.ts';
import { DAY, formatDateLong, MINUTE } from '../domain/time.ts';
import { platformBalance } from './ledgerSvc.ts';
import type { ApprovalRequest, CommissionAgreement, Id } from './model.ts';
import { audit, contactFor, displayName, notify, pageOf, requireBusiness, requirePlatform, securityEvent, settings, verifyAuditChain, type Svc } from './svc.ts';

export function platformOverview(s: Svc) {
  requirePlatform(s, 'platform.overview.view');
  const since = s.now - 30 * DAY;
  const captured = s.db.filter('payments', (p) => p.capturedAt !== null && p.capturedAt >= since);
  const gbv = captured.reduce((a, p) => a + p.amount, 0);
  const commission = platformBalance(s.db, ACCOUNTS.commissionRevenue, since);
  const fees = platformBalance(s.db, ACCOUNTS.feeExpense, since);
  const feeRecovery = platformBalance(s.db, ACCOUNTS.feeRecovery, since);
  const venueNet = captured.reduce((a, p) => a + (s.db.get('snapshots', p.snapshotId)?.quote.venueNet ?? 0), 0);
  const failed = s.db.filter('payments', (p) => p.status === 'failed' && p.createdAt >= s.now - 7 * DAY);
  const alerts: { severity: 'critical' | 'warning' | 'info'; title: string; detail: string; link: string }[] = [];
  const pendingBiz = s.db.count('businesses', (b) => b.status === 'pending_verification');
  if (pendingBiz) alerts.push({ severity: 'warning', title: `${pendingBiz} business verification(s) waiting`, detail: 'Review documents and approve or request information.', link: '#/admin/businesses' });
  const failedPayouts = s.db.filter('payouts', (p) => p.status === 'failed');
  if (failedPayouts.length) alerts.push({ severity: 'critical', title: `${failedPayouts.length} payout(s) failed`, detail: failedPayouts.map((p) => `${s.db.get('businesses', p.businessId)?.tradeName}: ${p.failureReason}`).join('; '), link: '#/admin/payouts' });
  const refundApprovals = s.db.count('refunds', (r) => r.status === 'pending_approval' && r.needsPlatformApproval && !r.needsBusinessApproval);
  if (refundApprovals) alerts.push({ severity: 'warning', title: `${refundApprovals} refund(s) need platform approval`, detail: 'Over threshold or after payout.', link: '#/admin/refunds' });
  const failedRefunds = s.db.count('refunds', (r) => r.status === 'failed');
  if (failedRefunds) alerts.push({ severity: 'critical', title: `${failedRefunds} refund(s) failed at the provider`, detail: 'Retry or refund manually with approval.', link: '#/admin/refunds' });
  const disputes = s.db.count('disputes', (d) => d.status === 'open' || d.status === 'evidence_submitted');
  if (disputes) alerts.push({ severity: 'warning', title: `${disputes} open dispute(s)`, detail: 'Submit evidence before the due date.', link: '#/admin/disputes' });
  const dbl = s.db.count('securityEvents', (e) => e.type === 'double_booking_blocked' && e.at >= s.now - 7 * DAY);
  if (dbl) alerts.push({ severity: 'info', title: `${dbl} double-booking attempt(s) blocked this week`, detail: 'The booking_slots no-overlap constraint rejected overlapping holds.', link: '#/admin/security' });
  const webhookBad = s.db.count('securityEvents', (e) => e.type === 'webhook_token_invalid' && e.at >= s.now - 7 * DAY);
  if (webhookBad) alerts.push({ severity: 'critical', title: `${webhookBad} forged webhook(s) rejected`, detail: 'Invalid x-callback-token.', link: '#/admin/security' });
  const healed = s.db.count('securityEvents', (e) => e.type === 'reconciliation_healed' && e.at >= s.now - 7 * DAY);
  if (healed) alerts.push({ severity: 'info', title: `${healed} payment(s) confirmed by reconciliation`, detail: 'Webhooks were missed or late; the provider query confirmed them.', link: '#/admin/transactions' });
  if (failed.length >= 3) alerts.push({ severity: 'warning', title: `${failed.length} failed payment attempts in 7 days`, detail: 'Mostly declined e-wallet balances; monitor for provider issues.', link: '#/admin/transactions' });
  const pendingApprovals = s.db.count('approvals', (a) => a.status === 'pending');
  if (pendingApprovals) alerts.push({ severity: 'warning', title: `${pendingApprovals} change(s) awaiting second approval`, detail: 'Commission or fee schedule changes (maker-checker).', link: '#/admin/commissions' });
  const days: { date: number; gbv: number; bookings: number }[] = [];
  for (let d = 29; d >= 0; d--) {
    const start = s.now - (d + 1) * DAY;
    const end = s.now - d * DAY;
    const ps = captured.filter((p) => p.capturedAt! >= start && p.capturedAt! < end);
    days.push({ date: end, gbv: ps.reduce((a, p) => a + p.amount, 0), bookings: ps.length });
  }
  return {
    kpis: {
      gbv,
      commission,
      fees,
      feeRecovery,
      venueNet,
      payments: captured.length,
      failedPayments: failed.length,
      activeBusinesses: s.db.count('businesses', (b) => b.status === 'active'),
      venues: s.db.count('venues', (v) => v.status === 'published'),
      users: s.db.count('users', (u) => u.status === 'active' && !u.platformRole),
      bookings30d: s.db.count('bookings', (b) => b.createdAt >= since && !['draft', 'expired', 'failed'].includes(b.status)),
    },
    alerts,
    days,
  };
}

export function adminUsers(s: Svc, input: { q?: string; limit?: number; cursor?: string }) {
  requirePlatform(s, 'platform.users.view');
  const q = (input.q ?? '').toLowerCase();
  const rows = s.db
    .filter('users', (u) => !q || displayName(s.db, u.id).toLowerCase().includes(q) || (u.email ?? '').includes(q))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((u) => ({ id: u.id, name: displayName(s.db, u.id), contact: contactFor(u), status: u.status, platformRole: u.platformRole, mfa: !!u.mfa, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, bookings: s.db.count('bookings', (b) => b.userId === u.id && b.status !== 'draft'), businesses: s.db.count('members', (m) => m.userId === u.id && m.status === 'active'), persona: u.persona ?? null }));
  return pageOf(rows, input.limit ?? 50, input.cursor);
}

export function setUserSuspension(s: Svc, input: { userId: Id; suspend: boolean; reason: string }) {
  const admin = requirePlatform(s, 'platform.users.suspend', { write: true });
  const u = s.db.must('users', input.userId, 'user');
  if (u.platformRole) fail('FORBIDDEN', 'Platform staff accounts are managed through the access review process.');
  if (!input.reason?.trim()) invalid([{ field: 'reason', message: 'A reason is required.' }]);
  s.db.update('users', u.id, (x) => {
    x.status = input.suspend ? 'suspended' : 'active';
    x.statusReason = input.reason.trim();
  });
  if (input.suspend) for (const sess of s.db.filter('sessions', (x) => x.userId === u.id && !x.revokedAt)) s.db.update('sessions', sess.id, (x) => {
    x.revokedAt = s.now;
    x.revokeReason = 'account_suspended';
  });
  audit(s, { action: input.suspend ? 'user.suspended' : 'user.reactivated', targetType: 'user', targetId: u.id, summary: `${input.suspend ? 'Suspended' : 'Reactivated'} ${displayName(s.db, u.id)}`, reason: input.reason });
  void admin;
  return { ok: true };
}

export function adminBookings(s: Svc, input: { status?: string; businessId?: Id; limit?: number; cursor?: string }) {
  requirePlatform(s, 'platform.bookings.view');
  const rows = s.db
    .filter('bookings', (b) => b.status !== 'draft' && (!input.status || b.status === input.status) && (!input.businessId || b.businessId === input.businessId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((b) => ({ booking: b, venue: s.db.get('venues', b.venueId)?.name ?? '', court: s.db.get('courts', b.courtId)?.name ?? '', player: displayName(s.db, b.userId), total: s.db.get('snapshots', b.snapshotId)?.quote.total ?? 0 }));
  return pageOf(rows, input.limit ?? 50, input.cursor);
}

export function adminJournals(s: Svc, input: { businessId?: Id; type?: string; limit?: number; cursor?: string }) {
  requirePlatform(s, 'platform.transactions.view');
  const rows = s.db.filter('journals', (j) => (!input.businessId || j.businessId === input.businessId) && (!input.type || j.type === input.type)).sort((a, b) => b.seq - a.seq);
  return pageOf(rows, input.limit ?? 50, input.cursor);
}

export function adminPayments(s: Svc, input: { status?: string; limit?: number; cursor?: string }) {
  requirePlatform(s, 'platform.transactions.view');
  const rows = s.db
    .filter('payments', (p) => p.status !== 'created' && (!input.status || p.status === input.status))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((p) => ({ payment: p, business: s.db.get('businesses', p.businessId)?.tradeName ?? '', customer: displayName(s.db, p.userId) }));
  return pageOf(rows, input.limit ?? 50, input.cursor);
}

export function adminRefunds(s: Svc) {
  requirePlatform(s, 'platform.transactions.view');
  return s.db
    .all('refunds')
    .sort((a, b) => (a.status === 'pending_approval' ? 0 : 1) - (b.status === 'pending_approval' ? 0 : 1) || b.createdAt - a.createdAt)
    .map((r) => ({ refund: r, business: s.db.get('businesses', r.businessId)?.tradeName ?? '', customer: displayName(s.db, r.userId), requestedBy: displayName(s.db, r.requestedBy) }));
}

export function ledgerTotals(s: Svc) {
  requirePlatform(s, 'platform.transactions.view');
  return Object.fromEntries(Object.entries(ACCOUNTS).map(([k, acc]) => [k, platformBalance(s.db, acc)]));
}

// ---------------------------------------------------------------- commission agreements (maker-checker)

export function commissionAgreements(s: Svc) {
  requirePlatform(s, 'platform.commissions.manage');
  return {
    agreements: s.db.all('commissionAgreements').sort((a, b) => b.createdAt - a.createdAt).map((a) => ({ agreement: a, business: a.businessId ? s.db.get('businesses', a.businessId)?.tradeName ?? '' : 'Platform default', createdBy: displayName(s.db, a.createdBy), approvedBy: a.approvedBy ? displayName(s.db, a.approvedBy) : null })),
    approvals: s.db.all('approvals').sort((a, b) => b.requestedAt - a.requestedAt).map((a) => ({ approval: a, requestedBy: displayName(s.db, a.requestedBy), decidedBy: a.decidedBy ? displayName(s.db, a.decidedBy) : null })),
    businesses: s.db.filter('businesses', (b) => b.status === 'active').map((b) => ({ id: b.id, name: b.tradeName })),
  };
}

export function proposeCommission(s: Svc, input: { businessId: Id | null; ratePpm: number; effectiveFrom: number; effectiveTo: number | null; appliesToProducts: boolean; appliesToEvents: boolean; note: string }) {
  const maker = requirePlatform(s, 'platform.commissions.manage', { write: true });
  if (!(Number.isInteger(input.ratePpm) && input.ratePpm >= 0 && input.ratePpm <= 300_000)) invalid([{ field: 'rate', message: 'Commission must be between 0% and 30%.' }]);
  if (input.effectiveTo !== null && input.effectiveTo <= input.effectiveFrom) invalid([{ field: 'effectiveTo', message: 'End must be after start.' }]);
  if (!input.note?.trim()) invalid([{ field: 'note', message: 'Reference the approved commercial agreement.' }]);
  if (input.businessId && !s.db.get('businesses', input.businessId)) fail('NOT_FOUND', 'Business not found.');
  const agreement: CommissionAgreement = { id: newId('cag'), businessId: input.businessId, ratePpm: input.ratePpm, appliesToProducts: input.appliesToProducts, appliesToEvents: input.appliesToEvents, effectiveFrom: Math.max(input.effectiveFrom, s.now), effectiveTo: input.effectiveTo, status: 'pending_approval', note: input.note.trim(), createdBy: maker.id, createdAt: s.now, approvedBy: null, approvedAt: null, approvalId: null };
  const payload = { agreementId: agreement.id, businessId: agreement.businessId, ratePpm: agreement.ratePpm, effectiveFrom: agreement.effectiveFrom, effectiveTo: agreement.effectiveTo };
  const approval: ApprovalRequest = { id: newId('apr'), kind: 'commission_agreement', businessId: input.businessId, payload, payloadHash: sha256Hex(canonicalJson(payload)), summary: `${input.businessId ? s.db.must('businesses', input.businessId).tradeName : 'Platform default'}: ${formatPpm(input.ratePpm)} from ${formatDateLong(agreement.effectiveFrom)}`, requestedBy: maker.id, requestedAt: s.now, status: 'pending', decidedBy: null, decidedAt: null, note: null };
  agreement.approvalId = approval.id;
  s.db.insert('commissionAgreements', agreement);
  s.db.insert('approvals', approval);
  audit(s, { action: 'commission.proposed', targetType: 'commission_agreement', targetId: agreement.id, businessId: input.businessId, summary: `Proposed ${approval.summary}`, after: payload, reason: input.note });
  return { agreement, approval };
}

export function proposeFeeSchedule(s: Svc, input: { schedule: FeeSchedule; note: string }) {
  const maker = requirePlatform(s, 'platform.config.manage', { write: true });
  const f = input.schedule;
  const current = settings(s.db).feeSchedules.find((x) => x.method === f.method);
  if (!current) fail('NOT_FOUND', 'Unknown payment method.');
  if (f.passThrough && current.passThroughLockedReason) fail('FORBIDDEN', `Fee pass-through is locked for ${current.label}: ${current.passThroughLockedReason}`);
  if (!(f.percentPpm >= 0 && f.percentPpm <= 100_000 && f.fixed >= 0 && f.fixed <= 10_000)) invalid([{ field: 'percent', message: 'Fee must be 0–10% plus ₱0–₱100.' }]);
  const payload = { method: f.method, percentPpm: f.percentPpm, fixed: f.fixed, passThrough: f.passThrough, enabled: f.enabled };
  const approval: ApprovalRequest = { id: newId('apr'), kind: 'fee_schedule', businessId: null, payload, payloadHash: sha256Hex(canonicalJson(payload)), summary: `${current.label}: ${formatPpm(f.percentPpm)} + ${formatPHP(f.fixed)}, pass-through ${f.passThrough ? 'ON' : 'OFF'}, ${f.enabled ? 'enabled' : 'disabled'}`, requestedBy: maker.id, requestedAt: s.now, status: 'pending', decidedBy: null, decidedAt: null, note: input.note?.trim() || null };
  s.db.insert('approvals', approval);
  audit(s, { action: 'fee_schedule.proposed', targetType: 'fee_schedule', targetId: f.method, summary: `Proposed ${approval.summary}`, before: current, after: payload, reason: input.note });
  return approval;
}

export function decideApproval(s: Svc, input: { approvalId: Id; approve: boolean; note?: string }) {
  const approval = s.db.must('approvals', input.approvalId, 'approval');
  const perm = approval.kind === 'fee_schedule' ? 'platform.config.manage' : 'platform.commissions.manage';
  const checker = requirePlatform(s, perm, { write: true });
  if (approval.status !== 'pending') fail('INVALID_STATE_TRANSITION', 'Already decided.');
  if (approval.requestedBy === checker.id) fail('FORBIDDEN', 'Maker-checker: a different administrator must approve this change.');
  if (sha256Hex(canonicalJson(approval.payload)) !== approval.payloadHash) fail('CONFLICT', 'The request changed after it was submitted.');
  s.db.update('approvals', approval.id, (a) => {
    a.status = input.approve ? 'approved' : 'rejected';
    a.decidedBy = checker.id;
    a.decidedAt = s.now;
    a.note = input.note?.trim() || a.note;
  });
  if (approval.kind === 'commission_agreement') {
    const ag = s.db.must('commissionAgreements', String(approval.payload['agreementId']));
    if (!input.approve) s.db.update('commissionAgreements', ag.id, (x) => {
      x.status = 'rejected';
    });
    else {
      // Close the currently active agreement for the same scope at the new start.
      for (const prev of s.db.filter('commissionAgreements', (x) => x.id !== ag.id && x.businessId === ag.businessId && x.status === 'active' && (x.effectiveTo === null || x.effectiveTo > ag.effectiveFrom))) {
        s.db.update('commissionAgreements', prev.id, (x) => {
          x.effectiveTo = ag.effectiveFrom;
          if (ag.effectiveFrom <= s.now) x.status = 'superseded';
        });
      }
      s.db.update('commissionAgreements', ag.id, (x) => {
        x.status = 'active';
        x.approvedBy = checker.id;
        x.approvedAt = s.now;
      });
      if (ag.businessId) {
        const b = s.db.must('businesses', ag.businessId);
        notify(s, b.ownerUserId, 'payouts', { title: 'Commission agreement updated', body: `From ${formatDateLong(ag.effectiveFrom)}, CourtKo's commission on your bookings is ${formatPpm(ag.ratePpm)}. Existing bookings keep the rate shown on their receipts.`, link: '#/biz/payouts' });
      }
    }
  } else if (approval.kind === 'fee_schedule' && input.approve) {
    const p = approval.payload as unknown as Pick<FeeSchedule, 'method' | 'percentPpm' | 'fixed' | 'passThrough' | 'enabled'>;
    s.db.update('settings', 'platform', (x) => {
      x.feeSchedules = x.feeSchedules.map((f) => (f.method === p.method ? { ...f, percentPpm: p.percentPpm, fixed: p.fixed, passThrough: f.passThroughLockedReason ? false : p.passThrough, enabled: p.enabled } : f));
      x.updatedAt = s.now;
      x.updatedBy = checker.id;
    });
  }
  audit(s, { action: `approval.${input.approve ? 'approved' : 'rejected'}`, targetType: approval.kind, targetId: approval.id, businessId: approval.businessId, summary: `${input.approve ? 'Approved' : 'Rejected'}: ${approval.summary}`, reason: input.note ?? null });
  return s.db.must('approvals', approval.id);
}

// ---------------------------------------------------------------- configuration

export function platformConfig(s: Svc) {
  requirePlatform(s, 'platform.config.manage');
  return settings(s.db);
}

export function toggleFeatureFlag(s: Svc, input: { key: string; enabled: boolean }) {
  requirePlatform(s, 'platform.config.manage', { write: true });
  const cfg = settings(s.db);
  if (!cfg.featureFlags[input.key]) fail('NOT_FOUND', 'Unknown flag.');
  const before = cfg.featureFlags[input.key]!.enabled;
  s.db.update('settings', 'platform', (x) => {
    x.featureFlags[input.key]!.enabled = input.enabled;
    x.updatedAt = s.now;
  });
  audit(s, { action: 'config.feature_flag', targetType: 'feature_flag', targetId: input.key, summary: `${input.key}: ${before ? 'on' : 'off'} → ${input.enabled ? 'on' : 'off'}`, before, after: input.enabled });
  return settings(s.db).featureFlags;
}

export function updateRefundThreshold(s: Svc, input: { amount: number }) {
  requirePlatform(s, 'platform.config.manage', { write: true });
  if (!(input.amount >= 50_000 && input.amount <= 10_000_000)) invalid([{ field: 'amount', message: 'Between ₱500 and ₱100,000.' }]);
  const before = settings(s.db).refundPlatformApprovalThreshold;
  s.db.update('settings', 'platform', (x) => {
    x.refundPlatformApprovalThreshold = input.amount;
  });
  audit(s, { action: 'config.refund_threshold', targetType: 'setting', targetId: 'refundPlatformApprovalThreshold', summary: `Refund approval threshold ${formatPHP(before)} → ${formatPHP(input.amount)}` });
  return { ok: true };
}

// ---------------------------------------------------------------- support mode

export function startSupportSession(s: Svc, input: { targetUserId: Id; reason: string; ticketRef: string; minutes: number }) {
  const admin = requirePlatform(s, 'platform.support.impersonate', { write: true });
  if (!s.actor.session) fail('UNAUTHENTICATED');
  const target = s.db.must('users', input.targetUserId, 'user');
  if (target.platformRole) fail('FORBIDDEN', 'Platform staff accounts cannot be impersonated.');
  if ((input.reason ?? '').trim().length < 15) invalid([{ field: 'reason', message: 'Explain why you need access (at least 15 characters).' }]);
  if (!/^SUP-\d{4,}$/.test((input.ticketRef ?? '').trim())) invalid([{ field: 'ticketRef', message: 'Enter the support ticket reference (e.g. SUP-1043).' }]);
  const minutes = Math.min(30, Math.max(5, Math.floor(input.minutes || 15)));
  const sup = { id: newId('sup'), adminUserId: admin.id, adminSessionId: s.actor.session.id, targetType: 'user' as const, targetId: target.id, targetUserId: target.id, reason: input.reason.trim(), ticketRef: input.ticketRef.trim(), startedAt: s.now, expiresAt: s.now + minutes * MINUTE, endedAt: null, mode: 'read_only' as const };
  s.db.insert('supportSessions', sup);
  s.db.update('sessions', s.actor.session.id, (x) => {
    x.supportSessionId = sup.id;
  });
  securityEvent(s, { type: 'support_session_started', severity: 'warning', userId: admin.id, businessId: null, detail: `Read-only support session on ${displayName(s.db, target.id)} for ${minutes} min (${sup.ticketRef})` });
  audit(s, { action: 'support.session_started', targetType: 'user', targetId: target.id, summary: `Started read-only support session (${minutes} min, ${sup.ticketRef})`, reason: sup.reason });
  return sup;
}

export function endSupportSession(s: Svc) {
  const sess = s.actor.session;
  if (!sess?.supportSessionId) fail('CONFLICT', 'No support session is active.');
  const sup = s.db.must('supportSessions', sess.supportSessionId);
  s.db.update('supportSessions', sup.id, (x) => {
    x.endedAt = x.endedAt ?? s.now;
  });
  s.db.update('sessions', sess.id, (x) => {
    x.supportSessionId = null;
  });
  securityEvent(s, { type: 'support_session_ended', severity: 'info', userId: sup.adminUserId, businessId: null, detail: `Support session ${sup.ticketRef} ended` });
  audit(s, { action: 'support.session_ended', targetType: 'user', targetId: sup.targetUserId, summary: `Ended support session ${sup.ticketRef}` });
  // Transparency: the user is told their account was viewed by support.
  notify(s, sup.targetUserId, 'account_security', { title: 'CourtKo Support viewed your account', body: `A support agent viewed your account (read-only) for ticket ${sup.ticketRef}. No changes were made.` });
  return { ok: true };
}

export function supportSessions(s: Svc) {
  requirePlatform(s, 'platform.support.impersonate');
  return s.db.all('supportSessions').sort((a, b) => b.startedAt - a.startedAt).map((x) => ({ session: x, admin: displayName(s.db, x.adminUserId), target: displayName(s.db, x.targetUserId), active: !x.endedAt && s.now < x.expiresAt }));
}

export function expireSupportSessions(s: Svc): number {
  let n = 0;
  for (const sup of s.db.filter('supportSessions', (x) => !x.endedAt && s.now >= x.expiresAt)) {
    s.db.update('supportSessions', sup.id, (x) => {
      x.endedAt = x.expiresAt;
    });
    const sess = s.db.get('sessions', sup.adminSessionId);
    if (sess?.supportSessionId === sup.id) s.db.update('sessions', sess.id, (x) => {
      x.supportSessionId = null;
    });
    audit(s, { action: 'support.session_expired', targetType: 'user', targetId: sup.targetUserId, summary: `Support session ${sup.ticketRef} expired automatically` });
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- security & audit

export function securityEvents(s: Svc, input: { type?: string }) {
  requirePlatform(s, 'platform.security.view');
  return s.db
    .filter('securityEvents', (e) => !input.type || e.type === input.type)
    .sort((a, b) => b.at - a.at)
    .slice(0, 200)
    .map((e) => ({ event: e, user: e.userId ? displayName(s.db, e.userId) : null }));
}

export function auditLog(s: Svc, input: { businessId?: Id; q?: string; limit?: number; cursor?: string }) {
  if (input.businessId) requireBusiness(s, input.businessId, 'audit.view');
  else requirePlatform(s, 'platform.audit.view');
  const q = (input.q ?? '').toLowerCase();
  const rows = s.db.filter('audit', (a) => (!input.businessId || a.businessId === input.businessId) && (!q || a.action.includes(q) || a.summary.toLowerCase().includes(q) || a.actorLabel.toLowerCase().includes(q))).sort((a, b) => b.seq - a.seq);
  return pageOf(rows, input.limit ?? 50, input.cursor);
}

export function verifyAudit(s: Svc) {
  requirePlatform(s, 'platform.audit.view');
  return verifyAuditChain(s.db);
}
