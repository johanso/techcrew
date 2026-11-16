// Marks the generated migrations as applied on a database whose tables already exist (created with
// `drizzle-kit push` before the project switched to migrations), so `npm run db:migrate` doesn't try to recreate them.
//
//   npm run db:baseline
//
// Only for such databases: it records migrations without running them. On a fresh database use `npm run db:migrate`.
// Writes the same rows drizzle-kit's migrator would (drizzle.__drizzle_migrations: SHA-256 of the SQL, journal time).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import postgres from "postgres";

const ROOT = path.resolve(import.meta.dirname, "..");
const journal = JSON.parse(readFileSync(path.join(ROOT, "drizzle/meta/_journal.json"), "utf8"));

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
  const applied = new Set((await sql`SELECT hash FROM drizzle.__drizzle_migrations`).map((row) => row.hash));
  for (const entry of journal.entries) {
    const hash = createHash("sha256").update(readFileSync(path.join(ROOT, "drizzle", `${entry.tag}.sql`), "utf8")).digest("hex");
    if (applied.has(hash)) {
      console.log(`· ${entry.tag} already recorded`);
      continue;
    }
    await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${entry.when})`;
    console.log(`✓ ${entry.tag} marked as applied`);
  }
} finally {
  await sql.end();
}
