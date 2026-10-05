/**
 * Social player profiles (doc 24 SOC) and the per-sport "My Sports" dashboard.
 *
 * - Following is one-directional; follow-request approval is optional per profile.
 * - Every read of another person goes through `publicProfile()` — a single projection that never includes
 *   email, phone, payment data, restrictions, internal notes or audit metadata (doc 24 CR-D11).
 * - Blocks are enforced in the read path in both directions and look like "not found" (CR-D12). Blocking
 *   affects social features only: it does not cancel bookings or registrations and does not notify the
 *   blocked user (default pending product-owner confirmation, doc 24 Q1).
 */

import { fail, invalid } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { skillLabel } from '../domain/sports.ts';
import { DAY, MINUTE } from '../domain/time.ts';
import type { Follow, Id, Profile, SocialSettings, SportProfile, Visibility } from './model.ts';
import type { Db } from './store.ts';
import { audit, displayName, notify, requireUser, requireWritable, usernameProblem, type Svc } from './svc.ts';

// ---------------------------------------------------------------- relationship helpers

export function isBlockedEitherWay(db: Db, a: Id | null | undefined, b: Id | null | undefined): boolean {
  if (!a || !b) return false;
  return !!db.find('blocks', (x) => (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a));
}

function activeFollow(db: Db, follower: Id, followee: Id): Follow | undefined {
  return db.find('follows', (f) => f.followerId === follower && f.followeeId === followee && (f.status === 'pending' || f.status === 'accepted'));
}

function followsAccepted(db: Db, follower: Id, followee: Id): boolean {
  return activeFollow(db, follower, followee)?.status === 'accepted';
}

/** Is `viewer` allowed to see something the owner set to `level`? */
export function canSee(db: Db, level: Visibility, ownerId: Id, viewerId: Id | null): boolean {
  if (viewerId === ownerId) return true;
  if (!viewerId) return level === 'public';
  if (isBlockedEitherWay(db, ownerId, viewerId)) return false;
  if (level === 'public') return true;
  if (level === 'followers') return followsAccepted(db, viewerId, ownerId);
  if (level === 'organizers') {
    // Staff of a business where the owner has a booking or registration.
    const bizIds = new Set([
      ...db.filter('bookings', (b) => b.userId === ownerId).map((b) => b.businessId),
      ...db.filter('opRegistrations', (r) => r.userId === ownerId).map((r) => r.businessId),
      ...db.filter('registrations', (r) => r.userId === ownerId).map((r) => r.businessId),
    ]);
    return !!db.find('members', (m) => m.userId === viewerId && m.status === 'active' && bizIds.has(m.businessId));
  }
  return false;
}

function profileByUsername(s: Svc, username: string): Profile {
  const u = (username ?? '').trim().replace(/^@/, '').toLowerCase();
  const p = s.db.find('profiles', (x) => (x.username ?? '').toLowerCase() === u);
  const viewer = s.actor.user?.id ?? null;
  if (!p || s.db.get('users', p.userId)?.status !== 'active' || isBlockedEitherWay(s.db, p.userId, viewer)) fail('NOT_FOUND', 'Player not found.');
  return p;
}

// ---------------------------------------------------------------- per-sport stats (shared by dashboard + public profile)

interface SportStats {
  sport: string;
  name: string;
  icon: string;
  hue: number;
  sessions: number;
  hours: number;
  bookings: number;
  openPlay: number;
  events: number;
  games: number;
  wins: number;
  losses: number;
  lastPlayedAt: number | null;
  venues: { name: string; slug: string; sessions: number }[];
  monthly: number[];
}

