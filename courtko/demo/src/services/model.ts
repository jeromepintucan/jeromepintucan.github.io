/**
 * Demo data model. Mirrors the production schema in docs/design/12-database-erd.md and schema.sql
 * (camelCase here, snake_case in PostgreSQL). All data in the demo is synthetic.
 */

import type { BookingSettings, SpecialHours, WeeklyHours, OccupancyKind } from '../domain/availability.ts';
import type { LatLng } from '../domain/geo.ts';
import type { JournalDraft, RefundBreakdown } from '../domain/ledger.ts';
import type { Centavos, Ppm } from '../domain/money.ts';
import type { CancellationInitiator, CancellationPolicy } from '../domain/policy.ts';
import type { FeeSchedule, PaymentMethodCode, PricingRule, PromoDefinition, Quote } from '../domain/pricing.ts';
import type { PlatformRoleKey } from '../domain/rbac.ts';
import type {
  BookingStatus,
  BusinessStatus,
  CheckoutStatus,
  DisputeStatus,
  OrderStatus,
  PaymentStatus,
  PayoutStatus,
  RefundStatus,
  RegistrationStatus,
  StatusChange,
  VenueStatus,
} from '../domain/state.ts';
import type { LocalDate } from '../domain/time.ts';

export type Id = string;
export type Visibility = 'private' | 'connections' | 'organizers' | 'public';
export type SkillLevel = 'beginner' | 'novice' | 'intermediate' | 'advanced' | 'expert';

export interface User {
  id: Id;
  email: string | null;
  phone: string | null;
  passwordHash: string | null;
  status: 'pending_verification' | 'active' | 'suspended' | 'deleted';
  statusReason?: string;
  emailVerifiedAt: number | null;
  phoneVerifiedAt: number | null;
  mfa: { totpSecret: string; enabledAt: number; lastUsedStep: number; recoveryDigests: string[] } | null;
  mfaPending?: { totpSecret: string; createdAt: number } | null;
  platformRole: PlatformRoleKey | null;
  createdAt: number;
  lastLoginAt: number | null;
  lockedUntil: number | null;
  persona?: string;
  invited?: boolean;
  deletion?: { requestedAt: number; scheduledFor: number; status: 'scheduled' | 'completed' | 'cancelled' } | null;
}

export interface Profile {
  id: Id; // = userId
  userId: Id;
  firstName: string;
  lastName: string;
  displayName: string;
  city: string;
  skillSelf: SkillLevel | null;
  bio: string;
  avatarHue: number;
  visibility: { profile: Visibility; activity: Visibility; ratings: Visibility };
}

export type NotificationCategory =
  | 'account_security'
  | 'booking_updates'
  | 'payment_updates'
  | 'reminders'
  | 'events'
  | 'orders'
  | 'business_ops'
  | 'payouts'
  | 'marketing';

export interface ChannelPrefs {
  inApp: boolean;
  email: boolean;
  sms: boolean;
  push: boolean;
}

export interface Preferences {
  id: Id; // = userId
  userId: Id;
  notifications: Record<NotificationCategory, ChannelPrefs>;
  marketingOptIn: boolean;
  locationConsent: 'granted' | 'denied' | 'unset';
  cookieAnalytics: boolean | null;
}

export interface Consent {
  id: Id;
  userId: Id;
  kind: 'terms' | 'privacy' | 'marketing' | 'location' | 'cookies_analytics';
  version: string;
  granted: boolean;
  at: number;
}

export interface Session {
  id: Id; // SHA-256 digest of the opaque token (the token itself is never stored)
  userId: Id;
  createdAt: number;
  lastSeenAt: number;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
  revokedAt: number | null;
  revokeReason?: string;
  mfaVerifiedAt: number | null;
  device: string;
  ip: string;
  supportSessionId: Id | null;
}

export interface PendingLogin {
  id: Id; // digest of the challenge token
  userId: Id;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  device: string;
}

