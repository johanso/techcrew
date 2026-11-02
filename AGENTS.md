<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TechTeam — Agent Guide

Read this file before changing anything. It sets the design system, typography, coding
conventions and folder structure every agent and contributor must follow.

## 1. What the app does

A user signs in, creates a **workspace**, and links **exactly one GitHub repository** to it.
AI agents then work on that repository on the workspace's behalf.

```
sign-in / sign-up ─▶ /workspaces ──(no workspaces)──▶ /workspaces/new ──Next──▶ /dashboard/<id>
                         │                                  │
                         └──(pick one)──▶ /dashboard/<id>   ├─ name
                                                            ├─ icon or uploaded logo
                                                            └─ connect GitHub ─▶ select repository
```

- `/dashboard` redirects to the newest workspace (`/dashboard/<id>`), or to `/workspaces/new` if there is none.
- `/dashboard/<id>/…` 404s unless the signed-in user owns workspace `<id>`.
- An agent acting on a workspace uses the **owner's** GitHub token: `getGithubToken(workspace.ownerId)` from `lib/github.ts`.
  Work only on `workspace.githubRepoFullName`. Never use one workspace's token or repo for another.

## 2. Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js 16 App Router, React 19 | `proxy.ts` replaces `middleware.ts`. Read bundled docs first. |
| Styling | Tailwind CSS v4 (CSS-first config) | All theme tokens live in `app/globals.css`. There is no `tailwind.config`. |
| Components | shadcn/ui, **base-nova** style, on `@base-ui/react` | Not Radix. Compose with the `render` prop, not `asChild`. |
| Icons | `lucide-react` | Import the `…Icon` suffixed names (`RocketIcon`). |
| Database | PostgreSQL + Drizzle ORM | Schema in `db/schema.ts`; apply with `npm run db:push`. |
| Auth | Hosted Better Auth (CloudHike) | Token in an HTTP-only cookie; see `lib/auth.ts`. |
| GitHub | OAuth App (`repo read:user`) | Separate from social sign-in; tokens are AES-256-GCM encrypted. |
| File storage | Private S3 bucket | Never public; served through ownership-checked routes. |
| Jobs | Inngest | `lib/inngest/*`, `app/api/inngest`. |

## 3. Commands

```bash
npm run dev          # dev server on http://localhost:3000
npm run build        # production build — must pass before you finish
npx tsc --noEmit     # type check
npm run db:push      # apply db/schema.ts to the database
npm run db:studio    # inspect data
npx next typegen     # regenerate PageProps / RouteContext types after adding routes
npx shadcn add <c>   # add a shadcn component into components/ui
```

## 4. Folder structure

```
app/
  (auth)/                 Sign-in, sign-up, social callback. actions.ts = auth server actions.
  api/
    auth/social/[provider]/   Starts GitHub/Google sign-in (hosted auth).
    github/connect/           Starts GitHub OAuth for repository access (state + PKCE).
    github/callback/          Finishes it; stores the encrypted token.
    workspaces/[id]/logo/     Streams a workspace logo from S3 to its owner.
    inngest/                  Inngest handler + trigger.
  workspaces/
    page.tsx              Workspace picker (post-sign-in landing). Redirects to /new if empty.
    new/page.tsx          Create-workspace page.
    actions.ts            createWorkspace, disconnectGithub server actions.
  dashboard/
    page.tsx              Redirects to the newest workspace.
    [workspaceId]/
      layout.tsx          Dashboard shell: sidebar + header. Owner check via getDashboardContext().
      page.tsx            Overview.
      board/ ai-team/ pull-requests/ activity/   One page.tsx per sidebar section.
      settings/           Account (#account) and workspace (#workspace) settings.
  globals.css             THE theme: palette, semantic tokens, Tailwind mapping.
  layout.tsx              Root layout; loads Open Sans.
components/
  ui/                     shadcn primitives. Generated — do not hand-edit; restyle via tokens.
  auth/                   Auth-only UI (forms, social buttons, brand icons, FormMessage).
  workspace/              Workspace UI (avatar, create form, appearance + repo pickers, draft storage).
  dashboard/              Dashboard shell: app-sidebar, workspace-switcher, user-menu, dashboard-header,
                          nav.ts (sidebar sections — server-safe), use-dashboard-section.ts (client hook),
                          page-header (PageHeader, DetailGrid), section-empty.
  app-header.tsx          Signed-in top bar.
  brand.tsx               Product mark.
hooks/                    Client hooks (use-field-errors, use-mobile …).
lib/                      Server logic. Files that touch secrets/DB start with `import "server-only"`.
  auth.ts                 Hosted-auth client, session cookie.
  current-user.ts         getCurrentUser() / requireUser(returnTo).
  github.ts               GitHub OAuth + REST + connection persistence.
  crypto.ts               encrypt / decrypt for secrets at rest.
  storage.ts              S3 uploads/reads, logo limits.
  workspaces.ts           Workspace queries (always scoped by owner) + getDashboardContext().
  workspace-icons.ts      Selectable icon set (shared client/server).
  utils.ts                cn(), initials().
db/                       Drizzle client (index.ts) and schema (schema.ts).
proxy.ts                  Optimistic cookie guard for /dashboard and /workspaces.
```

