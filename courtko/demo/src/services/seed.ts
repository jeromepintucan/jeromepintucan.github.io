/**
 * SYNTHETIC DEMO DATA. Every venue, business, person, phone number and transaction here is fictional.
 * Generated deterministically from (seed, seedDate) so every tab rebuilds the identical base dataset;
 * only changes made during the demo are persisted. Historical bookings, payments, ledger journals, provider
 * records and payouts are produced with the same domain functions the live flows use, so reports and
 * reconciliation balance exactly.
 */

import { DEFAULT_BOOKING_SETTINGS, type BookingSettings, type WeeklyHours } from '../domain/availability.ts';
import { canonicalJson, sha256Hex, toBase32 } from '../domain/crypto.ts';
import { bookingCode, mulberry32, newId, type Rng } from '../domain/ids.ts';
import { captureJournal, computeRefund, payoutJournal, payoutFailedJournal, providerFeeJournal, refundJournal, type JournalDraft } from '../domain/ledger.ts';
import { pesos, providerFeeOn } from '../domain/money.ts';
import { evaluateCancellation, POLICY_LIBRARY } from '../domain/policy.ts';
import { buildQuote, priceCourtTime, type FeeSchedule, type PaymentMethodCode, type PricingRule, type Quote } from '../domain/pricing.ts';
import type { PlatformRoleKey } from '../domain/rbac.ts';
import type { BookingStatus, StatusChange } from '../domain/state.ts';
import { addDays, DAY, HOUR, localDate, localParts, localToInstant, MINUTE } from '../domain/time.ts';
import { defaultPreferences } from './auth.ts';
import { seedSystemRoles } from './businesses.ts';
import { emptyTables, type AuditEntry, type Booking, type Business, type Court, type CourtEvent, type DbTables, type Id, type LedgerJournal, type PlatformSettings, type Product, type User, type Venue } from './model.ts';
import { METHOD_LABEL } from './provider.ts';
import type { GeneratedBase } from './store.ts';

export const DEMO_NOTICE = 'All venues, businesses, people and transactions in this demo are fictional (synthetic data).';

export const FEE_SCHEDULES: FeeSchedule[] = [
  { method: 'gcash', label: 'GCash', percentPpm: 23_000, fixed: 0, passThrough: true, enabled: true },
  { method: 'maya', label: 'Maya', percentPpm: 20_000, fixed: 0, passThrough: true, enabled: true },
  { method: 'grabpay', label: 'GrabPay', percentPpm: 20_000, fixed: 0, passThrough: true, enabled: true },
  { method: 'online_banking', label: 'Online banking (BPI / UnionBank)', percentPpm: 0, fixed: 1_500, passThrough: true, enabled: true },
  { method: 'card', label: 'Credit / debit card', percentPpm: 35_000, fixed: 1_500, passThrough: false, passThroughLockedReason: 'Card surcharging is restricted by card-network rules outside the U.S.; confirm with the acquirer and counsel (doc 23 D-05).', enabled: true },
  { method: 'qrph', label: 'QR Ph', percentPpm: 10_000, fixed: 0, passThrough: false, passThroughLockedReason: 'BSP QR Ph P2M rules: customers may not be charged fees (doc 23 D-05).', enabled: true },
];

const AMENITIES = [
  ['parking', 'Parking'], ['showers', 'Showers'], ['lockers', 'Lockers'], ['pro_shop', 'Pro shop'], ['cafe', 'Café'], ['paddle_rental', 'Paddle rental'],
  ['ball_machine', 'Ball machine'], ['lights', 'Night lights'], ['aircon', 'Air-conditioned'], ['wifi', 'Wi-Fi'], ['first_aid', 'First aid'],
  ['pwd_access', 'PWD accessible'], ['coaching', 'Coaching'], ['seating', 'Spectator seating'], ['ev_charging', 'EV charging'],
].map(([code, label]) => ({ code: code!, label: label! }));

// Sample holiday calendar — PLACEHOLDER; verify against the official proclamation each year.
const HOLIDAYS: [string, string, 'regular' | 'special_non_working'][] = [
  ['2026-08-21', 'Ninoy Aquino Day', 'special_non_working'], ['2026-08-31', 'National Heroes Day', 'regular'], ['2026-11-01', "All Saints' Day", 'special_non_working'],
  ['2026-11-02', "All Souls' Day", 'special_non_working'], ['2026-11-30', 'Bonifacio Day', 'regular'], ['2026-12-08', 'Feast of the Immaculate Conception', 'special_non_working'],
  ['2026-12-24', 'Christmas Eve', 'special_non_working'], ['2026-12-25', 'Christmas Day', 'regular'], ['2026-12-30', 'Rizal Day', 'regular'], ['2026-12-31', 'Last Day of the Year', 'special_non_working'],
  ['2027-01-01', "New Year's Day", 'regular'], ['2027-02-06', 'Chinese New Year', 'special_non_working'], ['2027-03-25', 'Maundy Thursday', 'regular'], ['2027-03-26', 'Good Friday', 'regular'],
  ['2027-04-09', 'Araw ng Kagitingan', 'regular'], ['2027-05-01', 'Labor Day', 'regular'], ['2027-06-12', 'Independence Day', 'regular'],
];

const FIRST = ['Miguel', 'Andrea', 'Carlo', 'Bianca', 'Paolo', 'Kristine', 'Rafael', 'Nicole', 'Jerome', 'Patricia', 'Enzo', 'Camille', 'Marco', 'Isabel', 'Luis', 'Angela', 'Gabriel', 'Denise', 'Joaquin', 'Trisha', 'Adrian', 'Samantha', 'Vince', 'Chelsea', 'Diego', 'Katrina', 'Nathan', 'Ella', 'Tristan', 'Mika', 'Jericho', 'Faith', 'Renz', 'Hazel', 'Kevin', 'Rica', 'Elijah', 'Jasmine', 'Aldrin', 'Sofia'];
const LAST = ['Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres', 'Aquino', 'Ramos', 'Castillo', 'Flores', 'Villanueva', 'Navarro', 'Santiago', 'Dizon', 'Lopez', 'Fernandez', 'Pascual', 'Rivera', 'Manalo', 'Tan', 'Lim', 'Sy', 'Go', 'Chua', 'De Leon', 'Salazar', 'Aguilar', 'Del Rosario', 'Marquez'];

interface VenueSpec {
  key: string;
  business: string;
  legal: string;
  name: string;
  tagline: string;
  city: string;
  barangay: string;
  province: string;
  landmark: string;
  line1: string;
  lat: number;
  lng: number;
  courts: { name: string; env: Court['environment']; format?: Court['format'] }[];
  base: number;
  peak: number;
  weekend: number;
  amenities: string[];
  popularity: number;
  vat: boolean;
  hue: number;
  pattern: Venue['art']['pattern'];
  settings?: Partial<BookingSettings>;
  hours?: [number, number];
  policy?: Venue['policyKey'];
}