export interface VerificationCode {
  id: Id;
  userId: Id;
  channel: 'email' | 'sms';
  purpose: 'verify_contact' | 'password_reset';
  digest: string;
  expiresAt: number;
  attempts: number;
  consumedAt: number | null;
  createdAt: number;
}

export interface LoginEvent {
  id: Id;
  userId: Id | null;
  identifierMasked: string;
  at: number;
  outcome: 'success' | 'failed' | 'locked' | 'mfa_failed' | 'mfa_success' | 'reset';
  device: string;
  ip: string;
}

export interface Address {
  line1: string;
  barangay: string;
  city: string;
  province: string;
  region: string;
  postalCode: string;
  landmark?: string;
}

export interface Business {
  id: Id;
  legalName: string;
  tradeName: string;
  slug: string;
  type: 'sole_proprietorship' | 'partnership' | 'corporation' | 'cooperative';
  registrationNo: string;
  tinMasked: string;
  vatRegistered: boolean;
  pricesIncludeVat: boolean;
  ownerUserId: Id;
  contactEmail: string;
  contactPhone: string;
  address: Address;
  description: string;
  status: BusinessStatus;
  statusReason?: string;
  history: StatusChange<BusinessStatus>[];
  settlementModel: 'provider_split' | 'platform_payout';
  payoutAccount: {
    status: 'not_connected' | 'pending_provider_setup' | 'verified';
    providerSubAccountId: string | null;
    bankName: string | null;
    accountMasked: string | null;
    updatedAt: number | null;
  };
  createdAt: number;
  submittedAt: number | null;
  approvedAt: number | null;
  approvedBy: Id | null;
}

export type DocumentType = 'dti_sec_registration' | 'bir_cor_2303' | 'mayors_permit' | 'owner_valid_id' | 'proof_of_bank_account';

export interface VerificationDocument {
  id: Id;
  type: DocumentType;
  fileName: string;
  sizeBytes: number;
  mime: string;
  scanStatus: 'clean' | 'pending' | 'rejected';
  uploadedAt: number;
}

export interface BusinessVerification {
  id: Id;
  businessId: Id;
  status: 'submitted' | 'in_review' | 'approved' | 'rejected' | 'info_requested';
  documents: VerificationDocument[];
  submittedAt: number;
  submittedBy: Id;
  reviewedAt: number | null;
  reviewedBy: Id | null;
  decisionNote: string | null;
}

export interface Venue {
  id: Id;
  businessId: Id;
  name: string;
  slug: string;
  tagline: string;
  description: string;
  address: Address;
  geo: LatLng;
  timezone: 'Asia/Manila';
  offsetMin: number;
  contactPhone: string;
  contactEmail: string;
  amenities: string[];
  parking: string;
  accessibility: string;
  rules: string[];
  status: VenueStatus;
  history: StatusChange<VenueStatus>[];
  hours: WeeklyHours;
  settings: BookingSettings;
  policyKey: CancellationPolicy['key'];
  acceptedMethods: PaymentMethodCode[];
  art: { hue: number; accent: number; pattern: 'lines' | 'dots' | 'waves' };
  ratingAvg: number;
  ratingCount: number;
  createdAt: number;
  publishedAt: number | null;
}

export interface VenueSpecialHours extends SpecialHours {
  businessId: Id;
}

export interface Court {
  id: Id;
  businessId: Id;
  venueId: Id;
  name: string;
  format: 'full' | 'half';
  environment: 'indoor' | 'outdoor' | 'covered';
  surface: string;
  customTags: string[];
  status: 'active' | 'inactive';
  sortOrder: number;
}

export interface CourtBlock {
  id: Id;
  businessId: Id;
  venueId: Id;
  courtId: Id;
  startMs: number;
  endMs: number;
  reason: 'maintenance' | 'private_rental' | 'event_setup' | 'weather' | 'other';
  note: string;
  createdBy: Id;
  createdAt: number;
  status: 'active' | 'removed';
  slotId: Id;
}

