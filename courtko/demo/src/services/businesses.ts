/**
 * Business onboarding & verification (build step 4). Documents are validated (type/size/name) and only
 * metadata is kept in the demo — file contents never leave the browser. Payout account connection is a
 * PLACEHOLDER for Xendit sub-account KYB.
 */

import { fail, invalid, type FieldError } from '../domain/errors.ts';
import { newId, slugify } from '../domain/ids.ts';
import { BUSINESS_ROLE_TEMPLATES, type BusinessRoleKey } from '../domain/rbac.ts';
import { BUSINESS_TRANSITIONS, transition } from '../domain/state.ts';
import { isEmail, normalizePhMobile, requireText, validateUpload } from '../domain/validation.ts';
import type { Business, DocumentType, Id, Role } from './model.ts';
import * as provider from './provider.ts';
import { audit, displayName, notify, notifyBusiness, pageOf, requireBusiness, requirePlatform, requireVerifiedUser, requireWritable, type Svc } from './svc.ts';
import type { Db } from './store.ts';

export const DOCUMENT_LABEL: Record<DocumentType, string> = {
  dti_sec_registration: 'DTI / SEC / CDA registration',
  bir_cor_2303: 'BIR Certificate of Registration (Form 2303)',
  mayors_permit: "Mayor's / Business permit",
  owner_valid_id: 'Valid government ID of the owner',
  proof_of_bank_account: 'Proof of bank account (for payouts)',
};
export const REQUIRED_DOCUMENTS: DocumentType[] = ['dti_sec_registration', 'bir_cor_2303', 'mayors_permit', 'owner_valid_id'];

export function seedSystemRoles(db: Db | null, businessId: Id, now: number): Role[] {
  void db;
  return (Object.keys(BUSINESS_ROLE_TEMPLATES) as BusinessRoleKey[]).map((key) => ({
    id: `rol_${businessId.slice(4)}_${key}`,
    businessId,
    key,
    name: BUSINESS_ROLE_TEMPLATES[key].name,
    description: BUSINESS_ROLE_TEMPLATES[key].description,
    permissions: [...BUSINESS_ROLE_TEMPLATES[key].permissions],
    system: true,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  }));
}

export function registerBusiness(
  s: Svc,
  input: { legalName: string; tradeName: string; type: Business['type']; registrationNo: string; tin: string; contactEmail: string; contactPhone: string; line1: string; barangay: string; city: string; province: string; description?: string; vatRegistered: boolean },
) {
  requireWritable(s);
  const user = requireVerifiedUser(s);
  const errors: FieldError[] = [];
  const legalName = requireText(errors, 'legalName', input.legalName, 'Registered business name', { min: 3, max: 120 });
  const tradeName = requireText(errors, 'tradeName', input.tradeName, 'Trade name', { min: 2, max: 80 });
  const registrationNo = requireText(errors, 'registrationNo', input.registrationNo, 'Registration number', { min: 4, max: 40 });
  const tinDigits = (input.tin ?? '').replace(/\D/g, '');
  if (!(tinDigits.length === 9 || tinDigits.length === 12 || tinDigits.length === 14)) errors.push({ field: 'tin', message: 'Enter a valid TIN (9–14 digits).' });
  if (!isEmail(input.contactEmail ?? '')) errors.push({ field: 'contactEmail', message: 'Enter a valid business email.' });
  const phone = normalizePhMobile(input.contactPhone ?? '');
  if (!phone) errors.push({ field: 'contactPhone', message: 'Enter a valid PH mobile number.' });
  const line1 = requireText(errors, 'line1', input.line1, 'Street address', { max: 120 });
  const barangay = requireText(errors, 'barangay', input.barangay, 'Barangay', { max: 60 });
  const city = requireText(errors, 'city', input.city, 'City / municipality', { max: 60 });
  const province = requireText(errors, 'province', input.province, 'Province', { max: 60 });
  if (!['sole_proprietorship', 'partnership', 'corporation', 'cooperative'].includes(input.type)) errors.push({ field: 'type', message: 'Choose a business type.' });
  if (errors.length) invalid(errors);
  if (s.db.find('members', (m) => m.userId === user.id && m.status === 'active' && s.db.get('businesses', m.businessId)?.status === 'draft')) fail('CONFLICT', 'You already have a business registration in progress.');
  const id = newId('biz');
  let slug = slugify(tradeName);
  if (s.db.find('businesses', (b) => b.slug === slug)) slug = `${slug}-${id.slice(-4)}`;
  const business: Business = {
    id,
    legalName,
    tradeName,
    slug,
    type: input.type,
    registrationNo,
    tinMasked: `•••-•••-${tinDigits.slice(6, 9) || '000'}`,
    vatRegistered: !!input.vatRegistered,
    pricesIncludeVat: true,
    ownerUserId: user.id,
    contactEmail: input.contactEmail.trim().toLowerCase(),
    contactPhone: phone!,
    address: { line1, barangay, city, province, region: '', postalCode: '' },
    description: (input.description ?? '').trim().slice(0, 600),
    status: 'draft',
    history: [],
    settlementModel: 'provider_split',
    payoutAccount: { status: 'not_connected', providerSubAccountId: null, bankName: null, accountMasked: null, updatedAt: null },
    createdAt: s.now,
    submittedAt: null,
    approvedAt: null,
    approvedBy: null,
  };
  s.db.insert('businesses', business);
  const roles = seedSystemRoles(null, id, s.now);
  for (const r of roles) s.db.insert('roles', r);
  s.db.insert('members', { id: newId('mem'), businessId: id, userId: user.id, status: 'active', roleIds: [roles.find((r) => r.key === 'business_owner')!.id], venueIds: null, invitedBy: user.id, invitedAt: s.now, joinedAt: s.now, title: 'Owner' });
  audit(s, { action: 'business.registered', targetType: 'business', targetId: id, businessId: id, summary: `Registered ${tradeName} (${legalName})` });
  return business;
}

