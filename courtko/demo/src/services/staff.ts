/**
 * Team & roles (build step 3): invitations, role assignment with venue scoping, custom roles, and the
 * privilege-escalation guard (you can only grant permissions you hold; owner-only permissions never go into
 * custom roles). Every change is audited.
 */

import { fail, invalid } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { BUSINESS_PERMISSIONS, BUSINESS_ROLE_TEMPLATES, checkGrant, OWNER_ONLY_PERMISSIONS } from '../domain/rbac.ts';
import { isEmail, normalizeEmail } from '../domain/validation.ts';
import type { BusinessMember, Id, Role } from './model.ts';
import { activeMembership, audit, contactFor, displayName, membershipPermissions, notify, requireBusiness, requireUser, requireWritable, type Svc } from './svc.ts';

export function myMemberships(s: Svc) {
  const u = requireUser(s);
  return s.db
    .filter('members', (m) => m.userId === u.id && (m.status === 'active' || m.status === 'invited'))
    .map((m) => {
      const b = s.db.must('businesses', m.businessId);
      return { member: m, business: b, roles: m.roleIds.map((r) => s.db.get('roles', r)).filter((r): r is Role => !!r), permissions: [...membershipPermissions(s.db, m)] };
    });
}

export function listMembers(s: Svc, input: { businessId: Id }) {
  const acc = requireBusiness(s, input.businessId, 'staff.manage');
  return {
    members: s.db
      .filter('members', (m) => m.businessId === input.businessId && m.status !== 'removed')
      .map((m) => {
        const u = s.db.get('users', m.userId);
        return { member: m, name: displayName(s.db, m.userId), contact: u ? contactFor(u) : '', mfa: !!u?.mfa, roles: m.roleIds.map((r) => s.db.get('roles', r)).filter((r): r is Role => !!r), venues: m.venueIds ? m.venueIds.map((v) => s.db.get('venues', v)?.name ?? '') : null };
      }),
    roles: listRolesInternal(s, input.businessId),
    myPermissions: [...acc.perms],
  };
}

function listRolesInternal(s: Svc, businessId: Id): Role[] {
  return s.db.filter('roles', (r) => r.businessId === businessId).sort((a, b) => Number(b.system) - Number(a.system) || a.name.localeCompare(b.name));
}

export function listRoles(s: Svc, input: { businessId: Id }) {
  requireBusiness(s, input.businessId, 'staff.manage');
  return { roles: listRolesInternal(s, input.businessId), catalog: BUSINESS_PERMISSIONS, ownerOnly: OWNER_ONLY_PERMISSIONS };
}

function assertCanAssign(s: Svc, actorPerms: Set<string>, roleIds: Id[], businessId: Id): Role[] {
  const roles = roleIds.map((id) => s.db.get('roles', id));
  if (roles.some((r) => !r || r.businessId !== businessId)) fail('NOT_FOUND', 'Role not found.');
  const requested = [...new Set((roles as Role[]).flatMap((r) => r.permissions))];
  const res = checkGrant(actorPerms, requested, false);
  if (!res.ok) fail('FORBIDDEN', `You can't assign permissions you don't have: ${res.missing.join(', ')}.`);
  if ((roles as Role[]).some((r) => r.key === 'business_owner') && !actorPerms.has('finance.manage_payout_account')) fail('FORBIDDEN', 'Only the Business Owner can grant the owner role.');
  return roles as Role[];
}

export function inviteMember(s: Svc, input: { businessId: Id; email: string; roleIds: Id[]; venueIds: Id[] | null; title?: string }) {
  const acc = requireBusiness(s, input.businessId, 'staff.manage', { write: true });
  if (!isEmail(input.email ?? '')) invalid([{ field: 'email', message: 'Enter a valid email.' }]);
  if (!input.roleIds?.length) invalid([{ field: 'roleIds', message: 'Choose at least one role.' }]);
  const roles = assertCanAssign(s, acc.perms, input.roleIds, input.businessId);
  const email = normalizeEmail(input.email);
  const user = s.db.find('users', (u) => u.email === email && u.status !== 'deleted');
  if (!user) fail('NOT_FOUND', 'No CourtKo account uses that email yet. Ask them to sign up first, then invite them. (Demo: try an existing player email.)');
  if (s.db.find('members', (m) => m.businessId === input.businessId && m.userId === user.id && m.status !== 'removed')) fail('CONFLICT', 'That person is already on your team.');
  const venueIds = input.venueIds && input.venueIds.length ? input.venueIds.filter((v) => s.db.get('venues', v)?.businessId === input.businessId) : null;
  const member: BusinessMember = { id: newId('mem'), businessId: input.businessId, userId: user.id, status: 'invited', roleIds: input.roleIds, venueIds, invitedBy: acc.user.id, invitedAt: s.now, joinedAt: null, title: (input.title ?? '').trim().slice(0, 40) };
  s.db.insert('members', member);
  notify(s, user.id, 'account_security', { title: `Invitation to join ${acc.business.tradeName}`, body: `${displayName(s.db, acc.user.id)} invited you as ${roles.map((r) => r.name).join(', ')}. Accept from your notifications.`, link: '#/app/notifications' });
  audit(s, { action: 'staff.invited', targetType: 'member', targetId: member.id, businessId: input.businessId, summary: `Invited ${displayName(s.db, user.id)} as ${roles.map((r) => r.name).join(', ')}${venueIds ? ` (venues: ${venueIds.length})` : ''}` });
  return member;
}

