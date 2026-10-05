/**
 * In-browser API layer mirroring the production REST surface (design doc 13). Every call:
 *  - resolves the session → actor (support mode aware),
 *  - enforces authorization inside the service (never in the UI),
 *  - runs writes in a transaction with rollback, rate limiting, and Idempotency-Key replay/conflict handling,
 *  - records an API log entry (method, path, status, latency, correlation id) for the presenter's inspector.
 */

import { AppError, fail, toProblem, type ProblemDetails } from '../domain/errors.ts';
import { canonicalJson, sha256Hex } from '../domain/crypto.ts';
import { correlationId } from '../domain/ids.ts';
import * as admin from './admin.ts';
import * as auth from './auth.ts';
import * as booking from './booking.ts';
import * as businesses from './businesses.ts';
import * as catalog from './catalog.ts';
import * as disputes from './disputes.ts';
import * as events from './events.ts';
import * as openplay from './openplay.ts';
import * as exceptions from './exceptions.ts';
import * as social from './social.ts';
import * as sportsAdmin from './sportsAdmin.ts';
import * as payments from './payments.ts';
import * as payouts from './payouts.ts';
import * as pricing from './pricingSvc.ts';
import * as products from './products.ts';
import * as profile from './profile.ts';
import * as refunds from './refunds.ts';
import * as reports from './reports.ts';
import * as restrictions from './restrictions.ts';
import * as reviews from './reviews.ts';
import * as staff from './staff.ts';
import * as venues from './venues.ts';
import type { Store } from './store.ts';
import { displayName, makeSvc, requireBusiness, requirePlatform, resolveActor, securityEvent, type RequestInfo, type Svc } from './svc.ts';

type Handler = (s: Svc, input: never) => unknown;