function sportStats(s: Svc, userId: Id): SportStats[] {
  const sports = s.db.filter('sports', (x) => x.status === 'active');
  const bookings = s.db.filter('bookings', (b) => (b.userId === userId || b.participants.some((p) => p.userId === userId)) && (b.status === 'completed' || b.status === 'checked_in'));
  const opRegs = s.db.filter('opRegistrations', (r) => r.userId === userId && r.status === 'confirmed' && ['completed', 'checked_out', 'waiting', 'on_court', 'temp_off', 'checked_in'].includes(r.attendance));
  const sessionsById = new Map(opRegs.map((r) => [r.sessionId, s.db.get('openPlaySessions', r.sessionId)!]));
  const regs = s.db.filter('registrations', (r) => r.userId === userId && (r.status === 'checked_in' || r.status === 'confirmed'));
  const games = s.db.filter('opGames', (g) => g.status === 'completed');
  const matches = s.db.filter('matches', (m) => m.sideA.includes(userId) || m.sideB.includes(userId));
  const monthStart = (k: number) => s.now - (k + 1) * 30 * DAY;
  return sports.map((sp) => {
    const b = bookings.filter((x) => (x.sport ?? 'pickleball') === sp.code && x.startMs <= s.now);
    const o = opRegs.filter((r) => sessionsById.get(r.sessionId)?.sport === sp.code && (sessionsById.get(r.sessionId)?.startMs ?? 0) <= s.now);
    const e = regs.filter((r) => {
      const ev = s.db.get('events', r.eventId);
      return !!ev && (ev.sport ?? 'pickleball') === sp.code && ev.startMs <= s.now;
    });
    const myRegIds = new Set(o.map((r) => r.id));
    const myGames = games.filter((g) => [...g.sideA, ...g.sideB].some((id) => myRegIds.has(id)));
    const scored = myGames.filter((g) => g.winner);
    const gameWins = scored.filter((g) => (g.winner === 'a' ? g.sideA : g.sideB).some((id) => myRegIds.has(id))).length;
    const sportMatches = matches.filter((m) => (s.db.get('events', m.eventId)?.sport ?? 'pickleball') === sp.code);
    const matchWins = sportMatches.filter((m) => (m.sideA.includes(userId) ? m.scoreA > m.scoreB : m.scoreB > m.scoreA)).length;
    const times = [...b.map((x) => x.startMs), ...o.map((r) => sessionsById.get(r.sessionId)!.startMs), ...e.map((r) => s.db.get('events', r.eventId)!.startMs)];
    const venueCount = new Map<Id, number>();
    for (const x of b) venueCount.set(x.venueId, (venueCount.get(x.venueId) ?? 0) + 1);
    for (const r of o) venueCount.set(r.venueId, (venueCount.get(r.venueId) ?? 0) + 1);
    const hours = b.reduce((a, x) => a + x.durationMinutes, 0) / 60 + o.reduce((a, r) => {
      const ss = sessionsById.get(r.sessionId)!;
      return a + (ss.endMs - Math.max(ss.startMs, r.checkedInAt ?? ss.startMs)) / (60 * MINUTE);
    }, 0);
    return {
      sport: sp.code,
      name: sp.name,
      icon: sp.icon,
      hue: sp.hue,
      sessions: b.length + o.length + e.length,
      hours: Math.round(hours * 10) / 10,
      bookings: b.length,
      openPlay: o.length,
      events: e.length,
      games: myGames.length + o.reduce((a, r) => a + Math.max(0, r.gamesPlayed - myGames.filter((g) => [...g.sideA, ...g.sideB].includes(r.id)).length), 0),
      wins: gameWins + matchWins,
      losses: scored.length - gameWins + (sportMatches.length - matchWins),
      lastPlayedAt: times.length ? Math.max(...times) : null,
      venues: [...venueCount.entries()]
        .sort((a, b2) => b2[1] - a[1])
        .slice(0, 3)
        .map(([id, n]) => {
          const v = s.db.get('venues', id);
          return { name: v?.name ?? 'Venue', slug: v?.slug ?? '', sessions: n };
        }),
      monthly: Array.from({ length: 6 }, (_, i) => 5 - i).map((k) => times.filter((t) => t >= monthStart(k) && t < monthStart(k - 1)).length),
    };
  });
}