export function submitVerification(s: Svc, input: { businessId: Id; documents: { type: DocumentType; fileName: string; sizeBytes: number; mime: string }[] }) {
  const acc = requireBusiness(s, input.businessId, 'business.settings.manage', { write: true });
  if (acc.business.status !== 'draft' && acc.business.status !== 'rejected') fail('INVALID_STATE_TRANSITION', 'Verification was already submitted.');
  const errors: FieldError[] = [];
  for (const d of input.documents) {
    const problem = validateUpload({ name: d.fileName, size: d.sizeBytes, type: d.mime });
    if (problem) errors.push({ field: d.type, message: `${DOCUMENT_LABEL[d.type]}: ${problem}` });
  }
  for (const req of REQUIRED_DOCUMENTS) if (!input.documents.some((d) => d.type === req)) errors.push({ field: req, message: `${DOCUMENT_LABEL[req]} is required.` });
  if (errors.length) invalid(errors);
  s.db.insert('verifications', {
    id: newId('ver'),
    businessId: input.businessId,
    status: 'submitted',
    documents: input.documents.map((d) => ({ id: newId('doc'), type: d.type, fileName: d.fileName, sizeBytes: d.sizeBytes, mime: d.mime, scanStatus: 'clean', uploadedAt: s.now })),
    submittedAt: s.now,
    submittedBy: acc.user.id,
    reviewedAt: null,
    reviewedBy: null,
    decisionNote: null,
  });
  s.db.update('businesses', input.businessId, (b) => {
    b.submittedAt = s.now;
    if (b.status === 'rejected') transition(BUSINESS_TRANSITIONS, b, 'draft', s.now, acc.user.id, 'Resubmitting', 'business');
    transition(BUSINESS_TRANSITIONS, b, 'pending_verification', s.now, acc.user.id, 'Documents submitted', 'business');
  });
  audit(s, { action: 'business.verification_submitted', targetType: 'business', targetId: input.businessId, businessId: input.businessId, summary: `Submitted ${input.documents.length} verification document(s)` });
  notify(s, acc.user.id, 'account_security', { title: 'Verification submitted', body: 'CourtKo usually reviews documents within 1–2 business days. You can set up venues and courts meanwhile.', link: '#/biz' });
  return s.db.must('businesses', input.businessId);
}

export function updateBusinessProfile(s: Svc, input: { businessId: Id; tradeName?: string; description?: string; contactEmail?: string; contactPhone?: string; vatRegistered?: boolean; pricesIncludeVat?: boolean }) {
  const acc = requireBusiness(s, input.businessId, 'business.settings.manage', { write: true });
  const errors: FieldError[] = [];
  if (input.contactEmail !== undefined && !isEmail(input.contactEmail)) errors.push({ field: 'contactEmail', message: 'Enter a valid email.' });
  const phone = input.contactPhone !== undefined ? normalizePhMobile(input.contactPhone) : undefined;
  if (input.contactPhone !== undefined && !phone) errors.push({ field: 'contactPhone', message: 'Enter a valid PH mobile number.' });
  if (errors.length) invalid(errors);
  const before = { tradeName: acc.business.tradeName, vatRegistered: acc.business.vatRegistered, pricesIncludeVat: acc.business.pricesIncludeVat };
  s.db.update('businesses', input.businessId, (b) => {
    if (input.tradeName?.trim()) b.tradeName = input.tradeName.trim().slice(0, 80);
    if (input.description !== undefined) b.description = input.description.trim().slice(0, 600);
    if (input.contactEmail) b.contactEmail = input.contactEmail.trim().toLowerCase();
    if (phone) b.contactPhone = phone;
    if (input.vatRegistered !== undefined) b.vatRegistered = input.vatRegistered;
    if (input.pricesIncludeVat !== undefined) b.pricesIncludeVat = input.pricesIncludeVat;
  });
  const b = s.db.must('businesses', input.businessId);
  audit(s, { action: 'business.profile_updated', targetType: 'business', targetId: b.id, businessId: b.id, summary: 'Updated business profile', before, after: { tradeName: b.tradeName, vatRegistered: b.vatRegistered, pricesIncludeVat: b.pricesIncludeVat } });
  return b;
}

