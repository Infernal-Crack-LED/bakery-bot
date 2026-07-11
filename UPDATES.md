# F3 — gacha enhancements: update log

One section per update on the `gacha-enhancements` branch, so the operator can
cherry-pick what reaches `main`. **Nothing here has been merged to `main`.**
Each update is its own commit, passes `npm run typecheck` + `npm test`, and
follows the repo golden rules (all DB via `@app/db`, snowflakes as `text`,
filesystem auto-load, ESM `.js` imports, tests next to code).

Design source: `~/wave2-autonomous/F3-DESIGN.md`, which fuses the F2 feasibility
trial's 7 hard requirements (`~/wave2-autonomous/F2-feasibility/REPORT.md`) with
a read-only survey of the existing bot infra. Features build on the existing
NIKKE sync/announcement infra — they extend it, they do not duplicate it.

---

## 1. Schema: `gacha_events` + `event_ingest_runs` tables

**Commit:** `c592e94`

**What:** Two new Drizzle tables in `packages/db/src/schema.ts` (+ migration
0012, + the `ProposedGachaEvent` / `IngestDiagnostics` shared types), mirroring
the existing `nikke_sync_runs` audit pattern.

- `gacha_events` — approved calendar entries the calendar/reminder features
  read. Written ONLY by the operator-approve flow, never by the LLM pipeline.
  Unique on `(guild, type, name)` so re-approving an updated announcement
  upserts instead of duplicating. Carries provenance (source message/channel,
  ingest run, approver), reminder-sent bookkeeping, and low-confidence `flags`.
- `event_ingest_runs` — audit log of ingest runs. The parse pipeline records a
  `proposal` (jsonb) + per-run `diagnostics` with status `"proposed"`; an admin
  decision moves it to `approved` / `rejected`.

**Why:** Gives the LLM-ingestion feature a place to record proposals for review
without touching the live calendar, and gives the calendar/reminder features a
single approved-only table to read.

**How tested:** `npm run typecheck` (schema + generated types compile);
migration generated with drizzle-kit, **not applied** (no local DB — `npm run
release` applies it on deploy). No runtime tests (schema-only change).

**Merge recommendation:** Safe to merge on its own — additive, no code paths
touch it yet. But it is the prerequisite for updates 2+, so most useful merged
together with the ingestion feature once that lands.

---

## 2. Announcement-parse core: hardened salvage + deterministic validation

**Commit:** _(this update)_ — `apps/bot/src/lib/gacha/`

**What:** The pure, LLM-adjacent core of the announcement→event ingestion, with
no I/O so every rule is unit-testable. Four new files:

- `prompt.ts` — `buildParsePrompt()` / `buildRepairPrompt()`. The extraction
  prompt is the F2 trial's scored prompt: trust body over TL;DR, keep the
  announced timezone, resolve "after maintenance" to the maintenance END, never
  invent character names, and put boss/costume names in `notes` not
  `characters`.
- `salvage.ts` — `salvageJson()` / `extractJsonObjects()`. Recovers a JSON
  object from a messy reply (parse-as-is → strip code fences → pull balanced
  top-level objects from surrounding prose → dedupe repeats → prefer the object
  carrying an `events` array). Returns `null` on unrecoverable truncation.
- `validate.ts` — `validateEnvelope()` / `validateProposedEvent()` /
  `parseIsoInstant()` / `summarizeAgreement()`. The deterministic layer between
  the model and the DB.
- `salvage.test.ts` + `validate.test.ts` — 28 unit tests covering the failure
  shapes the F2 trial actually produced.

Which F2 requirements this update lands (of the 7):

- **#3 harden JSON salvage** — `salvage.ts` (fences, prose-wrapping, doubled
  objects, truncation).
- **#4 validate dates** — `parseIsoInstant()` requires an explicit offset,
  rejects impossible calendar dates (round-trips Feb 31 etc.), and flags
  `start-not-before-end`. Reuses `discordTime.ts`'s `parseUtcOffset`.