// ---------------------------------------------------------------- My Sports dashboard

export function mySportsDashboard(s: Svc) {
  const u = requireUser(s);
  const sportCfgs = s.db.filter('sports', (x) => x.status === 'active');
  const stats = sportStats(s, u.id);
  const sp = (code: string) => s.db.get('sportProfiles', `${u.id}:${code}`);
  const upcomingBookings = s.db.filter('bookings', (b) => b.userId === u.id && b.status === 'confirmed' && b.startMs > s.now);
  const upcomingOp = s.db.filter('opRegistrations', (r) => r.userId === u.id && ['confirmed', 'held', 'pending_payment', 'waitlisted', 'offered'].includes(r.status)).filter((r) => (s.db.get('openPlaySessions', r.sessionId)?.endMs ?? 0) > s.now);
  const cards = stats
    .map((st) => {
      const prof = sp(st.sport);
      const cfg = sportCfgs.find((c) => c.code === st.sport)!;
      const upcoming = [
        ...upcomingBookings.filter((b) => (b.sport ?? 'pickleball') === st.sport).map((b) => ({ kind: 'booking' as const, id: b.id, title: s.db.get('courts', b.courtId)?.name ?? 'Court', venue: s.db.get('venues', b.venueId)?.name ?? '', startMs: b.startMs, href: `#/app/bookings/${b.id}` })),
        ...upcomingOp.filter((r) => s.db.get('openPlaySessions', r.sessionId)?.sport === st.sport).map((r) => {
          const o = s.db.must('openPlaySessions', r.sessionId);
          return { kind: 'open_play' as const, id: r.id, title: o.title, venue: s.db.get('venues', o.venueId)?.name ?? '', startMs: o.startMs, href: `#/app/open-play/registrations/${r.id}`, status: r.status };
        }),
      ].sort((a, b) => a.startMs - b.startMs).slice(0, 3);
      const ratings = st.sport === 'pickleball' ? s.db.filter('ratings', (r) => r.userId === u.id && r.source !== 'self_declared') : [];
      return {
        ...st,
        skill: prof?.skill ?? null,
        skillLabel: prof?.skill ? skillLabel(cfg, prof.skill) : null,
        skillSource: prof?.skillSource ?? null,
        ratings,
        interested: prof?.interested ?? false,
        pinned: prof?.pinned ?? false,
        hidden: prof?.hidden ?? false,
        upcoming,
        skillLevels: cfg.skillLevels,
      };
    })
    .filter((c) => c.sessions > 0 || c.interested || c.upcoming.length > 0)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.sessions - a.sessions);
  const visible = cards.filter((c) => !c.hidden);
  return {
    sports: visible,
    hiddenSports: cards.filter((c) => c.hidden).map((c) => ({ sport: c.sport, name: c.name })),
    otherSports: sportCfgs.filter((c) => !cards.some((x) => x.sport === c.code)).map((c) => ({ sport: c.code, name: c.name, icon: c.icon })),
    totals: { sports: visible.length, sessions: visible.reduce((a, c) => a + c.sessions, 0), hours: Math.round(visible.reduce((a, c) => a + c.hours, 0) * 10) / 10 },
  };
}

