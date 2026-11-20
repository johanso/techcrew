# Plan: a live model catalog (no hand-written model lists)

Status: implemented 2026-11-21 on branch `feat/model-catalog` (migration `0017_model_catalog`). Differences from this
plan: the effort *levels* are in the catalog after all (`reasoning.supported_efforts`), so `modelKnobs` takes them from
there, with `MODEL_EFFORTS` as the override; "current" also needs the family to have shipped within 183 days of its
company's newest model (newest-per-family alone kept GPT-3.5 Turbo, GPT-4o, GPT-5.5 …), and previews, image-output
models and OpenRouter's `-pro` mode twins (same model and price, another reasoning mode the native API lacks) are left
out; "keep a model an agent uses" is done by never deleting rows (`listed` false) and showing the agent's own model as
"older" in its picker, not at refresh time; tiers use `floor(3 × rank / n)` (a lone model is balanced) and moving
company picks the nearest price within the tier (else the nearest price); role defaults take the tier's cheapest model,
on OpenRouter DeepSeek's first (OpenAI's balanced default is now GPT-6.1 Terra, not Sol); drafting and trust reviews
use the Analyst's default (no fixed `CONFIG_MODELS`); OpenRouter's host routing rules can't be checked from `/models`
(it lists API paths, not hosts) and stay per request; no Inngest cron (stale-on-load + the button); the automatic
refresh is off in simulated mode, the button still works. Written for the agent that implements it, on a new branch from `main` after
`feat/cli-agents` is merged (or on `feat/cli-agents` if it isn't yet). Read `AGENTS.md` and `CLAUDE.local.md` first;
every rule there applies (noreply commit identity, `npm run check` + `npm run build`, docs current, ask before live
runs, never print env values).

## 1. The problem

`AGENT_MODELS` in `lib/agent-config.ts` is a hand-written list (Opus/Sonnet/Haiku 5.5, a few GPT-6.x, 10 OpenRouter
models) with prices, tier, vision and per-model request knobs (`MODEL_EFFORTS` in `lib/agent-request-params.ts`).
Every new model needs a code change, and the list is already stale: Claude Fable 5.2 and GPT-6.2 (Sol, Astra) exist
and can't be picked. A guessed rule ("Pro has no Opus") also blocked a model the owner's plan carries (fixed in
db84f8a by not guessing).

**What the owner wants:** pick a company in AI Team and see that company's current models, as they really are,
without anyone updating code.

## 2. The source: OpenRouter's public catalog

`GET https://openrouter.ai/api/v1/models` (public, **no key**; check the current docs with Context7) returns ~480
models, **including Anthropic's and OpenAI's own** (`anthropic/claude-fable-5.2`, `anthropic/claude-opus-5.5`,
`openai/gpt-6.2-sol`, …), each with `pricing` (prompt, completion, `input_cache_read`, `input_cache_write`, per
token, as strings), `architecture.input_modalities` (image = vision), `supported_parameters` (`tools`,
`structured_outputs`, `reasoning`, `reasoning_effort`, `verbosity`, …), `context_length`, `created`,
`expiration_date`. Verified 2026-11-21.

One catalog serves every route:
- **OpenRouter route**: the OpenRouter id as today.
- **Anthropic API and the Claude plan (Claude Code)**: map `anthropic/claude-opus-5.5` → `claude-opus-5-5` (drop
  the prefix, dots in the version → dashes). Check the mapping against the ids already in use (`claude-opus-5-5`,
  `claude-sonnet-5-5`, `claude-haiku-5-5`) with a test. Claude Code accepts the full id (`--model`).
- **OpenAI API**: `openai/gpt-6.1-sol` → `gpt-6.1-sol` (drop the prefix).

## 3. Design

### 3.1 Catalog module (`lib/model-catalog.ts`, server-only; pure parts in `lib/model-catalog-config.ts`, tested)

- `refreshModelCatalog()`: fetch, parse, filter, store. Stored in the database (new table `model_catalog`: one row
  per model, or one JSON row; the database is shared by both computers, so one refresh serves both) with
  `fetched_at`. Refresh when older than 24 h (on AI Team / Settings load, in the background, never blocking the
  page) and with a **Refresh models** button in Settings → AI. Daily Inngest cron optional.
- **Fallback**: if the fetch fails, keep the last stored catalog; if there is none (first run offline), use a small
  built-in seed (today's `AGENT_MODELS`, kept only as the seed).
- **Filter** (pure, tested on a saved fixture of the real response, trimmed):
  - Drop variants (`:batch`, `:free`, `:extended`, anything with `:`), expired models (`expiration_date` past),
    and models without `tools` **and** `structured_outputs` in `supported_parameters` (the pipeline needs both).
  - **Anthropic** = `anthropic/claude-*`; **OpenAI** = `openai/gpt-*`; **OpenRouter** = the makers TechTeam offers
    today (Google, DeepSeek, Z.ai, xAI, Moonshot; keep the list in config) plus their routing rules
    (`OPENROUTER_ROUTING`: hosts that keep no data, support tools, not 4-bit).
  - **Only current models**: per family (e.g. `claude-opus`, `claude-sonnet`, `gpt-*-sol`, `deepseek-v4-pro`), keep
    the newest version by `created`. Always keep a model an agent of any workspace currently uses, labeled
    "older" in the picker, so nothing breaks.
- **Derived fields** per model: `id` (route id), `provider`, `maker`, `label` (`name` without the "Anthropic: "
  prefix), `vision`, `pricing` (USD per million tokens: the per-token strings × 1e6), `tier`, `knobs`.
  - `tier` (flagship / balanced / fast) is used to keep the tier when an agent changes company (`closestModel`):
    rank each company's current models by output price; top third flagship, bottom third fast. Test it.
  - `knobs`: from `supported_parameters` (`reasoning_effort` / `reasoning`, `verbosity`). The *levels* aren't in the
    catalog: keep `MODEL_EFFORTS` only as an override for known ids; an unknown model gets the conservative set
    (send effort only when `reasoning_effort` is supported, and only `low` / `medium` / `high`). Keep the existing
    "OpenAI 400 on an optional knob → retry without it" and the OpenRouter "never send a parameter `/models` doesn't
    list" rules.

### 3.2 Model ids become data

- `AgentModelId` stops being a union of literals: it's a string validated against the catalog (`isCatalogModel`).
  Every `Record<AgentModelId, …>` and `modelInfo(id)!` becomes a catalog lookup that can miss: an agent whose
  model left the catalog keeps running (the provider decides), shows "older model" in AI Team, and cost uses the
  last stored price (or the CLI's / OpenRouter's reported cost).
- Role defaults (`AGENT_ROLES[*].defaults.models`) become a **tier** per role (Lead / Developer: balanced or flagship,
  Tester: fast, …), resolved to the company's current model of that tier.
- Cost: OpenRouter keeps `usage.cost` as reported; Claude Code reports `total_cost_usd`; the Anthropic and OpenAI APIs
  use the catalog price (`responseCostMicros`, `messageCostMicros` take the price from the catalog instead of
  `AGENT_MODELS`).
- `agents.provider_models` (remembered model per company) and `moveAgentsToProvider` keep working on ids; a
  remembered id missing from the catalog falls back to the same tier.

### 3.3 UI

- AI Team → Configure: Company select as today; Model select lists the catalog's current models for that company
  (label, tier chip, vision icon, price per million in/out for API routes; "Your plan" when the route is the plan),
  plus "older" for the agent's current model if it left the catalog. No code change when a model ships.
- Settings → AI: "Models updated 3 h ago · Refresh models".
- Simulated mode and unit tests never fetch: they use the seed or a fixture.

## 4. Tests and docs

- Unit tests: id mapping both ways, filter (variants, expired, missing tools/structured outputs, newest per family,
  keep in-use), pricing conversion, tier ranking, knobs, fallback order (stored → seed), `closestModel` on catalog
  data. Fixture: a trimmed copy of the real `/models` response under `lib/__fixtures__/`.
- Docs: `AGENTS.md` (Models and providers rules: the catalog replaces the hand-written list; "an OpenRouter model is
  added only when…" becomes the filter), `docs/features.md`, `docs/data-model.md` (new table), `docs/testing.md`,
  `CHANGELOG.md` (Unreleased), `docs/cli-agents.md` (the plan uses the same Anthropic list).

## 5. Done means

`npm run check` and `npm run build` pass; with network the picker shows Claude Fable 5.2 and GPT-6.2 without any
model id written in code (outside the seed and overrides); offline the app still starts with the seed; existing
agents (`claude-sonnet-5-5`, `gpt-6.1-terra`, `deepseek/deepseek-v4-pro-0813`) keep working; one PR (description to the
clipboard with `pbcopy`).