export interface BookingSlot {
  id: Id;
  businessId: Id;
  venueId: Id;
  courtId: Id;
  startMs: number;
  endMs: number;
  occupiedEndMs: number;
  kind: OccupancyKind;
  sourceId: Id;
  status: 'active' | 'released';
  expiresAt: number | null;
  createdAt: number;
  releasedAt: number | null;
  releaseReason?: string;
}

export interface Checkout {
  id: Id;
  kind: 'court_booking' | 'event_registration' | 'product_order';
  userId: Id;
  businessId: Id;
  venueId: Id;
  status: CheckoutStatus;
  history: StatusChange<CheckoutStatus>[];
  createdAt: number;
  expiresAt: number;
  maxExpiresAt: number;
  snapshotId: Id;
  paymentMethod: PaymentMethodCode | null;
  paymentIds: Id[];
  bookingId?: Id;
  registrationId?: Id;
  orderId?: Id;
  promoCode?: string | null;
  redemptionId?: Id | null;
  addOns: { productId: Id; variantId: Id | null; qty: number }[];
  policyKey: CancellationPolicy['key'];
  policyVersion: number;
  policyAcceptedAt: number | null;
  source: 'online' | 'walk_in';
  createdBy: Id;
  cancelReason?: string;
}

export interface PriceSnapshot {
  id: Id;
  businessId: Id;
  quote: Quote;
  hash: string;
  createdAt: number;
  lockedUntil: number;
}

export interface Participant {
  userId: Id | null;
  name: string;
  status: 'invited' | 'accepted';
}

export interface Booking {
  id: Id;
  code: string;
  businessId: Id;
  venueId: Id;
  courtId: Id;
  userId: Id;
  checkoutId: Id;
  startMs: number;
  endMs: number;
  durationMinutes: number;
  status: BookingStatus;
  history: StatusChange<BookingStatus>[];
  snapshotId: Id;
  policy: { key: CancellationPolicy['key']; version: number; name: string; acceptedAt: number };
  participants: Participant[];
  addOnOrderId: Id | null;
  source: 'online' | 'walk_in';
  createdAt: number;
  confirmedAt: number | null;
  checkedInAt: number | null;
  checkedInBy: Id | null;
  completedAt: number | null;
  cancelledAt: number | null;
  cancelledBy: Id | null;
  cancelReason: string | null;
  noShowAt: number | null;
  rescheduleCount: number;
  slotId: Id | null;
  lateRecovery: boolean;
  qrNonce: string;
}

export interface Payment {
  id: Id;
  checkoutId: Id;
  userId: Id;
  businessId: Id;
  provider: 'xendit_sandbox';
  providerSessionId: string;
  providerPaymentId: string | null;
  method: PaymentMethodCode;
  methodDisplay: string;
  /** Immutable price snapshot this payment was created for. */
  snapshotId: Id;
  amount: Centavos;
  currency: 'PHP';
  status: PaymentStatus;
  history: StatusChange<PaymentStatus>[];
  customerFee: Centavos;
  estimatedProviderFee: Centavos;
  actualProviderFee: Centavos | null;
  splitPlatformAmount: Centavos;
  attempt: number;
  idempotencyKey: string;
  createdAt: number;
  capturedAt: number | null;
  failureReason: string | null;
  refundedAmount: Centavos;
  reconciledAt: number | null;
  confirmedVia: 'webhook' | 'reconciliation' | 'return_check' | null;
  settledAt: number | null;
  payoutId: Id | null;
}

export interface WebhookEvent {
  id: Id;
  provider: 'xendit_sandbox';
  providerEventId: string;
  type: string;
  receivedAt: number;
  processedAt: number | null;
  status: 'processed' | 'duplicate' | 'rejected' | 'failed' | 'ignored';
  tokenValid: boolean;
  payloadDigest: string;
  note: string;
  deliveries: number;
}

