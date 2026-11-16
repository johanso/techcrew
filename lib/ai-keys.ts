import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { and, eq } from "drizzle-orm";

import { aiProviderKeys, db } from "@/db";
import { PROVIDERS, type AgentProvider, type ProviderStatus } from "@/lib/agent-config";
import { decrypt, encrypt } from "@/lib/crypto";

/**
 * AI provider keys (Settings → AI providers). A workspace's own key wins; without one the server environment's
 * key (OPENAI_API_KEY / ANTHROPIC_API_KEY) is used. Keys are encrypted at rest and never sent to the client:
 * the UI only ever sees `hint`.
 */

export type AIKeys = Record<AgentProvider, string | null>;

export type ProviderKeyView = {
  /** Where the key in use comes from; null when there is none. */
  source: "workspace" | "environment" | null;
  /** Masked workspace key, e.g. "sk-ant-••••a1B2". Null for environment keys (they belong to the server). */
  hint: string | null;
  updatedAt: string | null;
};

const ENV_KEY: Record<AgentProvider, string> = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };
const envKey = (provider: AgentProvider) => process.env[ENV_KEY[provider]] || null;

async function workspaceKeyRows(workspaceId: number) {
  return db.select().from(aiProviderKeys).where(eq(aiProviderKeys.workspaceId, workspaceId));
}

/** The keys agents and AI helpers of this workspace use. */
export async function getAIKeys(workspaceId: number): Promise<AIKeys> {
  const rows = await workspaceKeyRows(workspaceId);
  const own = (provider: AgentProvider) => {
    const row = rows.find((r) => r.provider === provider);
    return row ? decrypt(row.apiKey) : null;
  };
  return { openai: own("openai") ?? envKey("openai"), anthropic: own("anthropic") ?? envKey("anthropic") };
}

export function keyStatus(keys: AIKeys): ProviderStatus {
  return { openai: Boolean(keys.openai), anthropic: Boolean(keys.anthropic) };
}

/** What Settings shows per provider: source and masked key, never the key. */
export async function getProviderKeyViews(workspaceId: number): Promise<Record<AgentProvider, ProviderKeyView>> {
  const rows = await workspaceKeyRows(workspaceId);
  const view = (provider: AgentProvider): ProviderKeyView => {
    const row = rows.find((r) => r.provider === provider);
    if (row) return { source: "workspace", hint: row.hint, updatedAt: row.updatedAt.toISOString() };
    return { source: envKey(provider) ? "environment" : null, hint: null, updatedAt: null };
  };
  return { openai: view("openai"), anthropic: view("anthropic") };
}

/** "sk-ant-api03-…xyz" → "sk-ant-••••xyz1": enough to recognize a key, useless to anyone who sees it. */
export function maskKey(key: string) {
  const prefix = key.match(/^(sk-ant-|sk-proj-|sk-)/)?.[0] ?? "";
  return `${prefix}••••${key.slice(-4)}`;
}

/**
 * Checks a key with the provider before it's saved (lists models: free, no tokens spent). A key that passes may
 * still have no credit left; that only shows when an agent runs.
 */
export async function verifyProviderKey(provider: AgentProvider, key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = PROVIDERS[provider].label;
  try {
    if (provider === "openai") {
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

export async function saveProviderKey(workspaceId: number, provider: AgentProvider, key: string) {
  const values = { apiKey: encrypt(key), hint: maskKey(key), updatedAt: new Date() };
  await db
    .insert(aiProviderKeys)
    .values({ workspaceId, provider, ...values })
    .onConflictDoUpdate({ target: [aiProviderKeys.workspaceId, aiProviderKeys.provider], set: values });
}

export async function removeProviderKey(workspaceId: number, provider: AgentProvider) {
  await db.delete(aiProviderKeys).where(and(eq(aiProviderKeys.workspaceId, workspaceId), eq(aiProviderKeys.provider, provider)));
}
