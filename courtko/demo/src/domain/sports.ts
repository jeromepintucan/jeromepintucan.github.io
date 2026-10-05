/**
 * Sport catalog (change request CR-01, doc 24 CR-D01/D02). Sports are platform reference data managed by
 * SuperAdmin; shared code reads this catalog instead of hard-coding sport values. The initial release ships
 * exactly four active sports. Adding a sport later = adding a catalog entry with its format templates.
 */

export type SportCode = string;

/** Launch scope: exactly these four sports (doc 24 §2.1 out-of-scope: badminton, futsal and others). */
export const LAUNCH_SPORTS = ['pickleball', 'basketball', 'volleyball', 'tennis'] as const;

export type RegistrationMode = 'individual' | 'partner' | 'team';
export type OpenPlayStyle = 'recreational' | 'competitive' | 'beginner' | 'custom';
export type RotationStrategy = 'first_checked_in' | 'first_waiting' | 'manual' | 'random' | 'skill_based' | 'winner_stays' | 'timed';
export type LayoutKind = 'standard' | 'full' | 'half';

export const OPEN_PLAY_STYLE_LABEL: Record<OpenPlayStyle, string> = {
  recreational: 'Recreational',
  competitive: 'Competitive',
  beginner: 'Beginner-only',
  custom: 'Custom (venue-defined)',
};

export const ROTATION_LABEL: Record<RotationStrategy, string> = {
  first_checked_in: 'First checked in, first assigned',
  first_waiting: 'First waiting, first assigned',
  manual: 'Manual assignment',
  random: 'Random assignment',
  skill_based: 'Skill-based grouping',
  winner_stays: 'Winner stays',
  timed: 'Timed rotation',
};

export const REGISTRATION_MODE_LABEL: Record<RegistrationMode, string> = {
  individual: 'Individual',
  partner: 'With a partner',
  team: 'As a team',
};

export interface SportFormat {
  code: string;
  label: string;
  /** How players sign up for this format. */
  mode: RegistrationMode;
  /** Players on each side of one game. */
  playersPerSide: number;
  /** Team size range when the format is team-based (configurable per session within this range). */
  teamSize?: { min: number; max: number; default: number };
  /** Layout this format is played on (e.g. half court for 3x3). */
  layout?: LayoutKind;
  appliesTo: ('booking' | 'open_play')[];
}

export interface SportConfig {
  code: SportCode;
  name: string;
  description: string;
  /** Icon key (original line icon in ui/icons.ts). */
  icon: string;
  hue: number;
  status: 'active' | 'inactive';
  /** Court layouts this sport can be played on. */
  courtConfigurations: { code: LayoutKind; label: string; partial: boolean }[];
  formats: SportFormat[];
  minPlayers: number;
  maxPlayers: number;
  defaultDurationMinutes: number;
  skillLevels: { code: string; label: string }[];
  openPlay: {
    enabled: boolean;
    styles: OpenPlayStyle[];
    registrationModes: RegistrationMode[];
    defaultCapacity: number;
    defaultGameMinutes: number;
    rotationStrategies: RotationStrategy[];
  };
  matchResult: { enabled: boolean; unit: 'points' | 'games' | 'sets'; target: number; winBy: number; label: string };
  teamRequirement: 'none' | 'partner_for_doubles' | 'team_optional' | 'team_required';
  /** Generic name of one game for this sport (sport-neutral UI uses "game" unless a sport needs "match"). */
  gameNoun: 'game' | 'match';
  version: number;
  updatedAt: number;
  updatedBy: string | null;
}

const LEVELS = (labels: [string, string][]) => labels.map(([code, label]) => ({ code, label }));
const ALL_STRATEGIES: RotationStrategy[] = ['first_checked_in', 'first_waiting', 'manual', 'random', 'skill_based', 'winner_stays', 'timed'];

