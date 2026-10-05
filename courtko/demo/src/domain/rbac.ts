/**
 * Role and permission catalog — exactly as design doc 03. Evaluated server-side on every action
 * (never by hiding UI). Business-scoped roles may be restricted to specific venues.
 */

export const BUSINESS_PERMISSIONS = [
  { code: 'business.view', label: 'View business overview', group: 'Business', risk: 'low' },
  { code: 'business.settings.manage', label: 'Edit business profile, policies and booking settings', group: 'Business', risk: 'medium' },
  { code: 'venues.manage', label: 'Create and edit venues, hours and special hours', group: 'Venues & courts', risk: 'medium' },
  { code: 'courts.manage', label: 'Create and edit courts', group: 'Venues & courts', risk: 'medium' },
  { code: 'courts.block', label: 'Block courts and schedule maintenance', group: 'Venues & courts', risk: 'medium' },
  { code: 'pricing.manage', label: 'Manage pricing rules', group: 'Pricing', risk: 'high' },
  { code: 'promotions.manage', label: 'Manage promo codes', group: 'Pricing', risk: 'medium' },
  { code: 'bookings.view', label: 'View bookings and calendar', group: 'Bookings', risk: 'low' },
  { code: 'bookings.create_walkin', label: 'Create walk-in bookings', group: 'Bookings', risk: 'medium' },
  { code: 'bookings.check_in', label: 'Check players in', group: 'Bookings', risk: 'low' },
  { code: 'bookings.mark_no_show', label: 'Mark no-shows', group: 'Bookings', risk: 'medium' },
  { code: 'bookings.cancel', label: 'Cancel bookings (venue-initiated, full refund)', group: 'Bookings', risk: 'high' },
  { code: 'bookings.reschedule', label: "Reschedule on a customer's behalf", group: 'Bookings', risk: 'medium' },
  { code: 'payments.view', label: 'View payment status', group: 'Payments', risk: 'low' },
  { code: 'payments.confirm_status', label: 'Re-check payment status with the provider', group: 'Payments', risk: 'medium' },
  { code: 'refunds.request', label: 'Request goodwill or exception refunds', group: 'Payments', risk: 'high' },
  { code: 'refunds.approve', label: 'Approve refunds', group: 'Payments', risk: 'high' },
  { code: 'finance.view_summary', label: 'View revenue, commission and fee summaries', group: 'Finance', risk: 'medium' },
  { code: 'finance.view_payouts', label: 'View payouts and statements', group: 'Finance', risk: 'medium' },
  { code: 'finance.manage_payout_account', label: 'Connect or change the payout account', group: 'Finance', risk: 'critical' },
  { code: 'reports.view', label: 'View reports', group: 'Reports', risk: 'low' },
  { code: 'reports.export', label: 'Export reports', group: 'Reports', risk: 'medium' },
  { code: 'events.manage', label: 'Manage events, divisions and registrations', group: 'Events', risk: 'medium' },
  { code: 'events.check_in', label: 'Check in event participants', group: 'Events', risk: 'low' },
  { code: 'openplay.view', label: 'View Open Play sessions and the live desk', group: 'Open Play', risk: 'low' },
  { code: 'openplay.manage', label: 'Create, edit, publish and cancel Open Play sessions', group: 'Open Play', risk: 'medium' },
  { code: 'openplay.check_in', label: 'Check in Open Play players (QR, search, manual with reason)', group: 'Open Play', risk: 'low' },
  { code: 'openplay.run', label: 'Assign courts, run the rotation, start and finish games', group: 'Open Play', risk: 'low' },
  { code: 'openplay.attendance.correct', label: 'Reverse or correct attendance (reason required)', group: 'Open Play', risk: 'medium' },
  { code: 'products.manage', label: 'Manage products and variants', group: 'Products', risk: 'medium' },
  { code: 'inventory.manage', label: 'Adjust stock', group: 'Products', risk: 'medium' },
  { code: 'orders.fulfill', label: 'Prepare and hand over orders', group: 'Products', risk: 'low' },
  { code: 'customers.view', label: 'View customers and history (no contact details)', group: 'Customers', risk: 'medium' },
  { code: 'customers.view_contact', label: 'View customer email and mobile', group: 'Customers', risk: 'high' },
  { code: 'restrictions.view', label: 'See restriction status and reason category', group: 'Customers', risk: 'medium' },
  { code: 'restrictions.manage', label: 'Create and lift restrictions, see internal notes', group: 'Customers', risk: 'high' },
  { code: 'reviews.respond', label: 'Reply to reviews', group: 'Customers', risk: 'low' },
  { code: 'staff.manage', label: 'Invite and remove staff, assign roles', group: 'Team', risk: 'high' },
  { code: 'roles.manage', label: 'Create and edit custom roles', group: 'Team', risk: 'high' },
  { code: 'audit.view', label: 'View the business audit log', group: 'Team', risk: 'medium' },
] as const;