export interface LedgerJournal extends JournalDraft {
  id: Id;
  seq: number;
  postedAt: number;
}

export interface CommissionAgreement {
  id: Id;
  businessId: Id | null; // null = platform default
  ratePpm: Ppm;
  appliesToProducts: boolean;
  appliesToEvents: boolean;
  effectiveFrom: number;
  effectiveTo: number | null;
  status: 'pending_approval' | 'active' | 'superseded' | 'rejected';
  note: string;
  createdBy: Id;
  createdAt: number;
  approvedBy: Id | null;
  approvedAt: number | null;
  approvalId: Id | null;
}

export interface Refund {
  id: Id;
  paymentId: Id;
  businessId: Id;
  userId: Id;
  checkoutId: Id;
  bookingId: Id | null;
  orderId: Id | null;
  registrationId: Id | null;
  amount: Centavos;
  breakdown: RefundBreakdown;
  reason: string;
  initiator: CancellationInitiator | 'goodwill';
  requestedBy: Id;
  status: RefundStatus;
  history: StatusChange<RefundStatus>[];
  providerRefundId: string | null;
  approvals: { by: Id; at: number; role: string }[];
  needsBusinessApproval: boolean;
  needsPlatformApproval: boolean;
  afterPayout: boolean;
  createdAt: number;
  completedAt: number | null;
  failureReason: string | null;
  partial: boolean;
}

export interface Payout {
  id: Id;
  businessId: Id;
  amount: Centavos;
  status: PayoutStatus;
  history: StatusChange<PayoutStatus>[];
  periodEnd: number;
  paymentIds: Id[];
  destinationMasked: string;
  providerPayoutId: string | null;
  createdAt: number;
  paidAt: number | null;
  failureReason: string | null;
  attempts: number;
}

export interface Dispute {
  id: Id;
  paymentId: Id;
  businessId: Id;
  bookingId: Id | null;
  amount: Centavos;
  reason: string;
  status: DisputeStatus;
  history: StatusChange<DisputeStatus>[];
  openedAt: number;
  dueAt: number;
  resolvedAt: number | null;
  evidence: { note: string; at: number; by: Id }[];
  providerDisputeId: string;
  disputeFee: Centavos;
}

export interface RuleHistoryEntry {
  id: Id;
  ruleId: Id;
  businessId: Id;
  version: number;
  change: 'created' | 'updated' | 'archived';
  snapshot: PricingRule;
  changedBy: Id;
  changedAt: number;
}

export interface Promotion extends PromoDefinition {
  createdBy: Id;
  createdAt: number;
}

export interface PromoRedemption {
  id: Id;
  promotionId: Id;
  userId: Id;
  checkoutId: Id;
  amount: Centavos;
  status: 'reserved' | 'redeemed' | 'released';
  createdAt: number;
}

export type EventType = 'tournament' | 'league' | 'clinic' | 'training' | 'open_play' | 'social' | 'private';

export interface Division {
  id: Id;
  name: string;
  skill: string;
  capacity: number;
  format: 'singles' | 'doubles' | 'mixed_doubles' | 'open';
  fee: Centavos | null;
}

export interface CourtEvent {
  id: Id;
  businessId: Id;
  venueId: Id;
  type: EventType;
  name: string;
  description: string;
  startMs: number;
  endMs: number;
  courtIds: Id[];
  organizer: string;
  fee: Centavos;
  divisions: Division[];
  registrationOpensAt: number;
  registrationClosesAt: number;
  waitlistEnabled: boolean;
  policyKey: CancellationPolicy['key'];
  rules: string;
  prizes: string;
  format: string;
  visibility: 'public' | 'unlisted' | 'private';
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  checkInRequired: boolean;
  teamBased: boolean;
  ageNote: string;
  slotIds: Id[];
  createdAt: number;
  createdBy: Id;
}

