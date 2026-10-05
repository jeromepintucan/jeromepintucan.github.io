/** Store bootstrap: deterministic synthetic base + first-run initialization (persona password hashes). */

import { hashPassword } from '../domain/crypto.ts';
import { localDate } from '../domain/time.ts';
import { DEMO_PASSWORD } from './auth.ts';
import { generateSeed } from './seed.ts';
import { Store, type Clock, type StorageDriver } from './store.ts';

export const BUILD_ID = 'courtko-demo-2026.10.06-multisport';
export const SCHEMA_VERSION = 4;

export function openStore(driver: StorageDriver, opts: { clock?: Clock; passwordIterations?: number } = {}): Promise<Store> {
  return Store.open(driver, {
    buildId: BUILD_ID,
    schema: SCHEMA_VERSION,
    generate: generateSeed,
    seedDateFor: (now) => localDate(now),
    ...(opts.clock ? { clock: opts.clock } : {}),
    initialize: (tx) => {
      // Passwords are hashed at first run (random salts), so no password or hash ships in the file.
      for (const u of tx.db.filter('users', (x) => !!x.persona)) {
        tx.db.update('users', u.id, (x) => {
          x.passwordHash = hashPassword(DEMO_PASSWORD, opts.passwordIterations);
        });
      }
    },
  });
}