/* eslint-disable @typescript-eslint/no-explicit-any */
const READ = {
  'GET /v1/me': (s: Svc) => profile.getMe(s),
  'GET /v1/public/venues': (s: Svc, i: catalog.VenueSearchInput) => catalog.searchVenues(s, i),
  'GET /v1/public/venues/{slug}': (s: Svc, i: { slug: string }) => catalog.venueDetail(s, i),
  'GET /v1/public/venues/{venueId}/availability': (s: Svc, i: { venueId: string; date: string; durationMinutes?: number; sport?: string }) => booking.venueAvailability(s, i),
  'GET /v1/public/sports': (s: Svc) => sportsAdmin.publicSports(s),
  'GET /v1/public/open-play': (s: Svc, i: openplay.OpenPlaySearch) => openplay.listOpenPlay(s, i),
  'GET /v1/public/open-play/{sessionId}': (s: Svc, i: { sessionId: string }) => openplay.getOpenPlay(s, i),
  'GET /v1/players': (s: Svc, i: { q: string }) => social.searchPlayers(s, i),
  'GET /v1/players/{username}': (s: Svc, i: { username: string }) => social.publicProfile(s, i),
  'GET /v1/players/{username}/{kind}': (s: Svc, i: { username: string; kind: 'followers' | 'following' }) => social.followList(s, i),
  'GET /v1/me/open-play/registrations': (s: Svc) => openplay.myOpenPlay(s),
  'GET /v1/me/open-play/registrations/{registrationId}': (s: Svc, i: { registrationId: string }) => openplay.myOpenPlayRegistration(s, i),
  'GET /v1/me/open-play/registrations/{registrationId}/checkin-token': (s: Svc, i: { registrationId: string }) => openplay.openPlayCheckinToken(s, i),
  'GET /v1/me/open-play/registrations/{registrationId}/cancellation-quote': (s: Svc, i: { registrationId: string }) => openplay.openPlayCancellationQuote(s, i),
  'GET /v1/me/invites': (s: Svc) => openplay.myInvites(s),
  'GET /v1/me/sports': (s: Svc) => social.mySportsDashboard(s),
  'GET /v1/me/follow-requests': (s: Svc) => social.followRequests(s),
  'GET /v1/me/blocks': (s: Svc) => social.myBlocks(s),
  'GET /v1/me/player-suggestions': (s: Svc) => social.discoverPlayers(s),
  'GET /v1/public/venues/{venueId}/products': (s: Svc, i: { venueId: string; purpose?: 'booking' | 'event' | 'standalone' }) => products.venueShop(s, i),
  'GET /v1/public/locations': (s: Svc, i: { q: string }) => catalog.searchLocations(s, i),
  'GET /v1/public/events': (s: Svc, i: { type?: any; q?: string }) => events.listPublicEvents(s, i),
  'GET /v1/public/events/{eventId}': (s: Svc, i: { eventId: string }) => events.getEvent(s, i),
  'GET /v1/me/checkouts/{checkoutId}': (s: Svc, i: { checkoutId: string }) => booking.getMyCheckout(s, i),
  'GET /v1/me/bookings': (s: Svc, i: { tab?: 'upcoming' | 'past' | 'cancelled' }) => booking.myBookings(s, i),
  'GET /v1/me/bookings/{bookingId}': (s: Svc, i: { bookingId: string }) => booking.myBooking(s, i),
  'GET /v1/me/bookings/{bookingId}/cancellation-quote': (s: Svc, i: { bookingId: string }) => booking.cancellationQuote(s, i),
  'GET /v1/me/events/registrations': (s: Svc) => events.myRegistrations(s),
  'GET /v1/me/orders': (s: Svc) => products.myOrders(s),
  'GET /v1/me/orders/{orderId}': (s: Svc, i: { orderId: string }) => products.myOrder(s, i),
  'GET /v1/me/payments': (s: Svc) => payments.myPayments(s),
  'GET /v1/me/refunds': (s: Svc) => refunds.myRefunds(s),
  'GET /v1/me/favorites': (s: Svc) => profile.myFavorites(s),
  'GET /v1/me/notifications': (s: Svc) => profile.myNotifications(s),
  'GET /v1/me/messages': (s: Svc) => profile.myMessages(s),
  'GET /v1/me/activity': (s: Svc) => profile.myActivity(s),
  'GET /v1/me/sessions': (s: Svc) => auth.listMySessions(s),
  'GET /v1/me/login-history': (s: Svc) => auth.loginHistory(s),
  'GET /v1/me/restrictions': (s: Svc) => restrictions.myRestrictions(s),
  'GET /v1/staff/me/memberships': (s: Svc) => staff.myMemberships(s),
  'GET /demo/authenticator-code': (s: Svc, i: { identifier: string }) => auth.demoAuthenticatorCode(s, i),
  'GET /demo/open-play/{sessionId}/sample-pass': (s: Svc, i: Parameters<typeof openplay.demoSamplePass>[1]) => openplay.demoSamplePass(s, i),
  // business & staff
  'GET /v1/businesses/{businessId}': (s: Svc, i: { businessId: string }) => businesses.myBusinessOverview(s, i),
  'GET /v1/businesses/{businessId}/venues': (s: Svc, i: { businessId: string }) => venues.listBusinessVenues(s, i),
  'GET /v1/businesses/{businessId}/calendar': (s: Svc, i: { businessId: string; venueId: string; date: string }) => booking.calendar(s, i),
  'GET /v1/businesses/{businessId}/bookings': (s: Svc, i: Parameters<typeof booking.businessBookings>[1]) => booking.businessBookings(s, i),
  'GET /v1/businesses/{businessId}/bookings/{bookingId}': (s: Svc, i: { businessId: string; bookingId: string }) => booking.businessBooking(s, i),
  'GET /v1/businesses/{businessId}/customers': (s: Svc, i: { businessId: string; q?: string }) => booking.businessCustomers(s, i),
  'GET /v1/businesses/{businessId}/customers/search': (s: Svc, i: { businessId: string; q: string }) => booking.customerSearch(s, i),
  'GET /v1/businesses/{businessId}/court-blocks': (s: Svc, i: { businessId: string; venueId?: string }) => venues.listCourtBlocks(s, i),
  'GET /v1/businesses/{businessId}/pricing-rules': (s: Svc, i: { businessId: string; venueId: string; includeArchived?: boolean }) => pricing.listPricingRules(s, i),
  'GET /v1/businesses/{businessId}/pricing-rules/preview': (s: Svc, i: Parameters<typeof pricing.simulatePrice>[1]) => pricing.simulatePrice(s, i),
  'GET /v1/businesses/{businessId}/promotions': (s: Svc, i: { businessId: string }) => pricing.listPromotions(s, i),
  'GET /v1/businesses/{businessId}/events': (s: Svc, i: { businessId: string }) => events.businessEvents(s, i),
  'GET /v1/businesses/{businessId}/open-play': (s: Svc, i: { businessId: string; venueId?: string }) => openplay.businessOpenPlay(s, i),
  'GET /v1/businesses/{businessId}/open-play/{sessionId}/court-check': (s: Svc, i: { businessId: string; sessionId: string; courtIds?: string[] }) => openplay.openPlayCourtCheck(s, i),
  'GET /v1/businesses/{businessId}/open-play/{sessionId}/desk': (s: Svc, i: { businessId: string; sessionId: string }) => openplay.openPlayDesk(s, i),
  'GET /v1/businesses/{businessId}/open-play/{sessionId}/search': (s: Svc, i: { businessId: string; sessionId: string; q: string }) => openplay.openPlaySearch(s, i),
  'GET /v1/businesses/{businessId}/open-play/{sessionId}/rotation-suggestion': (s: Svc, i: { businessId: string; sessionId: string; courtId: string }) => openplay.rotationSuggestion(s, i),
  'GET /v1/businesses/{businessId}/open-play/{sessionId}/attendance-events': (s: Svc, i: { businessId: string; sessionId: string }) => openplay.attendanceLog(s, i),
  'GET /v1/businesses/{businessId}/events/{eventId}/registrations': (s: Svc, i: { businessId: string; eventId: string }) => events.eventRegistrations(s, i),
  'GET /v1/businesses/{businessId}/products': (s: Svc, i: { businessId: string; venueId?: string }) => products.businessProducts(s, i),
  'GET /v1/businesses/{businessId}/orders': (s: Svc, i: { businessId: string; status?: string }) => products.businessOrders(s, i),
  'GET /v1/businesses/{businessId}/restrictions': (s: Svc, i: { businessId: string }) => restrictions.listRestrictions(s, i),
  'GET /v1/businesses/{businessId}/members': (s: Svc, i: { businessId: string }) => staff.listMembers(s, i),
  'GET /v1/businesses/{businessId}/roles': (s: Svc, i: { businessId: string }) => staff.listRoles(s, i),
  'GET /v1/businesses/{businessId}/payments': (s: Svc, i: Parameters<typeof payments.businessPayments>[1]) => payments.businessPayments(s, i),
  'GET /v1/businesses/{businessId}/payments/{paymentId}': (s: Svc, i: { businessId: string; paymentId: string }) => payments.paymentDetail(s, i),
  'GET /v1/businesses/{businessId}/refunds': (s: Svc, i: { businessId: string }) => bizRefunds(s, i.businessId),
  'GET /v1/businesses/{businessId}/payouts': (s: Svc, i: { businessId: string }) => payouts.businessPayouts(s, i),
  'GET /v1/businesses/{businessId}/settlements': (s: Svc, i: { businessId: string; from: number; to: number }) => payouts.settlementStatement(s, i),
  'GET /v1/businesses/{businessId}/reports/summary': (s: Svc, i: Parameters<typeof reports.businessReport>[1]) => reports.businessReport(s, i),
  'GET /v1/businesses/{businessId}/reviews': (s: Svc, i: { businessId: string }) => reviews.businessReviews(s, i),
  'GET /v1/businesses/{businessId}/audit-logs': (s: Svc, i: { businessId: string; q?: string; limit?: number; cursor?: string }) => admin.auditLog(s, i),
  // admin
  'GET /v1/admin/overview': (s: Svc) => admin.platformOverview(s),
  'GET /v1/admin/businesses': (s: Svc, i: Parameters<typeof businesses.adminBusinesses>[1]) => businesses.adminBusinesses(s, i),
  'GET /v1/admin/businesses/{businessId}': (s: Svc, i: { businessId: string }) => businesses.adminBusinessDetail(s, i),
  'GET /v1/admin/users': (s: Svc, i: { q?: string; limit?: number; cursor?: string }) => admin.adminUsers(s, i),
  'GET /v1/admin/bookings': (s: Svc, i: Parameters<typeof admin.adminBookings>[1]) => admin.adminBookings(s, i),
  'GET /v1/admin/payments': (s: Svc, i: { status?: string; limit?: number; cursor?: string }) => admin.adminPayments(s, i),
  'GET /v1/admin/payments/{paymentId}': (s: Svc, i: { paymentId: string }) => payments.paymentDetail(s, i),
  'GET /v1/admin/ledger/journals': (s: Svc, i: Parameters<typeof admin.adminJournals>[1]) => admin.adminJournals(s, i),
  'GET /v1/admin/ledger/totals': (s: Svc) => admin.ledgerTotals(s),
  'GET /v1/admin/reconciliation': (s: Svc) => payments.reconciliationReport(s),
  'GET /v1/admin/payment-exceptions': (s: Svc) => exceptions.paymentExceptions(s, {}),
  'GET /v1/businesses/{businessId}/payment-exceptions': (s: Svc, i: { businessId: string }) => exceptions.paymentExceptions(s, i),
  'GET /v1/public/payment-status': (s: Svc) => exceptions.publicPaymentStatus(s),
  'GET /v1/admin/refunds': (s: Svc) => admin.adminRefunds(s),
  'GET /v1/admin/payouts': (s: Svc, i: { status?: string; limit?: number; cursor?: string }) => payouts.allPayouts(s, i),
  'GET /v1/admin/disputes': (s: Svc) => disputes.listDisputes(s),
  'GET /v1/admin/commission-agreements': (s: Svc) => admin.commissionAgreements(s),
  'GET /v1/admin/reports/summary': (s: Svc, i: { from: number; to: number }) => reports.platformReport(s, i),
  'GET /v1/admin/moderation/reports': (s: Svc) => reviews.moderationQueue(s),
  'GET /v1/admin/support-sessions': (s: Svc) => admin.supportSessions(s),
  'GET /v1/admin/security-events': (s: Svc, i: { type?: string }) => admin.securityEvents(s, i),
  'GET /v1/admin/audit-logs': (s: Svc, i: { q?: string; limit?: number; cursor?: string }) => admin.auditLog(s, i),
  'GET /v1/admin/config': (s: Svc) => admin.platformConfig(s),
  'GET /v1/admin/audit-logs/verify': (s: Svc) => admin.verifyAudit(s),
  'GET /v1/admin/products': (s: Svc) => adminProducts(s),
  'GET /v1/admin/promotions': (s: Svc) => pricing.listPromotions(s, {}),
  'GET /v1/admin/privacy-requests': (s: Svc) => profile.privacyRequests(s),
  'GET /v1/admin/sports': (s: Svc) => sportsAdmin.adminSports(s),
  'GET /v1/admin/open-play': (s: Svc) => openplay.adminOpenPlay(s),
} satisfies Record<string, Handler | ((s: Svc) => unknown)>;

