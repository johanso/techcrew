import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { and, eq } from "drizzle-orm";

import { aiProviderKeys, db, userAiKeys, workspaces } from "@/db";
import { PROVIDER_IDS, PROVIDERS, type AgentProvider, type ProviderStatus } from "@/lib/agent-config";
import { encrypt, tryDecrypt, warnUnreadable } from "@/lib/crypto";
import { checkOpenRouterKey } from "@/lib/openrouter";

/**
 * AI provider keys. The owner's account key (Settings → Your account) wins, so one key serves every project; a
 * project's own key only covers a provider the account has no key for; the server environment's key
 * (OPENAI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY) comes last. Keys are encrypted at rest and never sent to the client: the UI
 * only ever sees `hint`.
 */

export type AIKeys = Record<AgentProvider, string | null>;

export type KeySource = "account" | "workspace" | "environment";

/** A saved key as the UI sees it: masked. */
/** `unreadable`: it can't be decrypted (the encryption key changed), so it counts as not set until entered again. */
export type SavedKeyView = { hint: string; updatedAt: string; unreadable: boolean };

export type ProviderKeyView = {
  account: SavedKeyView | null;
  /** Null outside a workspace (the account page). */
  workspace: SavedKeyView | null;
  environment: boolean;
  /** The key agents use: the account's, else the workspace's, else the server's. Null when there is none. */
  inUse: KeySource | null;
};

const envKey = (provider: AgentProvider) => process.env[PROVIDERS[provider].envVar] || null;

/** One value per provider, in PROVIDER_IDS order. */
function perProvider<T>(value: (provider: AgentProvider) => T): Record<AgentProvider, T> {
  return Object.fromEntries(PROVIDER_IDS.map((provider) => [provider, value(provider)])) as Record<AgentProvider, T>;
}

type KeyRow = { provider: string; apiKey: string; hint: string; updatedAt: Date };

/** Which key a provider uses: the account's wins, then the workspace's, then the server's. */
export function keyInUse<T>(keys: { account: T | null; workspace: T | null; environment: T | null }): { source: KeySource; key: T } | null {
  if (keys.account !== null) return { source: "account", key: keys.account };
  if (keys.workspace !== null) return { source: "workspace", key: keys.workspace };
  if (keys.environment !== null) return { source: "environment", key: keys.environment };
  return null;
}

/** The account's and the workspace's saved keys (workspace rows only when a workspace is given). */
async function keyRows(userId: number, workspaceId: number | null) {
  const [account, workspace] = await Promise.all([
    db.select().from(userAiKeys).where(eq(userAiKeys.userId, userId)),
    workspaceId === null ? Promise.resolve([] as KeyRow[]) : db.select().from(aiProviderKeys).where(eq(aiProviderKeys.workspaceId, workspaceId)),
  ]);
  return { account, workspace };
}

type SavedScope = "account" | "workspace";

/** A saved key's plain text, or null when there is none or it can't be read (warned once per provider and scope). */
export function readSavedKey(row: Pick<KeyRow, "apiKey"> | undefined, provider: AgentProvider, scope: SavedScope): string | null {
  if (!row) return null;
  const key = tryDecrypt(row.apiKey);
  if (key === null) warnUnreadable(`${scope === "account" ? "user_ai_keys" : "ai_provider_keys"} ${provider}`);
  return key;
}

/** The key a provider uses, from its saved rows and the server's key; an unreadable saved key counts as missing. */
export function resolveKey(rows: { account: KeyRow[]; workspace: KeyRow[] }, provider: AgentProvider, environment: string | null): string | null {
  const find = (list: KeyRow[]) => list.find((r) => r.provider === provider);
  const used = keyInUse({
    account: readSavedKey(find(rows.account), provider, "account"),
    workspace: readSavedKey(find(rows.workspace), provider, "workspace"),
    environment,
  });
  return used?.key ?? null;
}

/** The keys agents and AI helpers of this workspace use (its owner's account keys first). */
export async function getAIKeys(workspaceId: number): Promise<AIKeys> {
  const [owner] = await db.select({ id: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!owner) return perProvider(envKey);
  const rows = await keyRows(owner.id, workspaceId);
  return perProvider((provider) => resolveKey(rows, provider, envKey(provider)));
}

export function keyStatus(keys: AIKeys): ProviderStatus {
  return perProvider((provider) => Boolean(keys[provider]));
}

/** What Settings shows per provider: which keys are saved (masked) and which one is used, never a key. */
export async function getProviderKeyViews(userId: number, workspaceId: number | null = null): Promise<Record<AgentProvider, ProviderKeyView>> {
  const rows = await keyRows(userId, workspaceId);
  const saved = (list: KeyRow[], provider: AgentProvider, scope: SavedScope): SavedKeyView | null => {
    const row = list.find((r) => r.provider === provider);
    if (!row) return null;
    return { hint: row.hint, updatedAt: row.updatedAt.toISOString(), unreadable: readSavedKey(row, provider, scope) === null };
  };
  const view = (provider: AgentProvider): ProviderKeyView => {
    const account = saved(rows.account, provider, "account");
    const workspace = saved(rows.workspace, provider, "workspace");
    const environment = envKey(provider) !== null;
    const readable = (key: SavedKeyView | null) => (key && !key.unreadable ? key : null);
    return {
      account,
      workspace,
      environment,
      inUse: keyInUse<unknown>({ account: readable(account), workspace: readable(workspace), environment: environment || null })?.source ?? null,
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

/** Where a key is saved: the user's account (every project) or one workspace. */
export type KeyScope = { userId: number } | { workspaceId: number };

export async function saveProviderKey(scope: KeyScope, provider: AgentProvider, key: string) {
  const values = { apiKey: encrypt(key), hint: maskKey(key), updatedAt: new Date() };
  if ("userId" in scope) {
    await db
      .insert(userAiKeys)
      .values({ userId: scope.userId, provider, ...values })
      .onConflictDoUpdate({ target: [userAiKeys.userId, userAiKeys.provider], set: values });
  } else {
    await db
      .insert(aiProviderKeys)
      .values({ workspaceId: scope.workspaceId, provider, ...values })
      .onConflictDoUpdate({ target: [aiProviderKeys.workspaceId, aiProviderKeys.provider], set: values });
  }
}

export async function removeProviderKey(scope: KeyScope, provider: AgentProvider) {
  if ("userId" in scope) {
    await db.delete(userAiKeys).where(and(eq(userAiKeys.userId, scope.userId), eq(userAiKeys.provider, provider)));
  } else {
    await db.delete(aiProviderKeys).where(and(eq(aiProviderKeys.workspaceId, scope.workspaceId), eq(aiProviderKeys.provider, provider)));
  }
}