Where new code goes:

- A route → `app/<segment>/page.tsx`; its mutations → `app/<segment>/actions.ts` (`"use server"`).
- Feature UI → `components/<feature>/`; only cross-feature UI at `components/` root.
- DB queries and third-party API calls → `lib/<domain>.ts`, never inline in components.
- Route handlers only for things server actions can't do: OAuth redirects, binary responses, webhooks.
- A new dashboard section → add it to `DASHBOARD_NAV` in `components/dashboard/nav.ts` and create
  `app/dashboard/[workspaceId]/<segment>/page.tsx`. Sidebar, breadcrumb and switcher pick it up automatically.
- Keep config modules (like `nav.ts`) free of hooks so Server Components can import them; put hooks in a
  separate `"use client"` file.

## 5. Coding conventions

**TypeScript & style**
- Strict TypeScript. No `any`; narrow `unknown` with type guards (see `isWorkspaceIcon`, `isSafeRedirectPath`).
- Double quotes, semicolons, 2-space indent, trailing commas. Files are `kebab-case.tsx`; components `PascalCase`; hooks `use-*.ts` exporting `useX`.
- Imports always use the `@/` alias. Order: React/Next → third-party → `@/` modules.
- Comments explain *why*, not what. Add a one-line doc comment to exported functions whose purpose isn't obvious from the name.

**Server vs client**
- Default to Server Components. Add `"use client"` only for state, effects or browser APIs, and push it to the smallest leaf.
- Server-only modules start with `import "server-only"`. Client code may `import type` from them, never values.
- Pass slow data to the client as an un-awaited promise and `use()` it inside `<Suspense>` (see the repo list on `/workspaces/new`).

**Auth & authorization**
- Get the user with `requireUser(returnTo)` (pages/actions) or `getCurrentUser()` (route handlers). `proxy.ts` is only an optimistic guard.
- Pages under `/dashboard/[workspaceId]` call `getDashboardContext(workspaceId)` — never query the workspace by id
  directly. It is `cache()`d, so layout and page share one lookup.
- Every id that comes from a request is untrusted: load it with an owner-scoped query (`getOwnedWorkspace(ownerId, id)`).
- Post-auth redirects go through `isSafeRedirectPath` — never redirect to a raw query value.

**Server actions & forms**
- Action signature: `(prev: State, formData: FormData) => Promise<State>`, used with `useActionState`.
- Validate every field on the server even if the client validated it. Return `{ errors: { field: "Message." } }` for field errors and `{ message }` for form-level ones; `redirect()` on success.
- Show field errors with `useFieldErrors(state)` (`hooks/use-field-errors.ts`) so they clear on edit.
- Re-validate external state at write time (e.g. `createWorkspace` re-reads the repo from GitHub instead of trusting client data).

**Secrets & external services**
- GitHub tokens are stored only via `saveGithubConnection` (encrypted) and read only via `getGithubToken`. Never send a token, ciphertext or S3 key to the client.
- Uploaded files go to private S3 via `lib/storage.ts`. Allowed logo types: PNG, JPEG, WebP, GIF, ≤ 1 MB. No SVG (script risk).
- Handle a GitHub `401` as "connection expired": prompt the user to reconnect.
- New env vars must be added to `.env.example` with a placeholder and a comment. Never put real credentials in `.env.example`.

**Database**
- Change `db/schema.ts`, then `npm run db:push`. Never touch the `auth` schema (owned by the hosted auth service).
- Tables are `snake_case` plural; columns `snake_case` in SQL, `camelCase` in TS. Foreign keys to `users.id` use `onDelete: "cascade"`.

## 6. Design system

### 6.1 Color palette

Raw colors exist **only** in `app/globals.css` as `--palette-*`. Everything else uses semantic tokens.
To re-skin the app, edit the palette there — no component changes needed.