/** PLACEHOLDER: in production this redirects to Xendit's sub-account onboarding/KYB. */
export function connectPayoutAccount(s: Svc, input: { businessId: Id; bankName: string; accountLast4: string }) {
  const acc = requireBusiness(s, input.businessId, 'finance.manage_payout_account', { write: true });
  if (!/^\d{4}$/.test(input.accountLast4 ?? '')) invalid([{ field: 'accountLast4', message: 'Enter the last 4 digits only — never the full account number.' }]);
  if (!input.bankName?.trim()) invalid([{ field: 'bankName', message: 'Choose your bank.' }]);
  s.db.update('businesses', input.businessId, (b) => {
    b.payoutAccount = { status: 'pending_provider_setup', providerSubAccountId: b.payoutAccount.providerSubAccountId, bankName: input.bankName.trim(), accountMasked: `${input.bankName.trim()} •••• ${input.accountLast4}`, updatedAt: s.now };
  });
  audit(s, { action: 'payout_account.changed', targetType: 'business', targetId: input.businessId, businessId: input.businessId, summary: `Payout account set to ${input.bankName.trim()} •••• ${input.accountLast4} (pending provider verification)` });
  notifyBusiness(s, input.businessId, 'finance.manage_payout_account', { title: 'Payout account changed', body: `Payouts will go to ${input.bankName.trim()} •••• ${input.accountLast4} once verified. If you didn't make this change, contact CourtKo immediately.` }, 'account_security');
  void acc;
  return s.db.must('businesses', input.businessId).payoutAccount;
}

/** DEMO: simulate the provider finishing KYB for the sub-account. */
export function simulatePayoutVerification(s: Svc, input: { businessId: Id }) {
  requireBusiness(s, input.businessId, 'finance.manage_payout_account', { write: true });
  const b = s.db.must('businesses', input.businessId);
  if (b.payoutAccount.status !== 'pending_provider_setup') fail('CONFLICT', 'Connect a payout account first.');
  const sub = b.payoutAccount.providerSubAccountId ?? provider.createSubAccount(s, b.id);
  s.db.update('businesses', b.id, (x) => {
    x.payoutAccount = { ...x.payoutAccount, status: 'verified', providerSubAccountId: sub, updatedAt: s.now };
  });
  audit(s, { action: 'payout_account.verified', targetType: 'business', targetId: b.id, businessId: b.id, summary: 'Payout account verified by provider (sandbox)' });
  return s.db.must('businesses', b.id).payoutAccount;
}

export function myBusinessOverview(s: Svc, input: { businessId: Id }) {
  const acc = requireBusiness(s, input.businessId, 'business.view');
  return { business: acc.business, verification: s.db.filter('verifications', (v) => v.businessId === input.businessId).sort((a, b) => b.submittedAt - a.submittedAt)[0] ?? null, perms: [...acc.perms], member: acc.member };
}

// ---------------------------------------------------------------- SuperAdmin

export function adminBusinesses(s: Svc, input: { status?: string; q?: string; limit?: number; cursor?: string }) {
  requirePlatform(s, 'platform.businesses.view');
  const q = (input.q ?? '').toLowerCase();
  const rows = s.db
    .filter('businesses', (b) => (!input.status || b.status === input.status) && (!q || b.tradeName.toLowerCase().includes(q) || b.legalName.toLowerCase().includes(q)))
    .sort((a, b) => (a.status === 'pending_verification' ? 0 : 1) - (b.status === 'pending_verification' ? 0 : 1) || b.createdAt - a.createdAt)
    .map((b) => ({ business: b, owner: displayName(s.db, b.ownerUserId), venues: s.db.count('venues', (v) => v.businessId === b.id), staff: s.db.count('members', (m) => m.businessId === b.id && m.status === 'active') }));
  return pageOf(rows, input.limit ?? 50, input.cursor);
}

