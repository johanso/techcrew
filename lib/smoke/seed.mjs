// `npm run smoke`'s test data: a user, their GitHub connection, a workspace on the throwaway repository and one card.
import { createCipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts exactly like lib/crypto.ts (AES-256-GCM, `v1.<iv>.<tag>.<ciphertext>`, base64url), with the data dir's key.
 * @param {string} plaintext
 * @param {Buffer} key 32 bytes
 */
export function encryptToken(plaintext, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
}

export const SMOKE_WORKSPACE_NAME = "Smoke";
export const SMOKE_CARD_TITLE = "Smoke test card";

/**
 * Inserts the rows and returns their ids. `sql` is a postgres.js client; every value is a parameter.
 * @param {import("postgres").Sql} sql
 * @param {{ github: { id: number, login: string, avatarUrl: string | null }, encryptedToken: string, repo: { id: number, fullName: string, htmlUrl: string, defaultBranch: string, private: boolean } }} input
 */
export async function seedDatabase(sql, { github, encryptedToken, repo }) {
  return sql.begin(async (tx) => {
    const [user] = await tx`
      insert into users (github_user_id, name, email, email_verified)
      values (${github.id}, ${github.login}, ${`smoke-${github.id}@users.noreply.github.com`}, true)
      returning id`;
    await tx`
      insert into github_connections (user_id, github_user_id, login, avatar_url, access_token, scope)
      values (${user.id}, ${github.id}, ${github.login}, ${github.avatarUrl}, ${encryptedToken}, ${"repo"})`;
    const [workspace] = await tx`
      insert into workspaces (owner_id, name, icon, github_repo_id, github_repo_full_name, github_repo_url, github_default_branch, github_repo_private)
      values (${user.id}, ${SMOKE_WORKSPACE_NAME}, ${"rocket"}, ${repo.id}, ${repo.fullName}, ${repo.htmlUrl}, ${repo.defaultBranch}, ${repo.private})
      returning id`;
    const [task] = await tx`
      insert into tasks (workspace_id, number, type, title, description, priority, status, position, created_by_id)
      values (${workspace.id}, 1, ${"feature"}, ${SMOKE_CARD_TITLE}, ${"Added by npm run smoke. Simulated agents write one note file and open a pull request."}, ${"medium"}, ${"todo"}, 0, ${user.id})
      returning id`;
    return { userId: user.id, workspaceId: workspace.id, taskId: task.id };
  });
}