export type BusinessPermission = (typeof BUSINESS_PERMISSIONS)[number]['code'];
export const ALL_BUSINESS_PERMISSIONS: BusinessPermission[] = BUSINESS_PERMISSIONS.map((p) => p.code);

export type BusinessRoleKey =
  | 'business_owner'
  | 'business_manager'
  | 'receptionist'
  | 'court_manager'
  | 'finance_viewer'
  | 'event_manager'
  | 'inventory_manager';

const EXCEPT_MANAGER: BusinessPermission[] = ['finance.manage_payout_account', 'roles.manage', 'refunds.approve'];

export const BUSINESS_ROLE_TEMPLATES: Record<BusinessRoleKey, { name: string; description: string; permissions: BusinessPermission[] }> = {
  business_owner: { name: 'Business Owner', description: 'Full control of the business, including payouts and roles.', permissions: ALL_BUSINESS_PERMISSIONS },
  business_manager: {
    name: 'Business Manager',
    description: 'Runs day-to-day operations; cannot change payout accounts, roles, or approve refunds.',
    permissions: ALL_BUSINESS_PERMISSIONS.filter((p) => !EXCEPT_MANAGER.includes(p)),
  },
  receptionist: {
    name: 'Receptionist',
    description: 'Front desk: check-ins, walk-ins, no-shows and pickups.',
    permissions: ['business.view', 'bookings.view', 'bookings.create_walkin', 'bookings.check_in', 'bookings.mark_no_show', 'payments.view', 'customers.view', 'orders.fulfill', 'events.check_in', 'restrictions.view', 'openplay.view', 'openplay.check_in', 'openplay.run'],
  },
  court_manager: {
    name: 'Court Manager',
    description: 'Courts, venue hours and maintenance blocks.',
    permissions: ['business.view', 'bookings.view', 'courts.manage', 'courts.block', 'venues.manage', 'openplay.view', 'openplay.run'],
  },
  finance_viewer: {
    name: 'Finance Viewer',
    description: 'Read-only finance: summaries, payouts, reports and exports.',
    permissions: ['business.view', 'finance.view_summary', 'finance.view_payouts', 'payments.view', 'reports.view', 'reports.export'],
  },
  event_manager: {
    name: 'Event Manager',
    description: 'Events, Open Play sessions, registrations and check-in.',
    permissions: ['business.view', 'bookings.view', 'events.manage', 'events.check_in', 'customers.view', 'openplay.view', 'openplay.manage', 'openplay.check_in', 'openplay.run'],
  },
  inventory_manager: {
    name: 'Product / Inventory Manager',
    description: 'Products, stock and order fulfilment.',
    permissions: ['business.view', 'products.manage', 'inventory.manage', 'orders.fulfill'],
  },
};

/** Permissions that require the actor to have verified MFA in the current session. */
export const MFA_REQUIRED_PERMISSIONS: BusinessPermission[] = [
  'refunds.approve',
  'finance.manage_payout_account',
  'staff.manage',
  'roles.manage',
  'pricing.manage',
  'bookings.cancel',
  'openplay.attendance.correct',
];

/** Permissions only the Business Owner role may hold (cannot be placed in custom roles). */
export const OWNER_ONLY_PERMISSIONS: BusinessPermission[] = ['finance.manage_payout_account'];