const WRITE = {
  'POST /v1/auth/register': (s: Svc, i: Parameters<typeof auth.register>[1]) => auth.register(s, i),
  'POST /v1/auth/verify-contact': (s: Svc, i: { verificationId: string; code: string }) => auth.verifyContact(s, i),
  'POST /v1/auth/verify-contact/resend': (s: Svc, i: { identifier: string }) => auth.resendVerification(s, i),
  'POST /v1/auth/login': (s: Svc, i: { identifier: string; password: string }) => auth.login(s, i),
  'POST /v1/auth/mfa/verify': (s: Svc, i: { challengeToken: string; code: string }) => auth.verifyMfa(s, i),
  'POST /v1/auth/logout': (s: Svc) => auth.logout(s),
  'POST /v1/auth/password-reset/request': (s: Svc, i: { identifier: string }) => auth.requestPasswordReset(s, i),
  'POST /v1/auth/password-reset/confirm': (s: Svc, i: { verificationId: string; code: string; newPassword: string }) => auth.resetPassword(s, i),
  'POST /demo/sign-in': (s: Svc, i: { persona: string }) => auth.demoSignIn(s, i),
  'POST /demo/open-play/live': (s: Svc) => openplay.demoStartLiveOpenPlay(s),
  'POST /demo/open-play/arrivals': (s: Svc, i: { sessionId?: string }) => openplay.demoSimulateArrivals(s, i ?? {}),
  'PATCH /v1/me/profile': (s: Svc, i: Parameters<typeof profile.updateProfile>[1]) => profile.updateProfile(s, i),
  'PUT /v1/me/preferences/notifications': (s: Svc, i: Parameters<typeof profile.updateNotificationPrefs>[1]) => profile.updateNotificationPrefs(s, i),
  'PUT /v1/me/preferences/location': (s: Svc, i: { consent: 'granted' | 'denied' }) => profile.setLocationConsent(s, i),
  'PUT /v1/me/preferences/cookies': (s: Svc, i: { analytics: boolean }) => profile.setCookieConsent(s, i),
  'POST /v1/me/password': (s: Svc, i: { currentPassword: string; newPassword: string }) => auth.changePassword(s, i),
  'POST /v1/me/mfa/totp': (s: Svc) => auth.startTotpEnrollment(s),
  'POST /v1/me/mfa/totp/confirm': (s: Svc, i: { code: string }) => auth.confirmTotpEnrollment(s, i),
  'DELETE /v1/me/mfa/totp': (s: Svc, i: { code: string }) => auth.disableMfa(s, i),
  'DELETE /v1/me/sessions/{sessionId}': (s: Svc, i: { sessionId: string }) => auth.revokeSession(s, i),
  'POST /v1/me/sessions/revoke-all': (s: Svc, i: { keepCurrent: boolean }) => auth.revokeAllSessions(s, i),
  'POST /v1/me/favorites/{venueId}/toggle': (s: Svc, i: { venueId: string }) => profile.toggleFavorite(s, i),
  'POST /v1/me/notifications/read': (s: Svc, i: { notificationId?: string }) => profile.markNotificationsRead(s, i),
  'POST /v1/me/booking-holds': (s: Svc, i: booking.CreateHoldInput) => booking.createHold(s, i),
  'PATCH /v1/me/checkouts/{checkoutId}': (s: Svc, i: Parameters<typeof booking.updateCheckout>[1]) => booking.updateCheckout(s, i),
  'POST /v1/me/checkouts/{checkoutId}/extend': (s: Svc, i: { checkoutId: string }) => booking.extendHold(s, i),
  'DELETE /v1/me/checkouts/{checkoutId}': (s: Svc, i: { checkoutId: string }) => booking.releaseHold(s, i),
  'POST /v1/me/checkouts/{checkoutId}/payment-sessions': (s: Svc, i: Parameters<typeof booking.beginPayment>[1]) => booking.beginPayment(s, i),
  'POST /v1/me/checkouts/{checkoutId}/verify-payment': (s: Svc, i: { checkoutId: string }) => payments.verifyCheckoutPayment(s, i),
  'POST /v1/me/bookings/{bookingId}/cancel': (s: Svc, i: { bookingId: string; reason?: string }) => booking.cancelMyBooking(s, i),
  'POST /v1/me/bookings/{bookingId}/reschedule': (s: Svc, i: { bookingId: string; startMs: number; courtId?: string }) => booking.rescheduleMyBooking(s, i),
  'POST /v1/me/bookings/{bookingId}/participants': (s: Svc, i: { bookingId: string; name: string; email?: string }) => booking.addParticipant(s, i),
  'POST /v1/me/bookings/{bookingId}/review': (s: Svc, i: { bookingId: string; rating: number; body: string }) => reviews.createReview(s, i),
  'POST /v1/me/reports': (s: Svc, i: Parameters<typeof reviews.reportContent>[1]) => reviews.reportContent(s, i),
  'POST /v1/me/events/{eventId}/registrations': (s: Svc, i: Parameters<typeof events.registerForEvent>[1]) => events.registerForEvent(s, i),
  'POST /v1/me/events/{eventId}/waitlist': (s: Svc, i: { eventId: string; divisionId: string; partnerName?: string }) => events.joinWaitlist(s, i),
  'POST /v1/me/events/registrations/{registrationId}/accept-offer': (s: Svc, i: { registrationId: string }) => events.acceptOffer(s, i),
  'POST /v1/me/events/registrations/{registrationId}/withdraw': (s: Svc, i: { registrationId: string }) => events.withdrawRegistration(s, i),
  'POST /v1/me/orders': (s: Svc, i: Parameters<typeof products.createStandaloneOrder>[1]) => products.createStandaloneOrder(s, i),
  'POST /v1/me/open-play/{sessionId}/registrations': (s: Svc, i: Parameters<typeof openplay.registerOpenPlay>[1]) => openplay.registerOpenPlay(s, i),
  'POST /v1/me/open-play/{sessionId}/waitlist': (s: Svc, i: { sessionId: string }) => openplay.joinOpenPlayWaitlist(s, i),
  'POST /v1/me/open-play/registrations/{registrationId}/accept-offer': (s: Svc, i: { registrationId: string }) => openplay.acceptOpenPlayOffer(s, i),
  'POST /v1/me/open-play/registrations/{registrationId}/cancellation': (s: Svc, i: { registrationId: string; reason?: string }) => openplay.cancelMyOpenPlay(s, i),
  'POST /v1/me/open-play/registrations/{registrationId}/invitations': (s: Svc, i: { registrationId: string; username: string }) => openplay.invitePartner(s, i),
  'POST /v1/me/invites/{inviteId}/response': (s: Svc, i: { inviteId: string; accept: boolean }) => openplay.respondToInvite(s, i),
  'PUT /v1/me/sports/{sport}': (s: Svc, i: Parameters<typeof social.setSportProfile>[1]) => social.setSportProfile(s, i),
  'PATCH /v1/me/social-settings': (s: Svc, i: Parameters<typeof social.updateSocialSettings>[1]) => social.updateSocialSettings(s, i),
  'POST /v1/me/follows/{username}': (s: Svc, i: { username: string }) => social.followPlayer(s, i),
  'DELETE /v1/me/follows/{username}': (s: Svc, i: { username: string }) => social.unfollowPlayer(s, i),
  'POST /v1/me/follow-requests/{followId}/response': (s: Svc, i: { followId: string; accept: boolean }) => social.respondFollowRequest(s, i),
  'DELETE /v1/me/followers/{username}': (s: Svc, i: { username: string }) => social.removeFollower(s, i),
  'POST /v1/me/blocks/{username}': (s: Svc, i: { username: string }) => social.blockPlayer(s, i),
  'DELETE /v1/me/blocks/{username}': (s: Svc, i: { username: string }) => social.unblockPlayer(s, i),
  'POST /v1/me/restrictions/{restrictionId}/appeal': (s: Svc, i: { restrictionId: string; message: string }) => restrictions.submitAppeal(s, i),
  'POST /v1/me/privacy/data-exports': (s: Svc) => profile.exportMyData(s),
  'POST /v1/me/privacy/deletion-requests': (s: Svc) => profile.requestDeletion(s),
  'DELETE /v1/me/privacy/deletion-requests': (s: Svc) => profile.cancelDeletion(s),
  'POST /v1/staff/me/memberships/{memberId}/accept': (s: Svc, i: { memberId: string }) => staff.acceptInvite(s, i),
  // business & staff
  'POST /v1/businesses': (s: Svc, i: Parameters<typeof businesses.registerBusiness>[1]) => businesses.registerBusiness(s, i),
  'PATCH /v1/businesses/{businessId}': (s: Svc, i: Parameters<typeof businesses.updateBusinessProfile>[1]) => businesses.updateBusinessProfile(s, i),
  'POST /v1/businesses/{businessId}/verification-submissions': (s: Svc, i: Parameters<typeof businesses.submitVerification>[1]) => businesses.submitVerification(s, i),
  'PUT /v1/businesses/{businessId}/payout-account': (s: Svc, i: Parameters<typeof businesses.connectPayoutAccount>[1]) => businesses.connectPayoutAccount(s, i),
  'POST /demo/businesses/{businessId}/payout-account/verify': (s: Svc, i: { businessId: string }) => businesses.simulatePayoutVerification(s, i),
  'POST /v1/businesses/{businessId}/venues': (s: Svc, i: Parameters<typeof venues.createVenue>[1]) => venues.createVenue(s, i),
  'PATCH /v1/businesses/{businessId}/venues/{venueId}': (s: Svc, i: Parameters<typeof venues.updateVenueProfile>[1]) => venues.updateVenueProfile(s, i),
  'PUT /v1/businesses/{businessId}/venues/{venueId}/operating-hours': (s: Svc, i: Parameters<typeof venues.updateOperatingHours>[1]) => venues.updateOperatingHours(s, i),
  'PUT /v1/businesses/{businessId}/venues/{venueId}/booking-rules': (s: Svc, i: Parameters<typeof venues.updateBookingSettings>[1]) => venues.updateBookingSettings(s, i),
  'POST /v1/businesses/{businessId}/venues/{venueId}/special-hours': (s: Svc, i: Parameters<typeof venues.addSpecialHours>[1]) => venues.addSpecialHours(s, i),
  'DELETE /v1/businesses/{businessId}/special-hours/{specialHoursId}': (s: Svc, i: { businessId: string; specialHoursId: string }) => venues.removeSpecialHours(s, i),
  'POST /v1/businesses/{businessId}/venues/{venueId}/publish': (s: Svc, i: { businessId: string; venueId: string; publish: boolean }) => venues.publishVenue(s, i),
  'PUT /v1/businesses/{businessId}/venues/{venueId}/courts': (s: Svc, i: Parameters<typeof venues.upsertCourt>[1]) => venues.upsertCourt(s, i),
  'PUT /v1/businesses/{businessId}/venues/{venueId}/physical-courts': (s: Svc, i: Parameters<typeof venues.savePhysicalCourt>[1]) => venues.savePhysicalCourt(s, i),
  'PUT /v1/businesses/{businessId}/venues/{venueId}/sports': (s: Svc, i: Parameters<typeof venues.updateVenueSports>[1]) => venues.updateVenueSports(s, i),
  'PUT /v1/businesses/{businessId}/open-play': (s: Svc, i: openplay.SaveOpenPlayInput) => openplay.saveOpenPlay(s, i),
  'POST /v1/businesses/{businessId}/open-play/{sessionId}/publish': (s: Svc, i: Parameters<typeof openplay.publishOpenPlay>[1]) => openplay.publishOpenPlay(s, i),
  'POST /v1/businesses/{businessId}/open-play/{sessionId}/duplicate': (s: Svc, i: { businessId: string; sessionId: string; days?: number }) => openplay.duplicateOpenPlay(s, i),
  'POST /v1/businesses/{businessId}/open-play/{sessionId}/cancellation': (s: Svc, i: { businessId: string; sessionId: string; reason: string }) => openplay.cancelOpenPlay(s, i),
  'POST /v1/businesses/{businessId}/open-play/{sessionId}/check-ins': (s: Svc, i: Parameters<typeof openplay.openPlayCheckIn>[1]) => openplay.openPlayCheckIn(s, i),
  'POST /v1/businesses/{businessId}/open-play/{sessionId}/walk-ins': (s: Svc, i: Parameters<typeof openplay.openPlayWalkIn>[1]) => openplay.openPlayWalkIn(s, i),
  'POST /v1/businesses/{businessId}/open-play/{sessionId}/attendance': (s: Svc, i: Parameters<typeof openplay.openPlayAttendance>[1]) => openplay.openPlayAttendance(s, i),
  'POST /v1/businesses/{businessId}/open-play/{sessionId}/games': (s: Svc, i: Parameters<typeof openplay.startOpenPlayGame>[1]) => openplay.startOpenPlayGame(s, i),
  'POST /v1/businesses/{businessId}/open-play/{sessionId}/games/{gameId}/completion': (s: Svc, i: Parameters<typeof openplay.endOpenPlayGame>[1]) => openplay.endOpenPlayGame(s, i),
  'POST /v1/businesses/{businessId}/open-play/{sessionId}/attendance-corrections': (s: Svc, i: Parameters<typeof openplay.correctAttendance>[1]) => openplay.correctAttendance(s, i),
  'POST /v1/businesses/{businessId}/open-play/{sessionId}/attendance-events/{eventId}/reversal': (s: Svc, i: Parameters<typeof openplay.reverseAttendanceEvent>[1]) => openplay.reverseAttendanceEvent(s, i),
  'POST /v1/businesses/{businessId}/open-play/{sessionId}/parties': (s: Svc, i: Parameters<typeof openplay.formParty>[1]) => openplay.formParty(s, i),
  'POST /v1/businesses/{businessId}/open-play/{sessionId}/parties/{partyId}/replacement': (s: Svc, i: Parameters<typeof openplay.assignReplacement>[1]) => openplay.assignReplacement(s, i),
  'POST /v1/businesses/{businessId}/courts/{courtId}/blocks': (s: Svc, i: Parameters<typeof venues.createCourtBlock>[1]) => venues.createCourtBlock(s, i),
  'DELETE /v1/businesses/{businessId}/court-blocks/{blockId}': (s: Svc, i: { businessId: string; blockId: string }) => venues.removeCourtBlock(s, i),
  'PUT /v1/businesses/{businessId}/pricing-rules': (s: Svc, i: Parameters<typeof pricing.savePricingRule>[1]) => pricing.savePricingRule(s, i),
  'DELETE /v1/businesses/{businessId}/pricing-rules/{ruleId}': (s: Svc, i: { businessId: string; ruleId: string }) => pricing.archivePricingRule(s, i),
  'PUT /v1/businesses/{businessId}/promotions': (s: Svc, i: Parameters<typeof pricing.savePromotion>[1]) => pricing.savePromotion(s, i),
  'POST /v1/businesses/{businessId}/bookings/walk-in': (s: Svc, i: Parameters<typeof booking.createWalkIn>[1]) => booking.createWalkIn(s, i),
  'POST /v1/businesses/{businessId}/bookings/check-in': (s: Svc, i: { businessId: string; code: string }) => booking.checkIn(s, i),
  'POST /v1/businesses/{businessId}/bookings/{bookingId}/no-show': (s: Svc, i: { businessId: string; bookingId: string }) => booking.markNoShow(s, i),
  'POST /v1/businesses/{businessId}/bookings/{bookingId}/cancel': (s: Svc, i: Parameters<typeof booking.venueCancelBooking>[1]) => booking.venueCancelBooking(s, i),
  'POST /v1/businesses/{businessId}/bookings/{bookingId}/reschedule': (s: Svc, i: Parameters<typeof booking.staffReschedule>[1]) => booking.staffReschedule(s, i),
  'POST /v1/businesses/{businessId}/payments/{paymentId}/recheck': (s: Svc, i: { businessId: string; paymentId: string }) => payments.recheckPayment(s, i),
  'POST /v1/businesses/{businessId}/refunds': (s: Svc, i: { businessId: string; bookingId: string; sharePpm: number; reason: string }) => bizRequestRefund(s, i),
  'POST /v1/businesses/{businessId}/refunds/{refundId}/approve': (s: Svc, i: { businessId: string; refundId: string; note?: string }) => refunds.approveRefund(s, i),
  'POST /v1/businesses/{businessId}/refunds/{refundId}/reject': (s: Svc, i: { businessId: string; refundId: string; note: string }) => refunds.rejectRefund(s, i),
  'POST /v1/businesses/{businessId}/refunds/{refundId}/retry': (s: Svc, i: { businessId: string; refundId: string }) => refunds.retryRefund(s, i),
  'PUT /v1/businesses/{businessId}/events': (s: Svc, i: Parameters<typeof events.saveEvent>[1]) => events.saveEvent(s, i),
  'POST /v1/businesses/{businessId}/events/{eventId}/publish': (s: Svc, i: { businessId: string; eventId: string }) => events.publishEvent(s, i),
  'POST /v1/businesses/{businessId}/events/{eventId}/cancel': (s: Svc, i: { businessId: string; eventId: string; reason: string }) => events.cancelEvent(s, i),
  'POST /v1/businesses/{businessId}/registrations/{registrationId}/check-in': (s: Svc, i: { businessId: string; registrationId: string }) => events.checkInRegistration(s, i),
  'POST /v1/businesses/{businessId}/events/{eventId}/matches': (s: Svc, i: Parameters<typeof events.recordMatch>[1]) => events.recordMatch(s, i),
  'PUT /v1/businesses/{businessId}/products': (s: Svc, i: Parameters<typeof products.saveProduct>[1]) => products.saveProduct(s, i),
  'POST /v1/businesses/{businessId}/products/{productId}/inventory-adjustments': (s: Svc, i: Parameters<typeof products.adjustInventory>[1]) => products.adjustInventory(s, i),
  'POST /v1/businesses/{businessId}/orders/{orderId}/status': (s: Svc, i: Parameters<typeof products.setOrderStatus>[1]) => products.setOrderStatus(s, i),
  'POST /v1/businesses/{businessId}/orders/claims': (s: Svc, i: { businessId: string; code: string }) => products.claimOrder(s, i),
  'POST /v1/businesses/{businessId}/orders/{orderId}/cancel': (s: Svc, i: { businessId: string; orderId: string; reason: string }) => products.cancelOrderByVenue(s, i),
  'POST /v1/businesses/{businessId}/restrictions': (s: Svc, i: Parameters<typeof restrictions.createRestriction>[1]) => restrictions.createRestriction(s, i),
  'POST /v1/businesses/{businessId}/restrictions/{restrictionId}/lift': (s: Svc, i: { businessId: string; restrictionId: string; reason: string }) => restrictions.liftRestriction(s, i),
  'POST /v1/businesses/{businessId}/restrictions/{restrictionId}/appeal-decision': (s: Svc, i: Parameters<typeof restrictions.decideAppeal>[1]) => restrictions.decideAppeal(s, i),
  'POST /v1/businesses/{businessId}/members': (s: Svc, i: Parameters<typeof staff.inviteMember>[1]) => staff.inviteMember(s, i),
  'PATCH /v1/businesses/{businessId}/members/{memberId}': (s: Svc, i: Parameters<typeof staff.updateMember>[1]) => staff.updateMember(s, i),
  'DELETE /v1/businesses/{businessId}/members/{memberId}': (s: Svc, i: { businessId: string; memberId: string }) => staff.removeMember(s, i),
  'PUT /v1/businesses/{businessId}/roles': (s: Svc, i: Parameters<typeof staff.saveCustomRole>[1]) => staff.saveCustomRole(s, i),
  'POST /v1/businesses/{businessId}/reviews/{reviewId}/reply': (s: Svc, i: { businessId: string; reviewId: string; body: string }) => reviews.replyToReview(s, i),
  'POST /v1/businesses/{businessId}/reports/exports': (s: Svc, i: Parameters<typeof reports.exportReport>[1]) => reports.exportReport(s, i),
  // admin
  'POST /v1/admin/businesses/{businessId}/verification-decision': (s: Svc, i: Parameters<typeof businesses.decideVerification>[1]) => businesses.decideVerification(s, i),
  'POST /v1/admin/businesses/{businessId}/suspension': (s: Svc, i: Parameters<typeof businesses.setBusinessSuspension>[1]) => businesses.setBusinessSuspension(s, i),
  'POST /v1/admin/users/{userId}/suspension': (s: Svc, i: Parameters<typeof admin.setUserSuspension>[1]) => admin.setUserSuspension(s, i),
  'POST /v1/admin/users/{userId}/restrictions': (s: Svc, i: Parameters<typeof restrictions.platformRestrict>[1]) => restrictions.platformRestrict(s, i),
  'POST /v1/admin/commission-agreements': (s: Svc, i: Parameters<typeof admin.proposeCommission>[1]) => admin.proposeCommission(s, i),
  'POST /v1/admin/fee-schedules': (s: Svc, i: Parameters<typeof admin.proposeFeeSchedule>[1]) => admin.proposeFeeSchedule(s, i),
  'POST /v1/admin/approval-requests/{approvalId}/decision': (s: Svc, i: Parameters<typeof admin.decideApproval>[1]) => admin.decideApproval(s, i),
  'POST /v1/admin/refunds/{refundId}/approve': (s: Svc, i: { refundId: string; note?: string }) => refunds.approveRefund(s, i),
  'POST /v1/admin/refunds/{refundId}/reject': (s: Svc, i: { refundId: string; note: string }) => refunds.rejectRefund(s, i),
  'POST /v1/admin/refunds/{refundId}/retry': (s: Svc, i: { refundId: string }) => refunds.retryRefund(s, i),
  'POST /v1/admin/payouts/{payoutId}/retry': (s: Svc, i: { payoutId: string }) => payouts.retryPayout(s, i),
  'POST /v1/admin/reconciliation/runs': (s: Svc) => payments.runReconciliation(s),
  'POST /v1/admin/payment-exceptions/acknowledgements': (s: Svc, i: { key: string; note: string }) => exceptions.acknowledgeException(s, i),
  'POST /v1/businesses/{businessId}/payment-exceptions/acknowledgements': (s: Svc, i: { businessId: string; key: string; note: string }) => exceptions.acknowledgeException(s, i),
  'POST /v1/admin/payments/{paymentId}/review-resolution': (s: Svc, i: { paymentId: string; note: string }) => payments.resolveAmountMismatch(s, i),
  'POST /v1/admin/refunds/{refundId}/manual-completion': (s: Svc, i: { refundId: string; reference: string; note?: string }) => refunds.recordManualRefund(s, i),
  'POST /v1/businesses/{businessId}/refunds/{refundId}/manual-completion': (s: Svc, i: { businessId: string; refundId: string; reference: string; note?: string }) => refunds.recordManualRefund(s, i),
  'POST /v1/admin/reconciliation/payments/{paymentId}/heal': (s: Svc, i: { paymentId: string }) => payments.healPayment(s, i),
  'POST /v1/admin/disputes/{disputeId}/evidence': (s: Svc, i: { disputeId: string; note: string }) => disputes.submitEvidence(s, i),
  'POST /demo/disputes/{disputeId}/outcome': (s: Svc, i: { disputeId: string; outcome: 'WON' | 'LOST' }) => disputes.simulateDisputeOutcome(s, i),
  'POST /demo/payments/{paymentId}/chargeback': (s: Svc, i: { paymentId: string }) => disputes.simulateChargeback(s, i),
  'POST /v1/admin/moderation/reports/{reportId}/actions': (s: Svc, i: Parameters<typeof reviews.actionReport>[1]) => reviews.actionReport(s, i),
  'POST /v1/admin/support-sessions': (s: Svc, i: Parameters<typeof admin.startSupportSession>[1]) => admin.startSupportSession(s, i),
  'DELETE /v1/admin/support-sessions/current': (s: Svc) => admin.endSupportSession(s),
  'PATCH /v1/admin/config/feature-flags/{key}': (s: Svc, i: { key: string; enabled: boolean }) => admin.toggleFeatureFlag(s, i),
  'PATCH /v1/admin/config/refund-threshold': (s: Svc, i: { amount: number }) => admin.updateRefundThreshold(s, i),
  'PUT /v1/admin/promotions': (s: Svc, i: Parameters<typeof pricing.savePromotion>[1]) => pricing.savePromotion(s, i),
  'PATCH /v1/admin/sports/{sport}': (s: Svc, i: Parameters<typeof sportsAdmin.updateSport>[1]) => sportsAdmin.updateSport(s, i),
} satisfies Record<string, Handler | ((s: Svc) => unknown)>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function adminProducts(s: Svc) {
  requirePlatform(s, 'platform.bookings.view');
  return s.db.all('products').map((p) => ({ p, venue: s.db.get('venues', p.venueId)?.name ?? '' }));
}