export function defaultSports(at: number, by: string | null): SportConfig[] {
  return [
    {
      code: 'pickleball',
      name: 'Pickleball',
      description: 'Fast, social paddle sport played as singles or doubles on a compact court. Open Play rotations are the heart of most venues.',
      icon: 'sport_pickleball',
      hue: 152,
      status: 'active',
      courtConfigurations: [{ code: 'standard', label: 'Pickleball court', partial: false }],
      formats: [
        { code: 'singles', label: 'Singles', mode: 'individual', playersPerSide: 1, appliesTo: ['booking', 'open_play'] },
        { code: 'doubles', label: 'Doubles', mode: 'partner', playersPerSide: 2, appliesTo: ['booking', 'open_play'] },
        { code: 'rotation', label: 'Open Play rotation (doubles)', mode: 'individual', playersPerSide: 2, appliesTo: ['open_play'] },
      ],
      minPlayers: 2,
      maxPlayers: 4,
      defaultDurationMinutes: 60,
      skillLevels: LEVELS([['beginner', 'Beginner (2.0–2.5)'], ['novice', 'Novice (3.0)'], ['intermediate', 'Intermediate (3.5)'], ['advanced', 'Advanced (4.0+)']]),
      openPlay: { enabled: true, styles: ['recreational', 'competitive', 'beginner', 'custom'], registrationModes: ['individual', 'partner'], defaultCapacity: 16, defaultGameMinutes: 15, rotationStrategies: ALL_STRATEGIES },
      matchResult: { enabled: true, unit: 'points', target: 11, winBy: 2, label: 'Games to 11, win by 2' },
      teamRequirement: 'partner_for_doubles',
      gameNoun: 'game',
      version: 1,
      updatedAt: at,
      updatedBy: by,
    },
    {
      code: 'basketball',
      name: 'Basketball',
      description: 'Full-court 5-on-5 or half-court 3-on-3. Book the whole court or one half, or join a pickup run as an individual or a team.',
      icon: 'sport_basketball',
      hue: 22,
      status: 'active',
      courtConfigurations: [
        { code: 'full', label: 'Full court', partial: false },
        { code: 'half', label: 'Half court', partial: true },
      ],
      formats: [
        { code: 'full_court', label: 'Full court (5-on-5)', mode: 'team', playersPerSide: 5, layout: 'full', teamSize: { min: 5, max: 8, default: 5 }, appliesTo: ['booking', 'open_play'] },
        { code: 'half_court', label: 'Half court (3-on-3)', mode: 'team', playersPerSide: 3, layout: 'half', teamSize: { min: 3, max: 5, default: 3 }, appliesTo: ['booking', 'open_play'] },
        { code: 'individual', label: 'Individual registration (pickup)', mode: 'individual', playersPerSide: 5, layout: 'full', appliesTo: ['open_play'] },
        { code: 'team', label: 'Team registration', mode: 'team', playersPerSide: 5, layout: 'full', teamSize: { min: 3, max: 10, default: 5 }, appliesTo: ['open_play'] },
      ],
      minPlayers: 2,
      maxPlayers: 20,
      defaultDurationMinutes: 120,
      skillLevels: LEVELS([['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced / competitive']]),
      openPlay: { enabled: true, styles: ['recreational', 'competitive', 'beginner', 'custom'], registrationModes: ['individual', 'team'], defaultCapacity: 20, defaultGameMinutes: 12, rotationStrategies: ALL_STRATEGIES },
      matchResult: { enabled: true, unit: 'points', target: 21, winBy: 2, label: 'First to 21, win by 2' },
      teamRequirement: 'team_optional',
      gameNoun: 'game',
      version: 1,
      updatedAt: at,
      updatedBy: by,
    },
    {
      code: 'volleyball',
      name: 'Volleyball',
      description: 'Indoor 6-on-6 on a full court. Sign up as an individual and get placed on a team, or bring your own squad.',
      icon: 'sport_volleyball',
      hue: 205,
      status: 'active',
      courtConfigurations: [{ code: 'full', label: 'Volleyball court', partial: false }],
      formats: [
        { code: 'full_court', label: 'Full court (6-on-6)', mode: 'team', playersPerSide: 6, layout: 'full', teamSize: { min: 4, max: 9, default: 6 }, appliesTo: ['booking', 'open_play'] },
        { code: 'individual', label: 'Individual registration', mode: 'individual', playersPerSide: 6, layout: 'full', appliesTo: ['open_play'] },
        { code: 'team', label: 'Team registration', mode: 'team', playersPerSide: 6, layout: 'full', teamSize: { min: 4, max: 9, default: 6 }, appliesTo: ['open_play'] },
      ],
      minPlayers: 4,
      maxPlayers: 18,
      defaultDurationMinutes: 120,
      skillLevels: LEVELS([['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']]),
      openPlay: { enabled: true, styles: ['recreational', 'competitive', 'beginner', 'custom'], registrationModes: ['individual', 'team'], defaultCapacity: 24, defaultGameMinutes: 20, rotationStrategies: ALL_STRATEGIES },
      matchResult: { enabled: true, unit: 'points', target: 25, winBy: 2, label: 'Sets to 25, win by 2' },
      teamRequirement: 'team_optional',
      gameNoun: 'match',
      version: 1,
      updatedAt: at,
      updatedBy: by,
    },
    {
      code: 'tennis',
      name: 'Tennis',
      description: 'Singles or doubles on hard or clay courts. Some venues convert tennis courts into pickleball courts at set times.',
      icon: 'sport_tennis',
      hue: 75,
      status: 'active',
      courtConfigurations: [{ code: 'standard', label: 'Tennis court', partial: false }],
      formats: [
        { code: 'singles', label: 'Singles', mode: 'individual', playersPerSide: 1, appliesTo: ['booking', 'open_play'] },
        { code: 'doubles', label: 'Doubles', mode: 'partner', playersPerSide: 2, appliesTo: ['booking', 'open_play'] },
        { code: 'rotation', label: 'Individual rotation (doubles)', mode: 'individual', playersPerSide: 2, appliesTo: ['open_play'] },
      ],
      minPlayers: 2,
      maxPlayers: 4,
      defaultDurationMinutes: 60,
      skillLevels: LEVELS([['beginner', 'Beginner (NTRP 2.0–2.5)'], ['intermediate', 'Intermediate (3.0–3.5)'], ['advanced', 'Advanced (4.0+)']]),
      openPlay: { enabled: true, styles: ['recreational', 'competitive', 'beginner', 'custom'], registrationModes: ['individual', 'partner'], defaultCapacity: 12, defaultGameMinutes: 30, rotationStrategies: ALL_STRATEGIES },
      matchResult: { enabled: true, unit: 'games', target: 6, winBy: 2, label: 'Sets to 6 games (tiebreak at 6–6)' },
      teamRequirement: 'partner_for_doubles',
      gameNoun: 'match',
      version: 1,
      updatedAt: at,
      updatedBy: by,
    },
  ];
}

