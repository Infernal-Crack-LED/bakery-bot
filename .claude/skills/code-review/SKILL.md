---
name: code-review
description: Cross-family POST-OP code review — the diff gets reviewed by a DIFFERENT model family than the one that wrote it, before commit/merge. Kimi-authored code → claude-opus-5 via scripts/gates/dispatch-claude.sh; Claude-authored code → kimi-code/k3 via scripts/gates/dispatch-kimi.sh; Qwen-authored → claude-opus-5. Invoke ONLY when the owner explicitly requests it (typically for higher-risk changes, after `npm test` / `npm run typecheck` / `npm run lint` are green) — never automatically.
---

# code-review — the author never reviews their own diff

Post-op code review, ported from nikke-sim's cross-family protocol. The rule is one sentence:
**the reviewer is always a different model family than the author**, because same-family review
shares the author's priors and re-derives the same reasoning instead of reading the code.

**Scope:** ordinary engineering changes — new commands/events, refactors, schema changes, fixes.
Trivial edits (typos, one-liners, a doc tweak) may skip.

## Routing (reviewer = opposite family of the AUTHOR)

The author is whoever wrote the code — normally you, the driver.

| Author / driver       | Reviewer        | Bridge                                                                                                                             |
| --------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Kimi** or **Qwen**  | `claude-opus-5` | `bash scripts/gates/dispatch-claude.sh <packet> claude-opus-5 <out.json>`                                                          |
| **Claude** (any tier) | `kimi-code/k3`  | `KIMI_AGENT_FILE=<abs path>/scripts/gates/kimi-gate-agent.md bash scripts/gates/dispatch-kimi.sh <packet> kimi-code/k3 <out.json>` |

- **Model names are literal, not aliases.** The bridges pass the string straight to the target CLI:
  `claude-opus-4-8` is NOT `claude-opus-5`; `kimi-code/kimi-for-coding` is NOT `kimi-code/k3`. The
  bridge injects the `model` field into the result JSON; an off-protocol `model` voids the review —
  re-dispatch. Change the canonical names by editing THIS file only.
- The role body lives in `.claude/agents/code-review.md` (pinned to Opus). The packet = role body +
  materials; the bridges prepend `.claude/subagent-non-negotiables.md` themselves.
- `dispatch-kimi.sh` already defaults `KIMI_AGENT_FILE` to `scripts/gates/kimi-gate-agent.md`, so the
  env var is only needed to point at a different profile.
- **Fallback (label it):** if the cross-family bridge is genuinely unavailable, run
  `Agent(subagent_type:'code-review')` natively and mark the review **"same-family only"** — weaker
  evidence, visible to the owner. Never silently substitute.

## Procedure

1. **Gate order.** Run the cheap local gates first — `npm test`, `npm run typecheck`, `npm run lint`
   all green. Do not spend a cross-family dispatch on code that fails locally. (The pre-commit hook
   runs lint/format/typecheck anyway; the review is for what those cannot see.)
2. **Build the packet** at `scratchpad/code-review/<date>-<topic>/review-packet.md`:
   - the FULL role body of `.claude/agents/code-review.md` (minus its frontmatter), then
   - `## INTENT` — 2–4 sentences: what the change does and why, in plain terms,
   - `## DIFF` — the full `git diff` (uncommitted work, or branch-vs-base for a PR),
   - `## CONTEXT` — only the anchors the reviewer cannot derive from the diff. The Kimi-side reviewer
     has **no tools** — the packet is all it sees, so err toward including the relevant hunks of
     untouched code: the callers of a changed `@app/db` export, the schema rows a query reads, the
     web-side consumer of a changed shape, and which of `npm test` actually covers the new path.
     Relevant excerpts of `CLAUDE.md` help it judge FIT against this repo rather than generic taste.
3. **Dispatch** per the routing table with a **600s shell timeout** — large diffs take 2–5 minutes on
   opus/k3. A 60s abort manufactures a fake timeout and pushes you to the weaker same-family fallback;
   suspect impatience before suspecting the bridge.
4. **Read the result JSON:**
   - `CLEAN` → land it. A cross-family CLEAN is real evidence.
   - `FIX-BEFORE-MERGE` → resolve every `FIX` finding, then re-review the new diff (full loop —
     fixes introduce their own defects).
   - `BLOCKED` → stop. Resolve the BLOCKERs or take the review to the owner. Do not commit over a
     BLOCKER because you disagree with it — disagreement goes to the owner with both rationales.
5. **Disputes:** if you believe a finding is wrong, verify it concretely (run the code, read the
   caller, add a test) — and if it still looks wrong, that's an owner decision, not a silent
   override. Record the dispute next to the result JSON.

## Notes

- `FOLLOW-UP` findings: file them (backlog doc / GitHub issue) rather than blocking; say where you
  filed them.
- Keep packets + result JSONs under `scratchpad/code-review/` until the change lands — they are the
  audit trail, and re-reviews rebuild from them. `scratchpad/` is gitignored; nothing from a review
  belongs in the public repo.
- Requires the `claude` CLI (Claude side) and the `kimi` CLI (Kimi side, on PATH or at
  `~/.kimi-code/bin/kimi`), plus `jq` and `python3`. If the Kimi CLI is not installed on this
  machine, that is exactly the "bridge unavailable" case in the routing table — use the labeled
  same-family fallback.