function bizRefunds(s: Svc, businessId: string) {
  requireBusiness(s, businessId, 'payments.view');
  return s.db
    .filter('refunds', (r) => r.businessId === businessId)
    .sort((a, b) => (a.status === 'pending_approval' ? 0 : 1) - (b.status === 'pending_approval' ? 0 : 1) || b.createdAt - a.createdAt)
    .map((r) => ({ refund: r, customer: displayName(s.db, r.userId), requestedBy: displayName(s.db, r.requestedBy), booking: r.bookingId ? s.db.get('bookings', r.bookingId)?.code ?? null : null }));
}

/** Goodwill/exception refund requested by staff; needs refunds.approve from someone else unless the requester has it. */
function bizRequestRefund(s: Svc, i: { businessId: string; bookingId: string; sharePpm: number; reason: string }) {
  const b = s.db.get('bookings', i.bookingId);
  const acc = requireBusiness(s, i.businessId, 'refunds.request', { venueId: b?.venueId ?? null, write: true });
  if (!b || b.businessId !== i.businessId) fail('NOT_FOUND', 'Booking not found.');
  if (!i.reason?.trim()) fail('VALIDATION_FAILED', 'Add a reason.', { fields: [{ field: 'reason', message: 'Required.' }] });
  if (!(i.sharePpm > 0 && i.sharePpm <= 1_000_000)) fail('VALIDATION_FAILED', 'Choose a refund share.', { fields: [{ field: 'sharePpm', message: 'Required.' }] });
  const payment = s.db.filter('payments', (p) => p.checkoutId === b.checkoutId && ['captured', 'partially_refunded'].includes(p.status))[0];
  if (!payment) fail('CONFLICT', 'No captured payment to refund.');
  if (!['completed', 'no_show', 'confirmed', 'checked_in', 'partially_refunded'].includes(b.status)) fail('INVALID_STATE_TRANSITION', `Bookings that are ${b.status.replace(/_/g, ' ')} can't get a goodwill refund.`);
  const canApprove = acc.perms.has('refunds.approve') && s.actor.mfaVerified;
  const r = refunds.createRefund(s, { payment, components: { items: [{ ref: 'court', sharePpm: i.sharePpm }], refundGatewayFee: false }, reason: `Goodwill: ${i.reason.trim()}`, initiator: 'goodwill', bookingId: b.id, approvedByRequester: canApprove });
  if (r && b.status !== 'partially_refunded' && ['completed', 'no_show'].includes(b.status)) {
    s.db.update('bookings', b.id, (x) => {
      x.history.push({ from: x.status, to: 'refund_pending', at: s.now, by: acc.user.id, reason: 'Goodwill refund requested' });
      x.status = 'refund_pending';
    });
  }
  return r;
}

