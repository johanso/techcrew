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
  resolveDataDir,
  resolvePort,
} from '@/lib/local-db-config.mjs';

const RETRY_FOR_MS = 15_000;

/** Connects to the embedded Postgres, retrying while `npm run dev` is still starting it. */
function connectWhenReady(port: number) {
  return async () => {
    const deadline = Date.now() + RETRY_FOR_MS;
    for (;;) {
      try {
        return await new Promise<net.Socket>((resolve, reject) => {
          const socket = net.connect(port, PG_HOST);
          socket.once('connect', () => resolve(socket));
          socket.once('error', reject);
        });
      } catch (error) {
        if (Date.now() > deadline) throw error;
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
    socket: connectWhenReady(port),
    prepare: false,
  };
  return postgres(options);
}

const client = createClient();
export const db = drizzle({ client, schema });
export * from '@/db/schema';