export function acceptInvite(s: Svc, input: { memberId: Id }) {
  requireWritable(s);
  const u = requireUser(s);
  const m = s.db.get('members', input.memberId);
  if (!m || m.userId !== u.id || m.status !== 'invited') fail('NOT_FOUND', 'Invitation not found.');
  s.db.update('members', m.id, (x) => {
    x.status = 'active';
    x.joinedAt = s.now;
  });
  audit(s, { action: 'staff.joined', targetType: 'member', targetId: m.id, businessId: m.businessId, summary: `${displayName(s.db, u.id)} accepted the invitation` });
  return s.db.must('members', m.id);
}

export function updateMember(s: Svc, input: { businessId: Id; memberId: Id; roleIds?: Id[]; venueIds?: Id[] | null; status?: 'active' | 'suspended'; title?: string }) {
  const acc = requireBusiness(s, input.businessId, 'staff.manage', { write: true });
  const m = s.db.get('members', input.memberId);
  if (!m || m.businessId !== input.businessId || m.status === 'removed') fail('NOT_FOUND', 'Team member not found.');
  if (m.userId === acc.user.id && (input.roleIds || input.status)) fail('FORBIDDEN', "You can't change your own roles or status. Ask another admin.");
  const targetIsOwner = m.roleIds.some((r) => s.db.get('roles', r)?.key === 'business_owner');
  if (targetIsOwner && !acc.perms.has('finance.manage_payout_account')) fail('FORBIDDEN', 'Only the Business Owner can change the owner’s access.');
  const before = { roleIds: m.roleIds, venueIds: m.venueIds, status: m.status };
  if (input.roleIds) {
    if (!input.roleIds.length) invalid([{ field: 'roleIds', message: 'Keep at least one role.' }]);
    assertCanAssign(s, acc.perms, input.roleIds, input.businessId);
  }
  s.db.update('members', m.id, (x) => {
    if (input.roleIds) x.roleIds = input.roleIds;
    if (input.venueIds !== undefined) x.venueIds = input.venueIds && input.venueIds.length ? input.venueIds : null;
    if (input.status) x.status = input.status;
    if (input.title !== undefined) x.title = input.title.trim().slice(0, 40);
  });
  if (input.status === 'suspended') {
    for (const sess of s.db.filter('sessions', (x) => x.userId === m.userId && !x.revokedAt)) s.db.update('sessions', sess.id, (x) => {
      x.revokedAt = s.now;
      x.revokeReason = 'staff_suspended';
    });
  }
  const after = s.db.must('members', m.id);
  audit(s, { action: input.roleIds ? 'staff.roles_changed' : 'staff.updated', targetType: 'member', targetId: m.id, businessId: input.businessId, summary: `Changed access for ${displayName(s.db, m.userId)}`, before, after: { roleIds: after.roleIds, venueIds: after.venueIds, status: after.status } });
  return after;
}

export function removeMember(s: Svc, input: { businessId: Id; memberId: Id }) {
  const acc = requireBusiness(s, input.businessId, 'staff.manage', { write: true });
  const m = s.db.get('members', input.memberId);
  if (!m || m.businessId !== input.businessId || m.status === 'removed') fail('NOT_FOUND', 'Team member not found.');
  if (m.userId === acc.user.id) fail('FORBIDDEN', "You can't remove yourself.");
  if (m.roleIds.some((r) => s.db.get('roles', r)?.key === 'business_owner')) fail('FORBIDDEN', 'The Business Owner cannot be removed.');
  s.db.update('members', m.id, (x) => {
    x.status = 'removed';
  });
  audit(s, { action: 'staff.removed', targetType: 'member', targetId: m.id, businessId: input.businessId, summary: `Removed ${displayName(s.db, m.userId)} from the team` });
  return { ok: true };
}

export function saveCustomRole(s: Svc, input: { businessId: Id; roleId?: Id; name: string; description: string; permissions: string[] }) {
  const acc = requireBusiness(s, input.businessId, 'roles.manage', { write: true });
  const name = (input.name ?? '').trim();
  if (!name || name.length > 40) invalid([{ field: 'name', message: 'Role name is required (up to 40 characters).' }]);
  const perms = [...new Set(input.permissions)];
  const res = checkGrant(acc.perms, perms, true);
  if (res.unknown.length) fail('VALIDATION_FAILED', `Unknown permissions: ${res.unknown.join(', ')}`);
  if (res.ownerOnly.length) fail('FORBIDDEN', `${res.ownerOnly.join(', ')} is reserved for the Business Owner role.`);
  if (res.missing.length) fail('FORBIDDEN', `You can't grant permissions you don't have: ${res.missing.join(', ')}.`);
  const existing = input.roleId ? s.db.get('roles', input.roleId) : undefined;
  if (input.roleId && (!existing || existing.businessId !== input.businessId)) fail('NOT_FOUND', 'Role not found.');
  if (existing?.system) fail('FORBIDDEN', 'System role templates cannot be edited. Create a custom role instead.');
  const role: Role = { id: existing?.id ?? newId('rol'), businessId: input.businessId, key: existing?.key ?? `custom_${newId('k').slice(2, 8)}`, name, description: (input.description ?? '').trim().slice(0, 160), permissions: perms, system: false, createdBy: existing?.createdBy ?? acc.user.id, createdAt: existing?.createdAt ?? s.now, updatedAt: s.now };
  if (existing) s.db.update('roles', existing.id, (x) => Object.assign(x, role));
  else s.db.insert('roles', role);
  audit(s, { action: existing ? 'role.updated' : 'role.created', targetType: 'role', targetId: role.id, businessId: input.businessId, summary: `${existing ? 'Updated' : 'Created'} custom role "${name}" (${perms.length} permissions)`, before: existing?.permissions ?? null, after: perms });
  return role;
}

export function roleTemplates() {
  return BUSINESS_ROLE_TEMPLATES;
}

export function isMember(s: Svc, businessId: Id): boolean {
  return !!(s.actor.user && activeMembership(s.db, s.actor.user.id, businessId));
}