export const PLATFORM_PERMISSIONS = [
  { code: 'platform.overview.view', label: 'View platform overview' },
  { code: 'platform.businesses.view', label: 'View businesses' },
  { code: 'platform.businesses.verify', label: 'Approve or reject business verification' },
  { code: 'platform.businesses.suspend', label: 'Suspend or reactivate businesses' },
  { code: 'platform.venues.moderate', label: 'Unpublish or suspend venues' },
  { code: 'platform.users.view', label: 'View users' },
  { code: 'platform.users.suspend', label: 'Suspend or reactivate users' },
  { code: 'platform.bookings.view', label: 'View all bookings' },
  { code: 'platform.transactions.view', label: 'View transactions and ledger' },
  { code: 'platform.reconciliation.run', label: 'Run reconciliation' },
  { code: 'platform.commissions.manage', label: 'Propose or approve commission changes (maker-checker)' },
  { code: 'platform.payouts.manage', label: 'Manage payouts and adjustments' },
  { code: 'platform.refunds.approve', label: 'Approve high-value or after-payout refunds' },
  { code: 'platform.disputes.manage', label: 'Manage disputes and chargebacks' },
  { code: 'platform.reports.view', label: 'View platform reports' },
  { code: 'platform.reports.export', label: 'Export platform reports' },
  { code: 'platform.moderation.manage', label: 'Moderate reported content' },
  { code: 'platform.restrictions.manage', label: 'Platform-level restrictions' },
  { code: 'platform.support.impersonate', label: 'Start read-only support sessions' },
  { code: 'platform.security.view', label: 'View security events' },
  { code: 'platform.audit.view', label: 'View audit logs' },
  { code: 'platform.config.manage', label: 'Change platform configuration' },
  { code: 'platform.promotions.manage', label: 'Manage platform promotions' },
  { code: 'platform.privacy.requests', label: 'Handle data subject requests' },
  { code: 'platform.sports.manage', label: 'Manage the sport catalog and format templates' },
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number]['code'];
export type PlatformRoleKey = 'superadmin' | 'platform_support' | 'platform_finance' | 'platform_trust_safety' | 'platform_compliance';

const ALL_PLATFORM: PlatformPermission[] = PLATFORM_PERMISSIONS.map((p) => p.code);

export const PLATFORM_ROLE_TEMPLATES: Record<PlatformRoleKey, { name: string; permissions: PlatformPermission[] }> = {
  superadmin: { name: 'SuperAdmin', permissions: ALL_PLATFORM },
  platform_support: { name: 'Support Agent', permissions: ['platform.overview.view', 'platform.users.view', 'platform.bookings.view', 'platform.support.impersonate'] },
  platform_finance: {
    name: 'Finance Operations',
    permissions: ['platform.transactions.view', 'platform.reconciliation.run', 'platform.payouts.manage', 'platform.refunds.approve', 'platform.disputes.manage', 'platform.reports.view', 'platform.reports.export', 'platform.commissions.manage'],
  },
  platform_trust_safety: {
    name: 'Trust & Safety',
    permissions: ['platform.moderation.manage', 'platform.restrictions.manage', 'platform.users.suspend', 'platform.venues.moderate', 'platform.users.view'],
  },
  platform_compliance: { name: 'Compliance (DPO office)', permissions: ['platform.audit.view', 'platform.privacy.requests', 'platform.businesses.verify', 'platform.security.view'] },
};

export function platformRoleHas(role: PlatformRoleKey | null | undefined, perm: PlatformPermission): boolean {
  if (!role) return false;
  return PLATFORM_ROLE_TEMPLATES[role].permissions.includes(perm);
}

export function isBusinessPermission(code: string): code is BusinessPermission {
  return (ALL_BUSINESS_PERMISSIONS as string[]).includes(code);
}

/**
 * Privilege-escalation guard: an actor may only grant permissions they hold themselves, and never
 * owner-only permissions through custom roles.
 */
export function checkGrant(actorPermissions: ReadonlySet<string>, requested: readonly string[], customRole = true): { ok: boolean; missing: string[]; ownerOnly: string[]; unknown: string[] } {
  const unknown = requested.filter((p) => !isBusinessPermission(p));
  const missing = requested.filter((p) => isBusinessPermission(p) && !actorPermissions.has(p));
  const ownerOnly = customRole ? requested.filter((p) => (OWNER_ONLY_PERMISSIONS as string[]).includes(p)) : [];
  return { ok: unknown.length === 0 && missing.length === 0 && ownerOnly.length === 0, missing, ownerOnly, unknown };
}

export function permissionLabel(code: string): string {
  return (BUSINESS_PERMISSIONS as readonly { code: string; label: string }[]).find((p) => p.code === code)?.label
    ?? (PLATFORM_PERMISSIONS as readonly { code: string; label: string }[]).find((p) => p.code === code)?.label
    ?? code;
}
