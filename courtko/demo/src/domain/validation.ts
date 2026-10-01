/** Input validation shared by every service (server-side validation; the UI only mirrors it). */

import type { FieldError } from './errors.ts';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmail(email: string): boolean {
  const e = normalizeEmail(email);
  return e.length <= 254 && /^[^\s@<>()[\]\\,;:"]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(e);
}

/** Normalizes Philippine mobile numbers to E.164 (+639XXXXXXXXX); returns null if invalid. */
export function normalizePhMobile(input: string): string | null {
  const digits = input.replace(/[\s()-]/g, '');
  let m = /^\+639(\d{9})$/.exec(digits);
  if (m) return `+639${m[1]}`;
  m = /^639(\d{9})$/.exec(digits);
  if (m) return `+639${m[1]}`;
  m = /^09(\d{9})$/.exec(digits);
  if (m) return `+639${m[1]}`;
  return null;
}

export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  if (!domain) return '•••';
  return `${user.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

export function maskPhone(phone: string): string {
  return phone.length > 4 ? `${phone.slice(0, 4)} ••• ••${phone.slice(-2)}` : '•••';
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456789012', 'qwertyuiop12', 'iloveyou1234', 'pickleball123', 'pickleball2026',
  'courtko12345', 'abc123456789', 'letmein12345', 'welcome12345', 'philippines1', 'manila123456', 'admin1234567',
]);

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** NIST SP 800-63B style: length over composition rules, block common and context-specific passwords. */
export function passwordProblems(password: string, context: string[] = []): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN) problems.push(`Use at least ${PASSWORD_MIN} characters.`);
  if (password.length > PASSWORD_MAX) problems.push(`Use at most ${PASSWORD_MAX} characters.`);
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) problems.push('This password is too common.');
  if (/^(.)\1+$/.test(password)) problems.push('Avoid repeating a single character.');
  for (const c of context) {
    const token = c.toLowerCase().split('@')[0] ?? '';
    if (token.length >= 4 && lower.includes(token)) {
      problems.push("Don't include your name or email in your password.");
      break;
    }
  }
  return problems;
}

export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0;
  let score = 0;
  if (password.length >= PASSWORD_MIN) score++;
  if (password.length >= 16) score++;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes >= 3) score++;
  if (classes === 4 && password.length >= 14) score++;
  if (COMMON_PASSWORDS.has(password.toLowerCase())) score = 0;
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}

export function requireText(errors: FieldError[], field: string, value: unknown, label: string, opts: { min?: number; max?: number } = {}): string {
  const text = typeof value === 'string' ? value.trim() : '';
  const min = opts.min ?? 1;
  const max = opts.max ?? 200;
  if (text.length < min) errors.push({ field, message: min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.` });
  else if (text.length > max) errors.push({ field, message: `${label} must be at most ${max} characters.` });
  return text;
}

export function optionalText(errors: FieldError[], field: string, value: unknown, label: string, max = 2000): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > max) errors.push({ field, message: `${label} must be at most ${max} characters.` });
  return text;
}

export function requireInt(errors: FieldError[], field: string, value: unknown, label: string, opts: { min?: number; max?: number } = {}): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isInteger(n)) {
    errors.push({ field, message: `${label} must be a whole number.` });
    return 0;
  }
  if (opts.min !== undefined && n < opts.min) errors.push({ field, message: `${label} must be at least ${opts.min}.` });
  if (opts.max !== undefined && n > opts.max) errors.push({ field, message: `${label} must be at most ${opts.max}.` });
  return n;
}

export function oneOf<T extends string>(errors: FieldError[], field: string, value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  errors.push({ field, message: `Choose a valid ${label.toLowerCase()}.` });
  return allowed[0]!;
}

/** Allowed upload types and size for verification documents (doc 14 secure uploads). */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export function validateUpload(file: { name: string; size: number; type: string }): string | null {
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) return 'Upload a PDF, JPG or PNG file.';
  if (file.size <= 0) return 'The file is empty.';
  if (file.size > UPLOAD_MAX_BYTES) return 'Files must be 10 MB or smaller.';
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(file.name) || file.name.length > 120) return 'Rename the file using letters, numbers, dashes or underscores.';
  return null;
}
