# Handoff — Skill cooldowns in `skill_descriptions` (for nikke-sim)

**Date:** 2026-07-20
**From:** bakery-bot (owns the `nikke_characters` table)
**To:** nikke-sim (reads `nikke_characters` directly)
**Status:** bakery-bot side shipped; sim side TODO (this doc)

---

## TL;DR

`nikke_characters.skill_descriptions` (jsonb) now carries an optional
**`cooldowns`** object — skill cooldowns in **seconds** for `skill1`, `skill2`,
and `burst`. This fills a real hole: blablalink's roledata (our kit source) has
the **burst** cooldown but **no cooldown for skills 1 & 2**. We now source all
three from the community wiki (Fandom). Since the sim already reads
`skill_descriptions`, there's **no new column and no API change** — just a new
optional key in a JSON you already parse.

---

## The shape

`skill_descriptions` was:

```jsonc
{ "skill1": "…prose…", "skill2": "…prose…", "burst": "…prose…" }
```

It is now (cooldowns folded in):

```jsonc
{
  "skill1": "…prose…",
  "skill2": "…prose…",
  "burst": "…prose…",
  "cooldowns": { "skill1": null, "skill2": 15, "burst": 40 }, // ← NEW, seconds
}
```

TypeScript (`@app/db`):

```ts
interface SkillCooldowns {
  skill1: number | null; // seconds, or null = no cooldown (passive)
  skill2: number | null;
  burst: number | null;
}
interface SkillDescriptions {
  skill1: string;
  skill2: string;
  burst: string;
  cooldowns?: SkillCooldowns; // ← NEW
}
```

### Semantics (read carefully)

- **Units are seconds.** `skill2: 15` = a 15-second cooldown.
- **`null` per slot = no cooldown** (a passive skill; wiki `N/A`). Almost every
  unit's `skill1` is `null`, and many units' `skill2` too. `burst` is effectively
  always a number.
- **Cooldowns do NOT scale with skill level.** One fixed scalar per slot,
  independent of the account's skill levels — so there's no per-level array here,
  just the three numbers.
- **`cooldowns` may be absent** (the key missing entirely) when the bot hasn't
  matched that unit to its wiki page yet (a new/alt/collab unit whose page title
  needs a manual override on our side). Treat a missing `cooldowns` as "unknown"
  and fall back gracefully.

---

## What to implement in nikke-sim

1. **Read `skill_descriptions.cooldowns`** and wire it into the unit's cooldown
   model for skills 1, 2, and burst.
2. **Handle `null` per slot** as "this skill has no cooldown" (passive) — not `0`,
   not "unknown". A `null` slot should never be put on a cooldown timer.
3. **Handle `cooldowns` absent** as "unknown for this unit":
   - Prefer your existing burst-cooldown source if you have one (burst is also in
     blablalink roledata, which the sim may already ingest).
   - For skill1/skill2, fall back to today's behavior (likely "no CD"), ideally
     surfaced as unknown rather than silently 0.

```ts
function cooldownFor(
  sd: SkillDescriptions,
  slot: 'skill1' | 'skill2' | 'burst'
): number | null {
  const cd = sd.cooldowns?.[slot];
  if (cd === undefined) return fallbackCooldown(slot); // unit not yet matched
  return cd; // number = seconds; null = passive (no timer)
}
```

No per-account path is involved — this is static kit data, same for every
account, read straight from `nikke_characters`. (An earlier draft of this change
attached cooldowns to the per-account `syncedLoadouts`; that was reverted in
favor of this DB-native approach.)

---

## Validation / how to eyeball it

- **Values confirmed against the wiki on 2026-07-20:**
  - Snow White → `{ skill1: null, skill2: 15, burst: 40 }`
  - Rapunzel → `{ skill1: null, skill2: 15, burst: 60 }`
  - Modernia, Red Hood → `{ skill1: null, skill2: null, burst: 40 }`
- **Quick DB check:**
  ```sql
  SELECT name, skill_descriptions -> 'cooldowns' AS cd
  FROM nikke_characters
  WHERE name IN ('Snow White','Rapunzel','Modernia','Red Hood');
  ```
- **Sanity assertions worth adding sim-side:** `burst` is a positive number for
  every unit that has `cooldowns`; a `null` slot is never scheduled on a timer.

---

## Bakery-bot side (context, no action needed)

- **Source:** `packages/nikke/src/fandom.ts` reads each character's
  `{{Skill table}}` via the MediaWiki `action=parse` API (`skillcd1/2/3`), chosen
  over nikke.gg (a client-rendered SPA with no clean data API).
- **Sync:** `syncSkillCooldowns` in `apps/bot/src/lib/nikke/sync.ts` is
  **fetch-only-new** — it targets rows that have `skill_descriptions` but no
  `cooldowns` key yet, and **merges** cooldowns into that JSON. It runs AFTER the
  roledata backfill and the Favorite-Item step (both of which write
  `skill_descriptions`), so nothing clobbers the cooldowns.
- **Column:** none added — cooldowns live inside the existing
  `skill_descriptions` jsonb, so there's no migration.

---

## Open items / gotchas

- **Coverage depends on wiki matching.** A unit only gets `cooldowns` once our
  sync matches its display name to a wiki page. Alt/skin/collab units may lag
  until we add a title override (`FANDOM_TITLE_OVERRIDES` in the bot). Unmatched
  names are listed in `nikke_sync_runs.sources.unmatched.skillCooldowns` — ping us
  and it's a one-line override on our end.
- **Ordering matters (our side, already handled).** Because cooldowns live inside
  `skill_descriptions`, the cooldown step must run after anything that rewrites
  that column; it does. If nikke-sim ever WRITES `skill_descriptions`, preserve
  the `cooldowns` key on write.
- **Burst redundancy is intentional.** We carry `burst` too so you have a
  one-stop read; if you already trust blablalink's burst cooldown, use ours only
  for skill1/skill2 — they'll agree.