export interface EventRegistration {
  id: Id;
  eventId: Id;
  businessId: Id;
  divisionId: Id;
  userId: Id;
  partnerName: string | null;
  teamName: string | null;
  status: RegistrationStatus;
  history: StatusChange<RegistrationStatus>[];
  checkoutId: Id | null;
  waitlistPosition: number | null;
  offerExpiresAt: number | null;
  holdExpiresAt: number | null;
  createdAt: number;
  confirmedAt: number | null;
  checkedInAt: number | null;
}

export interface Match {
  id: Id;
  eventId: Id;
  businessId: Id;
  divisionId: Id;
  round: string;
  sideA: Id[];
  sideB: Id[];
  scoreA: number;
  scoreB: number;
  recordedBy: Id;
  recordedAt: number;
}

export interface PlayerRating {
  id: Id;
  userId: Id;
  source: 'self_declared' | 'venue_verified' | 'platform_recreational' | 'external';
  value: number | null;
  label: string;
  verifiedByBusinessId: Id | null;
  updatedAt: number;
  history: { at: number; value: number }[];
}

export interface ProductVariant {
  id: Id;
  name: string;
  price: Centavos | null;
}

export interface Product {
  id: Id;
  businessId: Id;
  venueId: Id;
  name: string;
  description: string;
  category: 'drinks' | 'food' | 'merch' | 'balls' | 'rental' | 'equipment' | 'service';
  price: Centavos;
  variants: ProductVariant[];
  maxPerOrder: number;
  fulfillment: { pickup: boolean; bookingAddOn: boolean; eventAddOn: boolean; standalone: boolean };
  pickupInstructions: string;
  taxable: boolean;
  status: 'active' | 'inactive';
  art: { hue: number; glyph: string };
  createdAt: number;
}

export interface InventoryMovement {
  id: Id;
  businessId: Id;
  productId: Id;
  variantId: Id | null;
  type: 'initial' | 'restock' | 'reservation' | 'release' | 'sale' | 'adjustment' | 'return';
  onHandDelta: number;
  reservedDelta: number;
  refId: Id | null;
  at: number;
  by: Id;
  note: string;
}

export interface OrderItem {
  ref: string;
  productId: Id;
  variantId: Id | null;
  name: string;
  qty: number;
  unitPrice: Centavos;
  total: Centavos;
}

export interface Order {
  id: Id;
  code: string;
  businessId: Id;
  venueId: Id;
  userId: Id;
  checkoutId: Id;
  bookingId: Id | null;
  registrationId: Id | null;
  items: OrderItem[];
  status: OrderStatus;
  history: StatusChange<OrderStatus>[];
  total: Centavos;
  createdAt: number;
  paidAt: number | null;
  readyAt: number | null;
  claimedAt: number | null;
  claimedBy: Id | null;
}

export interface PickupClaim {
  id: Id;
  orderId: Id;
  businessId: Id;
  claimedBy: Id;
  at: number;
  method: 'code' | 'qr';
}

export type RestrictionReason = 'repeated_no_shows' | 'misconduct' | 'payment_abuse' | 'safety_concern' | 'policy_violation' | 'other';

export interface Restriction {
  id: Id;
  userId: Id;
  businessId: Id | null;
  venueId: Id | null;
  scope: 'business' | 'venue' | 'platform';
  reasonCategory: RestrictionReason;
  internalNotes: string;
  startAt: number;
  endAt: number | null;
  createdBy: Id;
  approvedBy: Id | null;
  evidenceRef: string;
  status: 'active' | 'lifted' | 'expired';
  appeal: { status: 'none' | 'submitted' | 'upheld' | 'overturned'; message?: string; submittedAt?: number; decidedBy?: Id; decidedAt?: number; decisionNote?: string };
  createdAt: number;
  liftedAt: number | null;
  liftedBy: Id | null;
  liftReason: string | null;
}

export interface Review {
  id: Id;
  bookingId: Id;
  userId: Id;
  businessId: Id;
  venueId: Id;
  rating: number;
  body: string;
  status: 'published' | 'hidden' | 'flagged';
  reply: { body: string; by: Id; at: number } | null;
  createdAt: number;
}

