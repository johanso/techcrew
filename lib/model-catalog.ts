import "server-only";

import { notInArray, sql } from "drizzle-orm";

import { db, modelCatalog, type ModelCatalogRow } from "@/db";
import { PROVIDER_IDS } from "@/lib/agent-config";
import {
  OPENROUTER_MODELS_URL,
  buildCatalog,
  catalogEntries,
  catalogStale,
  findModel,
  parseCatalogResponse,
  routeOf,
  type CatalogEntry,
  type CatalogModel,
  type ModelCatalog,
} from "@/lib/model-catalog-config";
import { SEED_ENTRIES } from "@/lib/model-seed";

/**
 * The model catalog (docs/model-catalog-plan.md): OpenRouter's public `/models` (no key), filtered by
 * lib/model-catalog-config.ts and stored in `model_catalog`, shared by every workspace and computer. Refreshed when
 * older than a day (AI Team and Settings schedule it after the response) and with Settings → AI → Refresh models.
 * Without a stored catalog (first run offline) the app runs on the built-in seed. Simulated mode never fetches on its own.
 */

// The pipeline reads the catalog every turn: one query a minute per process is plenty.
const CACHE_MS = 60_000;
// After a failed fetch, don't try again on every page load.
const RETRY_AFTER_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;

let cached: { catalog: ModelCatalog; at: number } | null = null;
let refreshing: Promise<RefreshResult> | null = null;
let lastFailureAt = 0;

function rowEntry(row: ModelCatalogRow): CatalogEntry {
  return {
    openRouterId: row.openRouterId,
    label: row.label,
    createdAt: row.releasedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    vision: row.vision,
    contextLength: row.contextLength,
    pricing: row.pricing,
    parameters: row.parameters,
    efforts: row.efforts ?? null,
    listed: row.listed,
  };
}

/** The catalog the app uses now: the stored one (cached a minute), else the seed. Never fetches. */
export async function getModelCatalog(): Promise<ModelCatalog> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.catalog;
  let rows: ModelCatalogRow[];
  try {
    rows = await db.select().from(modelCatalog);
  } catch (error) {
    // The seed keeps the app usable; not cached, so the next call reads the database again.
    console.error("[model-catalog] couldn't read the stored catalog; using the seed", error);
    return buildCatalog(SEED_ENTRIES, { now: new Date(), fetchedAt: null, source: "seed" });
  }
  const fetchedAt = rows.reduce<Date | null>((latest, row) => (!latest || row.seenAt > latest ? row.seenAt : latest), null);
  const { entries, source } = catalogEntries(rows.map(rowEntry), SEED_ENTRIES);
  const catalog = buildCatalog(entries, { now: new Date(), fetchedAt: fetchedAt?.toISOString() ?? null, source });
  cached = { catalog, at: Date.now() };
  return catalog;
}

/** One model from the catalog (undefined: the catalog doesn't know it; callers fall back to safe defaults). */
export async function catalogModel(id: string): Promise<CatalogModel | undefined> {
  return findModel(await getModelCatalog(), id);
}

export type RefreshResult = { ok: true; models: number } | { ok: false; error: string };

/** Fetches the catalog and stores it: new and changed models upserted, models no longer listed kept but marked. */
export function refreshModelCatalog(): Promise<RefreshResult> {
  // Two pages asking at once share one fetch.
  refreshing ??= fetchAndStore().finally(() => (refreshing = null));
  return refreshing;
}

async function fetchAndStore(): Promise<RefreshResult> {
  let body: unknown;
  try {
    const response = await fetch(OPENROUTER_MODELS_URL, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    body = await response.json();
  } catch (error) {
    lastFailureAt = Date.now();
    console.warn("[model-catalog] fetch failed; keeping the stored catalog", error);
    return { ok: false, error: "OpenRouter's model list didn't answer. The current list stays; try again later." };
  }

  const now = new Date();
  const entries = parseCatalogResponse(body, now);
  // A response without models for every company is a broken response, not news: keep what's stored.
  const missing = PROVIDER_IDS.filter((provider) => !entries.some((e) => routeOf(e.openRouterId)?.provider === provider));
  if (missing.length) {
    lastFailureAt = Date.now();
    console.warn(`[model-catalog] the response has no models for ${missing.join(", ")}; keeping the stored catalog`);
    return { ok: false, error: "OpenRouter's model list looked incomplete. The current list stays; try again later." };
  }

  const ids = entries.map((e) => e.openRouterId);
  await db.transaction(async (tx) => {
    await tx
      .insert(modelCatalog)
      .values(
        entries.map((e) => ({
          openRouterId: e.openRouterId,
          label: e.label,
          releasedAt: new Date(e.createdAt),
          expiresAt: e.expiresAt ? new Date(e.expiresAt) : null,
          vision: e.vision,
          contextLength: e.contextLength,
          pricing: e.pricing,
          parameters: e.parameters,
          efforts: e.efforts,
          listed: true,
          seenAt: now,
          updatedAt: now,
        }))
      )
      .onConflictDoUpdate({
        target: modelCatalog.openRouterId,
        set: {
          label: sql`excluded.label`,
          releasedAt: sql`excluded.released_at`,
          expiresAt: sql`excluded.expires_at`,
          vision: sql`excluded.vision`,
          contextLength: sql`excluded.context_length`,
          pricing: sql`excluded.pricing`,
          parameters: sql`excluded.parameters`,
          efforts: sql`excluded.efforts`,
          listed: true,
          seenAt: now,
          updatedAt: now,
        },
      });
    await tx.update(modelCatalog).set({ listed: false, updatedAt: now }).where(notInArray(modelCatalog.openRouterId, ids));
  });
  cached = null;
  lastFailureAt = 0;
  return { ok: true, models: entries.length };
}

/**
 * Refreshes the catalog when it's older than a day (pages schedule it with `after`, so nobody waits for it). Never in
 * simulated mode, and not again within ten minutes of a failed fetch.
 */
export async function refreshModelCatalogIfStale() {
  // AGENTS_SIMULATED (lib/agent-simulated.ts, not imported: it pulls in the agent tools).
  if (process.env.AGENTS_SIMULATED === "true" || Date.now() - lastFailureAt < RETRY_AFTER_MS) return;
  const catalog = await getModelCatalog();
  if (!catalogStale(catalog.fetchedAt, new Date())) return;
  try {
    await refreshModelCatalog();
  } catch (error) {
    lastFailureAt = Date.now();
    console.error("[model-catalog] refresh failed", error);
  }
}