- **#5 flag low-confidence** — `no-start` / `no-end` / `midnight-start` /
  `invalid-*-dropped` flags on each `ProposedGachaEvent`.
- **#6 scrub `characters` on non-banner types** — sets `characters-scrubbed`.
- **#7 double-run comparison** — `summarizeAgreement()` labels runs
  `agree` / `partial` / `single-run` for the approval view.

Still to come (later updates, the LLM/DB edge): the ingest orchestrator that
actually calls the model on :8770 (double-run + repair-reprompt, F2 #2
`max_tokens ≥ 16k`), records to `event_ingest_runs`, and the operator-approve
admin command that renders the diff (F2 #1 always-approve). These are kept
separate so this pure core can be reviewed and tested in isolation.

**Why:** Isolating the parsing/validation as pure functions means the risky part
(the model's messy output) is fully covered by fast unit tests with no Discord,
DB, or LLM needed — the loader safety-net + these tests keep the branch green.

**How tested:** `npm run typecheck` clean; `npm test` green (195 tests, incl.
28 new gacha tests). All inputs are absolute instants — no wall-clock
dependence.

**Merge recommendation:** Safe and self-contained, but inert until the ingest
orchestrator + admin command wire it up. Merge with update 1 and the
forthcoming ingestion update as one reviewable feature, or hold the whole set
until the ingestion edge lands.

---

## 3. Ingest orchestrator (LLM injected, no I/O)

**Commit:** _(this update)_ — `apps/bot/src/lib/gacha/ingest.ts`

**What:** The pipeline that ties prompt → salvage → validate together, with the
LLM call **injected** (`LlmComplete = (prompt) => Promise<string>`) so nothing
here does I/O. Exports:

- `runOnce()` — one parse pass: prompt the model, salvage the reply, and on an
  unrecoverable reply **re-prompt once** for clean JSON (F2 req 3), then
  validate. Never throws on a bad reply or a completer failure — both surface as
  a `run.error` string with an empty, invalid run.
- `ingestAnnouncement()` — **double-runs** the parse (F2 req 7), assembles
  `IngestDiagnostics` (per-run valid/repaired/salvage/events/confidence + an
  `agree`/`partial`/`single-run` agreement label + collected errors +
  source excerpt), and returns the best proposal (most events, ties broken by
  confidence). Writes nothing — the caller records it on an `event_ingest_runs`
  row for review.
- `MIN_MAX_TOKENS = 16000` — exported constant the real edge adapter must
  request (F2 req 2); kept here as the single source of truth.
- `ingest.test.ts` — 7 tests with a fake completer: clean parse, repair-on-
  broken, unsalvageable, completer throw, double-run agree/partial, and
  best-proposal-with-errors.

**Why:** Injecting the LLM keeps the risky orchestration (retries, double-run,
diagnostics) deterministic and fully unit-tested. The only thing left for the
edge is a thin adapter (endpoint + `max_tokens`) and the DB/Discord wiring.

**How tested:** `npm run typecheck` clean; `npm test` green (35 gacha tests,
full suite unaffected). No network/model/DB used in tests.

**Merge recommendation:** Self-contained and inert (nothing calls it yet). Merge
as part of the ingestion feature set together with updates 1–2 and the
forthcoming edge adapter + `/events` approve command.

---

## 4. Pity / pull calculator + `/pity` command

**Commit:** _(this update)_ — `apps/bot/src/lib/gacha/pity.ts` +
`apps/bot/src/commands/utility/pity.ts` (F3 Feature 3)

**What:** A pure pity/pull math lib and the user-facing slash command that uses
it. Independent of the LLM/ingestion work — no DB, no model.

- `pity.ts` — `probAtLeastOne` (1-(1-p)^n), `expectedCount` (n·p),
  `pullsForConfidence` (pulls to reach a % confidence in an SSR),
  `pullsToMileage` (pulls to the hard-pity ceiling), and `summarizePulls`
  (expected SSRs, chance of ≥1 SSR, mileage/pity progress). NIKKE defaults
  (`NIKKE_SSR_RATE=0.04`, `NIKKE_MILEAGE_TARGET=200`) are exported constants and
  every one is overridable.
- `commands/utility/pity.ts` — `/pity pulls:<n> [mileage:<0-200>]` replies with
  the summary (expected SSRs, ≥1-SSR odds, mileage-to-pity, and pulls needed for
  90% confidence). Mirrors the existing `/time` command shape.
- `pity.test.ts` — 13 tests against closed-form values (no randomness/clock).

**Deliberate scope note:** the lib models only the two mechanics that are exact
and well-documented — the per-pull SSR rate and the Gold Mileage hard-pity
ceiling. It intentionally does **not** hardcode gem/voucher costs (those vary by
shop/event and would be guesswork); a currency→pulls conversion can be added
later once the operator confirms the numbers.

**Why:** A self-contained, fully-tested, zero-integration-risk feature — a good
fit to land unattended. Gives players quick odds without touching the risky
LLM/DB edge.

**How tested:** `npm run typecheck` + `npm run lint` clean; `npm test` green
(215 tests: 13 new pity tests + the loader safety-net auto-covering the new
`/pity` command for name/uniqueness/serialization).

**Merge recommendation:** Safe to merge independently — no schema, no shared
state, no dependency on updates 1–3. The clearest standalone win of the branch.

---

## 5. LLM edge adapter + live smoke harness

**Commit:** _(this update)_ — `apps/bot/src/lib/gacha/llmClient.ts` +
`apps/bot/src/scripts/smoke-gacha-ingest.ts`

**What:** The ONLY file in the gacha pipeline that talks to a model: a thin
adapter producing the `LlmComplete` the (already-tested) orchestrator needs,
calling an OpenAI-compatible `/chat/completions` endpoint.

- Env-configured: `GACHA_LLM_URL` (default `http://127.0.0.1:8770/v1`),
  `GACHA_LLM_MODEL`, `GACHA_LLM_MAX_TOKENS`, `GACHA_LLM_TEMPERATURE` (default
  0.4 — deliberately > 0 so the double-run disagreement signal has variance),
  `GACHA_LLM_TIMEOUT_MS` (default 10 min; local models are slow at 16k).
- **F2 req 2 enforced here:** the completion budget is clamped UP to
  `MIN_MAX_TOKENS` (16000) — a smaller configured value is not honored,
  because truncation is the pipeline's worst failure mode.
- `smoke-gacha-ingest.ts` (`npm run smoke:gacha -- <file> [runs]`) runs the
  REAL pipeline against the configured endpoint and prints proposal +
  diagnostics. No DB, no Discord — the operator's pre-flight check before
  enabling ingestion.
- `.env.example` documents the new block.

**How tested:**

- Unit (fake fetch injected, no network): 9 new tests — URL building, env
  overrides, min-token clamping (`resolveMaxTokens(6000) → 16000`), HTTP
  error → reject, empty-content → reject. `npm test` green: **224 tests**.
- **LIVE smoke against :8770** (llama.cpp, model `harness-ideation`), real
  sample `F2-feasibility/samples/sample3-may28-patch.txt` (8538 chars),
  double-run — **PASS, exit 0, 132.3s**:
  - both runs valid, 11 events each, self-reported confidence 0.95;
  - salvage worked for real (`stripped-prose` on run 1;
    `stripped-code-fences` + `stripped-prose` + `deduped-repeated-object` on
    run 2 — exactly the F2 trial's failure modes, recovered without a repair
    round-trip);
  - agreement `partial` (nondeterministic wording differences across runs) —
    the force-human-attention signal works;
  - content spot-check vs ground truth: maintenance window, Special Recruit,
    BITTER SPICE, Solo Raid S37 (boss in `notes`, `characters` empty — F2
    req 6 held), timezone trap beaten (UTC+9 kept), low-confidence flags
    (`no-end`, `midnight-start`) attached where expected.

**Merge recommendation:** Merge together with updates 1–3 as the ingestion
core. Zero risk while `GACHA_INGEST_ENABLED` stays unset (next update) — the
adapter is only ever constructed on demand; nothing at import time.
