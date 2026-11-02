// Seeds a workspace's Kanban board with sample cards for local testing.
//
//   npm run db:seed:board            → seeds the only workspace (or lists them if there are several)
//   npm run db:seed:board -- <id>    → seeds workspace <id>
//
// Idempotent: cards whose title already exists in the workspace are skipped, so running it twice adds nothing.
// Plain Node + the `postgres` driver on purpose: it runs outside Next.js, so it can't import `server-only` modules.

import postgres from "postgres";

const SAMPLE_CARDS = [
  // [status, type, priority, title, description, labels, due in days (null = none)]
  ["todo", "feature", "high", "Invite teammates to a workspace", "Email invitations with an accept link and a pending-invites list.", ["workspaces"], 5],
  ["todo", "issue", "medium", "Investigate slow cold starts on the dashboard", "First load after deploy takes ~3s. Profile server components and DB calls.", ["performance"], 7],
  ["todo", "bug", "low", "Avatar initials are wrong for emails with dots", "john.doe@acme.com renders “JD” in one place and “J” in another.", ["ui"], null],
  ["todo", "feature", "low", "Workspace usage analytics", "Weekly chart of tasks closed, PRs merged and agent hours.", ["analytics"], 14],
  ["in_development", "feature", "high", "Add OAuth error states to the sign-in form", "Show a clear message when the provider denies access or the link expires.", ["auth", "ui"], 0],
  ["in_development", "bug", "medium", "Sidebar state is ignored on first load", "The sidebar_state cookie is read after hydration, so it flashes open.", ["ui"], 2],
  ["in_development", "feature", "urgent", "Stream agent run logs in real time", "Tail the agent's stdout in the task panel while it works.", ["agents"], 1],
  ["in_review", "issue", "high", "Rate-limit the GitHub repository listing", "Cache /user/repos for 60s per user to stay under GitHub's limits.", ["api"], 1],
  ["in_review", "bug", "medium", "Theme flickers when switching workspaces", "Dark mode briefly shows light surfaces during navigation.", ["ui", "theme"], -1],
  ["testing", "issue", "medium", "End-to-end tests for workspace creation", "Cover name, icon, GitHub connect and repository selection.", ["testing"], 2],
  ["testing", "bug", "high", "Logo upload rejects valid PNG files", "Some PNGs report image/x-png and fail the type check.", ["uploads"], 1],
  ["done", "feature", "medium", "Workspace switcher keeps the current section", "Switching from Board keeps you on the other workspace's Board.", ["navigation"], null],
  ["done", "issue", "low", "Cache dependencies in CI", "npm cache between runs; cuts CI time roughly in half.", ["ci"], null],
];

function dateInDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run with: node --env-file=.env scripts/seed-board.mjs");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

try {
  const workspaces = await sql`select id, name, owner_id from workspaces order by id`;
  const requested = process.argv[2] ? Number(process.argv[2]) : null;
  const workspace = requested ? workspaces.find((w) => w.id === requested) : workspaces.length === 1 ? workspaces[0] : null;

  if (!workspace) {
    console.error(requested ? `Workspace ${requested} not found.` : "Several workspaces exist — pass one id:");
    for (const w of workspaces) console.error(`  ${w.id}  ${w.name}`);
    process.exitCode = 1;
  } else {
    const inserted = await sql.begin(async (tx) => {
      // Same lock as the app's createTask, so numbering stays unique even if someone is using the board.
      await tx`select id from workspaces where id = ${workspace.id} for update`;
      const existing = new Set((await tx`select title from tasks where workspace_id = ${workspace.id}`).map((r) => r.title));
      let [{ last }] = await tx`select coalesce(max(number), 0)::int as last from tasks where workspace_id = ${workspace.id}`;

      const rows = [];
      for (const [status, type, priority, title, description, labels, dueInDays] of SAMPLE_CARDS) {
        if (existing.has(title)) continue;
        // Append after whatever is already in the column, keeping the sample order.
        const [{ bottom }] = await tx`
          select coalesce(max(position), -1)::int as bottom from tasks where workspace_id = ${workspace.id} and status = ${status}`;
        last += 1;
        const [row] = await tx`
          insert into tasks (workspace_id, number, type, title, description, priority, status, position, labels, due_date, created_by_id)
          values (${workspace.id}, ${last}, ${type}, ${title}, ${description}, ${priority}, ${status}, ${bottom + 1},
                  ${labels}, ${dueInDays === null ? null : dateInDays(dueInDays)}, ${workspace.owner_id})
          returning number, status, title`;
        rows.push(row);
      }
      return rows;
    });

    console.log(`Workspace ${workspace.id} "${workspace.name}": ${inserted.length} card(s) added, ${SAMPLE_CARDS.length - inserted.length} already present.`);
    for (const row of inserted) console.log(`  #${row.number}  ${row.status.padEnd(15)} ${row.title}`);
  }
} finally {
  await sql.end();
}
