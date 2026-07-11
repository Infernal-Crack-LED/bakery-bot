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
