/** Verified reviews (only after a completed booking), venue replies, content reports and moderation. */

import { fail, invalid } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import type { ContentReport, Id } from './model.ts';
import { audit, displayName, notify, notifyBusiness, requireBusiness, requirePlatform, requireUser, requireWritable, type Svc } from './svc.ts';

function recomputeRating(s: Svc, venueId: Id): void {
  const reviews = s.db.filter('reviews', (r) => r.venueId === venueId && r.status === 'published');
  const avg = reviews.length ? reviews.reduce((a, r) => a + r.rating, 0) / reviews.length : 0;
  s.db.update('venues', venueId, (v) => {
    v.ratingAvg = Math.round(avg * 10) / 10;
    v.ratingCount = reviews.length;
  });
}

export function createReview(s: Svc, input: { bookingId: Id; rating: number; body: string }) {
  requireWritable(s);
  const u = requireUser(s);
  const b = s.db.get('bookings', input.bookingId);
  if (!b || b.userId !== u.id) fail('NOT_FOUND', 'Booking not found.');
  if (b.status !== 'completed') fail('CONFLICT', 'You can review a venue after your game is completed.');
  if (!(Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 5)) invalid([{ field: 'rating', message: 'Choose 1 to 5 stars.' }]);
  const body = (input.body ?? '').trim();
  if (body.length < 10 || body.length > 1000) invalid([{ field: 'body', message: 'Write between 10 and 1000 characters.' }]);
  const review = { id: newId('rev'), bookingId: b.id, userId: u.id, businessId: b.businessId, venueId: b.venueId, rating: input.rating, body, status: 'published' as const, reply: null, createdAt: s.now };
  s.db.insert('reviews', review); // unique(booking_id) prevents duplicates
  recomputeRating(s, b.venueId);
  notifyBusiness(s, b.businessId, 'reviews.respond', { title: `New ${input.rating}★ review`, body: body.slice(0, 120), link: '#/biz/reviews' });
  return review;
}

export function businessReviews(s: Svc, input: { businessId: Id }) {
  requireBusiness(s, input.businessId, 'business.view');
  return s.db
    .filter('reviews', (r) => r.businessId === input.businessId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({ review: r, author: displayName(s.db, r.userId), venue: s.db.get('venues', r.venueId)?.name ?? '' }));
}

export function replyToReview(s: Svc, input: { businessId: Id; reviewId: Id; body: string }) {
  const r = s.db.get('reviews', input.reviewId);
  if (!r || r.businessId !== input.businessId) fail('NOT_FOUND', 'Review not found.');
  const acc = requireBusiness(s, input.businessId, 'reviews.respond', { write: true });
  const body = (input.body ?? '').trim();
  if (body.length < 2 || body.length > 800) invalid([{ field: 'body', message: 'Write a reply (up to 800 characters).' }]);
  s.db.update('reviews', r.id, (x) => {
    x.reply = { body, by: acc.user.id, at: s.now };
  });
  notify(s, r.userId, 'booking_updates', { title: 'The venue replied to your review', body: body.slice(0, 120), link: `#/venues/${s.db.must('venues', r.venueId).slug}` });
  return s.db.must('reviews', r.id);
}

export function reportContent(s: Svc, input: { targetType: ContentReport['targetType']; targetId: Id; reason: string; details?: string; businessId?: Id }) {
  requireWritable(s);
  const u = requireUser(s);
  if (!input.reason?.trim()) invalid([{ field: 'reason', message: 'Choose a reason.' }]);
  let businessId: Id | null = input.businessId ?? null;
  if (input.targetType === 'review') {
    const r = s.db.get('reviews', input.targetId);
    if (!r) fail('NOT_FOUND', 'Review not found.');
    businessId = r.businessId;
    if (input.businessId) requireBusiness(s, input.businessId, 'reviews.respond');
    s.db.update('reviews', r.id, (x) => {
      if (x.status === 'published') x.status = 'flagged';
    });
  }
  const report: ContentReport = { id: newId('rpt'), reporterId: u.id, targetType: input.targetType, targetId: input.targetId, businessId, reason: input.reason.trim(), details: (input.details ?? '').trim().slice(0, 1000), status: 'open', handledBy: null, handledAt: null, action: null, createdAt: s.now };
  s.db.insert('contentReports', report);
  return report;
}

export function moderationQueue(s: Svc) {
  requirePlatform(s, 'platform.moderation.manage');
  return s.db
    .all('contentReports')
    .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.createdAt - a.createdAt)
    .map((r) => ({ report: r, reporter: displayName(s.db, r.reporterId), review: r.targetType === 'review' ? s.db.get('reviews', r.targetId) ?? null : null }));
}

export function actionReport(s: Svc, input: { reportId: Id; action: 'hide_content' | 'dismiss'; note: string }) {
  const admin = requirePlatform(s, 'platform.moderation.manage', { write: true });
  const report = s.db.must('contentReports', input.reportId, 'report');
  if (report.status !== 'open') fail('INVALID_STATE_TRANSITION', 'This report was already handled.');
  if (report.targetType === 'review') {
    const r = s.db.get('reviews', report.targetId);
    if (r) {
      s.db.update('reviews', r.id, (x) => {
        x.status = input.action === 'hide_content' ? 'hidden' : 'published';
      });
      recomputeRating(s, r.venueId);
    }
  }
  s.db.update('contentReports', report.id, (x) => {
    x.status = input.action === 'hide_content' ? 'actioned' : 'dismissed';
    x.handledBy = admin.id;
    x.handledAt = s.now;
    x.action = input.note?.trim() || input.action;
  });
  audit(s, { action: `moderation.${input.action}`, targetType: report.targetType, targetId: report.targetId, businessId: report.businessId, summary: `${input.action === 'hide_content' ? 'Hid' : 'Dismissed report on'} ${report.targetType}`, reason: input.note });
  return s.db.must('contentReports', report.id);
}