**Primary**

| Name | Hex | Tailwind utility | Use for |
| --- | --- | --- | --- |
| brand | `#006fbb` | `bg-brand` `text-brand` (also `primary`) | Primary buttons, selected states, links, brand mark, completed steps. |
| accent | `#fbc100` | `bg-brand-accent` `text-brand-accent` | Sparse highlights only: a badge, a key word on a dark panel. Never large fills or body text. Text on it: `text-brand-accent-foreground`. |
| darkest | `#21262c` | `bg-darkest` `text-darkest` (also `foreground`) | Body text, dark panels, GitHub/neutral-dark buttons, dark-mode background. |
| lightest | `#eef1f3` | `bg-lightest` (also `muted`, `secondary`, `accent`, `canvas`) | Subtle surfaces. Same in light and dark — for theme-aware backgrounds use `bg-canvas` / `bg-muted`. |

**Secondary**

| Name | Hex | Tailwind utility | Use for |
| --- | --- | --- | --- |
| dark | `#7f90a4` | `text-dark` | Secondary text **on dark surfaces only**. On light surfaces use `text-muted-foreground`. |
| light | `#d7d7d7` | `border-light` (also `border`, `input`) | Borders, dividers, input outlines. |
| action | `#009cdf` | `text-action` `ring-action` (also `ring`) | Focus rings, informational highlights, icons on dark panels. |
| success | `#61bf33` | `bg-success` `text-success` | Success icons, progress fills, status dots. |
| warning | `#e96b1a` | `bg-warning` `text-warning` | Warning icons, fills, badges. |
| error | `#df1919` | `bg-error` `text-error` (also `destructive`) | Errors, destructive actions, invalid fields. |

**Rules**
1. Never write hex/rgb/oklch values or Tailwind palette colors (`sky-500`, `zinc-950`, `emerald-600` …) in components. If a token is missing, add it to `globals.css` (palette → semantic → `@theme inline`).
2. Prefer semantic shadcn tokens (`bg-background`, `text-muted-foreground`, `border`) for generic UI; use palette utilities (`bg-brand`, `text-success`) when the meaning is the brand color itself.
3. Name clash: shadcn's `accent` is the subtle hover surface. The yellow palette accent is `brand-accent`.
4. Palette utilities (`bg-lightest`, `text-brand` …) do **not** change with the theme. For surfaces use the
   semantic tokens: `bg-canvas` (page background behind cards: lightest → darkest), `bg-card`, `bg-muted`.
   For brand-colored text on sidebar/nav surfaces use `text-sidebar-primary` (brand → action in dark).
5. Contrast (WCAG AA): `success`, `warning`, `action` and `dark` are **below 4.5:1 on white** — use them for icons, borders, fills and large text, not small body text on light backgrounds. Pair text-on-color with its `-foreground` token (`bg-success text-success-foreground`). `brand`, `error`, `darkest` and `muted-foreground` are safe for text on white.
6. Tints: use opacity modifiers on tokens — `bg-brand/10`, `border-destructive/30`, `bg-muted/60`.
7. Dark mode: `next-themes` toggles `.dark` on `<html>` (user menu → Theme; default light). Tokens are redefined
   under `.dark` in `globals.css`. Components must not use `dark:` color overrides; fix or add a token instead.

### 6.2 Typography

Typeface: **Open Sans** (loaded in `app/layout.tsx` via `next/font`, weights 300–700), exposed as `font-sans` and `font-heading`.
The app's base size is **14 px** (`text-sm`); headings use `font-semibold` and tight tracking (applied globally to `h1`–`h4`).

| Role | Classes | Size / line height | Weight |
| --- | --- | --- | --- |
| Page title (h1) | `text-3xl font-semibold` | 30 / 36 | 600 |
| Section title (h2) | `text-xl font-semibold` | 20 / 28 | 600 |
| Card / step title (h2–h3) | `text-base font-semibold` | 16 / 24 | 600 |
| Body | `text-sm` | 14 / 20 | 400 |
| Lead / large body | `text-base` | 16 / 24 | 400 |
| Secondary text | `text-sm text-muted-foreground` | 14 / 20 | 400 |
| Caption / helper | `text-xs text-muted-foreground` | 12 / 16 | 400 |
| Eyebrow / label | `text-xs font-semibold tracking-wide uppercase` (`text-brand` or `text-muted-foreground`) | 12 / 16 | 600 |
| Display (marketing) | `text-4xl`–`text-5xl font-semibold` | 36–48 | 600 |
| Light display | `font-light` | — | 300 — large display text only |