const V: VenueSpec[] = [
  { key: 'bgc', business: 'Dink District', legal: 'Dink District Sports Inc.', name: 'Dink District BGC', tagline: 'Six tournament-grade courts in the heart of BGC', city: 'Taguig', barangay: 'Fort Bonifacio', province: 'Metro Manila', landmark: 'Near Bonifacio High Street', line1: '28th St. cor. 9th Ave.', lat: 14.5507, lng: 121.0494, courts: [{ name: 'Court 1', env: 'indoor' }, { name: 'Court 2', env: 'indoor' }, { name: 'Court 3', env: 'indoor' }, { name: 'Court 4', env: 'indoor' }, { name: 'Court 5', env: 'covered' }, { name: 'Court 6', env: 'covered' }], base: 400, peak: 600, weekend: 550, amenities: ['parking', 'showers', 'lockers', 'pro_shop', 'cafe', 'paddle_rental', 'lights', 'aircon', 'wifi', 'first_aid', 'pwd_access', 'coaching'], popularity: 9, vat: true, hue: 158, pattern: 'lines', settings: { bufferMinutes: 10 } },
  { key: 'alabang', business: 'Dink District', legal: 'Dink District Sports Inc.', name: 'Dink District Alabang', tagline: 'South-side courts with a family-friendly lounge', city: 'Muntinlupa', barangay: 'Alabang', province: 'Metro Manila', landmark: 'Near Festival Mall', line1: 'Commerce Ave.', lat: 14.4195, lng: 121.0391, courts: [{ name: 'Court A', env: 'indoor' }, { name: 'Court B', env: 'indoor' }, { name: 'Court C', env: 'covered' }, { name: 'Court D', env: 'covered' }], base: 380, peak: 520, weekend: 480, amenities: ['parking', 'showers', 'cafe', 'paddle_rental', 'lights', 'aircon', 'pwd_access'], popularity: 6, vat: true, hue: 190, pattern: 'waves' },
  { key: 'makati', business: 'Kitchen Line Pickleball Club', legal: 'Kitchen Line Pickleball Club Corp.', name: 'Kitchen Line Club Makati', tagline: 'Members-style club, open to everyone', city: 'Makati', barangay: 'Poblacion', province: 'Metro Manila', landmark: 'Near Rockwell', line1: 'P. Burgos St.', lat: 14.5649, lng: 121.0317, courts: [{ name: 'Center Court', env: 'indoor' }, { name: 'Court 2', env: 'indoor' }, { name: 'Court 3', env: 'indoor' }, { name: 'Court 4', env: 'indoor' }], base: 450, peak: 650, weekend: 600, amenities: ['showers', 'lockers', 'pro_shop', 'cafe', 'aircon', 'wifi', 'coaching', 'seating'], popularity: 8, vat: true, hue: 18, pattern: 'dots', settings: { incrementMinutes: 60 } },
  { key: 'ortigas', business: 'Ortigas Paddle House', legal: 'Ortigas Paddle House (Sole Proprietorship)', name: 'Ortigas Paddle House', tagline: 'Affordable covered courts near the business district', city: 'Pasig', barangay: 'San Antonio', province: 'Metro Manila', landmark: 'Near Ortigas Center', line1: 'Meralco Ave.', lat: 14.5869, lng: 121.0614, courts: [{ name: 'Court 1', env: 'covered' }, { name: 'Court 2', env: 'covered' }, { name: 'Court 3', env: 'covered' }, { name: 'Court 4', env: 'outdoor' }, { name: 'Court 5', env: 'outdoor' }], base: 300, peak: 450, weekend: 400, amenities: ['parking', 'paddle_rental', 'lights', 'first_aid'], popularity: 7, vat: false, hue: 210, pattern: 'lines' },
  { key: 'qc', business: 'Katipunan Pickle Park', legal: 'Katipunan Pickle Park Partnership', name: 'Katipunan Pickle Park', tagline: 'Outdoor courts popular with the university crowd', city: 'Quezon City', barangay: 'Loyola Heights', province: 'Metro Manila', landmark: 'Along Katipunan Ave.', line1: 'Katipunan Ave.', lat: 14.6371, lng: 121.0748, courts: [{ name: 'Court 1', env: 'outdoor' }, { name: 'Court 2', env: 'outdoor' }, { name: 'Court 3', env: 'covered' }], base: 250, peak: 380, weekend: 320, amenities: ['lights', 'paddle_rental', 'seating'], popularity: 6, vat: false, hue: 95, pattern: 'dots', policy: 'flexible' },
  { key: 'cebu', business: 'Cebu IT Park Pickle Hub', legal: 'Cebu Pickle Hub Inc.', name: 'Cebu IT Park Pickle Hub', tagline: "Cebu's after-work pickleball spot", city: 'Cebu City', barangay: 'Apas', province: 'Cebu', landmark: 'Inside Cebu IT Park', line1: 'Jose Ma. del Mar St.', lat: 10.3304, lng: 123.906, courts: [{ name: 'Court 1', env: 'indoor' }, { name: 'Court 2', env: 'indoor' }, { name: 'Court 3', env: 'covered' }, { name: 'Court 4', env: 'covered' }], base: 350, peak: 500, weekend: 450, amenities: ['parking', 'showers', 'cafe', 'lights', 'aircon', 'wifi'], popularity: 6, vat: true, hue: 265, pattern: 'waves' },
  { key: 'davao', business: 'Davao Rally Courts', legal: 'Davao Rally Courts Co.', name: 'Davao Rally Courts', tagline: 'Covered courts with mountain views', city: 'Davao City', barangay: 'Lanang', province: 'Davao del Sur', landmark: 'Near SM Lanang', line1: 'J.P. Laurel Ave.', lat: 7.0985, lng: 125.6312, courts: [{ name: 'Court 1', env: 'covered' }, { name: 'Court 2', env: 'covered' }, { name: 'Court 3', env: 'outdoor' }], base: 280, peak: 400, weekend: 350, amenities: ['parking', 'lights', 'paddle_rental', 'first_aid'], popularity: 4, vat: false, hue: 40, pattern: 'lines' },
  { key: 'clark', business: 'Clark Pickle Yard', legal: 'Clark Pickle Yard Corp.', name: 'Clark Pickle Yard', tagline: 'Six outdoor courts and a weekend league', city: 'Mabalacat', barangay: 'Clark Freeport Zone', province: 'Pampanga', landmark: 'Near Clark Global City', line1: 'Manuel A. Roxas Hwy.', lat: 15.185, lng: 120.546, courts: [1, 2, 3, 4, 5, 6].map((n) => ({ name: `Court ${n}`, env: 'outdoor' as const })), base: 300, peak: 420, weekend: 380, amenities: ['parking', 'lights', 'seating', 'ev_charging', 'first_aid'], popularity: 5, vat: true, hue: 120, pattern: 'dots' },
  { key: 'tagaytay', business: 'Tagaytay Ridge Pickleball', legal: 'Tagaytay Ridge Leisure Inc.', name: 'Tagaytay Ridge Pickleball', tagline: 'Cool-weather courts overlooking Taal', city: 'Tagaytay', barangay: 'Kaybagal South', province: 'Cavite', landmark: 'Along Aguinaldo Hwy.', line1: 'Aguinaldo Hwy.', lat: 14.1153, lng: 120.9621, courts: [{ name: 'Ridge Court', env: 'outdoor' }, { name: 'Lake Court', env: 'covered' }], base: 350, peak: 450, weekend: 500, amenities: ['parking', 'cafe', 'seating'], popularity: 3, vat: true, hue: 175, pattern: 'waves', policy: 'strict' },
];

export const PERSONAS: { key: string; first: string; last: string; email: string; phone: string; role?: PlatformRoleKey; mfa: boolean; label: string; description: string }[] = [
  { key: 'player', first: 'Juan', last: 'dela Cruz', email: 'juan.delacruz@example.com', phone: '+639170000001', mfa: false, label: 'Player', description: 'Regular player in Metro Manila' },
  { key: 'player2', first: 'Bea', last: 'Santiago', email: 'bea.santiago@example.com', phone: '+639170000002', mfa: false, label: 'Player 2', description: 'Second player for side-by-side demos' },
  { key: 'owner', first: 'Maria', last: 'Santos', email: 'maria.santos@example.com', phone: '+639170000010', mfa: true, label: 'Business Owner', description: 'Owns Dink District (BGC & Alabang)' },
  { key: 'manager', first: 'Ramon', last: 'Cruz', email: 'ramon.cruz@example.com', phone: '+639170000011', mfa: true, label: 'Business Manager', description: 'Runs operations at Dink District' },
  { key: 'receptionist', first: 'Paolo', last: 'Reyes', email: 'paolo.reyes@example.com', phone: '+639170000012', mfa: false, label: 'Receptionist', description: 'Front desk at Dink District BGC only' },
  { key: 'applicant', first: 'Rafael', last: 'Lim', email: 'rafael.lim@example.com', phone: '+639170000020', mfa: true, label: 'New Business Owner', description: 'Registered Iloilo Esplanade Pickleball — awaiting approval' },
  { key: 'superadmin', first: 'Andrea', last: 'Villanueva', email: 'andrea.admin@example.com', phone: '+639170000090', role: 'superadmin', mfa: true, label: 'SuperAdmin', description: 'Platform owner / operator' },
  { key: 'finance', first: 'Carla', last: 'Mendoza', email: 'carla.finance@example.com', phone: '+639170000091', role: 'platform_finance', mfa: true, label: 'Finance Ops', description: 'Second approver for commission changes' },
];

class Gen {
  readonly rng: Rng;
  readonly t: DbTables = emptyTables();
  readonly seededAt: number;
  readonly today: string;
  auditSeq = 0;
  auditHead = 'GENESIS';
  journalSeq = 0;
  readonly holidays: Set<string>;

  constructor(seed: number, seedDate: string, seededAt: number) {
    this.rng = mulberry32(seed);
    this.seededAt = seededAt;
    this.today = seedDate;
    this.holidays = new Set(HOLIDAYS.map((h) => h[0]));
  }
  id(prefix: string): string {
    return newId(prefix, this.rng);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.rng() * arr.length)]!;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.rng() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.rng() < p;
  }
  at(dayOffset: number, hh: number, mm = 0): number {
    return localToInstant(addDays(this.today, dayOffset), hh * 60 + mm);
  }
  journal(d: JournalDraft): LedgerJournal {
    this.journalSeq += 1;
    const j = { ...d, id: this.id('jnl'), seq: this.journalSeq, postedAt: d.occurredAt };
    this.t.journals[j.id] = j;
    return j;
  }
  audit(at: number, actorUserId: Id | null, actorLabel: string, action: string, targetType: string, targetId: Id | null, businessId: Id | null, summary: string): void {
    this.auditSeq += 1;
    const base: Omit<AuditEntry, 'hash'> = { id: this.id('aud'), seq: this.auditSeq, at, actorUserId, actorLabel, supportSessionId: null, action, targetType, targetId, businessId, summary, before: null, after: null, reason: null, ip: `203.0.113.${this.int(2, 250)}`, device: 'Chrome on Windows', correlationId: `cor_${this.id('c').slice(2, 14)}`, prevHash: this.auditHead };
    const hash = sha256Hex(canonicalJson(base));
    this.t.audit[base.id] = { ...base, hash };
    this.auditHead = hash;
  }
}

function hist<S extends string>(steps: [S, S, number, string][]): StatusChange<S>[] {
  return steps.map(([from, to, at, reason]) => ({ from, to, at, by: 'system', reason }));
}

