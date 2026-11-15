import { fileURLToPath } from 'node:url';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

// Integration tests run inside workerd via @cloudflare/vitest-pool-workers, with
// a real Miniflare-backed D1. Migrations are read from the shared migrations dir
// and applied per test file (setupFiles).
export default defineWorkersConfig(async () => {
  const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
  const migrations = await readD1Migrations(migrationsDir);

  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