export interface ContentReport {
  id: Id;
  reporterId: Id;
  targetType: 'review' | 'venue' | 'event' | 'product' | 'user' | 'issue';
  targetId: Id;
  businessId: Id | null;
  reason: string;
  details: string;
  status: 'open' | 'actioned' | 'dismissed';
  handledBy: Id | null;
  handledAt: number | null;
  action: string | null;
  createdAt: number;
}

export interface AppNotification {
  id: Id;
  userId: Id;
  category: NotificationCategory;
  title: string;
  body: string;
  link: string | null;
  createdAt: number;
  readAt: number | null;
  channels: { email: 'sent' | 'suppressed' | 'n/a'; sms: 'sent' | 'suppressed' | 'n/a'; push: 'sent' | 'suppressed' | 'n/a' };
  dedupeKey: string | null;
}

export interface OutboundMessage {
  id: Id;
  notificationId: Id;
  userId: Id;
  channel: 'email' | 'sms' | 'push';
  to: string;
  subject: string;
  body: string;
  createdAt: number;
}

export interface SupportSession {
  id: Id;
  adminUserId: Id;
  adminSessionId: Id;
  targetType: 'user' | 'business';
  targetId: Id;
  targetUserId: Id;
  reason: string;
  ticketRef: string;
  startedAt: number;
  expiresAt: number;
  endedAt: number | null;
  mode: 'read_only';
}

export interface AuditEntry {
  id: Id;
  seq: number;
  at: number;
  actorUserId: Id | null;
  actorLabel: string;
  supportSessionId: Id | null;
  action: string;
  targetType: string;
  targetId: Id | null;
  businessId: Id | null;
  summary: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string;
  device: string;
  correlationId: string;
  prevHash: string;
  hash: string;
}

export interface SecurityEvent {
  id: Id;
  at: number;
  type:
    | 'login_failed'
    | 'login_succeeded'
    | 'account_locked'
    | 'mfa_failed'
    | 'mfa_enabled'
    | 'password_changed'
    | 'password_reset'
    | 'sessions_revoked'
    | 'double_booking_blocked'
    | 'webhook_token_invalid'
    | 'authz_denied'
    | 'support_session_started'
    | 'support_session_ended'
    | 'rate_limited'
    | 'suspicious_login'
    | 'data_export'
    | 'reconciliation_healed'
    | 'payment_amount_mismatch'
    | 'impersonation_blocked_action';
  severity: 'info' | 'warning' | 'critical';
  userId: Id | null;
  businessId: Id | null;
  detail: string;
  ip: string;
}

export interface IdempotencyRecord {
  id: Id; // `${scope}:${key}`
  requestHash: string;
  response: unknown;
  createdAt: number;
  expiresAt: number;
}

export interface ApprovalRequest {
  id: Id;
  kind: 'commission_agreement' | 'fee_schedule' | 'manual_adjustment';
  businessId: Id | null;
  payload: Record<string, unknown>;
  payloadHash: string;
  summary: string;
  requestedBy: Id;
  requestedAt: number;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy: Id | null;
  decidedAt: number | null;
  note: string | null;
}

export interface BusinessMember {
  id: Id;
  businessId: Id;
  userId: Id;
  status: 'invited' | 'active' | 'suspended' | 'removed';
  roleIds: Id[];
  venueIds: Id[] | null;
  invitedBy: Id;
  invitedAt: number;
  joinedAt: number | null;
  title: string;
}

export interface Role {
  id: Id;
  businessId: Id | null;
  key: string;
  name: string;
  description: string;
  permissions: string[];
  system: boolean;
  createdBy: Id | null;
  createdAt: number;
  updatedAt: number;
}

export interface Favorite {
  id: Id; // `${userId}:${venueId}`
  userId: Id;
  venueId: Id;
  createdAt: number;
}

