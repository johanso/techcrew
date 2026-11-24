# Features

What each part of the product does, from the user's point of view, with pointers to the code.

- [Sign in](#sign-in)
- [Workspaces](#workspaces)
- [Dashboard shell](#dashboard-shell)
- [Overview](#overview)
- [Board](#board)
- [GitHub issues on the board](#github-issues-on-the-board)
- [Card actions: Run and Remove](#card-actions-run-and-remove)
- [Agent pipeline](#agent-pipeline)
- [AI Team](#ai-team)
- [Agent skills](#agent-skills)
- [Live process](#live-process)
- [Pull Requests, Activity](#pull-requests-activity)
- [Settings](#settings)
- [Theme](#theme)
- [Accessibility](#accessibility)

---

## Sign in

Pages: `/sign-in`, `/sign-in/adopt` (`app/(auth)/`). Layout: form on the left, product panel on the right (hidden on small screens).
There is no sign-up and no password: signing in with GitHub is also what lets agents reach your repositories.

- **Continue with GitHub** shows a code. **Open GitHub** (new tab) is where you type it and authorize; the page says
  "Waiting for you to authorize…" and signs you in by itself. The code can be copied. Cancel, a denied authorization, an
  expired code and GitHub errors each have their own message and a way to start again.
- **Use a personal access token instead** (collapsed): paste a token with the `repo` scope; it is checked with GitHub.
- **Client id.** The project's own OAuth App is built in; `GITHUB_CLIENT_ID` replaces it. If no id resolves at all the page
  says how to set one.
- **Adopting existing data.** The first sign-in on a database that already has exactly one user (an installation from before
  GitHub sign-in) asks: *Adopt it with @you* keeps every workspace, board and agent; *Create a separate account* starts empty.
- **Redirects.** `/sign-in?next=/some/path` goes there afterwards (same-origin paths only), otherwise to `/workspaces`.
  Visiting while signed in redirects right away.
- **Sign out** is in the user menu (header avatar): it clears the cookie. **Disconnect** (create-workspace page) also deletes
  the stored GitHub token. Where GitHub access is missing or revoked, the buttons say **Reconnect GitHub** and lead to `/sign-in`.

Code: `app/(auth)/actions.ts`, `components/auth/*`, `lib/sign-in.ts`. Flow details: [architecture.md](architecture.md#authentication-and-sessions).

## Workspaces

### Workspace picker — `/workspaces`

The landing page after sign-in. Lists your workspaces (avatar, name, linked repository, private badge, age).
Clicking one opens its dashboard. **New workspace** opens the create page. If you have no workspaces, this page
redirects to `/workspaces/new`.

### Create a workspace — `/workspaces/new`

A three-step form with a live preview card on top:

1. **Name** — required, up to 60 characters.
2. **Icon or logo** — pick one of 16 icons, or **Upload custom logo** (PNG, JPG, WebP or GIF, up to 1 MB; SVG is
   deliberately not allowed). A logo replaces the icon; **Remove** goes back to the icon. Logos are stored on this computer.
3. **Link a GitHub repository** — **Connect GitHub** sends you through GitHub's authorization page and back. Once
   connected you see "Connected as @login" (with **Disconnect**) and a searchable list of your repositories.
   Only repositories you can **push** to and that aren't archived are listed (up to 300, most recently pushed
   first), because agents need to push branches.

**Next** is enabled once there's a name and a selected repository. It creates the workspace and opens its
dashboard. The server re-checks the repository with GitHub before saving (it never trusts the client's data).

Details that matter:
- **The form survives the GitHub round trip.** Before leaving for GitHub, the name, icon, logo (as a data URL) and
  selected repository are saved in `sessionStorage` and restored on return (`components/workspace/workspace-draft.ts`).
- **Status messages** after the round trip: cancelled on GitHub ("authorization was cancelled"), failed ("We
  couldn't connect to GitHub"), or not configured on the server.
- A workspace is linked to **exactly one** repository. There's no way to change it after creation yet.

Code: `app/workspaces/*`, `components/workspace/*`, `lib/github.ts`, `lib/storage.ts`.

## Dashboard shell

Every `/dashboard/[workspaceId]/*` page shares one layout (`app/dashboard/[workspaceId]/layout.tsx`):

**Sidebar** (`components/dashboard/app-sidebar.tsx`)
- **Logo and app name** at the top; clicking goes to the workspace Overview.
- **Workspace switcher** — current workspace (avatar, name, repo). The dropdown lists all your workspaces (✓ on the
  current one), **Create new workspace** and **All workspaces**. Switching keeps you on the same section (Board →
  the other workspace's Board).
- **Navigation**: Overview, Board, AI Team, Pull Requests, Activity. The current page is highlighted.
- **Collapsible to icons only.** Toggle with the header button, the sidebar edge (rail), or **⌘B / Ctrl+B**. The
  state is remembered in the `sidebar_state` cookie, so it renders correctly on the next load. In icon mode every
  item shows a tooltip.
- **Mobile**: the sidebar becomes a sheet that slides in from the left and closes after you pick a destination.

**Header** (`components/dashboard/dashboard-header.tsx`)
- Sidebar toggle, breadcrumb (`Workspace › Section`).
- GitHub button with the repository's name (the project being worked on; the tooltip adds the owner, phones show just
  the icon), opens the repository; the notifications bell (see [Notifications](#notifications)); your avatar, which
  opens the user menu (Settings, Agent skills, Theme, Sign out). The sidebar has no user
  menu.

### Notifications

The header bell shows a count of unread notifications (9+ above nine) and opens a list, newest first (30 kept):

| Kind | When | Opens |
| --- | --- | --- |
| PR ready to merge | Review and tests passed with manual merge, or auto merge gave up waiting on checks | Pull Requests |
| Merged | Auto merge went through | Pull Requests |
| Merge blocked | A conflict or failing build; says which follow-up card the Tester filed | Pull Requests |
| Analyst needs info | The analyst asked a question instead of starting | The card's agent log (Answer the analyst) |
| Agents stopped | A run failed (paused agent, budget, missing permission, GitHub, out of turns, error) | The card's agent log |
| Out of credit | The provider refused for lack of credit and the run stopped | The board (switch and retry) |
| Switched provider | Auto failover moved the agents on a company out of credit to the next one in your fallback order | Settings → AI providers |

Unread items are bold with a dot; opening one marks it read, and **Mark all as read** clears the count. The bell
refreshes every 30 s while the tab is visible and whenever it opens. Notifications go to the workspace's owner only;
there's no email yet.

**Content panel** — a rounded panel with its own scroll; the header stays pinned inside it. Pages use
`max-w-6xl`; the board opts out to use the full width.

**Routing rules** — `/dashboard` redirects to your newest workspace (or to `/workspaces/new`). A workspace you don't
own is a 404.

## Overview

`/dashboard/[workspaceId]` — real data from the board, the agents and the activity feed (`lib/overview.ts`):

- Welcome header with your first name.
- Three stat cards:
  - **Open tasks** — cards not in Done. Hint: how many are overdue, else due in the next 7 days.
  - **In progress** — cards in Analysis, In Development, In Review or Testing. Hint: how many agents they're assigned to.
  - **PR ready** — cards whose pull request waits for you to merge (manual merge mode).
- **Upcoming tasks** (left) — up to five open cards, soonest due date first (undated last), then priority, then board
  order. Each row: status icon (Open = Todo, In progress, PR ready), title, key, type, priority, GitHub issue number,
  first label (+N for the rest); on the right, where the card is (its agent run — "Reviewing…", "PR #5 ready to
  merge", "Analyst needs info", "Agents stopped" — else its column) and the due date (red when overdue, or "No due
  date"). On phones that column moves under the title. **View board** link. Empty state: "No open tasks".
- **AI team** (right) — the six agents with their face, status dot and badge (Ready, Working, Paused, Over
  budget), and what each is doing: the running stage ("Reviewing ACM-142"; Reviewer and Security can both be working) or "Active 1 hour ago" (last work on a
  card; "No work yet" otherwise). Header: how many are working. Footer: the team's spend against its combined monthly
  budget. **View team** link. Read-only (`getTeamOverview`): it never creates agents; roles without a row show their
  defaults.
- **Recent activity** — the six latest *work* events (cards created, Run, stages, pull requests, merges, follow-up
  issues), leaving out team setup; **View all** link. Empty state: "No activity yet".

## Board

`/dashboard/[workspaceId]/board` — the Kanban board, persisted in the `tasks` table.

**Columns** — Todo, Analysis, In Development, In Review, Testing, Done. Each has a light tint (slate, brand blue, sky, amber, orange,
green), a count, and a **+** button that opens the create dialog preset to that column. Empty columns say what
belongs there ("Ready to be picked up. Drop a card here."). The board fits the screen: a long column scrolls inside,
under its title and count, instead of making the page longer (while dragging, it scrolls when the card nears its
edge). A card you just created or saved scrolls into view. Each column shows its first 5 cards and a **Show N more**
button at the bottom that opens the rest (**Show less** closes it again); the count in the header is always the total.
A search or type filter shows every match. A card dropped below a closed column's first 5 opens that column.

**Cards** show:
- type pill (Feature ✦, Bug 🐞, Issue ◉) and the key (`ACM-142`, always);
- title (up to three lines), labels;
- priority (Urgent / High / Medium / Low, as a colored dot), GitHub issue number for synced cards (`#12`), due date
  ("Today", "Tomorrow", or the date; red with a calendar-x icon when overdue — not in Done), a paperclip with the
  number of [references](#card-references) when it has some, and the assigned agent's avatar;
- a **▶ Run** button and a **⋯** menu (see [Card actions](#card-actions-run-and-remove)).

**Creating** — **New** (header) opens a menu: Feature, Bug or Issue. Each column's **+** does the same with that column
preselected. The dialog asks for: type, title (required, ≤ 120), description, priority, status (column), due date,
labels (comma-separated, ≤ 5). New cards appear at the top of their column with a short highlight. If the active
filters would hide the new card, they're cleared.

**Editing** — click a card, or press **Enter** on a focused card, to open the same dialog with its details: key,
creation date, last update. **Save changes** writes to the database. Changing the status in the form moves the card
to the end of that column. For GitHub cards, title, description and labels are read-only (they belong to GitHub).

**Drag and drop** (`@dnd-kit`)
- **Mouse**: press and move 6 px to start dragging (so clicks still open the card). A tilted copy follows the
  pointer and a faded placeholder shows where it will land. Drop between cards or into an empty column.
- **Touch**: press and hold ~180 ms, then drag; a quick swipe scrolls the board instead.
- **Keyboard**: focus a card, **Space** to pick it up, **↑/↓** to move within the column, **←/→** to jump to the
  neighbouring column, **Space** to drop, **Escape** to cancel (the card returns to where it was).
- Moves are **optimistic**: the board updates immediately and saves in the background. If saving fails, the card
  goes back and an error banner explains it.

**Search and filters** (toolbar above the columns)
- **Search** by title, key or GitHub issue number: `ACM-142`, `acm142`, `#142`, `142`, or words from the title.
  Press **/** anywhere to focus it, **Escape** to clear.
- **Type tabs**: All / Features / Bugs / Issues, each with a live count that follows the search.
- While filtering, column badges show `visible/total`, empty columns say "No matching cards.", and "Showing X of Y
  cards · Clear filters" appears. Filters only **hide** cards: dragging while filtered keeps the hidden cards' order.

**Layout** — the board scrolls horizontally when the six columns don't fit (snapping to columns on mobile).

Code: `components/board/*`, `lib/board.ts`, `lib/board-config.ts`, `app/dashboard/[workspaceId]/board/actions.ts`.

## Card references

Files the owner attaches to a card so the agents build from them: a design exported from a design tool, a spec, a
document, or a link to a page they want something similar to. They're in the **References** section of the card dialog, for every saved card (GitHub cards too: references
belong to the board, not to the issue). A new card says "Save the card to add references."

- **Add files** takes several at once: PNG, JPEG or WebP images (up to 5 MB and 8000 × 8000 px), Markdown or text
  (up to 1 MB), PDFs (up to 5 MB). Up to **10 per card**. Each file is checked by its content, not its name: an SVG, a
  GIF or a PDF renamed `.png` is refused with a reason. Files upload one by one ("Uploading home.png…"), so one bad
  file doesn't stop the others.
- Each row shows a thumbnail (images) or an icon, the name (opens the file in a new tab; PDFs download) and what it is
  ("1280 × 800 · 240 KB", "12 pages · 2 MB", "no text found" for a scanned PDF). The trash button asks **Remove** /
  **Keep** in place before deleting.
- The board card shows a paperclip and the count.
- **Add a link** (under the files): paste an http(s) address and press **Add link** or Enter. The sandbox browser
  captures the page once, now: a desktop (1280 px) and a mobile (375 px) screenshot, full page up to 2,400 px, plus a
  short outline (title, headings, landmarks, navigation and button labels, main texts, fonts and colors). A row with a
  spinner says "Capturing example.com…" (10–30 s). The reference shows the desktop thumbnail, the page's title (opens
  the screenshot), the domain (opens the original page in a new tab) and **Mobile** (the mobile screenshot). Private
  or internal addresses, names that don't resolve, slow pages and HTTP errors are refused with the reason, and nothing
  is stored. Without a sandbox host the input is disabled and says why. Links count toward the 10.
- **PDFs** are read once, at upload: the text of up to 100 pages (300,000 characters) is kept for the agents. A scanned
  PDF has no text; the agents are told so.
- **Removing the card** deletes its references, files included.

**What the agents do with them.** Every agent gets `list_references` and `read_reference` on a card with references,
like skills: Markdown, text and PDF text come back as text (in pages), images as the image itself, a link as its
outline plus both screenshots. A link is framed as a third-party page the owner wants something similar to: untrusted
content, structure and style only, never its logos, brand names, images or texts. The task lists the
references by name; the Analyst names in its brief the ones the Developer must follow and what each is for; the
Developer reads and follows them (the card's text wins where they disagree, and it says so); the Reviewer, the Lead and
the Tester read them to check the work. References are the owner's requirements but still data: nothing in them can
change the agents' rules or tools.

**The Tester compares.** With previews on, the Tester browses each changed page at the reference's size (the
`browse_preview` viewport closest to the image's width: desktop 1280, tablet 768, mobile 375; a link has desktop and
mobile), in light and dark, looks at its screenshots next to the reference, and fails the card with the specific
differences when the preview clearly doesn't match what the brief says to follow; the Developer gets them in a rework
round like any test fail.

**Models that can't see images.** Run is refused when the card has images or links and the **Analyst** or the
**Developer** uses a model without vision (DeepSeek V4 Pro, GLM 5.3), or the **Tester** does while the workspace has
previews on, with a link to the AI Team page; auto pickup leaves such a card in Todo and takes the next card without
images or links. Models are never switched for you. Another agent on such a model that reads an image gets a note
instead (a link: its outline only).

Code: `components/board/card-references.tsx`, `lib/references.ts`, `lib/reference-config.ts`, `lib/reference-images.ts`,
`lib/reference-pdf.ts`, `lib/sandbox/capture.ts` (+ `capture-config.ts`, `deploy/browser/capture.mjs`),
`app/api/workspaces/[id]/references/[referenceId]/route.ts`.

## GitHub issues on the board

Open issues from the workspace's repository become cards automatically.

- **When it syncs**: every time you open or reload the board (the header says "Syncing with GitHub…" from the
  first paint), when you come back to the tab after 15 s or more, every 60 s while the tab is visible, and when you
  click **Refresh**.
- **Status text** next to Refresh: "Synced just now", "Synced 3 minutes ago", plus what changed ("2 new · 1 closed")
  or "Up to date" after a manual refresh.
- **New issues** land at the top of **Todo**. Their type and priority are guessed from labels (`bug` → Bug,
  `enhancement`/`feature` → Feature; `p0`/`urgent`/`critical` → Urgent, `p1`/`high` → High, `p3`/`low`/`minor` →
  Low; otherwise Issue / Medium).
- **Closing** an issue on GitHub moves its card to **Done**; **reopening** moves it back to the top of **Todo**.
- **Edits on GitHub** (title, body, labels) update the card. Your board choices (column, type, priority, due date,
  agent) are never overwritten.
- **Problems** show a banner: not connected / connection expired (**Connect GitHub** / **Reconnect GitHub** button),
  no access to the repository, or GitHub unreachable (**Try again**). Auto-sync pauses until the problem is fixed.

Full rules and limits: [github-integration.md](github-integration.md#issue-sync).

## Card actions: Run, Merge, agent log and Remove

Each card has a **▶** button and a **⋯** menu (**Run** or **Stop agents**, **View agent log** once it has run, and
**Remove task**). In **Done**, ▶ is replaced by a green check (a
status, not a button); **Run again** stays in the ⋯ menu. When the card's pull
request is ready for a manual merge ("PR #n ready to merge"), ▶ becomes a green **Merge** button and the menu adds
**Merge PR #n** and **View PR on GitHub**. Merging runs the same checks as the Pull Requests page; the board then
reloads: the card moves to Done, or, if GitHub reports a conflict or failing build, the Tester's follow-up card appears
in Todo and the reason shows above the board.

Running a card again starts over from Analysis. If the card already has an open pull request, the new run continues on
that branch and PR ("Run again on PR #n" in the menu) instead of opening another; the Developer is told to build on
the existing commits, and review and tests start over. The Tester's follow-up card of a pull request that couldn't
merge ("Fix merge of PR #n") works the same way: running it (or auto pickup) continues on that PR, the brief names the
original card and the merge error, and for a conflict the Developer first merges the default branch into the PR's
branch (see [Merging the default branch](#merging-the-default-branch)). The follow-up card carries the run; when the
PR merges, both cards go to Done. While one card's run works on the PR, Run on the other is refused. They sit beside the
card's drag area, so using them never starts a drag or opens the dialog.

- **Run** starts the agent pipeline (see [Agent pipeline](#agent-pipeline)): the card moves to **Analysis**, the
  Analyst's avatar appears and the card shows "Queued for the agents". ▶ stays disabled (spinner) while the agents
  work. Run is refused when the agents are already on the card, when an agent's
  model has neither a provider key nor your plan on this computer (`AGENTS_SIMULATED=true` runs scripted agents
  instead), while the Analyst is paused or over budget (the budget doesn't apply when it runs on your plan), or when the card has image references and the Analyst's or the Developer's model can't see
  images (the error links to the AI Team page).
- **Stop agents** (while a run is active) cancels it between steps. The card is unassigned and stays in its column
  (back to Todo if it was still in Analysis); the branch and pull request, if any, are kept.
- **Remove task** asks for confirmation, then takes the card off the board. For GitHub cards the issue stays open
  on GitHub and won't be synced back. The row is kept as a tombstone so the key isn't reused.

- **View agent log** opens a side panel with the card's latest run: its status, when it started, how long it took and
  its model spend, then one block per stage (and per rework round): the agent and model, turns, cost, how the stage
  ended (its result in green, or why it stopped in red), the **files changed**, and the list of tool calls (read,
  listed, searched, wrote, edited, deleted, checked the diff, checked CI), with failed calls and their error in red.
  It follows a running card every 5 s. Notifications link straight to it (`/board?log=<card>`). Runs from before the
  log existed show "Nothing logged".

Locally, Run needs the Inngest Dev Server (`npm run dev` starts it with the app); otherwise it shows an error saying so.

### Out of credit

When OpenAI, Anthropic or OpenRouter refuses a request because the account has no credit, the run stops with that
reason (not a generic failure):
- The card says **Out of OpenAI credit** (wallet icon), and the AI team card on the Overview too.
- A notice above the board lists the stopped cards with **Add credit** (the provider's billing page) and **Move agents
  to … and retry**: every agent still on the broke company moves to its closest model (same tier) on the first other
  company with a key (OpenAI, Anthropic, then OpenRouter) and each card runs again; reruns continue on their open pull
  requests. Without another company's key it offers **Add another company's key** instead. If no agent is on that
  company any more, the button just says **Retry**.
- **Automatic switch** (Settings → AI providers, off by default): the agents on the broke company move to the next one
  with a key on their own and the current stage starts over there (once per stage); you get a "Switched agents to …" notification.

### Your plan runs out

When an agent works on your Claude plan ([cli-agents.md](cli-agents.md)) and the plan's usage window runs out, your
choice in Settings → AI decides: by default (no Anthropic key) the card says **Waiting for your Claude plan · resets
3:40 PM** (hourglass), the bell tells you once, and the stage picks up the same session when the plan resets (**Stop
agents** still works while it waits); with a key, the stage starts over on the API key; or the company's agents move
elsewhere (switch company). When nothing is possible the card says **Your Claude plan ran out**. In the agent log a plan
stage's result ends with **Your Claude plan · 12 turns · 180K tokens (≈ $0.40 at API prices)**, a **Route** line says
why a stage took the API key although the plan is on, and the summary shows **API spend** only.

## Agent pipeline

A run takes a card through six phases. Review has two agents working in parallel; approval keeps the card in In
Review, so the board still has six columns:

| Column (phase) | Agent | What happens |
| --- | --- | --- |
| Analysis | Analyst | Reads the card and the code (read-only). Hands it to the Developer with acceptance criteria, a plan, relevant files and notes, or asks one question (**needs info**: comment on the GitHub issue with *Comment on issues*, card back to Todo). |
| In Development | Developer | Creates `agent/<key>-<slug>` from the default branch and commits to it through the GitHub API (write, edit, delete files). Then a pull request is opened (`Closes #<issue>` for GitHub cards). |
| In Development (CI) | — | The **CI gate**: the card waits ("Waiting for CI on PR #n…") until every check on the pushed commit finishes, polling every 30 s for up to 15 minutes. A check the change broke sends the work straight back to the Developer with each failing check's annotations and the end of its job log; nobody reviews a red build. A check that fails on the default branch too doesn't block. No CI in the repository (no workflow in `.github/workflows/` and no check within about a minute): it moves on. Still running at 15 minutes: review starts and the merge waits for CI. |
| In Review (review) | Reviewer + Security, in parallel | The **Reviewer** reads the diff for correctness and conventions against the acceptance criteria: approve or request changes with file-level findings. Only for what the developer can fix in code: checks that need a browser or device are listed as manual checks and never block. **Security** reads the same diff for leaked secrets, injection, missing auth checks, unsafe permissions and risky dependencies: each finding has a severity (critical, high, medium, low), a category, the file and the fix. Both post on the PR with *Review pull requests*. After rework each gets its earlier findings and checks those. |
| In Review (approval) | Lead | Reads both reviews and the measured diff (files, changed lines) and decides: **approve** or **request changes** (a list of what must change, with its source). Rates the change's **risk** — low, medium or high — with reasons; the pipeline raises it to a floor it can't talk away (below). Posted on the PR. |
| Testing | Tester | Verifies statically (no test runner): automated pre-checks (branch exists and has commits, reported files are in the diff, no conflict markers, PR open, merges cleanly into the default branch, the CI gate's result) plus its own review. A PR GitHub reports as conflicting fails and goes back to the Developer. |
| Done | — | After the merge. |

- A failing CI, the Lead's requested changes or failed verification send the work back to the Developer (same branch
  and PR) — at most **2 rework rounds** in all, then the run stops and the PR waits for a human. The Reviewer and
  Security never send work back on their own; the Developer gets the Lead's list plus both reviews' findings, or after a
  failed CI only the failures. The Lead and the Tester see the CI result of the round.
- **Risk floor** (`riskFloor`): Security's worst finding (critical or high → high, medium → medium) and what the diff
  touches — dependency manifests, database schema or migrations, authentication or permissions code, CI or
  infrastructure, more than 10 files or 400 changed lines → at least medium. The Lead may rate higher, never lower.
- **Merging** follows **Settings → Agents**: *Manual* leaves the card in Testing with "PR #n ready to merge" and a
  **Merge** button on the Pull Requests page; *Automatic when low risk* merges on its own only when the Lead's final
  risk is low (medium and high wait, and the notification says why); *Automatic* merges whatever the risk. Automatic
  merges happen as soon as GitHub says the PR is mergeable and CI is green (it waits up to 10 minutes for checks). A **conflict or failing build** makes the Tester file a follow-up bug
  card on top of Todo (and a GitHub issue with *File issues*); the original run ends with the reason. Running that card
  fixes the same pull request (above).
- **Task pickup** (Settings → Agents): *Manual* = Run; *Automatic* = every 2 minutes the Analyst takes the top Todo
  card that was never run, one card at a time per workspace.
- **Max turns** (per agent, AI Team → Configure): model calls allowed per stage. Three turns before the end the agent
  is told to wrap up; the last turn asks for its result. A Developer that can't finish submits what's done with what's
  left: the PR shows it under "Not finished yet" and the Lead sends it back for another round on the same branch. If
  it still ends without a result but committed work, the pipeline carries on with that work marked unfinished; a
  Reviewer or Security that runs out of turns becomes a missing check for the Lead (minimum risk medium). The Analyst,
  the Lead and the Tester running out of turns stop the run. A rerun after a run that stopped with commits and no pull
  request continues its branch. Pausing an agent or reaching its budget stops the run at its next turn.
- **Permissions are enforced**: an agent only gets the tools its permissions allow (*Read repository* → list/read/search files,
  plus the branch diff for the Reviewer, Security, Lead and Tester; *Write code* → write/edit/delete on the run's
  branch, Developer only; *Read CI results* → checks). Dependency manifests need
  *Manage dependencies*; CI workflows, `.env*` files (except `.env.example`) and `.git/` can never be written.
  With the sandbox on, *Manage dependencies* plus *Write code* gives the Developer `add_dependency`: npm adds one
  package in the sandbox and package.json and the lockfile are committed together (npm repositories only;
  [sandbox.md](sandbox.md#adding-a-package)). A font the card names is added this way (`@fontsource/…`) and imported,
  never linked from a font host; agents don't pick fonts the card doesn't name.
- **Merging the default branch** <a id="merging-the-default-branch"></a> (*Write code*, Developer, on the run's branch):
  `merge_default_branch` brings the default branch's latest commits into the branch as a merge commit with two
  parents, so the PR merges cleanly. GitHub merges it in one call when nothing conflicts. Otherwise files whose changes
  don't overlap merge automatically, lockfiles take the default branch's version (with *Manage dependencies* and the
  sandbox, the Developer re-adds its packages with `add_dependency`), and each remaining file is resolved by the
  Developer: `read_conflict` (the file with `<<<<<<<` your branch / `|||||||` merge base / `=======` / `>>>>>>>`
  default branch sections), `resolve_conflict` (the whole merged file; leftover markers are refused) and `finish_merge`
  (commit, or abort). The commit lands only if neither branch moved since the merge started. Refused, with a message the
  Developer passes on: protected paths, symbolic links and submodules, binary files or files over 200 KB, manifests
  without *Manage dependencies*, more than 20 conflicting files, and (GitHub's rule) a merge that brings in workflow
  changes, which TechTeam's GitHub connection may not push: use **Update branch** on the PR. While a merge is open, the
  write tools are refused. The agent log shows *Merged the default branch*, each file read and resolved, and *Finished
  the merge* with the outcome line, never file contents.
- **Skills** (see [Agent skills](#agent-skills)): an agent with skills switched on sees them listed in its prompt and
  gets two read-only tools in every stage, `search_skill` and `read_skill`; always-loaded skills ride in the prompt.
- **References** (see [Card references](#card-references)): on a card with references every agent gets
  `list_references` and `read_reference` in every stage; the Analyst's brief lists the ones to follow.
- If one of the two parallel reviewers stops (paused, budget, error), the other stops at its next turn and the run
  ends with the first reason (one notification).
- Each card shows its run: phase in progress ("Reviewing…", "Waiting for CI on PR #n…", "Approving…"), "Analyst needs info" + the question, "Agents stopped" + the reason,
  "PR #n ready to merge" or "Merged PR #n". The board re-reads itself every 10 s while any run is active (database only; GitHub is synced every minute).
- **Answering the analyst**: while a card waits on a question, ▶ becomes **Answer** (also in the ⋯ menu and the agent
  log). The answer is saved with the question, posted under it on the GitHub issue when the question is there, and the
  card runs again right away. The agents keep the last three questions and answers for every later run of the card,
  so the analyst doesn't explore blind or ask the same thing twice. Editing the description and pressing Run works
  too (the question then goes in unanswered).

## AI Team

`/dashboard/[workspaceId]/ai-team`. Every workspace gets six agents on first use: **Analyst** (requirements &
planning), **Developer** (implementation), **Reviewer** (code review), **Security** (security review), **Lead**
(approval & risk) and **Tester** (quality assurance), each with a face, written instructions, default permissions, a model
and a monthly budget. Workspaces created before Security and Lead existed get them the next time the page loads or a
card runs. Security and Lead are read-only by default (read the repository, issues and CI; post reviews).

- **Stats** — Active agents (active/total, how many are working on cards or paused), Trust Score (team average,
  grade, lowest agent), Monthly spending (all agents, against the sum of their budgets).
- **Agent cards** (three per row on wide screens) — the agent's face with a status dot, status (Ready, Working = a run
  is in this agent's phase and its stage hasn't finished, Paused, Over budget), description; while working, a brand
  border, a ring on the face and a "Working on KEY" box with what it's doing ("The Developer is editing
  src/styles.css."), live; model, *Permissions · N*, *Skills · N*, trust score, open cards and a budget bar (turns warning at 75 %,
  error at 100 %). Buttons: **Configure** and **View activity**.
- **Configure** (dialog) — Active/Paused switch, description, instructions (**Reset to default**; **Draft with AI**
  asks the AI (OpenAI, else Claude) for a description and instructions tailored to the repository's description, languages, topics and
  README, the selected permissions and budget, plus an optional focus; **Undo** restores the previous text; nothing is
  saved until **Save changes**), **Permissions** by category with risk level and *Default* tags (**Reset to defaults**),
  **Company** (OpenAI, Anthropic or OpenRouter; one without a key says *No key* and links to Settings) and **Model**
  (that company's **current models from the model catalog**, each with its price per 1M tokens in / out — or *Your
  plan* when your Claude plan carries it on this computer — an eye when it sees images, and a hint: tier, *sees images*
  or *text only*, context size; OpenRouter's grouped by maker: Google, xAI, DeepSeek, Z.ai, Moonshot; changing company
  picks the closest model of the same tier, so each agent can work on a different company. New models appear on their
  own after the daily refresh; an agent whose model is no longer offered keeps it, shown as *Older model* in the picker
  and *older* on its card, until you pick another) and
  monthly budget (presets $25/$50/$100/$250). The side panel shows the **Trust Score** (ring,
  grade — Trusted ≥ 85, Needs review ≥ 70, At risk — summary, checks passed, findings, **Scan again**) and
  **Spending** for the month (spent, budget bar, remaining, projection, reset date, breakdown: task runs, AI drafting,
  trust scans) and **Skills** (only the skills this agent has on, with type, load and source badges and a switch
  that saves at once; one switched off stays listed until the dialog closes, so it can be switched back; **Add a
  skill** opens a search over the rest of the library, *Recommended* ones for the role first, up to 8 results; a
  warning when a skill assumes a permission the agent lacks; **Manage skills** → Settings → Agent skills). Saving logs exactly what changed and re-scores the agent.
- **View activity** (drawer) — this month's event count and spend, open cards, then events grouped by day: joined,
  configuration changes, pauses, AI drafts and scans (with their cost), cards assigned by Run, each pipeline stage
  (with its cost and turn count), pull requests opened/merged and follow-up issues filed.
- **Live process** — what the agents are doing, step by step (see [Live process](#live-process)).

Without `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` the page shows "No AI provider connected", **Draft with AI** is disabled and scans are rule-based.

**Permissions vs. what the runtime does.** The pipeline enforces permissions as tools (until v0.3 these were called
"skills"; the database column is still `agents.skills`):

| Permission | Platform support today |
| --- | --- |
| Read repository, Read board & issues | ✅ list/read/search files (GitHub API); the card is in the agent's brief. |
| Write code on branches, Open pull requests | ✅ Developer commits through the GitHub contents API; the pipeline opens the PR. |
| Review pull requests, Comment on issues, File issues, Read CI results | ✅ Reviews (Reviewer, Security, Lead) and test reports posted on the PR, needs-info comments, merge follow-up issues, check runs/statuses. |
| Manage dependencies | ✅ Without it, manifests and lockfiles can't be written. With *Write code* and the sandbox on, the Developer gets `add_dependency` (npm: package.json and the lockfile in one commit). |
| Merge pull requests | 🟡 Not an agent tool: merging is controlled by Settings → Agents (manual, automatic when low risk, automatic). |
| Write tests, Run tests in a sandbox | ✅ With Settings → Sandbox on: `run_tests`, `run_build` and `run_command` for the Developer and the Tester, in gVisor containers ([sandbox.md](sandbox.md)). Off: tests are only written as files. |
| Web research | ❌ Needs a search tool (e.g. OpenAI's web search tool in the Responses API). |
| Read environment secrets | ❌ No per-workspace secrets store. |

## Agent skills

Skills are knowledge packs agents read while they work, in the [Agent Skills](https://agentskills.io) format: a folder
with `SKILL.md` (YAML frontmatter `name` + `description`, markdown body) and optional reference `.md` files. They are
never executed. Not to be confused with **permissions**, which decide what an agent may do.

- **Type**: *Technical* (how to use a technology well, e.g. modern HTML/CSS/JS) or *Practice* (how to do a kind of work
  well, e.g. security review, testing). **Load**: *Always loaded* (the SKILL.md body, ≤ 8 KB, goes into every prompt;
  for short role playbooks) or *On demand* (the agent searches and reads it when the task needs it; for libraries).
- **Sources**: *Built-in* (vendored in `agent-skills/` by pull request, see below) and *Uploaded* (by the workspace
  owner in Settings). Skills from the linked repository are a later phase.
- **Built-ins (v0.3)**: `modern-web-guidance` (Google Chrome's modern web guidance: 211 guides on HTML, CSS, JS,
  accessibility, performance, security; on for the Developer, Reviewer and Security by default) and
  `chrome-extensions` (Manifest V3; off for everyone, for extension projects). Both Apache-2.0, pinned to a commit.
  Upstream tells agents to run `npx modern-web-guidance search/retrieve`; TechTeam agents can't run commands, so
  their prompt maps that to `search_skill` / `read_skill` instead (`usage` in `agent-skills/sources.json`).
- **Built-in design skill (v0.7)**: `interface-design` (Dammyjay93/interface-design, MIT; one on-demand practice file
  on visual hierarchy, spacing and type scales, tokens, states, hit areas, dark mode and "use what exists"; on for the
  Developer and the Tester by default). Its usage note puts the repository's design system and the card's references
  first, treats a rough image or spec as content and intent rather than pixels to copy (fix its spacing, contrast,
  missing loading/empty/error states, mobile and dark mode), skips upstream's ask-the-user, render-tool and
  save-`system.md` steps, and gives the Tester its states and checks as a checklist for the preview.
- **How agents use them**: the system prompt lists the agent's enabled skills (name, type, load, description), framed
  as reference material that never overrides the operating protocol, and includes the body of always-loaded ones.
  `search_skill(skill, query)` ranks a skill's files by title, path and summary; `read_skill(skill, path, offset)`
  returns up to 30 KB per call. Only the agent's enabled skills are reachable. The agent log and the live process
  show these calls ("Searched skill modern-web-guidance: light dismiss dialog"), never their content. Switching a
  skill on or off applies from the agent's next turn.
- **Settings → Agent skills** (`/dashboard/[workspaceId]/settings/skills`, its own page; also in the account menu,
  and a summary card in Settings `#skills` links to it): **Upload skill** opens a dialog for a `SKILL.md`, or a
  `.zip` with SKILL.md at its root or in one folder. It's read and scanned before anything is installed: a critical
  finding blocks it with the reasons; otherwise a confirm step shows the findings, files left out, **Type**,
  **Loading** and **Assign to** (the six agents, pre-checked with the suggestion), then **Install skill**. The result
  stays in the dialog (who it's switched on for) with **Done** where Install was, and **Upload another**. The library
  has a search (name, description, origin; accents and hyphens ignored; Escape clears) and an agent filter (all, on
  for one agent, not used by any), with a count while filtering. It lists built-ins first: badges, origin (built-ins link to the pinned upstream folder) and license, files and size, scan status
  (*Reviewed*, *Scan passed*, or *N scan findings* with details), and the agents that have it on. **Assign** changes
  who uses it; uploaded skills also get **New version** (same name; scanned again; agents using it are rescanned) and
  **Delete** (confirmation). Built-ins can't be deleted, only switched off.
- **Upload limits**: zip ≤ 5 MB, text ≤ 3 MB uncompressed, ≤ 300 files; only `.md` and `.txt` are kept (the rest is
  listed as left out); absolute paths, `..`, symlinks, encryption, ZIP64 and invalid frontmatter are refused (name:
  lowercase letters, digits and single hyphens, ≤ 64; description ≤ 1024).
- **Classification**: from the frontmatter when present —
  ```yaml
  metadata:
    techteam-type: practice          # technical | practice
    techteam-load: always            # always | on_demand
    techteam-roles: tester, reviewer # agents it fits
    techteam-requires: tests.write   # permissions it assumes (warning in the configure dialog)
  ```
  otherwise the AI review proposes them (one call on OpenAI, else Anthropic, billed to the Security agent as a
  scan), and the user confirms.
- **Security scan** (`lib/skill-scan.ts` + the AI review when a provider key exists): prompt-injection phrases,
  credentials, sending secrets out (critical: blocked); pushing to the default branch, disabling tests or CI, sending
  data to URLs, `curl | sh`, invisible characters, instructions in hidden HTML comments (high); large encoded blobs
  (medium). Non-critical findings install with the skill and count in the **trust score** of every agent that has
  it on; built-ins count as reviewed.

## Live process

On the AI Team page, below the agents: the pipeline as six vertical steps — Analysis, Development, Review (Reviewer +
Security), Approval (Lead), Testing, Merge (automatic, no agent).

- **Nothing running**: the header chip says **Inactive**, a note links to the board and to Settings (auto pickup), and
  every step is idle with one line on what it does (Merge's line follows the merge mode).
- **A card in flight**: a header with the card's type, key and title, the elapsed time ("Running 2:41 · step 3 of 6",
  plus the rework round), and **Agent log** (opens the card's log on the board). Finished steps get a green check and
  their result ("Brief ready: …", "Pull request #11 is open on …", "Reviewer approved · Security found nothing",
  "Approved · low risk", "Tests passed · 4 checks held"). The working step is highlighted: its agents' faces with a
  ring, a sentence of what they're doing from their latest action ("The Reviewer is reading the diff of PR #11.
  Security is reading index.html."), the last three actions (tool and target only, never file contents; with the
  agent's name when two share the step) and "Turn x of max · $y so far". Later steps say **Up next**.
- **Several cards** at once (you pressed Run on more than one) → one block per card, oldest first.
- **Live**: the chip says "Live · N working". It refreshes every 5 s while someone works and 15 s otherwise, only while
  the tab is visible (the same poll as the Overview's AI team card); "Reconnecting…" if a refresh fails. Read-only.

## Metrics

`/dashboard/<id>/metrics` (sidebar → Metrics): how the pipeline delivers, for the runs started in the last **7, 30 or
90 days** (`?days=`, 30 by default).

- **Delivered** (merged or ready to merge) with the success rate: delivered out of the runs that ended delivered or
  stopped by the agents. Runs you stopped and questions for you don't count either way.
- **First pass**: delivered without a rework round. **CI pass rate**: pushes whose CI passed, out of those CI decided.
- **Cost per delivered card**: everything spent in the period divided by what was delivered, so failed attempts are
  part of the price.
- **Outcomes** (merged, ready, agents stopped, stopped by you, needed info, running), **Why work went back** (CI failed,
  Lead sent it back, tests failed: one count per rework round) and **Spend by agent** (pipeline work only), as ranked
  bars with every value printed.
- **Recent runs**: the latest 15 with outcome, PR, rework rounds, cost and when they started; the card opens its
  agent log.
- Empty state: "No runs in the last N days" with **Open the board**.

## Pull Requests, Activity

- **Pull Requests** — every pull request the agents opened: title, number, branch → base, card key, Approval (the
  Lead) and Tests verdicts, the Lead's **Risk** (low, medium, high), merge error if the last merge was blocked, and
  **Merge** once the Lead approved and tests passed (manual mode; same
  checks and follow-up rules as auto-merge). Opening the page picks up merges and closes done directly on GitHub
  (cards move to Done). Empty state: "No agent pull requests yet". **View on GitHub** opens the repo's `/pulls`.
- **Activity** — the workspace timeline, newest first, grouped by day: everything the agents logged (assignments,
  each pipeline stage with its result and cost, pull requests opened and merged, follow-up issues, configuration,
  pauses, trust scans, provider switches) plus what people did on the board ("You" for your own): cards created, moved to
  another column (drag and drop or the dialog), edited (which fields) and removed. Each event: title
  with its cost in a small grey badge on the right (what the agent spent on models for that step; agent stages always
  show it, $0.00 included),
  then who and when (time, plus "5 minutes ago" for today), then the detail. Each day's header shows that day's total
  spend. Rows alternate white and a barely-grey tint (zebra) so long days stay easy to scan. 50 events at a
  time, **Show older activity** adds 50 more (up to 500). Empty state: "No activity yet" with **Open the board**.
  Reordering within a column and GitHub syncs aren't logged. The Overview's recent activity shows created and moved
  cards next to the agents' work.

## Settings

`/dashboard/[workspaceId]/settings` (the user menu's **Settings** item; **Agent skills** opens `/settings/skills`).
Two groups: **Your account** (applies to every project you own) and **This workspace**.

Your account:
- **Account** (`#account`) — your GitHub identity: avatar, name, `@login` and "Signed in with GitHub" (or "GitHub not
  connected" with a link to sign in), member since, last sign-in, and **Sign out**.
- **AI** (`#ai`) — everything about AI companies in one card. When TechTeam runs on your computer, it starts with
  **Plans on this computer**: Claude Code's install status and version, TechTeam's own sign-in (email · organization ·
  plan, login expiry) with **Sign in** / **Sign out** / **Check again** and **Confirm this account**, the switch **Use
  my Claude plan for Claude models**, which agents of this workspace it carries, and **When my plan runs out** (wait for
  the reset / continue on the API key / switch company). See [cli-agents.md](cli-agents.md). Then **API keys**:
  configured providers first, the others under "Add another provider". Your account's OpenAI, Anthropic and
  OpenRouter keys (OpenRouter: one key for Google, DeepSeek, Z.ai, xAI and Moonshot models), used by every project: a saved key shows in its field masked (first characters, dots, last four); **Replace
  key** opens an empty password field with a show/hide eye (**Save key**, checked with the provider first, or
  **Cancel**); **Remove** asks first. Without a key: Using the key from the environment, or Not connected. Every company with a key
  is available: each agent picks its company and model on the AI Team page. **Models**: "Models updated 3 hours ago ·
  24 current models from OpenRouter's public list" with **Refresh models** (no key, no spend): the list every model
  picker offers, shared by all your projects, refreshed on its own when older than a day (the AI Team and Settings pages
  check after they load) and kept as it was when OpenRouter doesn't answer. Before the first refresh the app offers its
  built-in list. Below, **This workspace only**:
  **Switch automatically when out of credit** (toggle, off by default; needs two companies with a key; see
  [Out of credit](#out-of-credit)) and the fallback order. The AI Team's "No AI provider connected" chip links here.
- **API spending this month** (`#usage`) — model spend across every project this calendar month (UTC): the total, ranked
  bars by project and by agent. Each project's own spend stays on its AI Team page. With stages on your plans, a
  **Plan usage this month** line: stages, tokens and the API-equivalent cost (not spent).

This workspace:
- **Workspace** (`#workspace`) — avatar, name, repository, default branch, visibility, creation date, **Open repository**.
- **Agent automation** (`#agents`) — **Task pickup** (Manual: Run on each card / Automatic: the Analyst picks the top
  never-run Todo card every 2 minutes) and **Merging pull requests** (Manual: from the Pull Requests page / Automatic when
  low risk: once tests and CI pass, if the Lead rated it low risk / Automatic: once approval, tests and CI pass). Both
  default to Manual; workspaces that merged automatically before v0.2 keep Automatic. A note explains that a blocked merge makes the Tester file a
  follow-up card.
- **Sandbox** (`#sandbox`) — **Let agents run code in the sandbox** (off by default; needs a sandbox host) and the
  **install / test / build** commands, prefilled from `package.json`. **Test the sandbox** runs them on the default
  branch and shows the result. Without a sandbox host the section is one line ("Not set up on this computer…"): no
  controls, and `package.json` isn't read. See [sandbox.md](sandbox.md).
- **Agent skills** (`#skills`) — a summary card (installed and uploaded counts) with **Manage skills**, which opens the library page; see [Agent skills](#agent-skills).

Account and workspace details are read-only.

## Theme

Light (default), Dark and System, from the user menu (**Theme**). Stored by `next-themes` in `localStorage` and
applied before paint (no flash). Dark mode uses the same tokens with darker surfaces; brand-colored text and icons
switch to a brighter blue for contrast.

## Accessibility

- Every interactive element is reachable by keyboard; focus rings are always visible.
- Custom choices (icons, repositories, card type, priority, filter tabs) are native radio buttons styled as tiles.
- Drag and drop has full keyboard support and screen-reader announcements ("Picked up … In Todo, position 2 of 4").
- Status colors never carry meaning alone (always paired with text or an icon) and aren't used for small text, where
  they'd fail WCAG AA contrast.
- Icon-only buttons have labels; decorative icons are hidden from assistive technology.