export function adminBusinessDetail(s: Svc, input: { businessId: Id }) {
  requirePlatform(s, 'platform.businesses.view');
  const b = s.db.must('businesses', input.businessId, 'business');
  return {
    business: b,
    owner: displayName(s.db, b.ownerUserId),
    verifications: s.db.filter('verifications', (v) => v.businessId === b.id).sort((x, y) => y.submittedAt - x.submittedAt),
    venues: s.db.filter('venues', (v) => v.businessId === b.id),
    agreements: s.db.filter('commissionAgreements', (a) => a.businessId === b.id).sort((x, y) => y.createdAt - x.createdAt),
    members: s.db.filter('members', (m) => m.businessId === b.id && m.status !== 'removed').map((m) => ({ member: m, name: displayName(s.db, m.userId), roles: m.roleIds.map((r) => s.db.get('roles', r)?.name ?? '') })),
  };
}

export function decideVerification(s: Svc, input: { businessId: Id; decision: 'approve' | 'reject' | 'request_info'; note: string }) {
  const admin = requirePlatform(s, 'platform.businesses.verify', { write: true });
  const b = s.db.must('businesses', input.businessId, 'business');
  if (b.status !== 'pending_verification') fail('INVALID_STATE_TRANSITION', 'This business is not awaiting verification.');
  const v = s.db.filter('verifications', (x) => x.businessId === b.id).sort((x, y) => y.submittedAt - x.submittedAt)[0];
  if (input.decision !== 'approve' && !input.note?.trim()) invalid([{ field: 'note', message: 'Explain what is missing or why it was rejected (the owner sees this).' }]);
  if (v) s.db.update('verifications', v.id, (x) => {
    x.status = input.decision === 'approve' ? 'approved' : input.decision === 'reject' ? 'rejected' : 'info_requested';
    x.reviewedAt = s.now;
    x.reviewedBy = admin.id;
    x.decisionNote = input.note?.trim() || null;
  });
  s.db.update('businesses', b.id, (x) => {
    if (input.decision === 'approve') {
      x.approvedAt = s.now;
      x.approvedBy = admin.id;
      transition(BUSINESS_TRANSITIONS, x, 'active', s.now, admin.id, 'Verification approved', 'business');
    } else if (input.decision === 'reject') transition(BUSINESS_TRANSITIONS, x, 'rejected', s.now, admin.id, input.note, 'business');
    else transition(BUSINESS_TRANSITIONS, x, 'draft', s.now, admin.id, `More information requested: ${input.note}`, 'business');
  });
  audit(s, { action: `business.verification_${input.decision}`, targetType: 'business', targetId: b.id, businessId: b.id, summary: `${input.decision === 'approve' ? 'Approved' : input.decision === 'reject' ? 'Rejected' : 'Requested more info from'} ${b.tradeName}`, reason: input.note || null });
  notify(s, b.ownerUserId, 'account_security', {
    title: input.decision === 'approve' ? `${b.tradeName} is approved!` : input.decision === 'reject' ? 'Verification not approved' : 'More information needed',
    body: input.decision === 'approve' ? 'You can now publish venues and accept bookings. Connect your payout account to receive settlements.' : input.note,
    link: '#/biz',
  });
  return s.db.must('businesses', b.id);
}

export function setBusinessSuspension(s: Svc, input: { businessId: Id; suspend: boolean; reason: string }) {
  const admin = requirePlatform(s, 'platform.businesses.suspend', { write: true });
  const b = s.db.must('businesses', input.businessId, 'business');
  if (!input.reason?.trim()) invalid([{ field: 'reason', message: 'A reason is required.' }]);
  s.db.update('businesses', b.id, (x) => {
    x.statusReason = input.reason.trim();
    transition(BUSINESS_TRANSITIONS, x, input.suspend ? 'suspended' : 'active', s.now, admin.id, input.reason.trim(), 'business');
  });
  audit(s, { action: input.suspend ? 'business.suspended' : 'business.reactivated', targetType: 'business', targetId: b.id, businessId: b.id, summary: `${input.suspend ? 'Suspended' : 'Reactivated'} ${b.tradeName}`, reason: input.reason });
  notify(s, b.ownerUserId, 'account_security', { title: input.suspend ? `${b.tradeName} is suspended` : `${b.tradeName} is active again`, body: input.suspend ? `New bookings are paused. Existing bookings are honored. Reason: ${input.reason}` : 'Your venues are visible and bookable again.', link: '#/biz' });
  return s.db.must('businesses', b.id);
}
