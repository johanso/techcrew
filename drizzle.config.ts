import { defineConfig } from 'drizzle-kit';
import {
  embeddedApplies,
  embeddedUrl,
  readSecret,
  resolveDataDir,
  resolvePort,
} from './lib/local-db-config.mjs';

// DATABASE_URL when set; otherwise the embedded database (`npm run db:local`, which `npm run dev` starts).
const url = embeddedApplies(process.env)
  ? embeddedUrl(resolvePort(process.env), readSecret(resolveDataDir(process.env)) ?? '')
  : process.env.DATABASE_URL!.trim();

export default defineConfig({
  schema: './db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  // The hosted auth service owns the `auth` schema in this database; never let drizzle-kit touch it.
  schemaFilter: ['public'],
  tablesFilter: ['!pg_stat_monitor*', '!pg_stat_statements*'],
});
