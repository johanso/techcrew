import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/mydb',
  },
  // The hosted auth service owns the `auth` schema in this database; never let drizzle-kit touch it.
  schemaFilter: ['public'],
  tablesFilter: ['!pg_stat_monitor*', '!pg_stat_statements*'],
});
