/**
 * Payment-gateway failure catalog (doc 08 §6). Maps provider failure codes to what the player sees, what they
 * should do next and what staff need to know. Codes follow the provider's naming (Xendit-style, illustrative —
 * the production adapter maps the provider's actual codes onto these). Player copy never reveals risk/fraud
 * signals: a card flagged by the issuer is shown as a plain decline.
 */

export type FailureCategory = 'customer' | 'funds' | 'issuer' | 'authentication' | 'risk' | 'provider' | 'timeout';
export type FailureRetry = 'same_method' | 'other_method' | 'later' | 'contact_issuer';

export interface FailureInfo {
  code: string;
  category: FailureCategory;
  retry: FailureRetry;
  /** Short player-facing title. */
  title: string;
  /** Player-facing explanation (no jargon, no blame). */
  message: string;
  /** Concrete next step for the player. */
  nextStep: string;
  /** Internal note for staff and support. */
  staffNote: string;
}

const f = (code: string, category: FailureCategory, retry: FailureRetry, title: string, message: string, nextStep: string, staffNote: string): FailureInfo => ({ code, category, retry, title, message, nextStep, staffNote });

export const PAYMENT_FAILURES: Record<string, FailureInfo> = {
  INSUFFICIENT_BALANCE: f('INSUFFICIENT_BALANCE', 'funds', 'other_method', 'Not enough balance', "Your e-wallet or account didn't have enough balance for this payment. You were not charged.", 'Top up and try again, or pay with another method.', 'Customer-side decline. No action needed.'),
  USER_DECLINED_PAYMENT: f('USER_DECLINED_PAYMENT', 'customer', 'same_method', 'Payment declined in the app', 'The payment was declined in your e-wallet app. You were not charged.', 'Try again and approve the payment in the app.', 'Customer declined in the wallet app.'),
  USER_CANCELLED: f('USER_CANCELLED', 'customer', 'same_method', 'Payment cancelled', 'You cancelled the payment on the payment page. You were not charged.', 'Try again whenever you are ready — your hold is kept until the timer ends.', 'Customer cancelled on the hosted page.'),
  MAXIMUM_LIMIT_EXCEEDED: f('MAXIMUM_LIMIT_EXCEEDED', 'funds', 'other_method', 'Wallet limit reached', 'This payment is over your e-wallet’s daily or monthly limit. You were not charged.', 'Use a card, QR Ph or another wallet. Fully verifying your wallet account usually raises the limit.', 'Wallet transaction limit (KYC tier). Suggest another method.'),
  ACCOUNT_ACCESS_BLOCKED: f('ACCOUNT_ACCESS_BLOCKED', 'customer', 'other_method', 'E-wallet account unavailable', "Your e-wallet account can't make payments right now. You were not charged.", 'Contact your e-wallet provider, or pay with another method.', 'Wallet account restricted by the wallet provider.'),
  OTP_EXPIRED: f('OTP_EXPIRED', 'authentication', 'same_method', 'Verification timed out', "The one-time PIN wasn't entered in time. You were not charged.", 'Try again and enter the OTP within a few minutes.', 'OTP/authorisation timeout.'),
  AUTHENTICATION_FAILED: f('AUTHENTICATION_FAILED', 'authentication', 'same_method', 'Card verification failed', "Your bank couldn't verify the payment (3-D Secure). You were not charged.", 'Try again and complete the verification in your banking app, or use another card.', '3-D Secure failed or abandoned.'),
  CARD_DECLINED: f('CARD_DECLINED', 'issuer', 'contact_issuer', 'Card declined by your bank', 'Your bank declined this card payment. You were not charged.', 'Use another card or method, or contact your bank.', 'Generic issuer decline (do not retry repeatedly).'),
  EXPIRED_CARD: f('EXPIRED_CARD', 'issuer', 'other_method', 'Card expired', 'This card has expired. You were not charged.', 'Use another card or payment method.', 'Expired card.'),
  INVALID_CVV: f('INVALID_CVV', 'customer', 'same_method', 'Security code incorrect', "The card's security code (CVC) didn't match. You were not charged.", 'Check the 3-digit code on the back of the card and try again.', 'CVC mismatch.'),
  SUSPECTED_FRAUD: f('SUSPECTED_FRAUD', 'risk', 'contact_issuer', 'Card declined by your bank', 'Your bank declined this card payment. You were not charged.', 'Use another payment method, or contact your bank.', 'Issuer/provider risk decline. Do not override or advise retries; repeated attempts are rate-limited.'),
  PROCESSOR_ERROR: f('PROCESSOR_ERROR', 'provider', 'later', 'Payment channel error', 'The payment channel had a technical problem. You were not charged.', 'Try again in a minute, or use another method.', 'Provider/acquirer error — monitored as a provider incident.'),
  CHANNEL_UNAVAILABLE: f('CHANNEL_UNAVAILABLE', 'provider', 'other_method', 'Payment method temporarily unavailable', 'This payment method is having problems right now. You were not charged.', 'Please choose another method. Your hold is kept.', 'Channel outage reported by the provider.'),
  USER_UNREACHABLE: f('USER_UNREACHABLE', 'timeout', 'same_method', 'No response from your app', "We didn't get a response from your e-wallet app in time. You were not charged.", 'Make sure the app is open and try again.', 'Wallet push not acknowledged.'),
  SESSION_EXPIRED: f('SESSION_EXPIRED', 'timeout', 'same_method', 'Payment page timed out', 'The payment page expired before the payment was completed. You were not charged.', 'Start the payment again while your hold is active.', 'Hosted session expired unpaid.'),
  MERCHANT_CANCELLED: f('MERCHANT_CANCELLED', 'customer', 'same_method', 'Replaced by a newer attempt', 'This payment attempt was replaced by a newer one.', 'Continue with the latest attempt.', 'Superseded attempt (platform cancelled the old session).'),
};