export type ReadKey = keyof typeof READ;
export type WriteKey = keyof typeof WRITE;
type ReadInput<K extends ReadKey> = Parameters<(typeof READ)[K]> extends [Svc, infer I] ? I : void;
type WriteInput<K extends WriteKey> = Parameters<(typeof WRITE)[K]> extends [Svc, infer I] ? I : void;
export type ReadResult<K extends ReadKey> = ReturnType<(typeof READ)[K]>;
export type WriteResult<K extends WriteKey> = ReturnType<(typeof WRITE)[K]>;

export interface ApiLogEntry {
  id: number;
  at: number;
  method: string;
  path: string;
  status: number;
  ms: number;
  correlationId: string;
  idempotencyKey?: string;
  note?: string;
  code?: string;
}

export class ApiError extends Error {
  readonly problem: ProblemDetails;
  constructor(problem: ProblemDetails) {
    super(problem.detail);
    this.name = 'ApiError';
    this.problem = problem;
  }
  get code() {
    return this.problem.code;
  }
  get fields() {
    return this.problem.errors ?? [];
  }
  get details(): Record<string, unknown> {
    return this.problem.details ?? {};
  }
}

function fillPath(key: string, input: unknown): { method: string; path: string } {
  const [method, template] = key.split(' ') as [string, string];
  const obj = (input ?? {}) as Record<string, unknown>;
  const path = template.replace(/\{(\w+)\}/g, (_, name: string) => String(obj[name] ?? `{${name}}`));
  return { method, path };
}

