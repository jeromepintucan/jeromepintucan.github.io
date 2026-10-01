/** Demo entry point: opens the in-browser store, wires the API layer and starts the UI. */

import { Api } from './services/api.ts';
import { openStore } from './services/boot.ts';
import { browserDriver } from './services/store.ts';
import { app } from './ui/app.ts';
import './ui/layouts.ts';
import './ui/views/public.ts';
import './ui/views/auth.ts';
import './ui/views/player.ts';
import './ui/views/booking.ts';
import './ui/views/pay.ts';
import './ui/views/business.ts';
import './ui/views/business-ops.ts';
import './ui/views/business-setup.ts';
import './ui/views/business-money.ts';
import './ui/views/admin.ts';
import './ui/views/admin-money.ts';
import { mountPresenter } from './ui/views/presenter.ts';

async function main(): Promise<void> {
  const root = document.getElementById('app')!;
  // Let the page finish loading and paint the splash before generating the synthetic data (~1–2 s).
  await new Promise<void>((resolve) => (document.readyState === 'complete' ? setTimeout(resolve, 16) : window.addEventListener('load', () => setTimeout(resolve, 16), { once: true })));
  try {
    const store = await openStore(browserDriver('courtko-demo'));
    const api = new Api(store, () => ({ correlationId: '', ip: app.ip, device: app.device, sessionToken: app.token }), { latency: store.state.settings.platform?.demo.latency !== 'fast' });
    // "Open as persona in a new tab" support: #/…?as=owner
    const m = /[?&]as=([a-z0-9]+)/.exec(location.hash);
    if (m) {
      try {
        const r = await api.write('POST /demo/sign-in', { persona: m[1]! }, { silent: true });
        app.token = r.token;
        app.businessId = null;
        app.venueId = null;
      } catch (e) {
        console.error(e);
      }
      location.replace(location.hash.replace(/[?&]as=[a-z0-9]+/, ''));
    }
    await app.start(store, api, root);
    mountPresenter();
    if (!store.driver.persistent) app.toast("This viewer doesn't allow browser storage, so changes won't persist after reload. Open the file in Chrome or Edge for the full demo.", 'warning');
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="state-panel"><h1>The demo couldn't start</h1><p>${e instanceof Error ? e.message.replace(/</g, '&lt;') : 'Unknown error'}</p><p class="muted">Try reloading, or open the file in Chrome or Edge.</p></div>`;
  }
}

void main();
