# Subagent non-negotiables (paste at the top of EVERY subagent prompt)

A compact hard-rules header so a subagent can't violate a rule it never saw. The orchestrator
prepends this (or points to it) in every spawn — `scripts/gates/dispatch-*.sh` do it automatically;
the parent verifies its own PREMISES before spawning (a wrong premise poisons every downstream agent).

## NON-NEGOTIABLES

1. **THE ARCHITECTURE IS LOAD-BEARING.** `CLAUDE.md`'s golden rules are hard constraints, not style
   preferences: all DB access through `@app/db`; `packages/db` never imports from `apps/*` and the two
   apps never import from each other; Discord snowflakes stored as `text`, never numeric; commands and
   events auto-loaded from the filesystem, never hand-wired into a registry; explicit `.js` extensions
   on relative imports in `apps/bot` and `packages/db`. A change that breaks one of these is a P0 —
   flag it plainly rather than reasoning around it.
2. **READ THE CODE, NOT THE INTENT.** Trace the actual control flow — boundaries, error paths,
   empty/first/last cases. Off-by-ones, inverted conditions, swallowed errors and wrong-variable-paste
   all survive a skim and all look correct if you pattern-match instead of reading.
3. **WHOLE-PICTURE.** Sanity-check every claim against the rest of the system — the other callers, the
   schema, the migration, the web-side consumer, what the tests actually exercise. A locally-plausible
   reading that contradicts something already known is WRONG — surface the contradiction, don't pass
   it along.
4. **PROVE-IT-DIFFERENTLY — and know when you are DONE.** Before asserting a load-bearing claim, ask
   whether you could establish it by an INDEPENDENT method. If not, label it a HYPOTHESIS, not a fact.
   **⇒ AND CONVERSELY:** an existing artifact in this repo — a `*.test.ts`, the loader safety-net test,
   `npm run typecheck` — **IS an independent method**. When such a check exists and passes, the bar is
   **MET** — say so and STOP. "A further check is conceivable" is never a reason to keep going.
   Over-validation is a real, expensive failure mode, not a safe default.
5. **NEVER LEAK SECRETS.** `DISCORD_TOKEN`, `DATABASE_URL` and friends live in env vars. Never print a
   real value, never paste one into a packet, never commit one. New env vars go in `.env.example`.
6. **TREAD LIGHTLY ON THE TREE.** Review roles are **findings-only**: never edit, never commit, never
   run anything that mutates state (no migrations, no `db:migrate`, no `deploy-commands`, no writes to
   the DB). Read-only checks — `npm test`, `npm run typecheck`, `npm run lint`, `git diff` — are fine
   and running one beats suspecting quietly. Leave no scratch behind outside `scratchpad/`.
7. **RETURN STRUCTURED.** End with a tight findings block (result + confidence + "what I verified"),
   not a prose essay — and when the role specifies a JSON contract, return ONLY that JSON object, no
   fences and no commentary. The orchestrator has to cross-check you fast without a context flood.
8. **REUSE BEFORE YOU DERIVE.** Before writing a new helper, test fixture, or query, search for the
   existing one (`apps/bot/src/lib/`, `packages/db/src/`, the neighbouring command in the same
   category). Reimplementing something the repo already has is itself a finding.
9. **STAY IN SCOPE.** Answer the question you were sent to answer. A finding outside your scope is
   REPORTED, never acted on — do not expand into a rewrite, a re-plan, or a neighbouring subsystem. If
   the scope looks wrong, say so in the findings block and stop; the orchestrator decides.
