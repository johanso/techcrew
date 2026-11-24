import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { and, eq } from "drizzle-orm";

import { db, userAiKeys, workspaces } from "@/db";
import { PROVIDER_IDS, PROVIDERS, type AgentProvider, type ProviderStatus } from "@/lib/agent-config";
import { encrypt, tryDecrypt, warnUnreadable } from "@/lib/crypto";
import { checkOpenRouterKey } from "@/lib/openrouter";

/**
 * AI provider keys. The owner's account key (Settings → AI) serves every project; the environment's key
 * (OPENAI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY) only covers a provider the account has no key for. Keys are
 * encrypted at rest and never sent to the client: the UI only ever sees `hint`.
 */

export type AIKeys = Record<AgentProvider, string | null>;

export type KeySource = "account" | "environment";

/** A saved key as the UI sees it: masked. */
/** `unreadable`: it can't be decrypted (the encryption key changed), so it counts as not set until entered again. */
export type SavedKeyView = { hint: string; updatedAt: string; unreadable: boolean };

export type ProviderKeyView = {
  account: SavedKeyView | null;
  environment: boolean;
  /** The key agents use: the account's, else the environment's. Null when there is none. */
  inUse: KeySource | null;
};

const envKey = (provider: AgentProvider) => process.env[PROVIDERS[provider].envVar] || null;

/** One value per provider, in PROVIDER_IDS order. */
function perProvider<T>(value: (provider: AgentProvider) => T): Record<AgentProvider, T> {
  return Object.fromEntries(PROVIDER_IDS.map((provider) => [provider, value(provider)])) as Record<AgentProvider, T>;
}

type KeyRow = { provider: string; apiKey: string; hint: string; updatedAt: Date };

/** Which key a provider uses: the account's wins, then the environment's. */
export function keyInUse<T>(keys: { account: T | null; environment: T | null }): { source: KeySource; key: T } | null {
  if (keys.account !== null) return { source: "account", key: keys.account };
  if (keys.environment !== null) return { source: "environment", key: keys.environment };
  return null;
}

const accountRows = (userId: number) => db.select().from(userAiKeys).where(eq(userAiKeys.userId, userId));

/** A saved key's plain text, or null when there is none or it can't be read (warned once per provider). */
export function readSavedKey(row: Pick<KeyRow, "apiKey"> | undefined, provider: AgentProvider): string | null {
  if (!row) return null;
  const key = tryDecrypt(row.apiKey);
  if (key === null) warnUnreadable(`user_ai_keys ${provider}`);
  return key;
}

/** The key a provider uses, from the account's saved rows and the environment's key; an unreadable saved key counts as missing. */
export function resolveKey(rows: KeyRow[], provider: AgentProvider, environment: string | null): string | null {
  const used = keyInUse({ account: readSavedKey(rows.find((r) => r.provider === provider), provider), environment });
  return used?.key ?? null;
}

/** The keys agents and AI helpers of this workspace use (its owner's account keys first). */
export async function getAIKeys(workspaceId: number): Promise<AIKeys> {
  const [owner] = await db.select({ id: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!owner) return perProvider(envKey);
  return getOwnerAIKeys(owner.id);
}

/** The same for a user who may own no workspace yet: their account keys first, then the environment's. */
export async function getOwnerAIKeys(userId: number): Promise<AIKeys> {
  const rows = await accountRows(userId);
  return perProvider((provider) => resolveKey(rows, provider, envKey(provider)));
}

export function keyStatus(keys: AIKeys): ProviderStatus {
  return perProvider((provider) => Boolean(keys[provider]));
}

/** What Settings shows per provider: whether the account's key is saved (masked) and which key is used, never a key. */
export async function getProviderKeyViews(userId: number): Promise<Record<AgentProvider, ProviderKeyView>> {
  const rows = await accountRows(userId);
  const view = (provider: AgentProvider): ProviderKeyView => {
    const row = rows.find((r) => r.provider === provider);
    const account: SavedKeyView | null = row
      ? { hint: row.hint, updatedAt: row.updatedAt.toISOString(), unreadable: readSavedKey(row, provider) === null }
      : null;
    const environment = envKey(provider) !== null;
    return {
      account,
      environment,
      inUse: keyInUse<unknown>({ account: account && !account.unreadable ? account : null, environment: environment || null })?.source ?? null,
    };
  };
  return perProvider(view);
}

/** "sk-ant-api03-…xyz" → "sk-ant-••••xyz1": enough to recognize a key, useless to anyone who sees it. */
export function maskKey(key: string) {
  const prefix = key.match(/^(sk-ant-|sk-proj-|sk-or-v1-|sk-)/)?.[0] ?? "";
  return `${prefix}••••${key.slice(-4)}`;
}

/**
 * Checks a key with the provider before it's saved (lists models: free, no tokens spent). A key that passes may
 * still have no credit left; that only shows when an agent runs.
 */
export async function verifyProviderKey(provider: AgentProvider, key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = PROVIDERS[provider].label;
  try {
    if (provider === "openrouter") {
      // Its model list is public, so it proves nothing about the key: ask about the key itself.
      if ((await checkOpenRouterKey(key)) === "rejected") return { ok: false, error: `${name} rejected this key. Check that you copied all of it.` };
    } else if (provider === "openai") {
      await new OpenAI({ apiKey: key, maxRetries: 0, timeout: 15_000 }).models.list();
    } else {
      await new Anthropic({ apiKey: key, maxRetries: 0, timeout: 15_000 }).models.list({ limit: 1 });
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof OpenAI.AuthenticationError || error instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: `${name} rejected this key. Check that you copied all of it.` };
    }
    if (error instanceof OpenAI.PermissionDeniedError || error instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, error: `This key can't use the ${name} API. Check its permissions.` };
    }
    console.warn("[ai-keys] verification failed", provider, error);
    return { ok: false, error: `We couldn't reach ${name} to check the key. Try again in a moment.` };
  }
}

export async function saveProviderKey(userId: number, provider: AgentProvider, key: string) {
  const values = { apiKey: encrypt(key), hint: maskKey(key), updatedAt: new Date() };
  await db
    .insert(userAiKeys)
    .values({ userId, provider, ...values })
    .onConflictDoUpdate({ target: [userAiKeys.userId, userAiKeys.provider], set: values });
}

export async function removeProviderKey(userId: number, provider: AgentProvider) {
  await db.delete(userAiKeys).where(and(eq(userAiKeys.userId, userId), eq(userAiKeys.provider, provider)));
}
