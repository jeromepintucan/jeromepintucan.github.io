/**
 * Canonical error codes (design doc 13 §2.4). The API layer renders AppError as RFC 9457 problem details.
 */

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'MFA_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SLOT_UNAVAILABLE'
  | 'HOLD_EXPIRED'
  | 'HOLD_LIMIT_REACHED'
  | 'BOOKING_NOT_ALLOWED'
  | 'QUOTE_EXPIRED'
  | 'PROMO_INVALID'
  | 'POLICY_NOT_ACCEPTED'
  | 'PAYMENT_METHOD_UNAVAILABLE'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'OUT_OF_STOCK'
  | 'EVENT_FULL'
  | 'INVALID_STATE_TRANSITION'
  | 'SUPPORT_MODE_READ_ONLY'
  | 'APPROVAL_REQUIRED'
  | 'ACCOUNT_LOCKED'
  | 'INTERNAL';

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  MFA_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SLOT_UNAVAILABLE: 409,
  HOLD_EXPIRED: 410,
  HOLD_LIMIT_REACHED: 429,
  BOOKING_NOT_ALLOWED: 403,
  QUOTE_EXPIRED: 409,
  PROMO_INVALID: 422,
  POLICY_NOT_ACCEPTED: 422,
  PAYMENT_METHOD_UNAVAILABLE: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  IDEMPOTENCY_IN_PROGRESS: 409,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 503,
  OUT_OF_STOCK: 409,
  EVENT_FULL: 409,
  INVALID_STATE_TRANSITION: 409,
  SUPPORT_MODE_READ_ONLY: 403,
  APPROVAL_REQUIRED: 403,
  ACCOUNT_LOCKED: 423,
  INTERNAL: 500,
};

export const ERROR_TITLE: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'Please check the highlighted fields',
  UNAUTHENTICATED: 'Please sign in to continue',
  MFA_REQUIRED: 'Two-step verification required',
  FORBIDDEN: "You don't have access to this action",
  NOT_FOUND: 'Not found',
  CONFLICT: 'This change conflicts with existing data',
  SLOT_UNAVAILABLE: 'That time was just taken',
  HOLD_EXPIRED: 'Your hold has expired',
  HOLD_LIMIT_REACHED: 'Too many checkouts in progress',
  BOOKING_NOT_ALLOWED: "Booking isn't available for your account here",
  QUOTE_EXPIRED: 'The price quote has expired',
  PROMO_INVALID: "That promo code can't be applied",
  POLICY_NOT_ACCEPTED: 'Please accept the cancellation policy',
  PAYMENT_METHOD_UNAVAILABLE: 'That payment method is unavailable',
  IDEMPOTENCY_KEY_REUSED: 'This request was already used with different details',
  IDEMPOTENCY_IN_PROGRESS: 'This request is still being processed',
  RATE_LIMITED: 'Too many attempts — please wait a moment',
  PROVIDER_UNAVAILABLE: 'Payments are temporarily unavailable',
  OUT_OF_STOCK: 'An item is out of stock',
  EVENT_FULL: 'This event is full',
  INVALID_STATE_TRANSITION: "That action isn't possible right now",
  SUPPORT_MODE_READ_ONLY: 'Support mode is read-only',
  APPROVAL_REQUIRED: 'A second approval is required',
  ACCOUNT_LOCKED: 'Account temporarily locked',
  INTERNAL: 'Something went wrong',
};

export interface FieldError {
  field: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly title: string;
  readonly fields: FieldError[];
  readonly meta: Record<string, unknown>;

  constructor(code: ErrorCode, detail?: string, opts: { fields?: FieldError[]; meta?: Record<string, unknown> } = {}) {
    super(detail ?? ERROR_TITLE[code]);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.title = ERROR_TITLE[code];
    this.fields = opts.fields ?? [];
    this.meta = opts.meta ?? {};
  }
}

export function fail(code: ErrorCode, detail?: string, opts?: { fields?: FieldError[]; meta?: Record<string, unknown> }): never {
  throw new AppError(code, detail, opts);
}

export function invalid(fields: FieldError[], detail?: string): never {
  throw new AppError('VALIDATION_FAILED', detail ?? fields.map((f) => f.message).join(' '), { fields });
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** RFC 9457 problem details for display in the API inspector. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: ErrorCode;
  correlationId: string;
  errors?: FieldError[];
}

export function toProblem(e: unknown, correlationId: string): ProblemDetails {
  if (isAppError(e)) {
    return {
      type: `https://docs.courtko.example/errors/${e.code.toLowerCase().replace(/_/g, '-')}`,
      title: e.title,
      status: e.status,
      detail: e.message,
      code: e.code,
      correlationId,
      ...(e.fields.length ? { errors: e.fields } : {}),
    };
  }
  return {
    type: 'https://docs.courtko.example/errors/internal',
    title: ERROR_TITLE.INTERNAL,
    status: 500,
    detail: 'An unexpected error occurred. The team has been notified.',
    code: 'INTERNAL',
    correlationId,
  };
}