export class Api {
  readonly store: Store;
  readonly request: () => RequestInfo;
  latency: boolean;
  log: ApiLogEntry[] = [];
  private seq = 0;
  private listeners = new Set<() => void>();
  private writeTimes: number[] = [];

  constructor(store: Store, request: () => RequestInfo, opts: { latency?: boolean } = {}) {
    this.store = store;
    this.request = request;
    this.latency = opts.latency ?? true;
  }

  onLog(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private record(e: Omit<ApiLogEntry, 'id' | 'at'>): void {
    this.log.unshift({ ...e, id: ++this.seq, at: this.store.now() });
    if (this.log.length > 150) this.log.length = 150;
    for (const l of this.listeners) l();
  }

  read<K extends ReadKey>(key: K, ...args: ReadInput<K> extends void ? [] : [ReadInput<K>]): ReadResult<K> {
    const input = args[0];
    const req = { ...this.request(), correlationId: correlationId() };
    const started = performance.now();
    const { method, path } = fillPath(key, input);
    let deferred: Svc['deferred'] = [];
    let touch = false;
    try {
      const result = this.store.read((db, now) => {
        const actor = resolveActor(db, now, req);
        const s = makeSvc(db, now, db.state.meta, actor, req);
        try {
          return (READ[key] as (s: Svc, i: unknown) => ReadResult<K>)(s, input);
        } finally {
          deferred = s.deferred;
          touch = !!actor.session && now - actor.session.lastSeenAt > 60_000;
        }
      });
      if (!key.startsWith('GET /demo') && !key.startsWith('GET /v1/me/checkouts')) this.record({ method, path, status: 200, ms: Math.round(performance.now() - started), correlationId: req.correlationId });
      return result;
    } catch (e) {
      const problem = toProblem(e, req.correlationId);
      this.record({ method, path, status: problem.status, ms: Math.round(performance.now() - started), correlationId: req.correlationId, code: problem.code });
      if (!(e instanceof AppError)) console.error(e);
      throw new ApiError(problem);
    } finally {
      if (deferred.length || touch) void this.flush(req, deferred, [], touch);
    }
  }

  private async flush(req: RequestInfo, deferred: Svc['deferred'], after: Svc['after'], touch: boolean): Promise<void> {
    try {
      await this.store.transact((tx) => {
        const actor = resolveActor(tx.db, tx.now, req);
        const s = makeSvc(tx.db, tx.now, tx.meta, actor, req);
        for (const d of deferred) securityEvent(s, d);
        for (const fn of after) fn(s);
        if (touch) auth.touchSession(s);
      });
    } catch (e) {
      console.error('deferred write failed', e);
    }
  }

  async write<K extends WriteKey>(key: K, input: WriteInput<K>, opts: { idempotencyKey?: string; silent?: boolean } = {}): Promise<Awaited<WriteResult<K>>> {
    const req = { ...this.request(), correlationId: correlationId() };
    const { method, path } = fillPath(key, input);
    const started = performance.now();
    // Per-tab write rate limit (production: Redis sliding window per user/IP/route).
    const now = Date.now();
    this.writeTimes = this.writeTimes.filter((t) => now - t < 60_000);
    if (this.writeTimes.length >= 90 && !key.startsWith('POST /demo')) {
      const problem = toProblem(new AppError('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.'), req.correlationId);
      this.record({ method, path, status: 429, ms: 0, correlationId: req.correlationId, code: 'RATE_LIMITED' });
      void this.flush(req, [{ at: this.store.now(), type: 'rate_limited', severity: 'warning', userId: null, businessId: null, detail: `Write rate limit hit on ${method} ${path}`, ip: req.ip }], [], false);
      throw new ApiError(problem);
    }
    this.writeTimes.push(now);
    if (this.latency) await new Promise((r) => setTimeout(r, 120 + Math.floor(Math.random() * 220)));
    let deferred: Svc['deferred'] = [];
    let after: Svc['after'] = [];
    let replayed = false;
    try {
      const result = await this.store.transact((tx) => {
        const actor = resolveActor(tx.db, tx.now, req);
        const s = makeSvc(tx.db, tx.now, tx.meta, actor, req);
        try {
          if (opts.idempotencyKey) {
            const scope = `${actor.realUser?.id ?? 'anon'}:${method} ${path}`;
            const recId = `${scope}:${opts.idempotencyKey}`;
            const requestHash = sha256Hex(canonicalJson(input ?? null));
            const prior = tx.db.get('idempotency', recId);
            if (prior && prior.expiresAt > tx.now) {
              if (prior.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request body.');
              replayed = true;
              return prior.response as Awaited<WriteResult<K>>;
            }
            const res = (WRITE[key] as (s: Svc, i: unknown) => Awaited<WriteResult<K>>)(s, input);
            tx.db.insert('idempotency', { id: recId, requestHash, response: res, createdAt: tx.now, expiresAt: tx.now + 24 * 3_600_000 });
            return res;
          }
          return (WRITE[key] as (s: Svc, i: unknown) => Awaited<WriteResult<K>>)(s, input);
        } finally {
          deferred = s.deferred;
          after = s.after;
        }
      });
      if (!opts.silent) this.record({ method, path, status: replayed ? 200 : method === 'POST' ? 201 : 200, ms: Math.round(performance.now() - started), correlationId: req.correlationId, ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}), ...(replayed ? { note: 'Idempotent replay — stored response returned, nothing re-executed' } : {}) });
      if (deferred.length || after.length) await this.flush(req, deferred, after, false);
      return result;
    } catch (e) {
      const problem = toProblem(e, req.correlationId);
      this.record({ method, path, status: problem.status, ms: Math.round(performance.now() - started), correlationId: req.correlationId, code: problem.code, ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}) });
      if (deferred.length || after.length) await this.flush(req, deferred, after, false);
      if (!(e instanceof AppError)) console.error(e);
      throw new ApiError(problem);
    }
  }

  /** The provider's webhook POST (used by the job runner and the presenter's "forged webhook" demo). */
  async webhook(headers: Record<string, string>, body: { id: string; event: string; data: Record<string, unknown> }): Promise<{ status: number; result: string }> {
    const req = { ...this.request(), sessionToken: null, correlationId: correlationId(), ip: '198.51.100.20' };
    const started = performance.now();
    const res = await this.store.transact((tx) => payments.handleProviderWebhook(makeSvc(tx.db, tx.now, tx.meta, { kind: 'provider', user: null, realUser: null, session: null, support: null, mfaVerified: true }, req), { headers, body }));
    this.record({ method: 'POST', path: '/v1/webhooks/xendit', status: res.status, ms: Math.round(performance.now() - started), correlationId: req.correlationId, note: res.result });
    return res;
  }

  recordExternal(e: Omit<ApiLogEntry, 'id' | 'at'>): void {
    this.record(e);
  }
}