export function setSportProfile(s: Svc, input: { sport: string; skill?: string | null; interested?: boolean; pinned?: boolean; hidden?: boolean }) {
  requireWritable(s);
  const u = requireUser(s);
  const cfg = s.db.get('sports', input.sport);
  if (!cfg || cfg.status !== 'active') fail('SPORT_NOT_SUPPORTED', 'Choose an active sport.');
  if (input.skill && !cfg.skillLevels.some((l) => l.code === input.skill)) invalid([{ field: 'skill', message: 'Choose a skill level for this sport.' }]);
  const id = `${u.id}:${cfg.code}`;
  const existing = s.db.get('sportProfiles', id);
  const row: SportProfile = existing
    ? { ...existing }
    : { id, userId: u.id, sport: cfg.code, skill: null, skillSource: 'self_declared', interested: false, pinned: false, hidden: false, updatedAt: s.now };
  if (input.skill !== undefined) {
    row.skill = input.skill;
    row.skillSource = 'self_declared';
  }
  if (input.interested !== undefined) row.interested = input.interested;
  if (input.pinned !== undefined) row.pinned = input.pinned;
  if (input.hidden !== undefined) row.hidden = input.hidden;
  row.updatedAt = s.now;
  if (existing) s.db.update('sportProfiles', id, (x) => Object.assign(x, row));
  else s.db.insert('sportProfiles', row);
  return s.db.must('sportProfiles', id);
}

// ---------------------------------------------------------------- public profile projection

/**
 * The ONLY shape in which one player's data is shown to another. Contact details, payment data,
 * restrictions, internal notes and audit metadata are never included (tested in tests/social.test.ts).
 */
export function publicProfile(s: Svc, input: { username: string }) {
  const p = profileByUsername(s, input.username);
  const viewer = s.actor.user?.id ?? null;
  const me = viewer === p.userId;
  const canProfile = canSee(s.db, p.visibility.profile, p.userId, viewer);
  const canActivity = canSee(s.db, p.visibility.activity, p.userId, viewer);
  const canRatings = canSee(s.db, p.visibility.ratings, p.userId, viewer);
  const outgoing = viewer ? activeFollow(s.db, viewer, p.userId) : undefined;
  const incoming = viewer ? activeFollow(s.db, p.userId, viewer) : undefined;
  const followers = s.db.count('follows', (f) => f.followeeId === p.userId && f.status === 'accepted');
  const following = s.db.count('follows', (f) => f.followerId === p.userId && f.status === 'accepted');
  const stats = canActivity && p.social.showSports ? sportStats(s, p.userId).filter((x) => x.sessions > 0 && !s.db.get('sportProfiles', `${p.userId}:${x.sport}`)?.hidden) : [];
  const sportCfgs = s.db.all('sports');
  return {
    username: p.username,
    displayName: p.displayName,
    avatarHue: p.avatarHue,
    me,
    bio: canProfile ? p.bio : '',
    city: canProfile ? p.city : '',
    limited: !canProfile,
    sports: stats.map((x) => {
      const prof = s.db.get('sportProfiles', `${p.userId}:${x.sport}`);
      return { sport: x.sport, name: x.name, icon: x.icon, sessions: x.sessions, games: x.games, lastPlayedAt: x.lastPlayedAt, skillLabel: canRatings && prof?.skill ? `${skillLabel(sportCfgs.find((c) => c.code === x.sport), prof.skill)} (self-declared)` : null };
    }),
    counts: { followers: p.social.showFollowers || me ? followers : null, following: p.social.showFollowing || me ? following : null },
    relationship: { following: outgoing?.status ?? null, followsYou: incoming?.status === 'accepted', followId: outgoing?.id ?? null },
    canFollow: !me && !!viewer && p.social.allowFollows,
    requiresApproval: p.social.requireApproval,
    memberSince: canProfile ? new Date(s.db.must('users', p.userId).createdAt).getUTCFullYear() : null,
  };
}

/** Player search by display name or username (signed-in users; discoverable profiles only). */
export function searchPlayers(s: Svc, input: { q: string }) {
  const u = requireUser(s);
  const q = (input.q ?? '').trim().toLowerCase().replace(/^@/, '');
  if (q.length < 2) return [];
  return s.db
    .filter('profiles', (p) => !!p.username && p.userId !== u.id && (p.displayName.toLowerCase().includes(q) || (p.username ?? '').toLowerCase().includes(q)))
    .filter((p) => s.db.get('users', p.userId)?.status === 'active' && !s.db.get('users', p.userId)?.platformRole && !isBlockedEitherWay(s.db, p.userId, u.id) && (p.social.discoverable || followsAccepted(s.db, u.id, p.userId)))
    .slice(0, 20)
    .map((p) => card(s, p, u.id));
}

