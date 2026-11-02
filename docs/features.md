# Features

What each part of the product does, from the user's point of view, with pointers to the code.

- [Sign up and sign in](#sign-up-and-sign-in)
- [Workspaces](#workspaces)
- [Dashboard shell](#dashboard-shell)
- [Overview](#overview)
- [Board](#board)
- [GitHub issues on the board](#github-issues-on-the-board)
- [Card actions: Run and Remove](#card-actions-run-and-remove)
- [AI Team, Pull Requests, Activity](#ai-team-pull-requests-activity)
- [Settings](#settings)
- [Theme](#theme)
- [Accessibility](#accessibility)

---

## Sign up and sign in

Pages: `/sign-up`, `/sign-in` (`app/(auth)/`). Layout: form on the left, product panel on the right (hidden on small screens).

- **Email + password.** Sign-up asks for name, email and a password of at least 8 characters; sign-in for email and
  password. Validation runs on the server; errors appear under each field and disappear as soon as you edit it.
- **GitHub / Google buttons** start social sign-in through the hosted auth service.
- **Email verification.** If the auth project requires it, sign-up shows "We sent a verification link to …" instead
  of signing in, and signing in before verifying shows "Please verify your email address…".
- **Errors** are mapped to plain messages: wrong credentials, too many attempts (429), service unavailable (503),
  email already registered (422).
- **Redirects.** Both pages accept `?next=/some/path`. After signing in you go there (only same-origin paths are
  accepted), otherwise to `/workspaces`. Visiting these pages while signed in redirects right away.
- **Sign out** is in the user menu (sidebar footer or header avatar). It revokes the session and clears the cookie.

Code: `app/(auth)/actions.ts`, `components/auth/*`, `lib/auth.ts`. Flow details: [architecture.md](architecture.md#authentication-and-sessions).

## Workspaces

### Workspace picker — `/workspaces`

The landing page after sign-in. Lists your workspaces (avatar, name, linked repository, private badge, age).
Clicking one opens its dashboard. **New workspace** opens the create page. If you have no workspaces, this page
redirects to `/workspaces/new`.

### Create a workspace — `/workspaces/new`

A three-step form with a live preview card on top:

1. **Name** — required, up to 60 characters.
2. **Icon or logo** — pick one of 16 icons, or **Upload custom logo** (PNG, JPG, WebP or GIF, up to 1 MB; SVG is
   deliberately not allowed). A logo replaces the icon; **Remove** goes back to the icon. Upload is disabled when S3
   isn't configured.
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
- **User footer** — your avatar, name and email; opens the user menu: Account settings, Workspace settings, Theme
  (Light / Dark / System), Sign out.
- **Collapsible to icons only.** Toggle with the header button, the sidebar edge (rail), or **⌘B / Ctrl+B**. The
  state is remembered in the `sidebar_state` cookie, so it renders correctly on the next load. In icon mode every
  item shows a tooltip.
- **Mobile**: the sidebar becomes a sheet that slides in from the left and closes after you pick a destination.

**Header** (`components/dashboard/dashboard-header.tsx`)
- Sidebar toggle, breadcrumb (`Workspace › Section`).
- GitHub button (opens the linked repository), notifications (empty state for now), avatar with the same user menu.

**Content panel** — a rounded panel with its own scroll; the header stays pinned inside it. Pages use
`max-w-6xl`; the board opts out to use the full width.

**Routing rules** — `/dashboard` redirects to your newest workspace (or to `/workspaces/new`). A workspace you don't
own is a 404.

## Overview

`/dashboard/[workspaceId]` — ⚠️ **dummy data** (`lib/overview.ts`):

- Welcome header with your first name.
- Three stat cards: **Open tasks**, **In progress**, **PR ready** (fixed numbers).
- **Upcoming tasks** (left) — five sample tasks with status icon, key, priority, labels, due date and agent;
  **View board** link.
- **AI Agent Office Space** (right) — placeholder ("The office is being built").
- **Recent activity** — six sample events (PR opened, commits pushed, review requested, …) with relative times;
  **View all** link.

The board has real data now; wiring the Overview to it is a suggested next step ([status.md](status.md)).

## Board

`/dashboard/[workspaceId]/board` — the Kanban board, persisted in the `tasks` table.

**Columns** — Todo, In Development, In Review, Testing, Done. Each has a light tint (slate, sky, amber, orange,
green), a count, and a **+** button that opens the create dialog preset to that column. Empty columns say what
belongs there ("Ready to be picked up. Drop a card here.").

**Cards** show:
- type pill (Feature ✦, Bug 🐞, Issue ◉) and the key (`ACM-142`, always);
- title (up to three lines), labels;
- priority (Urgent / High / Medium / Low, as a colored dot), GitHub issue number for synced cards (`#12`), due date
  ("Today", "Tomorrow", or the date; red with a calendar-x icon when overdue — not in Done), and the assigned agent's
  avatar;
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

**Layout** — the board scrolls horizontally when the five columns don't fit (snapping to columns on mobile).

Code: `components/board/*`, `lib/board.ts`, `lib/board-config.ts`, `app/dashboard/[workspaceId]/board/actions.ts`.

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

## Card actions: Run and Remove

Each card has a **▶** button and a **⋯** menu with **Run** and **Remove task**. They sit beside the card's drag area,
so using them never starts a drag or opens the dialog.

- **Run** hands the card to the **Analyst** agent: the server queues an `agent/task.run` job in Inngest and, only if
  that succeeds, assigns the card (its avatar appears on the card). While starting, ▶ shows a spinner and is
  disabled. Running an assigned card again re-queues it ("Run again with Analyst"). ⚠️ The job is a placeholder: it
  checks the card still exists and logs — see [background-jobs.md](background-jobs.md#agent-task-run).
- **Remove task** asks for confirmation, then takes the card off the board. For GitHub cards the issue stays open
  on GitHub and won't be synced back. The row is kept as a tombstone so the key isn't reused.

Locally, Run needs the Inngest Dev Server (`npm run inngest:dev`); otherwise it shows an error saying so.

## AI Team, Pull Requests, Activity

Pages exist with headers and empty states only:
- **AI Team** — "No agents yet".
- **Pull Requests** — "No agent pull requests yet" + **View pull requests on GitHub** (opens the repo's `/pulls`).
- **Activity** — "No activity yet".

## Settings

`/dashboard/[workspaceId]/settings` (also reachable from the user menu, which jumps to `#account` or `#workspace`):
- **Account** — avatar, name, verified-email badge, email, member since, last sign-in, account id.
- **Workspace** — avatar, name, repository, default branch, visibility, creation date, **Open repository**.

Read-only for now.

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
