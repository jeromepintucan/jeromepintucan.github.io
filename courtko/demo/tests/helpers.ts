import { Api } from '../src/services/api.ts';
import { openStore } from '../src/services/boot.ts';
import { MemoryDriver, type Store } from '../src/services/store.ts';
import { runJobs, shiftSessions } from '../src/services/jobs.ts';

export interface Harness {
  store: Store;
  clock: { t: number; realNow(): number };
  tab(persona?: string): Promise<Tab>;
  jobs(): Promise<void>;
  advance(ms: number): Promise<void>;
}

export interface Tab {
  api: Api;
  token: string | null;
}

export async function harness(start = Date.UTC(2026, 8, 30, 2, 0)): Promise<Harness> {
  const clock = { t: start, realNow() { return this.t; } };
  const store = await openStore(new MemoryDriver(), { clock, passwordIterations: 1_000 });
  const h: Harness = {
    store,
    clock,
    async tab(persona?: string) {
      const tab: Tab = { token: null, api: null as unknown as Api };
      tab.api = new Api(store, () => ({ correlationId: '', ip: '203.0.113.7', device: `Test ${persona ?? 'anon'}`, sessionToken: tab.token }), { latency: false });
      if (persona) {
        const r = await tab.api.write('POST /demo/sign-in', { persona });
        tab.token = r.token;
      }
      return tab;
    },
    async jobs() {
      await runJobs(store);
    },
    async advance(ms: number) {
      clock.t += ms;
      await shiftSessions(store, ms);
      await runJobs(store);
    },
  };
  return h;
}