function card(s: Svc, p: Profile, viewer: Id | null, reason?: string) {
  const out = viewer ? activeFollow(s.db, viewer, p.userId) : undefined;
  return { username: p.username!, displayName: p.displayName, avatarHue: p.avatarHue, following: out?.status ?? null, followsYou: viewer ? followsAccepted(s.db, p.userId, viewer) : false, ...(reason ? { reason } : {}) };
}

/** People you may know: shared Open Play sessions or events — only discoverable profiles; no times or places revealed unless their activity is public. */
export function discoverPlayers(s: Svc) {
  const u = requireUser(s);
  const mySessions = new Set(s.db.filter('opRegistrations', (r) => r.userId === u.id && r.status === 'confirmed').map((r) => r.sessionId));
  const myEvents = new Set(s.db.filter('registrations', (r) => r.userId === u.id).map((r) => r.eventId));
  const score = new Map<Id, { n: number; reason: string }>();
  for (const r of s.db.filter('opRegistrations', (x) => mySessions.has(x.sessionId) && x.userId !== u.id && x.status === 'confirmed')) {
    const cur = score.get(r.userId) ?? { n: 0, reason: '' };
    cur.n += 2;
    cur.reason = 'Played in the same Open Play session';
    score.set(r.userId, cur);
  }
  for (const r of s.db.filter('registrations', (x) => myEvents.has(x.eventId) && x.userId !== u.id)) {
    const cur = score.get(r.userId) ?? { n: 0, reason: 'Joined the same event' };
    cur.n += 1;
    score.set(r.userId, cur);
  }
  return [...score.entries()]
    .map(([id, v]) => ({ p: s.db.get('profiles', id), v }))
    .filter((x): x is { p: Profile; v: { n: number; reason: string } } => !!x.p && !!x.p.username && x.p.social.discoverable && !isBlockedEitherWay(s.db, x.p.userId, u.id) && !activeFollow(s.db, u.id, x.p.userId) && s.db.get('users', x.p.userId)?.status === 'active')
    .sort((a, b) => b.v.n - a.v.n)
    .slice(0, 8)
    .map((x) => card(s, x.p, u.id, x.p.visibility.activity === 'public' ? x.v.reason : 'Plays where you play'));
}

// ---------------------------------------------------------------- follow / unfollow / requests

export function followPlayer(s: Svc, input: { username: string }) {
  requireWritable(s);
  const u = requireUser(s);
  const p = profileByUsername(s, input.username);
  if (p.userId === u.id) fail('CONFLICT', "You can't follow yourself.");
  if (!p.social.allowFollows) fail('FOLLOW_NOT_ALLOWED', `${p.displayName} isn't accepting followers.`);
  const existing = activeFollow(s.db, u.id, p.userId);
  if (existing) fail('CONFLICT', existing.status === 'pending' ? 'Your follow request is pending.' : `You already follow ${p.displayName}.`);
  const recent = s.db.count('follows', (f) => f.followerId === u.id && f.createdAt > s.now - 60 * MINUTE);
  if (recent >= 60) fail('RATE_LIMITED', 'You are following people too quickly. Try again later.');
  const status: Follow['status'] = p.social.requireApproval ? 'pending' : 'accepted';
  const f: Follow = { id: newId('fol'), followerId: u.id, followeeId: p.userId, status, createdAt: s.now, respondedAt: status === 'accepted' ? s.now : null, endedAt: null };
  s.db.insert('follows', f);
  const me = s.db.get('profiles', u.id);
  notify(s, p.userId, 'social', status === 'pending' ? { title: 'New follow request', body: `${me?.displayName ?? 'A player'} (@${me?.username ?? ''}) wants to follow you.`, link: '#/app/follow-requests' } : { title: 'New follower', body: `${me?.displayName ?? 'A player'} (@${me?.username ?? ''}) started following you.`, link: `#/players/${me?.username ?? ''}` });
  return f;
}