export function generateSeed(seed: number, seedDate: string, seededAt: number): GeneratedBase {
  const g = new Gen(seed, seedDate, seededAt);
  const t = g.t;
  const longAgo = g.at(-400, 9);

  // ---------------------------------------------------------------- platform settings & catalogs
  const settingsRow: PlatformSettings = {
    id: 'platform',
    feeSchedules: FEE_SCHEDULES.map((f) => ({ ...f })),
    refundPlatformApprovalThreshold: pesos(5_000),
    lateWebhookGraceMinutes: 15,
    providerSessionMinMinutes: 5,
    maxHoldLifetimeMinutes: 20,
    vatPpm: 120_000,
    featureFlags: {
      split_payments: { enabled: false, description: 'Split a booking payment between players (Phase 2; provider-dependent)' },
      external_ratings: { enabled: false, description: 'Show ratings from an external provider via partner API (Phase 2)' },
      recurring_bookings: { enabled: false, description: 'Weekly recurring court bookings (Phase 2)' },
      platform_credits: { enabled: false, description: 'Refund to platform credit (blocked pending e-money legal review)' },
      sms_notifications: { enabled: true, description: 'Send SMS through the PH aggregator (sender ID registration pending)' },
      web_push: { enabled: true, description: 'Web Push notifications for the PWA' },
      read_only_mode: { enabled: false, description: 'Kill switch: pause all new bookings and payments' },
    },
    amenities: AMENITIES,
    eventTypes: [
      { code: 'tournament', label: 'Tournament' }, { code: 'league', label: 'League' }, { code: 'clinic', label: 'Clinic' }, { code: 'training', label: 'Training session' },
      { code: 'open_play', label: 'Open play' }, { code: 'social', label: 'Social event' }, { code: 'private', label: 'Private event' },
    ],
    demo: { webhookMode: 'normal', providerOutage: false, failNextPayout: false, failNextRefund: false, latency: 'realistic' },
    updatedAt: longAgo,
    updatedBy: null,
  };
  t.settings.platform = settingsRow;
  for (const [date, name, type] of HOLIDAYS) t.holidays[date] = { id: date, date, name, type };
  t.providerMaster.master = { id: 'master', balance: 0 };

  // ---------------------------------------------------------------- people
  const users: User[] = [];
  const mkUser = (first: string, last: string, email: string | null, phone: string | null, opts: { persona?: string; role?: PlatformRoleKey; mfa?: boolean; createdAt?: number; skill?: 'beginner' | 'novice' | 'intermediate' | 'advanced' | 'expert'; city?: string } = {}): User => {
    const id = g.id('usr');
    const secretBytes = new Uint8Array(20).map(() => Math.floor(g.rng() * 256));
    const u: User = {
      id,
      email,
      phone,
      passwordHash: null,
      status: 'active',
      emailVerifiedAt: email ? (opts.createdAt ?? longAgo) : null,
      phoneVerifiedAt: phone && !email ? (opts.createdAt ?? longAgo) : null,
      mfa: opts.mfa ? { totpSecret: toBase32(secretBytes), enabledAt: opts.createdAt ?? longAgo, lastUsedStep: 0, recoveryDigests: [] } : null,
      platformRole: opts.role ?? null,
      createdAt: opts.createdAt ?? longAgo,
      lastLoginAt: null,
      lockedUntil: null,
      ...(opts.persona ? { persona: opts.persona } : {}),
      deletion: null,
    };
    t.users[id] = u;
    t.profiles[id] = { id, userId: id, firstName: first, lastName: last, displayName: `${first} ${last.split(' ').pop()!.slice(0, 1)}.`, city: opts.city ?? 'Metro Manila', skillSelf: opts.skill ?? null, bio: '', avatarHue: g.int(0, 359), visibility: { profile: 'public', activity: 'connections', ratings: 'organizers' } };
    t.preferences[id] = defaultPreferences(id, g.chance(0.3));
    t.consents[`cns_${id}_t`] = { id: `cns_${id}_t`, userId: id, kind: 'terms', version: '2026-07', granted: true, at: u.createdAt };
    t.consents[`cns_${id}_p`] = { id: `cns_${id}_p`, userId: id, kind: 'privacy', version: '2026-07', granted: true, at: u.createdAt };
    users.push(u);
    return u;
  };
  const persona: Record<string, User> = {};
  for (const p of PERSONAS) persona[p.key] = mkUser(p.first, p.last, p.email, p.phone, { persona: p.key, ...(p.role ? { role: p.role } : {}), mfa: p.mfa, createdAt: g.at(-300, 10), skill: p.key === 'player' ? 'intermediate' : p.key === 'player2' ? 'novice' : undefined as never });
  t.profiles[persona.player!.id]!.displayName = 'Juan dela Cruz';
  t.profiles[persona.player!.id]!.bio = 'Weekday evenings after work. Always up for doubles!';
  t.preferences[persona.player!.id]!.notifications.reminders.email = true;
  const players: User[] = [];
  for (let i = 0; i < 44; i++) {
    const first = FIRST[i % FIRST.length]!;
    const last = LAST[(i * 7) % LAST.length]!;
    players.push(mkUser(first, last, `${first.toLowerCase()}.${last.toLowerCase().replace(/\s/g, '')}${i}@example.com`, `+63917${String(1000100 + i).padStart(7, '0')}`, { createdAt: g.at(-g.int(60, 380), 12), skill: g.pick(['beginner', 'novice', 'intermediate', 'advanced'] as const) }));
  }
  const ownerFor = new Map<string, User>();
  ownerFor.set('Dink District', persona.owner!);

  // ---------------------------------------------------------------- commission agreements
  const globalAgreement = { id: 'cag_platform_default', businessId: null, ratePpm: 50_000, appliesToProducts: false, appliesToEvents: true, effectiveFrom: longAgo, effectiveTo: null, status: 'active' as const, note: 'Platform default commission (launch terms)', createdBy: persona.superadmin!.id, createdAt: longAgo, approvedBy: persona.finance!.id, approvedAt: longAgo, approvalId: null };
  t.commissionAgreements[globalAgreement.id] = globalAgreement;

  // ---------------------------------------------------------------- businesses, venues, courts, pricing, products
  const businesses = new Map<string, Business>();
  const venues: { spec: VenueSpec; venue: Venue; courts: Court[]; rules: PricingRule[]; products: Product[] }[] = [];
  const mkBusiness = (name: string, legal: string, spec: VenueSpec | null, status: Business['status'], owner: User): Business => {
    const id = g.id('biz');
    const sub = status === 'active' ? `sub-${g.id('s').slice(2, 18)}` : null;
    const b: Business = {
      id,
      legalName: legal,
      tradeName: name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      type: legal.includes('Sole') ? 'sole_proprietorship' : legal.includes('Partnership') ? 'partnership' : 'corporation',
      registrationNo: `CS20${g.int(10, 26)}${g.int(10000, 99999)}`,
      tinMasked: `•••-•••-${g.int(100, 999)}`,
      vatRegistered: spec?.vat ?? true,
      pricesIncludeVat: true,
      ownerUserId: owner.id,
      contactEmail: `hello@${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.example.com`,
      contactPhone: `+63918${String(2000000 + g.int(0, 999999)).padStart(7, '0')}`,
      address: { line1: spec?.line1 ?? 'Diversion Rd.', barangay: spec?.barangay ?? 'Mandurriao', city: spec?.city ?? 'Iloilo City', province: spec?.province ?? 'Iloilo', region: '', postalCode: '' },
      description: spec?.tagline ?? '',
      status,
      history: [],
      settlementModel: 'provider_split',
      payoutAccount: sub ? { status: 'verified', providerSubAccountId: sub, bankName: g.pick(['BPI', 'BDO', 'UnionBank', 'Metrobank']), accountMasked: '', updatedAt: longAgo } : { status: 'not_connected', providerSubAccountId: null, bankName: null, accountMasked: null, updatedAt: null },
      createdAt: g.at(-g.int(200, 380), 10),
      submittedAt: g.at(-190, 10),
      approvedAt: status === 'active' || status === 'suspended' ? g.at(-185, 15) : null,
      approvedBy: status === 'active' || status === 'suspended' ? persona.superadmin!.id : null,
    };
    if (b.payoutAccount.bankName) b.payoutAccount.accountMasked = `${b.payoutAccount.bankName} •••• ${g.int(1000, 9999)}`;
    t.businesses[id] = b;
    if (sub) t.providerSubAccounts[sub] = { id: sub, businessId: id, type: 'MANAGED', status: 'LIVE', balance: 0, createdAt: b.approvedAt! };
    for (const r of seedSystemRoles(null, id, b.createdAt)) t.roles[r.id] = r;
    t.members[g.id('mem')] = { id: '', businessId: id, userId: owner.id, status: 'active', roleIds: [`rol_${id.slice(4)}_business_owner`], venueIds: null, invitedBy: owner.id, invitedAt: b.createdAt, joinedAt: b.createdAt, title: 'Owner' };
    const memKey = Object.keys(t.members).pop()!;
    t.members[memKey]!.id = memKey;
    g.audit(b.createdAt, owner.id, `${t.profiles[owner.id]!.displayName}`, 'business.registered', 'business', id, id, `Registered ${name} (${legal})`);
    if (b.approvedAt) g.audit(b.approvedAt, persona.superadmin!.id, 'Andrea V. (SuperAdmin)', 'business.verification_approve', 'business', id, id, `Approved ${name}`);
    businesses.set(name, b);
    return b;
  };

  const productTemplates: [string, Product['category'], number, string, Partial<Product['fulfillment']>, string[]?][] = [
    ['Bottled water (500 ml)', 'drinks', 40, 'Chilled at the front desk', { bookingAddOn: true, eventAddOn: true, standalone: true }],
    ['Electrolyte drink', 'drinks', 85, 'Chilled at the front desk', { bookingAddOn: true, eventAddOn: true, standalone: true }],
    ['Paddle rental (per session)', 'rental', 150, 'Collect at the front desk; return after your game', { bookingAddOn: true, eventAddOn: true }],
    ['Pickleballs — 3-pack (outdoor)', 'balls', 450, 'Pick up at the pro shop counter', { bookingAddOn: true, standalone: true }],
    ['Club dri-fit shirt', 'merch', 650, 'Pick up at the pro shop counter', { standalone: true }, ['S', 'M', 'L', 'XL']],
    ['Towel rental', 'rental', 50, 'Front desk', { bookingAddOn: true }],
    ['Banana bread slice', 'food', 75, 'Café counter', { bookingAddOn: true, standalone: true }],
  ];

  for (const spec of V) {
    let owner = ownerFor.get(spec.business);
    if (!owner) {
      owner = mkUser(g.pick(FIRST), g.pick(LAST), `owner.${spec.key}@example.com`, `+63919${String(3000000 + g.int(0, 999999)).padStart(7, '0')}`, { mfa: true, createdAt: g.at(-390, 9) });
      ownerFor.set(spec.business, owner);
    }
    const business = businesses.get(spec.business) ?? mkBusiness(spec.business, spec.legal, spec, 'active', owner);
    const hoursRange = spec.hours ?? [6, 23];
    const hours: WeeklyHours = { days: Array.from({ length: 7 }, () => ({ open: hoursRange[0] * 60, close: hoursRange[1] * 60 })) };
    const venue: Venue = {
      id: g.id('ven'),
      businessId: business.id,
      name: spec.name,
      slug: spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      tagline: spec.tagline,
      description: `${spec.tagline}. ${spec.courts.length} ${spec.courts.every((c) => c.env === 'outdoor') ? 'outdoor' : spec.courts.every((c) => c.env === 'indoor') ? 'indoor' : 'indoor and covered'} courts with professional nets and non-slip acrylic surfaces. Walk-ins welcome when courts are free; book ahead for evenings and weekends.`,
      address: { line1: spec.line1, barangay: spec.barangay, city: spec.city, province: spec.province, region: '', postalCode: '', landmark: spec.landmark },
      geo: { lat: spec.lat, lng: spec.lng },
      timezone: 'Asia/Manila',
      offsetMin: 480,
      contactPhone: business.contactPhone,
      contactEmail: business.contactEmail,
      amenities: spec.amenities,
      parking: spec.amenities.includes('parking') ? 'Free parking for players (first 3 hours).' : 'Street parking and nearby pay parking.',
      accessibility: spec.amenities.includes('pwd_access') ? 'Ramp access, accessible restroom, and courtside seating.' : 'Ground-floor courts; please call ahead for assistance.',
      rules: ['Non-marking court shoes only.', 'Please arrive 10 minutes early for check-in.', 'Maximum 8 players per court booking.', 'Clean up after your game — the next players will thank you.'],
      status: 'published',
      history: [],
      hours,
      settings: { ...DEFAULT_BOOKING_SETTINGS, ...(spec.settings ?? {}) },
      policyKey: spec.policy ?? 'standard',
      acceptedMethods: ['gcash', 'maya', 'grabpay', 'online_banking', 'card', 'qrph'],
      art: { hue: spec.hue, accent: (spec.hue + 140) % 360, pattern: spec.pattern },
      ratingAvg: 0,
      ratingCount: 0,
      createdAt: business.createdAt + DAY,
      publishedAt: business.createdAt + 5 * DAY,
    };
    t.venues[venue.id] = venue;
    const courts = spec.courts.map((c, i) => {
      const court: Court = { id: g.id('crt'), businessId: business.id, venueId: venue.id, name: c.name, format: c.format ?? 'full', environment: c.env, surface: c.env === 'indoor' ? 'Cushioned acrylic (indoor)' : 'Acrylic hard court', customTags: i === 0 && spec.key === 'makati' ? ['Show court'] : [], status: 'active', sortOrder: i + 1 };
      t.courts[court.id] = court;
      return court;
    });
    const mkRule = (name: string, kind: PricingRule['kind'], effect: PricingRule['effect'], conditions: PricingRule['conditions'], priority: number, extra: Partial<PricingRule> = {}): PricingRule => {
      const r: PricingRule = { id: g.id('prl'), businessId: business.id, venueId: venue.id, courtIds: null, name, kind, effect, conditions, priority, status: 'active', version: 1, createdAt: venue.createdAt, createdBy: owner!.id, updatedAt: venue.createdAt, updatedBy: owner!.id, ...extra };
      t.pricingRules[r.id] = r;
      t.ruleHistory[`rlh_${r.id}`] = { id: `rlh_${r.id}`, ruleId: r.id, businessId: r.businessId, version: 1, change: 'created', snapshot: r, changedBy: owner!.id, changedAt: r.createdAt };
      return r;
    };
    const rules = [
      mkRule('Standard rate', 'base', { type: 'rate', ratePerHour: pesos(spec.base) }, {}, 0, { minChargeCentavos: pesos(spec.base) }),
      mkRule('Weekday peak', 'peak', { type: 'rate', ratePerHour: pesos(spec.peak) }, { daysOfWeek: [1, 2, 3, 4, 5], startMinute: 17 * 60, endMinute: 22 * 60 }, 20),
      mkRule('Weekend', 'weekend', { type: 'rate', ratePerHour: pesos(spec.weekend) }, { daysOfWeek: [0, 6] }, 10),
      mkRule('Early bird', 'off_peak', { type: 'adjust_percent', percentPpm: -150_000 }, { daysOfWeek: [1, 2, 3, 4, 5], startMinute: 6 * 60, endMinute: 9 * 60 }, 5),
      mkRule('Holiday rate', 'holiday', { type: 'rate', ratePerHour: pesos(spec.peak + 50) }, { holidaysOnly: true }, 30),
    ];
    if (spec.key === 'makati') rules.push(mkRule('Center Court premium', 'custom', { type: 'adjust_amount', amountPerHour: pesos(100) }, {}, 15, { courtIds: [courts[0]!.id] }));
    g.audit(venue.createdAt + HOUR, owner.id, t.profiles[owner.id]!.displayName, 'pricing.rule_created', 'pricing_rule', rules[1]!.id, business.id, `Created "Weekday peak" ₱${spec.peak}/hr (priority 20)`);
    const products: Product[] = [];
    productTemplates.forEach(([name, category, price, pickup, ful, variants], i) => {
      if (spec.popularity < 5 && i > 3) return;
      const p: Product = { id: g.id('prd'), businessId: business.id, venueId: venue.id, name, description: '', category, price: pesos(price), variants: (variants ?? []).map((v) => ({ id: g.id('var'), name: v, price: null })), maxPerOrder: category === 'merch' ? 3 : 8, fulfillment: { pickup: true, bookingAddOn: false, eventAddOn: false, standalone: false, ...ful }, pickupInstructions: pickup, taxable: true, status: 'active', art: { hue: (spec.hue + i * 40) % 360, glyph: category }, createdAt: venue.createdAt };
      t.products[p.id] = p;
      const stock = category === 'merch' ? 12 : category === 'balls' ? 30 : 120;
      if (p.variants.length) for (const v of p.variants) t.inventory[g.id('inv')] = { id: '', businessId: business.id, productId: p.id, variantId: v.id, type: 'initial', onHandDelta: v.name === 'XL' ? 2 : stock, reservedDelta: 0, refId: null, at: venue.createdAt, by: owner!.id, note: 'Opening stock' };
      else t.inventory[g.id('inv')] = { id: '', businessId: business.id, productId: p.id, variantId: null, type: 'initial', onHandDelta: stock, reservedDelta: 0, refId: null, at: venue.createdAt, by: owner!.id, note: 'Opening stock' };
      products.push(p);
    });
    venues.push({ spec, venue, courts, rules, products });
  }
  // inventory rows need ids equal to keys
  for (const [k, v] of Object.entries(t.inventory)) v.id = k;

  // Kitchen Line promotional agreement (4%) — per-business commission demo
  const kl = businesses.get('Kitchen Line Pickleball Club')!;
  t.commissionAgreements.cag_kitchen_line = { id: 'cag_kitchen_line', businessId: kl.id, ratePpm: 40_000, appliesToProducts: false, appliesToEvents: true, effectiveFrom: g.at(-120, 0), effectiveTo: localToInstant('2027-01-01', 0), status: 'active', note: 'Launch partner rate — 4% until Dec 31, 2026 (commercial agreement KL-2026-01)', createdBy: persona.superadmin!.id, createdAt: g.at(-125, 11), approvedBy: persona.finance!.id, approvedAt: g.at(-124, 9), approvalId: null };
  g.audit(g.at(-124, 9), persona.finance!.id, 'Carla M. (Finance Operations)', 'approval.approved', 'commission_agreement', 'cag_kitchen_line', kl.id, 'Approved: Kitchen Line Pickleball Club: 4% until Dec 31, 2026');

  // Dink District team
  const dink = businesses.get('Dink District')!;
  const bgc = venues.find((v) => v.spec.key === 'bgc')!;
  const addMember = (u: User, roleKey: string, venueIds: Id[] | null, title: string) => {
    const id = g.id('mem');
    t.members[id] = { id, businessId: dink.id, userId: u.id, status: 'active', roleIds: [`rol_${dink.id.slice(4)}_${roleKey}`], venueIds, invitedBy: persona.owner!.id, invitedAt: g.at(-150, 10), joinedAt: g.at(-149, 10), title };
    g.audit(g.at(-150, 10), persona.owner!.id, 'Maria S.', 'staff.invited', 'member', id, dink.id, `Invited ${t.profiles[u.id]!.displayName} as ${roleKey.replace('_', ' ')}`);
  };
  addMember(persona.manager!, 'business_manager', null, 'Operations Manager');
  addMember(persona.receptionist!, 'receptionist', [bgc.venue.id], 'Front Desk (BGC)');

  // Pending applicant (Iloilo) and suspended business (Laguna)
  const iloilo = mkBusiness('Iloilo Esplanade Pickleball Co.', 'Iloilo Esplanade Pickleball Co. (Partnership)', null, 'pending_verification', persona.applicant!);
  iloilo.createdAt = g.at(-3, 14);
  iloilo.submittedAt = g.at(-2, 10);
  iloilo.history = hist([['draft', 'pending_verification', g.at(-2, 10), 'Documents submitted']]);
  t.verifications[g.id('ver')] = { id: '', businessId: iloilo.id, status: 'submitted', documents: [
    { id: g.id('doc'), type: 'dti_sec_registration', fileName: 'SEC-registration-2026.pdf', sizeBytes: 482_113, mime: 'application/pdf', scanStatus: 'clean', uploadedAt: g.at(-2, 9) },
    { id: g.id('doc'), type: 'bir_cor_2303', fileName: 'BIR-Form-2303.pdf', sizeBytes: 311_902, mime: 'application/pdf', scanStatus: 'clean', uploadedAt: g.at(-2, 9) },
    { id: g.id('doc'), type: 'mayors_permit', fileName: 'Mayors-Permit-Iloilo-2026.jpg', sizeBytes: 1_204_551, mime: 'image/jpeg', scanStatus: 'clean', uploadedAt: g.at(-2, 9) },
    { id: g.id('doc'), type: 'owner_valid_id', fileName: 'owner-id-front-back.png', sizeBytes: 902_337, mime: 'image/png', scanStatus: 'clean', uploadedAt: g.at(-2, 9) },
  ], submittedAt: g.at(-2, 10), submittedBy: persona.applicant!.id, reviewedAt: null, reviewedBy: null, decisionNote: null };
  for (const [k, v] of Object.entries(t.verifications)) v.id = k;
  const iloiloVenue: Venue = { ...bgc.venue, id: g.id('ven'), businessId: iloilo.id, name: 'Iloilo Esplanade Pickleball', slug: 'iloilo-esplanade-pickleball', tagline: 'Riverside courts along the Esplanade (opening soon)', address: { line1: 'Diversion Rd.', barangay: 'Mandurriao', city: 'Iloilo City', province: 'Iloilo', region: '', postalCode: '', landmark: 'Near the Iloilo River Esplanade' }, geo: { lat: 10.697, lng: 122.564 }, status: 'draft', history: [], amenities: ['parking', 'lights'], art: { hue: 330, accent: 110, pattern: 'dots' }, ratingAvg: 0, ratingCount: 0, createdAt: g.at(-3, 15), publishedAt: null };
  t.venues[iloiloVenue.id] = iloiloVenue;
  const lagunaOwner = mkUser('Dominic', 'Salazar', 'owner.laguna@example.com', '+639190000555', { mfa: true });
  const laguna = mkBusiness('Laguna Lakeside Courts', 'Laguna Lakeside Courts Inc.', null, 'suspended', lagunaOwner);
  laguna.statusReason = 'Mayor’s permit expired — reactivation after renewal is uploaded';
  laguna.history = hist([['active', 'suspended', g.at(-10, 11), laguna.statusReason]]);
  g.audit(g.at(-10, 11), persona.superadmin!.id, 'Andrea V. (SuperAdmin)', 'business.suspended', 'business', laguna.id, laguna.id, 'Suspended Laguna Lakeside Courts');

  // ---------------------------------------------------------------- transactions
  const tax = (b: Business) => ({ vatRegistered: b.vatRegistered, pricesIncludeVat: b.pricesIncludeVat, vatPpm: 120_000 });
  const commission = (b: Business, at: number) => {
    const ag = b.id === kl.id && at >= t.commissionAgreements.cag_kitchen_line!.effectiveFrom ? t.commissionAgreements.cag_kitchen_line! : globalAgreement;
    return { ratePpm: ag.ratePpm, source: ag.businessId ? ('agreement' as const) : ('global' as const), agreementId: ag.id, appliesToProducts: false, appliesToEvents: true, label: ag.businessId ? '4% business agreement' : '5% platform default' };
  };
  const methods: PaymentMethodCode[] = ['gcash', 'gcash', 'gcash', 'maya', 'maya', 'grabpay', 'card', 'qrph', 'online_banking'];
  const feeFor = (m: PaymentMethodCode) => settingsRow.feeSchedules.find((f) => f.method === m)!;

  const capture = (o: { business: Business; venue: Venue; userId: Id; quote: Quote; method: PaymentMethodCode; at: number; kind: 'court_booking' | 'event_registration' | 'product_order'; bookingId?: Id; registrationId?: Id; orderId?: Id; settle: boolean }) => {
    const checkoutId = g.id('chk');
    const snapId = g.id('snp');
    t.snapshots[snapId] = { id: snapId, businessId: o.business.id, quote: o.quote, hash: sha256Hex(canonicalJson(o.quote)), createdAt: o.at - 4 * MINUTE, lockedUntil: o.at + 6 * MINUTE };
    const payId = g.id('pay');
    const sessionId = `ps-${g.id('p').slice(2, 22)}`;
    const ppId = `py-${g.id('p').slice(2, 22)}`;
    const f = feeFor(o.method);
    const fee = providerFeeOn(o.quote.total, f.percentPpm, f.fixed);
    const split = o.quote.total - o.quote.venueNet;
    const last4 = String(g.int(1000, 9999));
    const display = o.method === 'card' ? `Visa •••• ${last4}` : o.method === 'qrph' ? 'QR Ph (InstaPay)' : o.method === 'online_banking' ? `BPI •••• ${last4}` : `${METHOD_LABEL[o.method]} •••• ${last4}`;
    t.checkouts[checkoutId] = { id: checkoutId, kind: o.kind, userId: o.userId, businessId: o.business.id, venueId: o.venue.id, status: 'completed', history: hist([['open', 'payment_pending', o.at - 2 * MINUTE, 'Paying'], ['payment_pending', 'completed', o.at, 'Paid']]), createdAt: o.at - 5 * MINUTE, expiresAt: o.at + 5 * MINUTE, maxExpiresAt: o.at + 15 * MINUTE, snapshotId: snapId, paymentMethod: o.method, paymentIds: [payId], ...(o.bookingId ? { bookingId: o.bookingId } : {}), ...(o.registrationId ? { registrationId: o.registrationId } : {}), ...(o.orderId ? { orderId: o.orderId } : {}), promoCode: null, redemptionId: null, addOns: [], policyKey: o.venue.policyKey, policyVersion: POLICY_LIBRARY[o.venue.policyKey].version, policyAcceptedAt: o.at - 3 * MINUTE, source: 'online', createdBy: o.userId };
    t.payments[payId] = { id: payId, checkoutId, userId: o.userId, businessId: o.business.id, provider: 'xendit_sandbox', providerSessionId: sessionId, providerPaymentId: ppId, method: o.method, methodDisplay: display, snapshotId: snapId, amount: o.quote.total, currency: 'PHP', status: 'captured', history: hist([['created', 'pending', o.at - 2 * MINUTE, 'Payment session created'], ['pending', 'captured', o.at, 'Capture verified via webhook']]), customerFee: o.quote.fee?.customerAmount ?? 0, estimatedProviderFee: o.quote.fee?.estimatedProviderFee ?? 0, actualProviderFee: fee, splitPlatformAmount: split, attempt: 1, idempotencyKey: `${checkoutId}:1`, createdAt: o.at - 2 * MINUTE, capturedAt: o.at, failureReason: null, refundedAmount: 0, reconciledAt: o.at + HOUR, confirmedVia: 'webhook', settledAt: o.settle ? o.at + HOUR : null, payoutId: null };
    t.providerSessions[sessionId] = { id: sessionId, externalId: payId, forUserId: o.business.payoutAccount.providerSubAccountId, splitPlatformAmount: split, amount: o.quote.total, currency: 'PHP', method: o.method, merchantName: o.venue.name, description: 'Checkout', status: 'COMPLETED', paymentId: ppId, createdAt: o.at - 2 * MINUTE, expiresAt: o.at + 8 * MINUTE, idempotencyKey: `${checkoutId}:1`, failureCode: null };
    t.providerPayments[ppId] = { id: ppId, sessionId, externalId: payId, amount: o.quote.total, fee, method: o.method, methodDisplay: display, status: 'SUCCEEDED', forUserId: o.business.payoutAccount.providerSubAccountId, splitPlatformAmount: split, createdAt: o.at, refundedAmount: 0, settledAt: o.settle ? o.at + HOUR : null };
    t.providerMaster.master!.balance += split - fee;
    const sub = o.business.payoutAccount.providerSubAccountId;
    if (sub) t.providerSubAccounts[sub]!.balance += o.quote.total - split;
    const refs = { paymentId: payId, checkoutId, ...(o.bookingId ? { bookingId: o.bookingId } : {}), ...(o.registrationId ? { registrationId: o.registrationId } : {}), ...(o.orderId ? { orderId: o.orderId } : {}) };
    g.journal(captureJournal(o.quote, o.business.id, refs, o.at, `Payment captured (${display})`));
    if (fee) g.journal(providerFeeJournal(fee, o.business.id, refs, o.at, `Provider fee for ${payId}`));
    return { checkoutId, snapId, payId, ppId };
  };

  const refund = (o: { payId: Id; business: Business; quote: Quote; share: number; feeBack: boolean; at: number; reason: string; initiator: 'player' | 'venue' | 'system'; bookingId: Id }) => {
    const breakdown = computeRefund(o.quote, { items: [{ ref: 'court', sharePpm: o.share }], refundGatewayFee: o.feeBack });
    if (breakdown.toCustomer <= 0) return 0;
    const id = g.id('rfn');
    const pay = t.payments[o.payId]!;
    const partial = breakdown.toCustomer < pay.amount;
    t.refunds[id] = { id, paymentId: o.payId, businessId: o.business.id, userId: pay.userId, checkoutId: pay.checkoutId, bookingId: o.bookingId, orderId: null, registrationId: null, amount: breakdown.toCustomer, breakdown, reason: o.reason, initiator: o.initiator, requestedBy: pay.userId, status: 'succeeded', history: hist([['requested', 'approved', o.at, 'Within policy'], ['approved', 'processing', o.at, 'Submitted'], ['processing', 'succeeded', o.at + 5 * MINUTE, 'Confirmed by provider']]), providerRefundId: `rfd-${g.id('r').slice(2, 20)}`, approvals: [], needsBusinessApproval: false, needsPlatformApproval: false, afterPayout: false, createdAt: o.at, completedAt: o.at + 5 * MINUTE, failureReason: null, partial };
    pay.refundedAmount += breakdown.toCustomer;
    pay.status = partial ? 'partially_refunded' : 'refunded';
    pay.history.push({ from: 'captured', to: pay.status, at: o.at + 5 * MINUTE, by: 'provider', reason: 'Refund completed' });
    const pp = t.providerPayments[pay.providerPaymentId!]!;
    pp.refundedAmount += breakdown.toCustomer;
    pp.status = partial ? 'PARTIALLY_REFUNDED' : 'REFUNDED';
    const sub = o.business.payoutAccount.providerSubAccountId;
    const fromSub = sub ? Math.min(t.providerSubAccounts[sub]!.balance, breakdown.toCustomer) : 0;
    if (sub) t.providerSubAccounts[sub]!.balance -= fromSub;
    t.providerMaster.master!.balance -= breakdown.toCustomer - fromSub;
    g.journal(refundJournal(breakdown, o.business.id, partial, { paymentId: o.payId, refundId: id, bookingId: o.bookingId }, o.at + 5 * MINUTE, `Refund — ${o.reason}`));
    return breakdown.toCustomer;
  };

  const bookingRow = (o: { business: Business; venue: Venue; court: Court; userId: Id; startMs: number; minutes: number; status: BookingStatus; checkoutId: Id; snapId: Id; createdAt: number; history: StatusChange<BookingStatus>[]; slot: boolean; source?: 'online' | 'walk_in' }): Booking => {
    const id = g.id('bkg');
    let code = bookingCode(g.rng);
    while (Object.values(t.bookings).some((b) => b.code === code)) code = bookingCode(g.rng);
    const endMs = o.startMs + o.minutes * MINUTE;
    let slotId: Id | null = null;
    if (o.slot) {
      slotId = g.id('slt');
      t.slots[slotId] = { id: slotId, businessId: o.business.id, venueId: o.venue.id, courtId: o.court.id, startMs: o.startMs, endMs, occupiedEndMs: endMs + o.venue.settings.bufferMinutes * MINUTE, kind: 'booking', sourceId: id, status: ['cancelled', 'refunded', 'partially_refunded', 'refund_pending'].includes(o.status) ? 'released' : 'active', expiresAt: null, createdAt: o.createdAt, releasedAt: null };
    }
    const b: Booking = { id, code, businessId: o.business.id, venueId: o.venue.id, courtId: o.court.id, userId: o.userId, checkoutId: o.checkoutId, startMs: o.startMs, endMs, durationMinutes: o.minutes, status: o.status, history: o.history, snapshotId: o.snapId, policy: { key: o.venue.policyKey, version: POLICY_LIBRARY[o.venue.policyKey].version, name: POLICY_LIBRARY[o.venue.policyKey].name, acceptedAt: o.createdAt }, participants: [], addOnOrderId: null, source: o.source ?? 'online', createdAt: o.createdAt, confirmedAt: o.createdAt + 2 * MINUTE, checkedInAt: o.status === 'completed' || o.status === 'checked_in' ? o.startMs - 10 * MINUTE : null, checkedInBy: null, completedAt: o.status === 'completed' ? endMs : null, cancelledAt: null, cancelledBy: null, cancelReason: null, noShowAt: o.status === 'no_show' ? o.startMs + 20 * MINUTE : null, rescheduleCount: 0, slotId, lateRecovery: false, qrNonce: g.id('q').slice(2, 14) };
    t.bookings[id] = b;
    const cko = t.checkouts[o.checkoutId];
    if (cko) cko.bookingId = id;
    return b;
  };

  const quoteFor = (vv: (typeof venues)[number], court: Court, startMs: number, minutes: number, method: PaymentMethodCode | null, business: Business, addOns: { p: Product; qty: number }[] = []) => {
    const pricing = priceCourtTime({ rules: vv.rules, courtId: court.id, courtName: court.name, startMs, endMs: startMs + minutes * MINUTE, offsetMin: 480, holidays: g.holidays });
    return buildQuote({ court: { pricing, ref: 'court', label: `${court.name} · ${minutes / 60 === 1 ? '1 hr' : `${minutes / 60} hrs`}` }, addOns: addOns.map((a) => ({ ref: `addon:${a.p.id}:-`, productId: a.p.id, label: a.qty > 1 ? `${a.p.name} × ${a.qty}` : a.p.name, unitAmount: a.p.price, qty: a.qty, taxable: true })), tax: tax(business), fee: method ? feeFor(method) : null, commission: commission(business, startMs) });
  };

  const taken = new Map<Id, { s: number; e: number }[]>();
  const isFree = (courtId: Id, s: number, e: number) => !(taken.get(courtId) ?? []).some((x) => x.s < e && s < x.e);
  const take = (courtId: Id, s: number, e: number) => {
    const list = taken.get(courtId) ?? [];
    list.push({ s, e });
    taken.set(courtId, list);
  };

  const reviewsText = [
    [5, 'Great courts and friendly front desk staff. Check-in with the QR code took seconds.'],
    [5, 'Lights are bright for evening games and the surface is excellent.'],
    [4, 'Good courts. Parking can be tight on weekends but the booking process was smooth.'],
    [4, 'Clean facility and fair rates for off-peak mornings.'],
    [5, 'Our barkada plays here every week. Easy to rebook the same slot.'],
    [3, 'Courts are fine, but the air-con was weak during the afternoon.'],
    [4, 'Nice café and paddle rentals. Would love more early-morning slots.'],
    [5, 'Best place in the area for beginners — the clinic was worth it.'],
  ] as const;

  // Pre-reserve the times used by scripted demo bookings and events so generated history never overlaps them.
  const now0 = seededAt;
  const half = (ms: number) => Math.ceil(ms / (30 * MINUTE)) * 30 * MINUTE;
  const bgcSpec = venues.find((v) => v.spec.key === 'bgc')!;
  const mkSpec = venues.find((v) => v.spec.key === 'makati')!;
  const dowAfter = (dow: number, minDays: number) => {
    for (let d = minDays; d < minDays + 8; d++) if (localParts(localToInstant(addDays(g.today, d), 12 * 60)).dow === dow) return d;
    return minDays;
  };
  const scripted = {
    soon: half(now0 + 35 * MINUTE),
    started: half(now0 - 50 * MINUTE),
    juanTomorrow: localToInstant(addDays(g.today, 1), 19 * 60),
    juanMakati: localToInstant(addDays(g.today, 3), 7 * 60),
    fri: dowAfter(5, 2),
    sat: dowAfter(6, 3),
  };
  take(bgcSpec.courts[1]!.id, scripted.soon - 30 * MINUTE, scripted.soon + 100 * MINUTE);
  take(bgcSpec.courts[2]!.id, scripted.started - 30 * MINUTE, scripted.started + 100 * MINUTE);
  take(bgcSpec.courts[0]!.id, scripted.juanTomorrow - 30 * MINUTE, scripted.juanTomorrow + 130 * MINUTE);
  take(mkSpec.courts[1]!.id, scripted.juanMakati - 60 * MINUTE, scripted.juanMakati + 120 * MINUTE);
  for (const i of [4, 5]) take(bgcSpec.courts[i]!.id, g.at(scripted.fri, 18), g.at(scripted.fri, 23));
  take(bgcSpec.courts[3]!.id, g.at(scripted.sat, 8), g.at(scripted.sat, 12));
  for (const c of mkSpec.courts) take(c.id, g.at(12, 7), g.at(12, 19));
  const cebuSpec = venues.find((v) => v.spec.key === 'cebu')!;
  for (const i of [2, 3]) take(cebuSpec.courts[i]!.id, g.at(5, 17), g.at(5, 22));
  const clarkSpec = venues.find((v) => v.spec.key === 'clark')!;
  for (const i of [0, 1]) take(clarkSpec.courts[i]!.id, g.at(-6, 7), g.at(-6, 13));

  // Historical & upcoming bookings
  for (const vv of venues) {
    const business = t.businesses[vv.venue.businessId]!;
    for (let day = -45; day <= 7; day++) {
      const date = addDays(g.today, day);
      const dow = localParts(localToInstant(date, 12 * 60)).dow;
      const weekend = dow === 0 || dow === 6;
      const target = Math.round((vv.spec.popularity * (weekend ? 1.4 : 0.9) * (day > 0 ? 0.55 : 1)) / 1.6) + g.int(0, 2);
      for (let k = 0; k < target; k++) {
        const court = g.pick(vv.courts);
        const hour = weekend ? g.pick([7, 8, 9, 10, 14, 15, 16, 17, 18, 19]) : g.pick([6, 7, 17, 18, 18, 19, 19, 20, 20, 21]);
        const minutes = g.pick([60, 60, 60, 90, 120]);
        const startMs = localToInstant(date, hour * 60 + (vv.venue.settings.incrementMinutes === 30 && g.chance(0.2) ? 30 : 0));
        const endMs = startMs + minutes * MINUTE;
        if (localParts(endMs).minute > vv.venue.hours.days[dow]!.close && localParts(endMs).date === date) continue;
        if (!isFree(court.id, startMs, endMs + vv.venue.settings.bufferMinutes * MINUTE)) continue;
        if (day >= 0 && startMs < seededAt + 90 * MINUTE && day === 0 && k % 3 !== 0) continue;
        take(court.id, startMs, endMs + vv.venue.settings.bufferMinutes * MINUTE);
        const user = g.chance(0.06) && vv.spec.city !== 'Cebu City' && vv.spec.city !== 'Davao City' ? persona.player! : g.pick(players);
        const method = g.pick(methods);
        const addOns = g.chance(0.18) ? [{ p: vv.products[0]!, qty: g.int(1, 3) }] : [];
        const quote = quoteFor(vv, court, startMs, minutes, method, business, addOns);
        const createdAt = Math.min(startMs - g.int(2, 72) * HOUR, seededAt - g.int(1, 30) * MINUTE);
        const past = endMs < seededAt;
        const cap = capture({ business, venue: vv.venue, userId: user.id, quote, method, at: createdAt + 3 * MINUTE, kind: 'court_booking', settle: createdAt + 3 * MINUTE + HOUR < seededAt });
        const roll = g.rng();
        let status: BookingStatus = past ? 'completed' : 'confirmed';
        const h: StatusChange<BookingStatus>[] = hist([['draft', 'slot_held', createdAt, 'Hold'], ['slot_held', 'payment_pending', createdAt + MINUTE, 'Payment started'], ['payment_pending', 'confirmed', createdAt + 3 * MINUTE, 'Payment verified with provider']]);
        if (past && roll < 0.05) status = 'no_show';
        else if (roll < 0.1) {
          // cancelled by player: refund per policy at cancellation time
          const cancelAt = Math.min(createdAt + g.int(1, 24) * HOUR, startMs - HOUR);
          const dec = evaluateCancellation(POLICY_LIBRARY[vv.venue.policyKey], 'player', cancelAt, startMs);
          status = dec.courtRefundPpm === 0 ? 'cancelled' : dec.courtRefundPpm === 1_000_000 ? 'refunded' : 'partially_refunded';
          h.push({ from: 'confirmed', to: dec.courtRefundPpm ? 'refund_pending' : 'cancelled', at: cancelAt, by: user.id, reason: 'Cancelled by player' });
          if (dec.courtRefundPpm) h.push({ from: 'refund_pending', to: status, at: cancelAt + 5 * MINUTE, by: 'provider', reason: 'Refund completed' });
          const bk = bookingRow({ business, venue: vv.venue, court, userId: user.id, startMs, minutes, status, checkoutId: cap.checkoutId, snapId: cap.snapId, createdAt, history: h, slot: true });
          bk.cancelledAt = cancelAt;
          bk.cancelledBy = user.id;
          bk.cancelReason = 'Cancelled by player';
          if (dec.courtRefundPpm && cancelAt < seededAt) refund({ payId: cap.payId, business, quote, share: dec.courtRefundPpm, feeBack: false, at: cancelAt, reason: 'Cancelled by player', initiator: 'player', bookingId: bk.id });
          continue;
        }
        if (past && status === 'completed') h.push({ from: 'confirmed', to: 'checked_in', at: startMs - 10 * MINUTE, by: 'staff', reason: 'Checked in' }, { from: 'checked_in', to: 'completed', at: endMs, by: 'system', reason: 'Play time ended' });
        if (status === 'no_show') h.push({ from: 'confirmed', to: 'no_show', at: startMs + 20 * MINUTE, by: 'staff', reason: 'Marked as no-show' });
        const bk = bookingRow({ business, venue: vv.venue, court, userId: user.id, startMs, minutes, status, checkoutId: cap.checkoutId, snapId: cap.snapId, createdAt, history: h, slot: true });
        if (addOns.length) {
          const orderId = g.id('ord');
          const o = addOns[0]!;
          t.orders[orderId] = { id: orderId, code: `PU-${bookingCode(g.rng).slice(3)}`, businessId: business.id, venueId: vv.venue.id, userId: user.id, checkoutId: cap.checkoutId, bookingId: bk.id, registrationId: null, items: [{ ref: `addon:${o.p.id}:-`, productId: o.p.id, variantId: null, name: o.p.name, qty: o.qty, unitPrice: o.p.price, total: o.p.price * o.qty }], status: past ? 'claimed' : 'paid', history: [], total: o.p.price * o.qty, createdAt, paidAt: createdAt + 3 * MINUTE, readyAt: past ? startMs - 15 * MINUTE : null, claimedAt: past ? startMs - 5 * MINUTE : null, claimedBy: null };
          t.checkouts[cap.checkoutId]!.orderId = orderId;
          bk.addOnOrderId = orderId;
          t.inventory[`inv_s_${orderId}`] = { id: `inv_s_${orderId}`, businessId: business.id, productId: o.p.id, variantId: null, type: 'sale', onHandDelta: -o.qty, reservedDelta: 0, refId: orderId, at: createdAt + 3 * MINUTE, by: 'system', note: 'Sold (payment captured)' };
        }
        if (status === 'completed' && g.chance(0.22)) {
          const [rating, body] = g.pick(reviewsText);
          const rid = g.id('rev');
          t.reviews[rid] = { id: rid, bookingId: bk.id, userId: user.id, businessId: business.id, venueId: vv.venue.id, rating, body, status: 'published', reply: g.chance(0.4) ? { body: 'Salamat! See you again on the courts.', by: vv.venue.businessId, at: endMs + DAY } : null, createdAt: endMs + g.int(2, 30) * HOUR };
        }
      }
    }
  }
  for (const vv of venues) {
    const rs = Object.values(t.reviews).filter((r) => r.venueId === vv.venue.id && r.status === 'published');
    vv.venue.ratingCount = rs.length;
    vv.venue.ratingAvg = rs.length ? Math.round((rs.reduce((a, r) => a + r.rating, 0) / rs.length) * 10) / 10 : 0;
  }

  // Demo-specific bookings at Dink District BGC (today) and for Juan (upcoming)
  const now = seededAt;
  const demoBooking = (userId: Id, court: Court, startMs: number, minutes: number, status: BookingStatus, vv = bgc, addWater = false) => {
    const business = t.businesses[vv.venue.businessId]!;
    const endMs = startMs + minutes * MINUTE;
    const addOns = addWater ? [{ p: vv.products[0]!, qty: 2 }] : [];
    const quote = quoteFor(vv, court, startMs, minutes, 'gcash', business, addOns);
    const createdAt = Math.min(now - 2 * DAY, startMs - 26 * HOUR);
    const cap = capture({ business, venue: vv.venue, userId, quote, method: 'gcash', at: createdAt + 3 * MINUTE, kind: 'court_booking', settle: true });
    const h = hist<BookingStatus>([['draft', 'slot_held', createdAt, 'Hold'], ['slot_held', 'payment_pending', createdAt + MINUTE, 'Payment started'], ['payment_pending', 'confirmed', createdAt + 3 * MINUTE, 'Payment verified with provider']]);
    const bk = bookingRow({ business, venue: vv.venue, court, userId, startMs, minutes, status, checkoutId: cap.checkoutId, snapId: cap.snapId, createdAt, history: h, slot: true });
    void endMs;
    if (addWater) {
      const orderId = g.id('ord');
      const p = vv.products[0]!;
      t.orders[orderId] = { id: orderId, code: `PU-${bookingCode(g.rng).slice(3)}`, businessId: business.id, venueId: vv.venue.id, userId, checkoutId: cap.checkoutId, bookingId: bk.id, registrationId: null, items: [{ ref: `addon:${p.id}:-`, productId: p.id, variantId: null, name: p.name, qty: 2, unitPrice: p.price, total: p.price * 2 }], status: 'paid', history: [], total: p.price * 2, createdAt, paidAt: createdAt + 3 * MINUTE, readyAt: null, claimedAt: null, claimedBy: null };
      t.checkouts[cap.checkoutId]!.orderId = orderId;
      bk.addOnOrderId = orderId;
      t.inventory[`inv_s_${orderId}`] = { id: `inv_s_${orderId}`, businessId: business.id, productId: p.id, variantId: null, type: 'sale', onHandDelta: -2, reservedDelta: 0, refId: orderId, at: createdAt + 3 * MINUTE, by: 'system', note: 'Sold (payment captured)' };
    }
    return bk;
  };
  const courtsBgc = bgc.courts;
  demoBooking(players[0]!.id, courtsBgc[1]!, scripted.soon, 60, 'confirmed', bgc, true); // check-in window open
  demoBooking(players[1]!.id, courtsBgc[2]!, scripted.started, 60, 'confirmed'); // started 20+ min ago → no-show demo
  const juanTomorrow = demoBooking(persona.player!.id, courtsBgc[0]!, scripted.juanTomorrow, 90, 'confirmed', bgc, true);
  juanTomorrow.participants = [{ userId: persona.player2!.id, name: 'Bea Santiago', status: 'accepted' }, { userId: null, name: 'Marco', status: 'accepted' }, { userId: null, name: 'Isabel', status: 'accepted' }];
  const mk = venues.find((v) => v.spec.key === 'makati')!;
  demoBooking(persona.player!.id, mk.courts[1]!, scripted.juanMakati, 60, 'confirmed', mk);

  // Pending goodwill refund needing owner approval (requested by the manager)
  const completedDink = Object.values(t.bookings).filter((b) => b.businessId === dink.id && b.status === 'completed').sort((a, b) => b.startMs - a.startMs)[0];
  if (completedDink) {
    const pay = t.payments[t.checkouts[completedDink.checkoutId]!.paymentIds[0]!]!;
    const q = t.snapshots[pay.snapshotId]!.quote;
    const breakdown = computeRefund(q, { items: [{ ref: 'court', sharePpm: 500_000 }], refundGatewayFee: false });
    const id = g.id('rfn');
    t.refunds[id] = { id, paymentId: pay.id, businessId: dink.id, userId: pay.userId, checkoutId: pay.checkoutId, bookingId: completedDink.id, orderId: null, registrationId: null, amount: breakdown.toCustomer, breakdown, reason: 'Goodwill: lights went out mid-session', initiator: 'goodwill', requestedBy: persona.manager!.id, status: 'pending_approval', history: hist([['requested', 'pending_approval', now - 3 * HOUR, 'Awaiting approval']]), providerRefundId: null, approvals: [], needsBusinessApproval: true, needsPlatformApproval: false, afterPayout: false, createdAt: now - 3 * HOUR, completedAt: null, failureReason: null, partial: true };
    completedDink.status = 'refund_pending';
    completedDink.history.push({ from: 'completed', to: 'refund_pending', at: now - 3 * HOUR, by: persona.manager!.id, reason: 'Goodwill refund requested' });
  }

  // Payouts every 3 days per business; the latest Ortigas payout failed.
  for (const b of businesses.values()) {
    if (b.status !== 'active' || !b.payoutAccount.providerSubAccountId) continue;
    const sub = b.payoutAccount.providerSubAccountId;
    for (let day = -42; day <= -1; day += 3) {
      const at = g.at(day, 6);
      const pays = Object.values(t.payments).filter((p) => p.businessId === b.id && p.payoutId === null && p.settledAt !== null && p.settledAt < at);
      if (!pays.length) continue;
      const amount = pays.reduce((a, p) => {
        const q = t.snapshots[p.snapshotId]!.quote;
        const rf = Object.values(t.refunds).filter((r) => r.paymentId === p.id && r.status === 'succeeded' && r.completedAt! < at).reduce((x, r) => x + r.breakdown.venueReversal, 0);
        return a + q.venueNet - rf;
      }, 0);
      if (amount <= 0) continue;
      const id = g.id('pyo');
      const failed = b.tradeName === 'Ortigas Paddle House' && day >= -3;
      t.payouts[id] = { id, businessId: b.id, amount, status: failed ? 'failed' : 'paid', history: failed ? hist([['scheduled', 'processing', at, 'Submitted'], ['processing', 'failed', at + 2 * HOUR, 'INVALID_DESTINATION_ACCOUNT']]) : hist([['scheduled', 'processing', at, 'Submitted'], ['processing', 'paid', at + HOUR, 'Paid to bank']]), periodEnd: at, paymentIds: failed ? [] : pays.map((p) => p.id), destinationMasked: b.payoutAccount.accountMasked ?? '', providerPayoutId: `po-${g.id('p').slice(2, 20)}`, createdAt: at, paidAt: failed ? null : at + HOUR, failureReason: failed ? 'INVALID_DESTINATION_ACCOUNT' : null, attempts: 1 };
      g.journal(payoutJournal(amount, b.id, { payoutId: id }, at, `Payout to ${b.payoutAccount.accountMasked}`));
      if (failed) g.journal(payoutFailedJournal(amount, b.id, { payoutId: id }, at + 2 * HOUR, 'Payout failed (INVALID_DESTINATION_ACCOUNT)'));
      else {
        for (const p of pays) p.payoutId = id;
        t.providerSubAccounts[sub]!.balance -= amount;
        t.providerPayouts[t.payouts[id]!.providerPayoutId!] = { id: t.payouts[id]!.providerPayoutId!, externalId: id, forUserId: sub, amount, status: 'SUCCEEDED', createdAt: at, completeAt: at + HOUR, failureCode: null };
      }
    }
  }

  // ---------------------------------------------------------------- events
  const mkEvent = (vv: (typeof venues)[number], e: Partial<CourtEvent> & Pick<CourtEvent, 'type' | 'name' | 'description' | 'startMs' | 'endMs' | 'fee' | 'divisions'>, courtIdx: number[], fill: number[], waitlist = 0) => {
    const business = t.businesses[vv.venue.businessId]!;
    const ev: CourtEvent = { id: g.id('evt'), businessId: business.id, venueId: vv.venue.id, courtIds: courtIdx.map((i) => vv.courts[i]!.id), organizer: vv.venue.name, registrationOpensAt: now - 14 * DAY, registrationClosesAt: e.startMs - 2 * HOUR, waitlistEnabled: true, policyKey: 'standard', rules: 'Rally scoring to 11, win by 2. Bring your own paddle or rent one at the desk.', prizes: '', format: '', visibility: 'public', status: 'published', checkInRequired: true, teamBased: false, ageNote: 'Open to players 18 and above. Minors need a parent or guardian’s consent.', slotIds: [], createdAt: now - 15 * DAY, createdBy: business.ownerUserId, ...e };
    for (const cid of ev.courtIds) {
      const sid = g.id('slt');
      t.slots[sid] = { id: sid, businessId: business.id, venueId: vv.venue.id, courtId: cid, startMs: ev.startMs, endMs: ev.endMs, occupiedEndMs: ev.endMs, kind: 'event', sourceId: ev.id, status: 'active', expiresAt: null, createdAt: ev.createdAt, releasedAt: null };
      ev.slotIds.push(sid);
    }
    t.events[ev.id] = ev;
    ev.divisions.forEach((d, di) => {
      const pool = [...players].sort(() => g.rng() - 0.5);
      for (let i = 0; i < (fill[di] ?? 0); i++) {
        const u = pool[i % pool.length]!;
        const regId = g.id('reg');
        const at = now - g.int(1, 12) * DAY;
        const quote = buildQuote({ eventItems: [{ ref: 'event', label: `${ev.name} · ${d.name}`, amount: d.fee ?? ev.fee, taxable: true }], tax: tax(business), fee: feeFor('gcash'), commission: commission(business, at) });
        const cap = capture({ business, venue: vv.venue, userId: u.id, quote, method: 'gcash', at, kind: 'event_registration', registrationId: regId, settle: true });
        t.registrations[regId] = { id: regId, eventId: ev.id, businessId: business.id, divisionId: d.id, userId: u.id, partnerName: ev.teamBased ? g.pick(FIRST) : null, teamName: null, status: 'confirmed', history: [], checkoutId: cap.checkoutId, waitlistPosition: null, offerExpiresAt: null, holdExpiresAt: null, createdAt: at, confirmedAt: at, checkedInAt: null };
      }
      if (di === 0) for (let w = 0; w < waitlist; w++) {
        const u = pool[(fill[di] ?? 0) + w]!;
        const regId = g.id('reg');
        t.registrations[regId] = { id: regId, eventId: ev.id, businessId: business.id, divisionId: d.id, userId: u.id, partnerName: null, teamName: null, status: 'waitlisted', history: [], checkoutId: null, waitlistPosition: w + 1, offerExpiresAt: null, holdExpiresAt: null, createdAt: now - DAY, confirmedAt: null, checkedInAt: null };
      }
    });
    return ev;
  };
  const fri = scripted.fri;
  mkEvent(bgc, { type: 'open_play', name: 'Friday Night Open Play', description: 'Rotate in, meet new players and play as many games as you like. Skill-balanced courts; perfect after work.', startMs: g.at(fri, 19), endMs: g.at(fri, 22), fee: pesos(250), divisions: [{ id: g.id('div'), name: 'All levels', skill: '2.5 – 4.0', capacity: 24, format: 'open', fee: null }] }, [4, 5], [21]);
  const sat = scripted.sat;
  mkEvent(bgc, { type: 'clinic', name: 'Beginner Clinic with Coach Ana', description: 'Two hours of fundamentals: grip, serve, return, the kitchen and the third-shot drop. Paddles provided.', startMs: g.at(sat, 9), endMs: g.at(sat, 11), fee: pesos(800), organizer: 'Coach Ana R.', divisions: [{ id: g.id('div'), name: 'Beginners', skill: 'New to 2.5', capacity: 12, format: 'open', fee: null }] }, [3], [12], 2);
  mkEvent(mk, { type: 'tournament', name: 'Makati Doubles Cup', description: 'One-day doubles tournament with pool play and single-elimination playoffs. Medals for the top 3 teams per division.', startMs: g.at(12, 8), endMs: g.at(12, 18), fee: pesos(1_500), teamBased: true, prizes: 'Medals and pro-shop vouchers for the top 3 teams', format: 'Pool play → single elimination, games to 11', divisions: [{ id: g.id('div'), name: 'Men’s / Mixed 3.0', skill: '3.0', capacity: 16, format: 'doubles', fee: null }, { id: g.id('div'), name: 'Open 3.5+', skill: '3.5+', capacity: 16, format: 'doubles', fee: pesos(1_800) }] }, [0, 1, 2, 3], [11, 6]);
  const cebu = venues.find((v) => v.spec.key === 'cebu')!;
  mkEvent(cebu, { type: 'social', name: 'Cebu After-Work Social Mixer', description: 'Casual games, music and snacks. Come solo — we will pair you up.', startMs: g.at(5, 18), endMs: g.at(5, 21), fee: pesos(300), divisions: [{ id: g.id('div'), name: 'Everyone', skill: 'All levels', capacity: 20, format: 'open', fee: null }] }, [2, 3], [8]);
  const clark = venues.find((v) => v.spec.key === 'clark')!;
  const pastLeague = mkEvent(clark, { type: 'league', name: 'Clark Weekend League — Week 3', description: 'Round-robin league night. Results count toward the season standings.', startMs: g.at(-6, 8), endMs: g.at(-6, 12), fee: pesos(400), status: 'completed', divisions: [{ id: g.id('div'), name: 'Intermediate', skill: '3.0 – 3.5', capacity: 16, format: 'doubles', fee: null }] }, [0, 1], [10]);
  // Juan's officially recorded matches (from a past league night)
  const juanReg = g.id('reg');
  t.registrations[juanReg] = { id: juanReg, eventId: pastLeague.id, businessId: pastLeague.businessId, divisionId: pastLeague.divisions[0]!.id, userId: persona.player!.id, partnerName: 'Marco', teamName: null, status: 'checked_in', history: [], checkoutId: null, waitlistPosition: null, offerExpiresAt: null, holdExpiresAt: null, createdAt: g.at(-12, 9), confirmedAt: g.at(-12, 9), checkedInAt: g.at(-6, 7, 45) };
  [[11, 7], [9, 11], [11, 8], [11, 5]].forEach(([a, b], i) => {
    const id = g.id('mtc');
    t.matches[id] = { id, eventId: pastLeague.id, businessId: pastLeague.businessId, divisionId: pastLeague.divisions[0]!.id, round: `Round ${i + 1}`, sideA: [persona.player!.id], sideB: [players[i + 3]!.id], scoreA: a!, scoreB: b!, recordedBy: pastLeague.createdBy, recordedAt: g.at(-6, 8 + i) };
  });

  // Ratings (sources are always labeled)
  const r1 = g.id('rtg');
  t.ratings[r1] = { id: r1, userId: persona.player!.id, source: 'self_declared', value: null, label: 'Intermediate', verifiedByBusinessId: null, updatedAt: g.at(-200, 9), history: [] };
  const r2 = g.id('rtg');
  t.ratings[r2] = { id: r2, userId: persona.player!.id, source: 'venue_verified', value: 3.5, label: '3.5 (verified by Dink District coaches)', verifiedByBusinessId: dink.id, updatedAt: g.at(-40, 9), history: [] };
  const r3 = g.id('rtg');
  t.ratings[r3] = { id: r3, userId: persona.player!.id, source: 'platform_recreational', value: 3.42, label: 'CourtKo recreational rating (beta)', verifiedByBusinessId: null, updatedAt: g.at(-6, 13), history: [{ at: g.at(-90, 9), value: 3.05 }, { at: g.at(-60, 9), value: 3.18 }, { at: g.at(-30, 9), value: 3.3 }, { at: g.at(-6, 13), value: 3.42 }] };

  // Promotions: one platform-funded, one venue-funded (funding source drives commission & ledger)
  t.promotions.prm_welcome10 = { id: 'prm_welcome10', code: 'WELCOME10', name: '10% off your first court booking', businessId: null, venueIds: null, type: 'percent', value: 100_000, maxDiscount: pesos(100), fundedBy: 'platform', appliesTo: 'court', validFrom: g.at(-60, 0), validTo: g.at(90, 0), usageLimit: 500, perUserLimit: 1, usedCount: 37, status: 'active', createdBy: persona.superadmin!.id, createdAt: g.at(-60, 9) };
  t.promotions.prm_dink50 = { id: 'prm_dink50', code: 'DINK50', name: '₱50 off at Dink District', businessId: dink.id, venueIds: null, type: 'fixed', value: pesos(50), minSpend: pesos(400), fundedBy: 'venue', appliesTo: 'court', validFrom: g.at(-30, 0), validTo: g.at(60, 0), usageLimit: 200, perUserLimit: 3, usedCount: 12, status: 'active', createdBy: persona.owner!.id, createdAt: g.at(-30, 9) };

  // Trust & safety samples
  const restricted = players[5]!;
  const rid = g.id('rst');
  t.restrictions[rid] = { id: rid, userId: restricted.id, businessId: dink.id, venueId: null, scope: 'business', reasonCategory: 'repeated_no_shows', internalNotes: 'Three no-shows in four weeks during peak evening slots (Aug 14, Aug 21, Sep 4). Warned by front desk on Aug 21.', startAt: g.at(-5, 10), endAt: g.at(25, 10), createdBy: persona.manager!.id, approvedBy: persona.manager!.id, evidenceRef: 'Front desk log FD-2026-0904', status: 'active', appeal: { status: 'none' }, createdAt: g.at(-5, 10), liftedAt: null, liftedBy: null, liftReason: null };
  g.audit(g.at(-5, 10), persona.manager!.id, 'Ramon C.', 'restriction.created', 'user', restricted.id, dink.id, `Restricted ${t.profiles[restricted.id]!.displayName} at Dink District (Repeated no-shows, 30 days)`);
  const flagged = Object.values(t.reviews).find((r) => r.rating <= 3);
  if (flagged) {
    flagged.status = 'flagged';
    const cr = g.id('rpt');
    t.contentReports[cr] = { id: cr, reporterId: players[9]!.id, targetType: 'review', targetId: flagged.id, businessId: flagged.businessId, reason: 'Contains inaccurate information', details: 'The review mentions the wrong venue.', status: 'open', handledBy: null, handledAt: null, action: null, createdAt: now - 20 * HOUR };
  }

  // Notifications for personas
  const note = (userId: Id, category: 'booking_updates' | 'events' | 'payouts' | 'business_ops' | 'account_security', title: string, body: string, link: string, at: number) => {
    const id = g.id('ntf');
    t.notifications[id] = { id, userId, category, title, body, link, createdAt: at, readAt: null, channels: { email: 'sent', sms: 'n/a', push: 'suppressed' }, dedupeKey: null };
  };
  note(persona.player!.id, 'booking_updates', `Booking confirmed · ${juanTomorrow.code}`, 'Dink District BGC · Court 1 · tomorrow 7:00 PM. Show your QR code at the front desk.', `#/app/bookings/${juanTomorrow.id}`, juanTomorrow.createdAt + 3 * MINUTE);
  note(persona.player!.id, 'events', 'New event near you', 'Friday Night Open Play at Dink District BGC — 3 spots left.', '#/events', now - 5 * HOUR);
  note(persona.owner!.id, 'business_ops', 'Refund awaiting your approval', 'Ramon requested a goodwill refund. Approve or reject it in Payments.', '#/biz/payments', now - 3 * HOUR);
  note(persona.owner!.id, 'payouts', 'Payout sent', 'Your latest payout was sent to your bank account.', '#/biz/payouts', now - DAY);
  note(persona.applicant!.id, 'account_security', 'Verification submitted', 'CourtKo usually reviews documents within 1–2 business days.', '#/biz', g.at(-2, 10));

  // ids for members inserted with placeholder keys
  for (const [k, v] of Object.entries(t.members)) v.id = k;
  void localDate;
  return { tables: t, counters: { auditSeq: g.auditSeq, auditHead: g.auditHead, journalSeq: g.journalSeq } };
}