export interface Holiday {
  id: LocalDate;
  date: LocalDate;
  name: string;
  type: 'regular' | 'special_non_working';
}

export interface DemoControls {
  webhookMode: 'normal' | 'slow' | 'duplicate' | 'drop' | 'fail_first';
  providerOutage: boolean;
  failNextPayout: boolean;
  failNextRefund: boolean;
  latency: 'fast' | 'realistic';
}

export interface PlatformSettings {
  id: 'platform';
  feeSchedules: FeeSchedule[];
  refundPlatformApprovalThreshold: Centavos;
  lateWebhookGraceMinutes: number;
  providerSessionMinMinutes: number;
  maxHoldLifetimeMinutes: number;
  vatPpm: Ppm;
  featureFlags: Record<string, { enabled: boolean; description: string }>;
  amenities: { code: string; label: string }[];
  eventTypes: { code: EventType; label: string }[];
  demo: DemoControls;
  updatedAt: number;
  updatedBy: Id | null;
}

// ---------------------------------------------------------------- mock payment provider (Xendit stand-in)

export interface ProviderSession {
  id: string;
  externalId: Id; // our payment id
  forUserId: string | null; // sub-account (xenPlatform `for-user-id`)
  splitPlatformAmount: Centavos; // split rule: amount routed to the master account
  amount: Centavos;
  currency: 'PHP';
  method: PaymentMethodCode;
  merchantName: string;
  description: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  paymentId: string | null;
  createdAt: number;
  expiresAt: number;
  idempotencyKey: string;
  failureCode: string | null;
}

export interface ProviderPayment {
  id: string;
  sessionId: string;
  externalId: Id;
  amount: Centavos;
  fee: Centavos;
  method: PaymentMethodCode;
  methodDisplay: string;
  status: 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'DISPUTED' | 'CHARGEBACK';
  forUserId: string | null;
  splitPlatformAmount: Centavos;
  createdAt: number;
  refundedAmount: Centavos;
  settledAt: number | null;
}

export interface ProviderRefund {
  id: string;
  paymentId: string;
  externalId: Id;
  amount: Centavos;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  createdAt: number;
  completeAt: number;
  failureCode: string | null;
  idempotencyKey: string;
}

export interface ProviderPayout {
  id: string;
  externalId: Id;
  forUserId: string | null;
  amount: Centavos;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  createdAt: number;
  completeAt: number;
  failureCode: string | null;
}

export interface ProviderDelivery {
  id: string;
  eventId: string;
  type: string;
  payload: Record<string, unknown>;
  deliverAt: number;
  attempts: number;
  status: 'pending' | 'delivered' | 'dropped' | 'failed';
  lastStatusCode: number | null;
  duplicateOf: string | null;
}

export interface ProviderSubAccount {
  id: string;
  businessId: Id;
  type: 'MANAGED';
  status: 'LIVE' | 'PENDING';
  balance: Centavos;
  createdAt: number;
}

export interface ProviderMasterBalance {
  id: 'master';
  balance: Centavos;
}

export interface ProviderIdempotency {
  id: string;
  resultId: string;
}

