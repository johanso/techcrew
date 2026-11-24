import fs from 'node:fs';
import net from 'node:net';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import {
  PG_DATABASE,
  PG_HOST,
  PG_USER,
  embeddedApplies,
  readSecret,
  readyPath,
  resolveDataDir,
  resolvePort,
} from '@/lib/local-db-config.mjs';

// The first run includes initdb (about 10 s) and the migrations.
const RETRY_FOR_MS = 90_000;

/**
 * Connects to the embedded Postgres once the launcher says the database exists and is migrated (the ready file)
 * and the port answers, retrying while `npm run dev` is still starting it.
 */
function connectWhenReady(port: number, dataDir: string) {
  return async () => {
    const deadline = Date.now() + RETRY_FOR_MS;
    for (;;) {
      try {
        if (!fs.existsSync(readyPath(dataDir))) throw new Error('not ready');
        return await new Promise<net.Socket>((resolve, reject) => {
          const socket = net.connect(port, PG_HOST);
          socket.once('connect', () => resolve(socket));
          socket.once('error', reject);
        });
      } catch {
        if (Date.now() > deadline) {
          throw new Error('The local database did not become ready: is `npm run dev` running? (npm run db:local)');
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  };
}

function createClient() {
  const env = process.env;
  if (!embeddedApplies(env)) return postgres(env.DATABASE_URL!.trim(), { prepare: false });
  // Embedded database (docs/setup.md#database): the password file may not exist yet, so it is read per connection.
  const dataDir = resolveDataDir(env);
  const port = resolvePort(env);
  // `socket` is supported by postgres.js but missing from its type definitions.
  const options = {
    host: PG_HOST,
    port,
    user: PG_USER,
    database: PG_DATABASE,
    pass: () => readSecret(dataDir) ?? '',
    socket: connectWhenReady(port, dataDir),
    prepare: false,
  };
  return postgres(options);
}

const client = createClient();
export const db = drizzle({ client, schema });
export * from '@/db/schema';
