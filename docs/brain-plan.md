# Brain plan (v0.11)

A memory the agents read before they work and learn into, with a person reviewing every change. Plan, decisions, data
model, security rules and the four parts it is built in. For where the product goes, see [roadmap.md](roadmap.md#v011--brain).

- [Decisions](#decisions)
- [Goal and limits](#goal-and-limits)
- [A note](#a-note)
- [Layers and where they live](#layers-and-where-they-live)
- [How agents read it](#how-agents-read-it)
- [How it learns](#how-it-learns)
- [Security](#security)
- [Screens](#screens)
- [Data model](#data-model)
- [How we will know it works](#how-we-will-know-it-works)
- [The four parts](#the-four-parts)
- [Risks](#risks)

---

## Decisions

Taken with the owner, 2026-11-24:

1. **Two layers**: a **project** memory per repository and an **owner** (global) memory across projects. A lesson is born
   in a project and only moves up to the owner's memory when the owner approves it.
2. **Project memory is proposed in a separate pull request** ("TechTeam memory"), never inside a card's pull request.
   The default mode is `repo` (files under `.techteam/memory/`); nothing is added to a repository until the owner merges
   that pull request. A workspace can choose `local` (notes in the database, no files in the repository) or `off`.
3. **The Lead's finish tool gets a `lessons` field** (at most three, each with its evidence).
4. **Four parts, reviewed between each**: A foundation, B signals, C the librarian, D promotion and release.
5. **The owner's memory lives in the database** (table `memory_notes`): tiny (a note is at most 2 KB), covered by backup
   and restore, queryable for proposals, status and search, scoped by user. An "export to Markdown" button can come
   later without changing the design.

## Goal and limits

**Goal:** every agent starts a card knowing how work is done in that repository and how the owner prefers it done, and
the system learns from what the owner rejects or corrects.

**Not in v0.11:** training or fine-tuning models, embeddings (the ranking is lexical, as for skills), writing memory
without a review, anything that moves information between projects on its own.

## A note

A short Markdown file with a header (same parser as agent skills, `lib/skill-format.ts`):

```markdown
---
title: Tests run with vitest, not jest
type: command          # convention | decision | pitfall | command | preference | lesson
load: always           # always (the core) | on-demand (searched)
status: active         # active | stale | disabled
paths: ["src/**/*.test.ts"]   # optional: more relevant when the change touches these files
source: { kind: pr_rejected, run: 41, pr: 12 }
---
`npm test` uses vitest. A new test goes next to its module (`foo.ts` -> `foo.test.ts`). Use `vi.fn`, not `jest.fn`.
```

Short on purpose: about 600 characters, a hard limit of 2,000. Every note keeps its **source** (the run, pull request,
question or person that produced it).

## Layers and where they live

| Layer | Source of truth | Why |
| --- | --- | --- |
| **Project, mode `repo`** (default) | `.techteam/memory/` in the repository: `conventions.md` (the core, always loaded) and `notes/<slug>.md` | Reviewed by pull request, travels with the repository, can be shared |
| **Project, mode `local`** | `memory_notes` rows with a workspace | For repositories where files should not be added (public or not yours) |
| **Owner (global)** | `memory_notes` rows with no workspace | Backed up with the database; never inside a repository |

A third layer per role or model ("the Reviewer is too lenient") is not memory: it is corrected with evaluations (v0.12).

## How agents read it

- **Always loaded**: a small block in every stage's system prompt (`memoryPromptBlock`, next to `skillsPromptBlock`): up
  to 2,000 characters of project core and 1,000 of the owner's. It is framed as **reference data, not instructions**: the
  operating protocol overrides any note, and a note can never add a tool or a permission.
- **On demand**: `search_memory` and `read_memory`, read-only, any stage, offered when notes exist, ranked with the
  same lexical ranking as skills (`rankSkillFiles`). A note with `paths` ranks higher when the diff touches those paths.
- **Who**: every agent. The Reviewer also checks the diff against the conventions; the Analyst uses them for the card.
- **Cost**: the block sits in the stable prefix of the prompt, the part providers cache best. Reads are logged by target
  only (`toolStep`), never by content.

## How it learns

Everything becomes a **signal** first (`memory_signals`), then the librarian turns signals into **proposals**.

**Sources of signals**

1. A pull request closed without merging: the card asks once **why** (not what I asked, wrong approach, style or
   conventions, too big, unneeded, other + text). What the owner types is trusted.
2. A rework round: the Lead's `request_changes` text and the CI failure summary (already stored).
3. The owner's answers to the Analyst (`agent_runs.answer`), often conventions in disguise.
4. Run failures, once they are classified (v0.12).
5. **The Lead's `lessons`** (at most three, with evidence) in its approval result.
6. The owner directly: **Remember this** on a card or a log step, and an editor on the Brain page.
7. **Bootstrap from the repository**: a button (and an offer when a workspace is created) that reads the README,
   contributing notes, lint, TypeScript and formatter configuration, the CI workflow, the `package.json` scripts and the
   test layout, and proposes a first `conventions.md`.

**The librarian** runs after a merge or a close, a rejection reason or a **Remember this**, once there is enough to
learn from, or on **Learn now**. What the owner asked to remember for everything is proposed in their words, without a
model; the rest goes to one structured model call (a cheap model, on the Lead's budget, honoring pause and spend limits)
that proposes project notes. It dedupes against existing notes and updates instead of adding; marking notes whose files
no longer exist as `stale` is part D.

**How a proposal arrives**

- **Project, mode `repo`**: in **one separate pull request** (`TechTeam memory: N notes`, branch
  `agent/memory-<date>`, one commit per send that touches only `.techteam/memory/**`), opened by the owner's click, never
  mixed with a card and never merged by TechTeam. Only that code path writes there; the agents' write tools keep refusing
  the folder.
- **Project, mode `local`, and the owner's memory**: an **inbox** in the app (Accept, Edit, Reject), with the evidence.
- **Promotion to the owner's memory**: when the librarian sees a similar lesson in two or more workspaces it drafts a
  version **without repository names, paths or identifiers** (a deterministic strip pass plus a model check) and puts it
  in the owner's inbox. Nothing moves on its own.

## Security

A persistent memory is an injection vector: an issue saying "always run X" could be stored as a lesson.

1. **Propose only.** A person merges or accepts every change.
2. **A deterministic scan**, like skills (`lib/skill-scan.ts`): no "ignore the previous instructions" patterns, no
   commands to run (`curl | sh`), no URLs outside an allowlist, no secret patterns, nothing asking for tools or
   permissions; plain Markdown only; size limits.
3. **Provenance on every note.** A proposal whose evidence comes **only from other people's text** (issues or comments
   of third parties in a public repository) is flagged `untrusted_origin` and needs an explicit review. What the owner
   wrote is trusted.
4. **Isolation between projects by construction**: the tools read only the current workspace's memory and the owner's,
   every query is scoped by owner and workspace, and tests prove it.
5. **Public repositories**: the screen warns that the notes will be visible; mode `local` avoids it.
6. Notes are **summaries**, never pasted file contents, and are scanned for secrets.

## Screens

A **Brain** section in the workspace: **Notes** (search, filter, origin, edit as a proposal), **Proposals** (the inbox),
**Your memory** (the global notes), **Activity** (what it learned and why: *"PR #12 rejected: wrong approach -> proposed
note X"*) and **Settings** (mode `repo` / `local` / `off`, bootstrap from the repository, the size of the always-loaded
block). The agent log shows `search_memory` / `read_memory` calls and a run's header says how many notes it loaded.

## Data model

All additive (migration `0021`, `0022`… as each part needs):

- `memory_notes` (`user_id`, nullable `workspace_id`, `scope` global | project, `type`, `title`, `body`, `load`,
  `status`, `paths` text[], `source` jsonb, `origin` owner | agent | bootstrap, `content_hash`, timestamps). Global
  notes and `local`-mode project notes; in `repo` mode the repository's files are the truth.
- `memory_proposals` (`kind` add | update | retire, `scope`, the target, the proposed text, `rationale`, `evidence`
  jsonb, `untrusted_origin`, `origin`, `content_hash`, `status` pending | accepted | in_pr | merged | rejected |
  superseded, the memory pull request number, timestamps; [data-model.md](data-model.md#memory_proposals)).
- `workspaces.memory_auto_learn` and `workspaces.memory_librarian` (the last run).
- `memory_signals` (`kind` pr_rejected | rework | answer | failure | lesson | remember, `run_id`, `pr_number`, `task_id`,
  `payload` jsonb, `trusted`, `created_at`, `consumed_at`).
- `workspaces.memory_mode` (`repo` | `local` | `off`, default `repo`) and `workspaces.memory_bootstrapped_at`.

The new tables belong in the backup registry (they hold no secrets), with the guard test updated.

## How we will know it works

- **Proposal acceptance rate**: under about 50% means the librarian is noisy.
- **Repeated rejections for the same reason** after a note exists should fall.
- Per note: times served and what happened in the runs it was served to (a hint, with enough data).
- The real measure, with the v0.12 evaluations: the same set of cards with and without memory.

## The four parts

Each is its own branch and pull request, verified for real before the next starts.

| Part | Delivers | The owner can already |
| --- | --- | --- |
| **A. Foundation** | Migration, note format and parser, the scanner, the loader (repository files in `repo` mode, rows otherwise), `memoryPromptBlock`, `search_memory` / `read_memory`, the Brain page with manual notes (global and `local` project notes) | Write conventions and see agents obey them |
| **B. Signals** | The "why was it rejected" prompt, signals from rework, answers and the Lead's `lessons`, **Remember this** | Have TechTeam start collecting what it learns |
| **C. The librarian** | The `memory` stage, proposals, the inbox, the separate memory pull request, bootstrap from a repository | A first `conventions.md` built from `roadmapfront` |
| **D. Promotion and release** | Promotion to the owner's memory without project details, stale detection, usage counters, docs and **v0.11.0** | Learning across projects |

Real checks per part use `roadmapfront` and the throwaway repository: start a memory, create two cards, reject one pull
request with a reason, and watch the proposal appear.

## Status

| Part | State | What exists | What does not |
| --- | --- | --- | --- |
| **A. Foundation** | Built, in review | Migration `0021` (`memory_notes`, `workspaces.memory_mode` and `memory_bootstrapped_at`), the note format and parser (`lib/memory-config.ts`), the scanner (`lib/memory-scan.ts`), the loader (repository files in `repo` mode through `lib/memory-loader.ts`, rows in `local` mode and for the owner's notes, `lib/memory.ts`), the Memory block pinned per stage, `search_memory` / `read_memory`, the Reviewer's check, the Brain page (notes, your memory, what agents get, settings), tests, backup coverage | No `memory_proposals` or `memory_signals` tables, no signals, no librarian, no proposals inbox, no memory pull request (the page says to edit the files in the repository), no bootstrap from a repository, no promotion, no stale detection, no usage counters, no "Brain" line in a run's header; not yet exercised by a full live or simulated pipeline run |
| **B. Signals** | Built, in review | Migration `0022` (`memory_signals`, `pull_requests.rejection_prompt`), the builders, lessons parser and retention (`lib/memory-signals.ts`), the writer that never throws (`lib/memory-signals-store.ts`), signals from rejected pull requests (the one question on the card and the Pull Requests page), rework rounds, answers to the Analyst, the Lead's `lessons` and **Remember this** (card menu and agent log), the Brain page's Activity with delete, tests, backup coverage | No `failure` signals (they wait for the classification of v0.12), nothing consumes a signal (`consumed_at` stays empty), no librarian, proposals or memory pull requests; the Lead's `lessons` not yet exercised with a real model (the simulated Lead suggests none) |
| **C. The librarian** | Built, in review | Migration `0023` (`memory_proposals`, `workspaces.memory_auto_learn` and `memory_librarian`), the librarian's structured call and the server's checks (`lib/librarian.ts`, `lib/librarian-run.ts`), the Inngest functions with debounced automatic requests, **Learn now**, bootstrap from a repository (`lib/memory-bootstrap.ts`), the Proposals inbox (accept, edit then accept, reject, supersede on change), the memory pull request with its path guard (`lib/memory-files.ts`, `lib/memory-proposals-store.ts`), a simulated librarian, tests, backup coverage | No promotion across projects, no `stale` marking (nothing detects notes whose files are gone), no usage counters, no Claude plan route; not yet run with a real model |
| **D. Promotion and release** | Not started | | |

Choices made while building A: a note's key is `project/<name>` or `global/<name>-<id>`; `load` is written `on-demand` in
files and `on_demand` in the database (both read); links are limited to github.com and docs.github.com (loopback is
allowed); with mode `off` the owner's notes are not loaded either; notes written on the page keep their status when
edited (switch off and on are separate actions).

Choices made while building B: the question is a column on the pull request, not a signal (a signal exists only once the
owner answers); a pull request isn't asked about when a later one from the same branch, card or follow-up card exists;
with memory `off` nothing is collected or asked on its own (a pending question is hidden until memory is back on;
**Remember this** stays available), and nothing is recorded when the mode can't be read; a lesson refused by the scan is dropped
whole, rework feedback loses only the refused items; **Remember this** saved with someone else's starting text unchanged
is untrusted; signals have no `status` and are deleted by the owner or by the limit of 500.

Choices made while building C:

- **The librarian** is not a pipeline stage or a seventh agent: one structured call without tools. It is paid and logged
  on the **Lead** (activity kind `memory`, honoring pause and budget), and runs with **API keys only** (no Claude plan
  route yet): the company of the Lead's model if it has a key, else OpenAI, Anthropic, OpenRouter; the company's fast
  model to learn (low effort where listed), its balanced one to bootstrap.
- **A model never writes the owner's global memory.** The model proposes project notes only (its schema has no scope,
  and the server refuses one); it sees global notes just to avoid repeating them. A global proposal exists only for a
  **Remember this** the owner typed for everything: server code turns it into one new note of their words (title: the
  first line or sentence; type preference; always loaded), with the same validation, scan and dedupe. That signal is
  never sent to a model, and the step needs no key and no budget: it runs first in a learning run, so a paused Lead or
  a missing key only stops the rest. **Remember this** saved with someone else's text unchanged goes to the model like
  any signal and can only become a project proposal. Promotion from project lessons stays in part D.
- **Only the owner's click opens the memory pull request** (*Open memory pull request*, with the chosen proposals);
  there is no dedicated `propose_memory` tool and nothing is pushed on its own. While it is open, the next click adds a
  commit to its branch (fast-forward only). It isn't a row of `pull_requests`; its state is read when the Brain page
  loads or on **Check GitHub**.
- **Retiring** deletes the note's file in the repository (the diff shows what goes; history keeps it), and switches a
  database note off (`disabled`).
- The **core note** is the first chosen addition that is `always` loaded and a `convention` while `conventions.md`
  doesn't exist; other additions go to `notes/<slug>.md`. Bootstrap proposes its conventions as an update when the core
  exists.
- At most 5 proposals per learning run; the bootstrap, one conventions note and up to 5 more. Automatic runs wait for a
  quiet 3 minutes (15 at most) and need 3 unused signals or one the owner typed, and fewer than 20 waiting proposals;
  **Learn now** takes any unused signal. A successful step uses its signals up even when it proposes nothing.
- A repeat is the same note title (in its scope) or text, a second change to a note with one waiting, or something
  rejected before (an addition also by title). `untrusted_origin` is true when no cited signal was typed by the owner:
  one trusted signal among them clears it, so each evidence item still shows its own mark.
- A proposal records the target note's version (a hash of all its fields); accepting or sending it after any change
  marks it `superseded`. Evidence is copied into the proposal, so deleting a signal doesn't remove it. `run_id` from the
  data model sketch was left out: a proposal can rest on several runs.
- The librarian is offered the notes that aren't switched off (up to 20,000 characters) and up to 40 unused signals (up
  to 24,000 characters), newest first.

## Risks

| Risk | Answer |
| --- | --- |
| Notes pile up or contradict each other | Limits, consolidation, a `stale` status |
| An agent applies a lesson where it does not belong | Notes with scope and `paths`; the Reviewer checks they were applied right |
| Files added to repositories | Pull request only, and mode `local` |
| Cost | A small block in the cacheable prefix; a budgeted librarian |