export function unfollowPlayer(s: Svc, input: { username: string }) {
  requireWritable(s);
  const u = requireUser(s);
  const p = profileByUsername(s, input.username);
  const f = activeFollow(s.db, u.id, p.userId);
  if (!f) fail('NOT_FOUND', "You don't follow this player.");
  s.db.update('follows', f.id, (x) => {
    x.status = x.status === 'pending' ? 'cancelled' : 'removed';
    x.endedAt = s.now;
  });
  return { ok: true };
}

export function followRequests(s: Svc) {
  const u = requireUser(s);
  const pending = s.db.filter('follows', (f) => f.status === 'pending' && (f.followeeId === u.id || f.followerId === u.id));
  const toCard = (id: Id) => {
    const p = s.db.get('profiles', id);
    return p ? { username: p.username, displayName: p.displayName, avatarHue: p.avatarHue } : { username: null, displayName: displayName(s.db, id), avatarHue: 0 };
  };
  return {
    incoming: pending.filter((f) => f.followeeId === u.id && !isBlockedEitherWay(s.db, f.followerId, u.id)).map((f) => ({ id: f.id, createdAt: f.createdAt, from: toCard(f.followerId) })),
    outgoing: pending.filter((f) => f.followerId === u.id).map((f) => ({ id: f.id, createdAt: f.createdAt, to: toCard(f.followeeId) })),
  };
}

export function respondFollowRequest(s: Svc, input: { followId: Id; accept: boolean }) {
  requireWritable(s);
  const u = requireUser(s);
  const f = s.db.get('follows', input.followId);
  if (!f || f.followeeId !== u.id) fail('NOT_FOUND', 'Request not found.');
  if (f.status !== 'pending') fail('CONFLICT', 'This request was already handled.');
  s.db.update('follows', f.id, (x) => {
    x.status = input.accept ? 'accepted' : 'declined';
    x.respondedAt = s.now;
    if (!input.accept) x.endedAt = s.now;
  });
  if (input.accept) {
    const me = s.db.get('profiles', u.id);
    notify(s, f.followerId, 'social', { title: 'Follow request accepted', body: `You now follow ${me?.displayName ?? 'this player'}.`, link: `#/players/${me?.username ?? ''}` });
  }
  return s.db.must('follows', f.id);
}

export function removeFollower(s: Svc, input: { username: string }) {
  requireWritable(s);
  const u = requireUser(s);
  const p = profileByUsername(s, input.username);
  const f = activeFollow(s.db, p.userId, u.id);
  if (!f) fail('NOT_FOUND', 'That player does not follow you.');
  s.db.update('follows', f.id, (x) => {
    x.status = 'removed';
    x.endedAt = s.now;
  });
  return { ok: true };
}

export function followList(s: Svc, input: { username: string; kind: 'followers' | 'following' }) {
  const p = profileByUsername(s, input.username);
  const viewer = s.actor.user?.id ?? null;
  const me = viewer === p.userId;
  const allowed = me || ((input.kind === 'followers' ? p.social.showFollowers : p.social.showFollowing) && canSee(s.db, p.visibility.profile, p.userId, viewer));
  if (!allowed) fail('FORBIDDEN', `${p.displayName} keeps this list private.`);
  const rows = s.db.filter('follows', (f) => f.status === 'accepted' && (input.kind === 'followers' ? f.followeeId === p.userId : f.followerId === p.userId));
  return rows
    .map((f) => s.db.get('profiles', input.kind === 'followers' ? f.followerId : f.followeeId))
    .filter((x): x is Profile => !!x && !!x.username && !isBlockedEitherWay(s.db, x.userId, viewer) && s.db.get('users', x.userId)?.status === 'active')
    .map((x) => card(s, x, viewer));
}

