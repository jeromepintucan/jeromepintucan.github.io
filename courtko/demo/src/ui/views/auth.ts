/** Sign in (with MFA), sign up with verification, password reset. Demo accounts are listed for presenters. */

import { passwordStrength } from '../../domain/validation.ts';
import { PERSONAS } from '../../services/seed.ts';
import { DEMO_PASSWORD } from '../../services/auth.ts';
import { action, app, form, route, str } from '../app.ts';
import { alertBox, btn, card, checkbox, field } from '../components.ts';
import { html } from '../html.ts';
import { icon } from '../icons.ts';

function next(): string {
  const n = new URLSearchParams(location.hash.split('?')[1] ?? '').get('next');
  return n && n.startsWith('/') ? `#${n}` : '';
}

export function landingFor(): string {
  const me = app.me();
  if (!me) return '#/';
  if (me.user.platformRole) return '#/admin';
  if (me.memberships.length && me.user.persona && ['owner', 'manager', 'receptionist', 'applicant'].includes(me.user.persona)) return '#/biz';
  return '#/app';
}

route('/login', 'auth', 'Sign in', () => {
  const mfa = app.ui.mfaChallenge as { token: string; identifier: string } | undefined;
  if (mfa) {
    let demo: { code: string | null; secondsLeft: number } = { code: null, secondsLeft: 0 };
    try {
      demo = app.api.read('GET /demo/authenticator-code', { identifier: mfa.identifier });
    } catch {
      /* not a demo persona */
    }
    return card(html`<h1>Two-step verification</h1><p class="muted">Enter the 6-digit code from your authenticator app.</p>
    <form data-form="auth.mfa" class="stack-sm">${field({ name: 'code', label: 'Authenticator code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 9, required: true, hint: 'You can also use a recovery code (XXXX-XXXX).' })}${btn('Verify and sign in', { type: 'submit', variant: 'primary', block: true, size: 'lg' })}</form>
    ${demo.code ? alertBox('info', html`Demo authenticator: <code style="font-size:1.1rem">${demo.code}</code>`, html`This helper shows the real TOTP code for demo personas (RFC 6238). In production the code comes only from the user's own device. <span class="xs">Refreshes every 30 s.</span>`) : ''}
    ${btn('Use a different account', { action: 'auth.cancelMfa', variant: 'ghost', block: true })}`);
  }
  return html`${card(html`<h1>Welcome back</h1><p class="muted">Sign in to book courts and manage your games.</p>
  <form data-form="auth.login" class="stack-sm">${field({ name: 'identifier', label: 'Email or mobile number', autocomplete: 'username', required: true, placeholder: 'you@example.com or 0917 000 0001' })}${field({ name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password', required: true })}
  <div class="row-between"><a href="#/forgot" class="small">Forgot password?</a></div>${btn('Sign in', { type: 'submit', variant: 'primary', block: true, size: 'lg' })}</form>
  <div class="divider-label">or</div>${btn('Continue with Google', { action: 'auth.google', variant: 'secondary', block: true })}
  <p class="small center" style="margin-top:14px">New to CourtKo? <a href="#/signup">Create an account</a></p>`)}
  <div style="margin-top:16px">${card(html`<p class="small muted">All demo accounts use the password <code>${DEMO_PASSWORD}</code>. One-click sign-in still verifies the stored password hash and a real TOTP code.</p><div class="stack-sm">${PERSONAS.map((p) => html`<button class="method" data-action="auth.persona" data-persona="${p.key}"><span class="avatar" style="width:34px;height:34px;background:hsl(${(p.key.charCodeAt(0) * 37) % 360},45%,35%);font-size:13px">${p.first[0]}${p.last.split(' ').pop()![0]}</span><span class="method-body"><b>${p.first} ${p.last}</b> <span class="pill">${p.label}</span><span class="method-fee block">${p.description}${p.mfa ? ' · MFA' : ''}</span></span>${icon('chevronRight', 16)}</button>`)}</div>`, { title: 'Demo accounts' })}</div>`;
});

form('auth.login', async (fd) => {
  const identifier = str(fd, 'identifier');
  const r = await app.api.write('POST /v1/auth/login', { identifier, password: String(fd.get('password') ?? '') });
  if (r.status === 'mfa_required') {
    app.set('mfaChallenge', { token: r.challengeToken, identifier });
    return;
  }
  if (r.status === 'verify_required') {
    app.ui.verify = { id: r.verificationId, demoCode: r.demoCode, destination: identifier };
    app.navigate('#/verify');
    return;
  }
  signedIn(r.token, r.mfaSetupRequired);
});
form('auth.mfa', async (fd) => {
  const c = app.ui.mfaChallenge as { token: string };
  const r = await app.api.write('POST /v1/auth/mfa/verify', { challengeToken: c.token, code: str(fd, 'code') });
  app.ui.mfaChallenge = undefined;
  signedIn(r.token, false);
});
action('auth.cancelMfa', () => app.set('mfaChallenge', undefined));
action('auth.google', () => app.toast('Google sign-in (OIDC) is part of the production build — use a demo account here.', 'info'));
action('auth.persona', async (el) => {
  const r = await app.run(el, () => app.api.write('POST /demo/sign-in', { persona: el.dataset.persona! }));
  if (r) signedIn(r.token, false);
});

export function signedIn(token: string, mfaSetupRequired: boolean): void {
  app.token = token;
  app.businessId = null;
  app.venueId = null;
  app.ui = {};
  const me = app.me();
  app.toast(`Signed in as ${me?.profile?.displayName ?? 'you'}`, 'success');
  if (mfaSetupRequired) app.toast('Your role requires two-step verification. Set it up in Settings → Security.', 'warning');
  app.navigate(next() || landingFor());
}

route('/signup', 'auth', 'Create account', () => card(html`<h1>Create your account</h1><p class="muted">Book courts, join events and track your games.</p>
  <form data-form="auth.signup" class="stack-sm"><div class="form-grid">${field({ name: 'firstName', label: 'First name', required: true, autocomplete: 'given-name' })}${field({ name: 'lastName', label: 'Last name', required: true, autocomplete: 'family-name' })}</div>
  ${field({ name: 'email', label: 'Email', type: 'email', autocomplete: 'email', hint: 'Or leave blank and use your mobile number.' })}${field({ name: 'phone', label: 'Mobile number', type: 'tel', autocomplete: 'tel', placeholder: '0917 000 0000', inputmode: 'tel' })}
  ${field({ name: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', required: true, hint: 'At least 12 characters. A short phrase works well, e.g. “Rally at the kitchen line”.' })}
  <div class="bar-inline" aria-hidden="true"><span id="pw-meter" style="width:0%"></span></div>
  ${checkbox({ name: 'acceptTerms', label: html`I agree to the <a href="#/terms" target="_blank">Terms of Service</a>`, required: true })}${checkbox({ name: 'acceptPrivacy', label: html`I have read the <a href="#/privacy" target="_blank">Privacy Notice</a>`, required: true })}${checkbox({ name: 'marketingOptIn', label: 'Send me promos and event news (optional)' })}
  ${btn('Create account', { type: 'submit', variant: 'primary', block: true, size: 'lg' })}</form><p class="small center" style="margin-top:12px">Already have an account? <a href="#/login">Sign in</a></p>`));

document.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.name === 'password' && el.form?.dataset.form === 'auth.signup') {
    const m = document.getElementById('pw-meter');
    if (m) {
      const s = passwordStrength(el.value);
      m.style.width = `${s * 25}%`;
      m.style.background = s <= 1 ? 'var(--ck-color-danger)' : s === 2 ? 'var(--ck-color-warning)' : 'var(--ck-color-success)';
    }
  }
});

form('auth.signup', async (fd) => {
  const r = await app.api.write('POST /v1/auth/register', {
    firstName: str(fd, 'firstName'),
    lastName: str(fd, 'lastName'),
    email: str(fd, 'email') || undefined as never,
    phone: str(fd, 'phone') || undefined as never,
    password: String(fd.get('password') ?? ''),
    acceptTerms: fd.get('acceptTerms') === 'on',
    acceptPrivacy: fd.get('acceptPrivacy') === 'on',
    marketingOptIn: fd.get('marketingOptIn') === 'on',
  });
  app.ui.verify = { id: r.verificationId, demoCode: r.demoCode, destination: r.destination };
  app.navigate('#/verify');
});

route('/verify', 'auth', 'Verify your account', () => {
  const v = app.ui.verify as { id: string; demoCode: string | null; destination: string } | undefined;
  if (!v) return card(html`<h1>Nothing to verify</h1>${btn('Sign in', { href: '#/login', variant: 'primary' })}`);
  return card(html`<h1>Check your messages</h1><p class="muted">We sent a 6-digit code to <b>${v.destination}</b>. It expires in 10 minutes.</p>
  <form data-form="auth.verify" class="stack-sm">${field({ name: 'code', label: 'Verification code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, required: true })}${btn('Verify', { type: 'submit', variant: 'primary', block: true, size: 'lg' })}</form>
  ${v.demoCode ? alertBox('info', html`Demo: your code is <code style="font-size:1.1rem">${v.demoCode}</code>`, 'In production this code arrives only by email or SMS. Codes are stored hashed, expire in 10 minutes and allow 5 attempts.') : alertBox('info', 'Didn’t get a code?', 'If an account already exists for these details, we notified its owner instead (so sign-up can’t be used to discover who has an account).')}`);
});
form('auth.verify', async (fd) => {
  const v = app.ui.verify as { id: string };
  const r = await app.api.write('POST /v1/auth/verify-contact', { verificationId: v.id, code: str(fd, 'code') });
  app.ui.verify = undefined;
  signedIn(r.token, false);
});

route('/forgot', 'auth', 'Reset password', () => {
  const reset = app.ui.reset as { id: string; demoCode: string | null } | undefined;
  if (reset)
    return card(html`<h1>Set a new password</h1><form data-form="auth.reset" class="stack-sm">${field({ name: 'code', label: 'Code from your email/SMS', inputmode: 'numeric', required: true })}${field({ name: 'newPassword', label: 'New password', type: 'password', autocomplete: 'new-password', required: true, hint: 'At least 12 characters.' })}${btn('Update password', { type: 'submit', variant: 'primary', block: true })}</form>${reset.demoCode ? alertBox('info', html`Demo: reset code <code>${reset.demoCode}</code>`, 'Resetting signs you out of every device and sends a security alert.') : ''}`);
  return card(html`<h1>Forgot your password?</h1><p class="muted">Enter your email or mobile number. If an account exists, we'll send a reset code.</p><form data-form="auth.forgot" class="stack-sm">${field({ name: 'identifier', label: 'Email or mobile number', required: true, autocomplete: 'username' })}${btn('Send reset code', { type: 'submit', variant: 'primary', block: true })}</form>`);
});
form('auth.forgot', async (fd) => {
  const r = await app.api.write('POST /v1/auth/password-reset/request', { identifier: str(fd, 'identifier') });
  app.set('reset', { id: r.verificationId, demoCode: r.demoCode });
  app.toast('If an account exists, a reset code was sent.', 'info');
});
form('auth.reset', async (fd) => {
  const r = app.ui.reset as { id: string };
  await app.api.write('POST /v1/auth/password-reset/confirm', { verificationId: r.id, code: str(fd, 'code'), newPassword: String(fd.get('newPassword') ?? '') });
  app.ui.reset = undefined;
  app.toast('Password updated. Please sign in.', 'success');
  app.navigate('#/login');
});

action('auth.logout', async () => {
  try {
    await app.api.write('POST /v1/auth/logout', undefined as never);
  } catch {
    /* already signed out */
  }
  app.token = null;
  app.ui = {};
  app.navigate('#/');
});