export interface DbTables {
  users: Record<Id, User>;
  profiles: Record<Id, Profile>;
  preferences: Record<Id, Preferences>;
  consents: Record<Id, Consent>;
  sessions: Record<Id, Session>;
  pendingLogins: Record<Id, PendingLogin>;
  verificationCodes: Record<Id, VerificationCode>;
  loginEvents: Record<Id, LoginEvent>;
  businesses: Record<Id, Business>;
  verifications: Record<Id, BusinessVerification>;
  members: Record<Id, BusinessMember>;
  roles: Record<Id, Role>;
  venues: Record<Id, Venue>;
  specialHours: Record<Id, VenueSpecialHours>;
  courts: Record<Id, Court>;
  courtBlocks: Record<Id, CourtBlock>;
  slots: Record<Id, BookingSlot>;
  checkouts: Record<Id, Checkout>;
  snapshots: Record<Id, PriceSnapshot>;
  bookings: Record<Id, Booking>;
  payments: Record<Id, Payment>;
  webhookEvents: Record<Id, WebhookEvent>;
  journals: Record<Id, LedgerJournal>;
  commissionAgreements: Record<Id, CommissionAgreement>;
  refunds: Record<Id, Refund>;
  payouts: Record<Id, Payout>;
  disputes: Record<Id, Dispute>;
  pricingRules: Record<Id, PricingRule>;
  ruleHistory: Record<Id, RuleHistoryEntry>;
  promotions: Record<Id, Promotion>;
  redemptions: Record<Id, PromoRedemption>;
  events: Record<Id, CourtEvent>;
  registrations: Record<Id, EventRegistration>;
  matches: Record<Id, Match>;
  ratings: Record<Id, PlayerRating>;
  products: Record<Id, Product>;
  inventory: Record<Id, InventoryMovement>;
  orders: Record<Id, Order>;
  pickupClaims: Record<Id, PickupClaim>;
  restrictions: Record<Id, Restriction>;
  reviews: Record<Id, Review>;
  contentReports: Record<Id, ContentReport>;
  notifications: Record<Id, AppNotification>;
  outbound: Record<Id, OutboundMessage>;
  supportSessions: Record<Id, SupportSession>;
  audit: Record<Id, AuditEntry>;
  securityEvents: Record<Id, SecurityEvent>;
  idempotency: Record<Id, IdempotencyRecord>;
  approvals: Record<Id, ApprovalRequest>;
  favorites: Record<Id, Favorite>;
  holidays: Record<Id, Holiday>;
  settings: Record<Id, PlatformSettings>;
  providerSessions: Record<Id, ProviderSession>;
  providerPayments: Record<Id, ProviderPayment>;
  providerRefunds: Record<Id, ProviderRefund>;
  providerPayouts: Record<Id, ProviderPayout>;
  providerDeliveries: Record<Id, ProviderDelivery>;
  providerSubAccounts: Record<Id, ProviderSubAccount>;
  providerMaster: Record<Id, ProviderMasterBalance>;
  providerIdempotency: Record<Id, ProviderIdempotency>;
}

export type TableName = keyof DbTables;
export type Row<T extends TableName> = DbTables[T][string];

export interface DbMeta {
  schema: number;
  buildId: string;
  seed: number;
  seedDate: LocalDate;
  seededAt: number;
  clockOffsetMs: number;
  rev: number;
  auditSeq: number;
  auditHead: string;
  journalSeq: number;
  initialized: boolean;
}

export interface DbState extends DbTables {
  meta: DbMeta;
}

export const TABLES: TableName[] = [
  'users', 'profiles', 'preferences', 'consents', 'sessions', 'pendingLogins', 'verificationCodes', 'loginEvents',
  'businesses', 'verifications', 'members', 'roles', 'venues', 'specialHours', 'courts', 'courtBlocks', 'slots',
  'checkouts', 'snapshots', 'bookings', 'payments', 'webhookEvents', 'journals', 'commissionAgreements', 'refunds',
  'payouts', 'disputes', 'pricingRules', 'ruleHistory', 'promotions', 'redemptions', 'events', 'registrations',
  'matches', 'ratings', 'products', 'inventory', 'orders', 'pickupClaims', 'restrictions', 'reviews', 'contentReports',
  'notifications', 'outbound', 'supportSessions', 'audit', 'securityEvents', 'idempotency', 'approvals', 'favorites',
  'holidays', 'settings', 'providerSessions', 'providerPayments', 'providerRefunds', 'providerPayouts',
  'providerDeliveries', 'providerSubAccounts', 'providerMaster', 'providerIdempotency',
];

export function emptyTables(): DbTables {
  const t = {} as Record<TableName, Record<Id, unknown>>;
  for (const name of TABLES) t[name] = {};
  return t as unknown as DbTables;
}