**Rules**
- One `h1` per page. Don't skip heading levels for styling — pick the level, then the classes.
- Weights in use: 400 body, 500 (`font-medium`) for emphasis/labels, 600 (`font-semibold`) for headings and buttons-with-emphasis. Avoid `font-bold`.
- Use sentence case for titles, buttons and labels ("Create a new workspace", not "Create A New Workspace").
- Truncate user-provided strings in constrained rows (`truncate`, `line-clamp-1`).

### 6.3 Layout, surfaces & components

- **Dashboard shell (`/dashboard/[workspaceId]/*`):** provided by the layout — collapsible sidebar (`collapsible="icon"`,
  state persisted in the `sidebar_state` cookie, toggle with ⌘/Ctrl+B) and a sticky `h-14` header. Pages render only
  their content: start with `<PageHeader title description actions? />` (the page's one `h1`), then sections.
  Empty sections use `<SectionEmpty icon title description />`. Every sidebar item needs a `tooltip` (icon-only mode).
- **Other signed-in pages** (`/workspaces*`): `min-h-svh bg-canvas` → `<AppHeader user={user} />` →
  `<main className="mx-auto max-w-2xl px-6 py-10">`.
- **Menus:** `DropdownMenu*` from `components/ui/dropdown-menu` (Base UI). Navigation items use
  `<DropdownMenuItem render={<Link href=… />}>`; `DropdownMenuLabel` must sit inside a `DropdownMenuGroup`.
  Triggers styled as other components use `render` (`<DropdownMenuTrigger render={<SidebarMenuButton />}>`).
- **Surfaces:** cards are `rounded-xl border bg-card shadow-xs` (hero form panels `rounded-2xl`). Don't stack shadows; one level of elevation.
- **Spacing:** 4-px grid via Tailwind spacing. Use `gap-*` on flex/grid, not margins between siblings. Typical: `gap-1` title+description, `gap-4` within a section, `gap-8` between page sections, `p-6` card padding.
- **Radius:** derived from `--radius` (0.625rem): `rounded-lg` controls, `rounded-xl` cards, `rounded-full` avatars/pills.
- **Buttons:** `Button` from `components/ui/button`. Form CTAs `h-10`, toolbar/secondary `h-9`. One primary (`default` variant) per view; others `outline`/`ghost`. For links styled as buttons use `buttonVariants()` on `<Link>`/`<a>`. Pending state: `disabled` + `<Spinner />` + a verb in progress ("Creating workspace…").
- **Forms:** `Field`, `FieldLabel`, `FieldError` from `components/ui/field`; inputs `h-10`; form-level errors with `FormMessage` (`components/auth/form-parts`).
- **Selection controls:** custom-styled choices (icon grid, repo list) are native `<input type="radio" className="peer sr-only">` inside a `<label>`, styled with `peer-checked:` / `peer-focus-visible:`. This keeps keyboard and screen-reader support for free.
- **Loading:** stream with `<Suspense>` and a `Skeleton` that matches the final layout. **Empty states:** dashed border panel (`border-dashed`) with one sentence and one action.
- **Icons:** lucide at `size-4` inline, `size-5` in 40-px tiles. Decorative icons get `aria-hidden` (lucide default); meaningful icon-only buttons need an `aria-label` or `sr-only` text.
- **Workspace identity:** always render with `<WorkspaceAvatar icon logoSrc size />`; get `logoSrc` from `workspaceLogoSrc(workspace)`.
- **Motion:** subtle only — `transition-colors`, `animate-in fade-in` (tw-animate-css). No motion that blocks interaction.
- **Responsive:** mobile-first; check 375 px width. Stack horizontal groups with `flex-col sm:flex-row`.
- **Accessibility:** every input has a label (visually hidden with `sr-only` if needed); focus must stay visible (`ring-ring/50`); color is never the only signal (pair with icon or text).

## 7. Environment variables

See `.env.example` for the full list with comments. Feature-specific:

| Variable | Needed for |
| --- | --- |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Connecting GitHub on `/workspaces/new`. OAuth App callback: `<NEXT_PUBLIC_APP_URL>/api/github/callback`. |
| `TOKEN_ENCRYPTION_KEY` | Encrypting GitHub tokens (`openssl rand -base64 32`). Rotating it forces every user to reconnect. |
| `S3_*` | Workspace logo uploads. Without them the upload button is disabled; icons still work. |