const GENERIC = f('UNKNOWN', 'provider', 'later', 'Payment not completed', "The payment didn't go through. You were not charged.", 'Try again, or choose another method.', 'Unmapped provider code — add it to the catalog.');

export function paymentFailure(code: string | null | undefined): FailureInfo {
  return (code && PAYMENT_FAILURES[code]) || GENERIC;
}

/** Sandbox hosted-page test outcomes (stand-ins for the provider's published test values). */
export const WALLET_TEST_OUTCOMES = ['INSUFFICIENT_BALANCE', 'USER_DECLINED_PAYMENT', 'MAXIMUM_LIMIT_EXCEEDED', 'OTP_EXPIRED', 'USER_UNREACHABLE'] as const;
export const BANK_TEST_OUTCOMES = ['INSUFFICIENT_BALANCE', 'OTP_EXPIRED', 'PROCESSOR_ERROR'] as const;
export const TEST_CARDS: { number: string; label: string; outcome: 'success' | '3ds' | 'international' | string }[] = [
  { number: '4242 4242 4242 4242', label: 'Success', outcome: 'success' },
  { number: '4000 0000 0000 3220', label: '3-D Secure challenge', outcome: '3ds' },
  { number: '4000 0566 5566 5556', label: 'International card (higher fee)', outcome: 'international' },
  { number: '4000 0000 0000 0002', label: 'Declined by bank', outcome: 'CARD_DECLINED' },
  { number: '4000 0000 0000 9995', label: 'Insufficient funds', outcome: 'INSUFFICIENT_BALANCE' },
  { number: '4000 0000 0000 0069', label: 'Expired card', outcome: 'EXPIRED_CARD' },
  { number: '4000 0000 0000 0127', label: 'Incorrect CVC', outcome: 'INVALID_CVV' },
  { number: '4100 0000 0000 0019', label: 'Issuer risk decline', outcome: 'SUSPECTED_FRAUD' },
  { number: '4000 0000 0000 0119', label: 'Processor error', outcome: 'PROCESSOR_ERROR' },
];

export interface OpsFailureInfo {
  code: string;
  title: string;
  staffNote: string;
  /** What resolves it: automatic retry, a manual retry, an alternate route, or fixing account details. */
  action: 'retry' | 'manual_route' | 'auto_retry' | 'fix_account';
}

const o = (code: string, title: string, staffNote: string, action: OpsFailureInfo['action']): OpsFailureInfo => ({ code, title, staffNote, action });

export const REFUND_FAILURES: Record<string, OpsFailureInfo> = {
  REFUND_REJECTED_BY_CHANNEL: o('REFUND_REJECTED_BY_CHANNEL', 'Rejected by the payment channel', 'The wallet/bank rejected the refund (e.g. account closed). Retry once; if it fails again, refund by bank transfer and record the reference.', 'retry'),
  REFUND_NOT_SUPPORTED: o('REFUND_NOT_SUPPORTED', 'Channel does not support API refunds', 'Some channels (e.g. QR Ph / InstaPay transfers, older payments) cannot be refunded through the API. Send the money by bank transfer and record the reference here.', 'manual_route'),
  INSUFFICIENT_BALANCE: o('INSUFFICIENT_BALANCE', 'Provider balance too low', 'The provider balance could not cover the refund. It is retried automatically after the next settlement; you can also retry now.', 'auto_retry'),
  REFUND_WINDOW_EXPIRED: o('REFUND_WINDOW_EXPIRED', 'Refund window expired', 'The channel only accepts refunds within its time window. Refund by bank transfer and record the reference.', 'manual_route'),
};

export const PAYOUT_FAILURES: Record<string, OpsFailureInfo> = {
  INVALID_DESTINATION_ACCOUNT: o('INVALID_DESTINATION_ACCOUNT', 'Bank account not found', 'The destination account number was rejected. The venue must update and re-verify its payout account before a retry.', 'fix_account'),
  ACCOUNT_NAME_MISMATCH: o('ACCOUNT_NAME_MISMATCH', 'Account name does not match', 'The bank rejected the transfer because the account name differs from the registered business name.', 'fix_account'),
  BANK_TEMPORARILY_UNAVAILABLE: o('BANK_TEMPORARILY_UNAVAILABLE', 'Bank temporarily unavailable', 'The receiving bank was offline (e.g. maintenance window). Retry later.', 'retry'),
};

export function refundFailure(code: string | null | undefined): OpsFailureInfo {
  return (code && REFUND_FAILURES[code]) || o(code ?? 'UNKNOWN', 'Refund failed', 'Unmapped provider code — retry, then escalate to the provider.', 'retry');
}

export function payoutFailure(code: string | null | undefined): OpsFailureInfo {
  return (code && PAYOUT_FAILURES[code]) || o(code ?? 'UNKNOWN', 'Payout failed', 'Unmapped provider code — check the payout account and retry.', 'retry');
}