// ---------------------------------------------------------------- blocks

export function blockPlayer(s: Svc, input: { username: string }) {
  requireWritable(s);
  const u = requireUser(s);
  const p = profileByUsername(s, input.username);
  if (p.userId === u.id) fail('CONFLICT', "You can't block yourself.");
  if (s.db.find('blocks', (b) => b.blockerId === u.id && b.blockedId === p.userId)) return { ok: true };
  s.db.insert('blocks', { id: newId('blk'), blockerId: u.id, blockedId: p.userId, createdAt: s.now });
  // Remove follow relationships in both directions (pending → cancelled, accepted → removed).
  for (const f of s.db.filter('follows', (x) => (x.status === 'pending' || x.status === 'accepted') && ((x.followerId === u.id && x.followeeId === p.userId) || (x.followerId === p.userId && x.followeeId === u.id)))) {
    s.db.update('follows', f.id, (x) => {
      x.status = x.status === 'pending' ? 'cancelled' : 'removed';
      x.endedAt = s.now;
    });
  }
  audit(s, { action: 'social.blocked', targetType: 'user', targetId: p.userId, summary: 'Blocked a player' });
  return { ok: true };
}

export function unblockPlayer(s: Svc, input: { username: string }) {
  requireWritable(s);
  const u = requireUser(s);
  const target = s.db.find('profiles', (x) => (x.username ?? '').toLowerCase() === (input.username ?? '').replace(/^@/, '').toLowerCase());
  const b = target ? s.db.find('blocks', (x) => x.blockerId === u.id && x.blockedId === target.userId) : undefined;
  if (!b) fail('NOT_FOUND', 'That player is not blocked.');
  s.db.remove('blocks', b.id);
  return { ok: true };
}

export function myBlocks(s: Svc) {
  const u = requireUser(s);
  return s.db.filter('blocks', (b) => b.blockerId === u.id).map((b) => {
    const p = s.db.get('profiles', b.blockedId);
    return { username: p?.username ?? null, displayName: p?.displayName ?? 'Player', since: b.createdAt };
  });
}

// ---------------------------------------------------------------- settings

export function updateSocialSettings(s: Svc, input: Partial<SocialSettings> & { username?: string }) {
  requireWritable(s);
  const u = requireUser(s);
  const p = s.db.must('profiles', u.id);
  if (input.username !== undefined && input.username.trim().toLowerCase() !== (p.username ?? '').toLowerCase()) {
    const name = input.username.trim().replace(/^@/, '').toLowerCase();
    const problem = usernameProblem(name);
    if (problem) invalid([{ field: 'username', message: problem }]);
    if (p.usernameChangedAt && s.now - p.usernameChangedAt < 30 * DAY) invalid([{ field: 'username', message: 'You can change your username once every 30 days.' }]);
    if (s.db.find('profiles', (x) => x.userId !== u.id && (x.username ?? '').toLowerCase() === name)) fail('USERNAME_TAKEN', `@${name} is taken.`, { fields: [{ field: 'username', message: 'That username is taken.' }] });
    s.db.update('profiles', u.id, (x) => {
      x.username = name;
      x.usernameChangedAt = s.now;
    });
  }
  const keys: (keyof SocialSettings)[] = ['discoverable', 'allowFollows', 'requireApproval', 'showFollowers', 'showFollowing', 'showSports'];
  s.db.update('profiles', u.id, (x) => {
    for (const k of keys) if (typeof input[k] === 'boolean') x.social[k] = input[k] as boolean;
  });
  // Turning approval on doesn't affect existing followers; turning follows off leaves existing followers until removed.
  return s.db.must('profiles', u.id);
}