// ---------------------------------------------------------------- validation helpers (server-side rules)

export function findFormat(sport: SportConfig, code: string): SportFormat | undefined {
  return sport.formats.find((f) => f.code === code);
}

/** CR-D02: a format is valid only if it belongs to the sport and applies to the requested use. */
export function formatAllowed(sport: SportConfig, code: string, use: 'booking' | 'open_play'): boolean {
  const f = findFormat(sport, code);
  return !!f && f.appliesTo.includes(use);
}

export function registrationModesFor(sport: SportConfig, format: SportFormat): RegistrationMode[] {
  if (format.mode === 'partner') return ['individual', 'partner'];
  if (format.mode === 'team') return sport.openPlay.registrationModes.includes('individual') ? ['team', 'individual'] : ['team'];
  return ['individual'];
}

/** Players needed on court for one game of this format. */
export function playersPerGame(format: SportFormat): number {
  return format.playersPerSide * 2;
}

export function skillLabel(sport: SportConfig | undefined, code: string | null | undefined): string {
  if (!code) return 'Any level';
  return sport?.skillLevels.find((l) => l.code === code)?.label ?? code.replace(/_/g, ' ');
}

export function sportName(sports: readonly SportConfig[], code: string | null | undefined): string {
  return sports.find((s) => s.code === code)?.name ?? (code ? code.replace(/^\w/, (c) => c.toUpperCase()) : 'Sport');
}
