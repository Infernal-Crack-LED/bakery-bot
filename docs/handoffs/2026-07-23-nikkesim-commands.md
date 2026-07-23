# Handoff — nikkesim.app command support for bakery-bot

**Date:** 2026-07-23
**From:** nikke-sim (owns the sim engine, DPS data, isomorphic renderers)
**To:** bakery-bot (owns the Discord bot, DB, user identity)
**Status:** Plan approved; implementation phased across multiple sessions

---

## TL;DR

Add 13 slash commands to bakery-bot that surface nikkesim.app data in Discord:
DPS charts, OL roll costs, charge/ammo breakpoints, saved team/roster
infographics, blablalink profile links, and simple resource links. Three
phases: (1) simple link/embed commands, (2) data commands that fetch precomputed
JSON, (3) interactive commands that query the DB and render PNG infographics.

---

## Commands overview

| Command      | Type        | What it does                                                                                                                |
| ------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `/sim`       | Link        | Links nikkesim.app                                                                                                          |
| `/guides`    | Edit        | Add nikkesim.app as first entry in existing GUIDES array                                                                    |
| `/rostergen` | Link        | Links nikkesim.app/roster                                                                                                   |
| `/mechanics` | Link        | Links nikkesim.app/mechanics                                                                                                |
| `/doll`      | Embed       | Doll FAQ (5 items) + link to nikkesim.app/doll                                                                              |
| `/dps`       | Data+Image  | DPS chart PNG (default: solo 8/12 core 100 ele advantage); optional element filter or `neutral`                             |
| `/nikke`     | Edit        | Add sim rank field to existing `/nikke` embed (same cell as /dps default)                                                   |
| `/ol`        | Data        | Default 8/12 OL roll table (Elem+ATK T11 × 4 pieces) + link to nikkesim.app/olsim                                           |
| `/bp`        | Data        | Generic charge-speed frame table by default; optional character input for per-unit breakpoints; link to nikkesim.app/charge |
| `/teams`     | Interactive | Numbered list of saved teams (select menu) → render team card PNG + link; optional name input skips listing                 |
| `/roster`    | Interactive | Same as /teams but for saved rosters                                                                                        |
| `/blabla`    | DB lookup   | Links the user's blablalink profile if they've synced on nikkesim.app                                                       |

---

## Phase 1 — Simple link/embed commands

No data fetching, no new dependencies. All files in `apps/bot/src/commands/utility/`.

### 1a. `/sim`, `/rostergen`, `/mechanics`

Use the existing `makeLinkCommand()` factory (`apps/bot/src/lib/linkCommand.ts`):

```ts
// sim.ts
import { makeLinkCommand } from '../../lib/linkCommand.js';
export const command = makeLinkCommand({
  name: 'sim',
  description: 'Link the NIKKE solo-raid damage simulator.',
  label: 'NIKKE Sim',
  url: 'https://www.nikkesim.app/',
  note: 'Solo-raid damage simulator',
});
```

```ts
// rostergen.ts
export const command = makeLinkCommand({
  name: 'rostergen',
  description: 'Link the NIKKE roster generator.',
  label: 'Roster Generator',
  url: 'https://www.nikkesim.app/roster',
  note: 'Generate optimal solo-raid rosters',
});
```

```ts
// mechanics.ts
export const command = makeLinkCommand({
  name: 'mechanics',
  description: 'Link the NIKKE sim mechanics reference.',
  label: 'Sim Mechanics',
  url: 'https://www.nikkesim.app/mechanics',
  note: 'How the simulator models each mechanic',
});
```

### 1b. `/guides` — add nikkesim.app as first entry

Edit `apps/bot/src/commands/utility/guides.ts` — prepend to the `GUIDES` array:

```ts
{
  label: 'NIKKE Sim',
  url: 'https://www.nikkesim.app/',
  description: 'Solo-raid damage simulator',
},
```

### 1c. `/doll` — FAQ + link

New file `apps/bot/src/commands/utility/doll.ts`. The FAQ content lives in
nikke-sim `web/src/App.tsx` lines ~6102–6190 as JSX. It needs to be:

1. **Extracted** into a static data file in nikke-sim: `web/src/doll-faq-data.ts`
   (array of `{ question, tldr, why }` objects — plain strings, no JSX)
2. **App.tsx updated** to import from that data file (no behavior change)
3. **Bot command** renders the FAQ as a Discord embed (question bold, tldr
   normal, why muted) + link to `https://www.nikkesim.app/doll`

The 5 FAQ items (as of 2026-07-23):

1. **Best way to roll an 8/12 T11+ set from scratch?** — Elem+ATK on all 4
   pieces, ~260 modules.
2. **Best way to roll a 12/12 T11+ set from scratch?** — Fill all 3 lines,
   ~585 modules. Don't lock Line 1 early.
3. **I hit a T15 (black line) on Line 1 — lock it?** — Yes. ~1-in-1000 event.
4. **Odds to roll T11 or higher?** — ~5% per line.
5. **Odds to roll all 3 lines in one roll?** — ~15% (100% × 50% × 30%).

Discord embed limit is 6000 chars total — the FAQ fits comfortably.

### 1d. Tests

One `<name>.test.ts` per new command, following `ping.test.ts` / `guides.test.ts`
patterns. Assert the embed shape (title, URL presence, field count).

---

## Phase 2 — Data commands

### 2a. Shared infrastructure

**`@napi-rs/canvas`** — add to `apps/bot/package.json`. The isomorphic
renderers in nikke-sim `src/share/` are explicitly designed for this (see
comment in `src/share/dpsChart.ts`: "the bakery-bot (@napi-rs/canvas /
node-canvas)").

**Isomorphic share modules** — copy from nikke-sim `src/share/` into
`apps/bot/src/lib/nikke-sim/`:

| File            | Purpose                                                             |
| --------------- | ------------------------------------------------------------------- |
| `build-code.ts` | Decode saved team/roster build codes (`decodeBuild()`)              |
| `teamCard.ts`   | Render team/roster card PNGs (`drawTeamCard()`, `drawRosterCard()`) |
| `dpsChart.ts`   | Render DPS chart PNGs (`drawDpsChart()`)                            |

These are dependency-free TypeScript. They import only from each other
(`dpsChart.ts` imports types from `teamCard.ts`). The `Canvas2DLike` interface
is satisfied by `@napi-rs/canvas`'s `SKRSContext2D`.

**DPS data** — the bot fetches `https://www.nikkesim.app/dpschart.json` at
startup with an in-memory cache (TTL ~6h). This file is a public static asset
generated at build time by `scripts/build-dpschart.ts`. Shape:

```jsonc
{
  "generatedAt": "…",
  "meta": {
    "frameworks": [{ "id": "solo", "label": "Solo" }, …],
    "eleadvs": [{ "id": "eleweak", "label": "…" }, { "id": "neutral", "label": "…" }],
    "cores": [{ "id": "c100", "label": "100%", "rate": 1 }],
    "invests": [{ "id": "8of12", "label": "8/12" }, …],
    "headliners": […]
  },
  "units": {
    "<slug>": { "name": "…", "element": "Fire", "elements": ["Fire"], "weapon": "AR", "tier": "SSS", "chartPop": true, "imageUrl": "…" }
  },
  "cells": {
    "<cellId>": [["<slug>", <dps>], …]  // ranked desc
  }
}
```

Cell ID format: `cellId()` in `src/dpschart/matrix.ts` composes
`framework:eleadv:core:invest` (e.g. `solo:eleweak:c100:8of12`).

**Default cell for /dps and /nikke:** `solo:eleweak:c100:8of12`
(framework=solo, eleadv=eleweak, core=c100, invest=8of12).

### 2b. `/dps` — DPS chart

New file `apps/bot/src/commands/utility/dps.ts`.

- Fetch cached `dpschart.json` → extract the default cell → build `DpsChartData`
  (title, bars with name/element/dps/imageUrl) → render PNG via `drawDpsChart()`
  - `@napi-rs/canvas` → post as `AttachmentBuilder`.
- Optional `element` string option: filter bars to units of that element.
  Special value `neutral` → use the `solo:neutral:c100:8of12` cell instead.
- Embed footer links `https://www.nikkesim.app/dpschart`.
- Portraits: fetch from the `imageUrl` in the JSON (blablalink CDN,
  `access-control-allow-origin: *`). Use the same downscale approach as
  `web/src/portraitThumb.ts` (stepped halving). Cache in memory.

### 2c. `/nikke` — add sim rank

Edit `apps/bot/src/commands/utility/nikke.ts`:

- After building the existing embed, look up the character's slug in the cached
  dpschart.json default cell.
- If found: add a field `📊 Sim Rank` with `#N of M · <dps> DPS` and the
  relative score (dps/top).
- If not found (unit not on chart): omit the field silently.
- The character's slug is `character.id` in the DB (matches the dpschart.json
  unit keys).

### 2d. `/ol` — OL roll calculator

New file `apps/bot/src/commands/utility/ol.ts`.

**nikke-sim change:** Add a build script `scripts/build-ol-default.ts` that runs
`monteCarloBuild()` (from `src/overload/policy.ts`) with the default 8/12
targets (4 pieces × `[{key:'elem',minTier:11},{key:'atk',minTier:11}]`) and
writes `web/public/ol-default.json`. Add to `build:deploy` in package.json.

Output shape:

```jsonc
{
  "generatedAt": "…",
  "config": { "lines": ["Elem DMG T11", "ATK T11"], "pieces": 4 },
  "perPiece": [
    { "expRolls": 36.2, "p95": 89, "modules": 65, "modulesP95": 161 },
  ],
  "total": { "expRolls": 145, "p95": 312, "modules": 263, "modulesP95": 564 },
}
```

Bot fetches `https://www.nikkesim.app/ol-default.json` → formats as an embed
table (per-piece row + full build total) → links `https://www.nikkesim.app/olsim`.

### 2e. `/bp` — charge/ammo breakpoints

New file `apps/bot/src/commands/utility/bp.ts`.

**nikke-sim changes:**

1. Extract breakpoint math from `web/src/App.tsx` into `src/breakpoints.ts`
   (isomorphic, pure functions). The functions to extract:
   - `chargeFrameBreakpoints(baseFrames)` — charge speed frame breakpoints
   - `ammoBreakpoints(base, perLinePct)` — max ammo breakpoints
   - `chargeSpeedRows(perLinePct)` — OL line rows for charge speed
   - `ammoLineRows(base, perLinePct)` — OL line rows for ammo
   - Constants: `CHARGE_SPEED_BREAKPOINTS`, `RELEASE_LATENCY_FRAMES`, etc.
   - Update `web/src/App.tsx` to import from the new module.

2. Add a build script `scripts/build-breakpoints.ts` that precomputes
   breakpoints for all characters into `web/public/breakpoints.json`:

```jsonc
{
  "generatedAt": "…",
  "generic": {
    "chargeFrames": [{ "frames": 59, "csNeeded": 0.85, "seconds": 0.983 }],
    "note": "Standard 60-frame charge weapon (1s base)",
  },
  "characters": {
    "<slug>": {
      "name": "…",
      "weapon": "RL",
      "baseChargeFrames": 45,
      "baseAmmo": 6,
      "chargeFrames": [{ "frames": 44, "csNeeded": 1.12 }],
      "ammoBreakpoints": [{ "ammo": 7, "minPct": 16.67, "linesNeeded": 1 }],
    },
  },
}
```

Bot behavior:

- **Default (no character):** Show the generic charge-speed frame table +
  a note that per-character data needs a character input.
- **With character input:** Look up the character in `breakpoints.json` →
  show their charge frame breakpoints and/or ammo breakpoints.
- Link to `https://www.nikkesim.app/charge`.

Character data source for the build script: `data/characters.json` has
`chargeFrames` (base charge time in frames) and `ammo` (base max ammo) per
character. Only charge weapons (SR, RL) have meaningful charge breakpoints;
ammo breakpoints apply to any unit with `ammo > 0`.

### 2f. Tests

Test the embed formatting, the dpschart.json cache/parse logic, and the
breakpoint lookup. Mock the HTTP fetch for dpschart.json / ol-default.json /
breakpoints.json.

---

## Phase 3 — Interactive commands (DB + components + infographics)

### 3a. `/teams` — saved teams with infographics

New file `apps/bot/src/commands/utility/teams.ts`.

**DB query:** `user_teams` table (already exists in `packages/db/src/schema.ts`):

```ts
import { db, userTeams } from '@app/db';
import { eq } from 'drizzle-orm';

const teams = await db.query.userTeams.findMany({
  where: eq(userTeams.discordId, interaction.user.id),
});
```

**No saved teams:**

> Connect your Discord to [nikkesim.app/teambuilder](https://www.nikkesim.app/teambuilder) to display saved teams.

**Optional `name` string option:** Look up team by name (case-insensitive) →
skip listing → render infographic directly.

**No name option:** Reply with a `StringSelectMenu` (discord.js 14) listing
team names. User picks → render infographic. Use
`interaction.awaitMessageComponent()` for the inline collector (no changes
to `interactionCreate.ts` needed). Defer the reply first since rendering
takes time.

```ts
import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
} from 'discord.js';

const menu = new StringSelectMenuBuilder()
  .setCustomId('team-pick')
  .setPlaceholder('Pick a team…')
  .addOptions(
    teams.map((t, i) => ({
      label: `${i + 1}. ${t.name}`.slice(0, 100),
      value: t.id,
    }))
  );
```

**Infographic rendering:**

1. `decodeBuild(team.code)` → `Build` object (from `src/share/build-code.ts`)
2. Extract unit slugs from `build.s[].slug`
3. Resolve unit names/elements/weapons from the DB (`nikkeCharacters`) or
   from `dpschart.json`'s `units` map
4. Render via `drawTeamCard()` + `@napi-rs/canvas` → PNG buffer
5. Post as `AttachmentBuilder` + embed with link:
   `https://www.nikkesim.app/teambuilder?b=<team.code>`

**Portraits:** Fetch from blablalink CDN using the character's `imageUrl`
from the DB. Use stepped-halving downscale (same as `web/src/portraitThumb.ts`).
Cache in memory (Map<url, Image>).

### 3b. `/roster` — saved rosters with infographics

New file `apps/bot/src/commands/utility/roster.ts`.

Same pattern as `/teams` but queries `user_profiles` with the roster kind:

```ts
const rosters = await db.query.userProfiles.findMany({
  where: and(
    eq(userProfiles.discordId, interaction.user.id),
    eq(userProfiles.kind, 'roster') // verify the actual kind string during impl
  ),
});
```

Render via `drawRosterCard()` instead of `drawTeamCard()`. The build code's
`roster` field (`Build.roster: (string|null)[][]`) holds the teams × 5 slugs.

**No saved rosters:**

> Connect your Discord to [nikkesim.app/teambuilder](https://www.nikkesim.app/teambuilder) to display saved rosters.

Link: `https://www.nikkesim.app/roster` (roster generator).

### 3c. `/blabla` — blablalink profile link

New file `apps/bot/src/commands/utility/blabla.ts`.

```ts
import { db, nikkeAccountLinks } from '@app/db';
import { and, eq } from 'drizzle-orm';

const link = await db.query.nikkeAccountLinks.findFirst({
  where: and(
    eq(nikkeAccountLinks.discordId, interaction.user.id),
    eq(nikkeAccountLinks.current, true)
  ),
});
```

**No linked account:**

> Sync your roster on [nikkesim.app](https://www.nikkesim.app/roster-sync) to link your blablalink profile.

**Linked:** Reply with an embed linking
`https://www.blablalink.com/user?openid=<link.openId>`.

### 3d. Tests

Mock the DB queries (follow the pattern in `nikke.test.ts` / `sync.test.ts`).
Test: no-teams message, select menu shape, name-lookup path, blabla URL
construction.

---

## nikke-sim changes summary

All changes are in **non-protected paths**. No changes to `src/engine/**`,
`data/**`, `src/skills/overrides/**`, or regression snapshots.

| Change                            | File(s)                                                      | Phase |
| --------------------------------- | ------------------------------------------------------------ | ----- |
| Extract doll FAQ data             | `web/src/doll-faq-data.ts` (new), `web/src/App.tsx` (import) | 1     |
| Extract breakpoint math           | `src/breakpoints.ts` (new), `web/src/App.tsx` (import)       | 2     |
| Precompute OL default results     | `scripts/build-ol-default.ts` (new), `package.json`          | 2     |
| Precompute breakpoints JSON       | `scripts/build-breakpoints.ts` (new), `package.json`         | 2     |
| Add build steps to `build:deploy` | `package.json`                                               | 2     |

---

## Key file paths (quick reference)

### bakery-bot

| Path                                       | Role                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `apps/bot/src/commands/utility/`           | All new command files go here                                           |
| `apps/bot/src/lib/linkCommand.ts`          | `makeLinkCommand()` factory for link commands                           |
| `apps/bot/src/lib/nikke-sim/`              | (new) Copied isomorphic share modules                                   |
| `apps/bot/src/types.ts`                    | `Command` interface (data + execute + autocomplete?)                    |
| `apps/bot/src/events/interactionCreate.ts` | Routes autocomplete + slash commands (no changes needed)                |
| `packages/db/src/schema.ts`                | `userTeams`, `userProfiles`, `nikkeAccountLinks`, `nikkeRosters` tables |

### nikke-sim

| Path                         | Role                                                                |
| ---------------------------- | ------------------------------------------------------------------- |
| `src/share/build-code.ts`    | `decodeBuild()` — isomorphic build-code codec                       |
| `src/share/teamCard.ts`      | `drawTeamCard()`, `drawRosterCard()` — isomorphic card renderers    |
| `src/share/dpsChart.ts`      | `drawDpsChart()` — isomorphic DPS chart renderer                    |
| `src/dpschart/matrix.ts`     | `cellId()`, axis definitions, `CELLS` array                         |
| `src/overload/policy.ts`     | `monteCarloBuild()` — OL roll Monte Carlo                           |
| `data/ol-probabilities.json` | OL probability model (datamined)                                    |
| `data/characters.json`       | Unit data (chargeFrames, ammo, element, weapon, imageUrl)           |
| `scripts/build-dpschart.ts`  | Precomputes `web/public/dpschart.json`                              |
| `web/src/App.tsx`            | Breakpoint math (~line 440), doll FAQ (~line 6100), OL sim defaults |
| `web/src/auth.ts`            | Backend API contract (teams, profiles, roster, accounts)            |

---

## Architectural decisions

1. **Bot queries DB directly** (via `@app/db`) for teams/rosters/accounts —
   no HTTP calls to the bakery-bot web API. The bot and web app share the
   same Postgres database through the shared `packages/db` workspace.

2. **Bot fetches precomputed JSON** from nikkesim.app for DPS data, OL
   defaults, and breakpoints — these are static assets regenerated on every
   nikke-sim deploy. In-memory cache with ~6h TTL.

3. **Isomorphic renderers are copied** (not published as a package) into
   bakery-bot. They're dependency-free and change rarely. If they drift,
   the visual output diverges — a documented maintenance cost.

4. **Component interactions** (select menus for /teams, /roster) use inline
   `awaitMessageComponent()` collectors within the command's `execute` —
   no changes to the shared `interactionCreate.ts` event handler.

5. **Portraits** are fetched from the blablalink CDN at render time (the CDN
   sends `access-control-allow-origin: *`). Stepped-halving downscale avoids
   aliasing. In-memory cache keyed by URL.

---

## Verification checklist

Per phase:

- [ ] `npm test` passes in bakery-bot
- [ ] `npm run typecheck` passes in bakery-bot
- [ ] `npm run lint` passes in bakery-bot
- [ ] `npm run typecheck` passes in nikke-sim (after extractions)
- [ ] `bash scripts/verify.sh` passes in nikke-sim (before committing)
- [ ] `npm run bot:deploy-commands` run after adding commands (guild-scoped for instant testing)
- [ ] Manual Discord testing with `npm run dev:bot`

---

## Open items / gotchas

- **`user_profiles.kind` for rosters:** Verify the exact kind string the
  roster generator uses when saving. Check `web/src/App.tsx` for the
  `saveProfile()` call in the roster generator section.

- **Portrait CDN rate limits:** Rendering a 5-team roster card fetches up to
  25 portraits. The blablalink CDN is generally permissive, but add a
  concurrency limit (e.g. 5 parallel fetches) and graceful fallback to
  element-tinted placeholders on failure.

- **dpschart.json cell ID format:** The `cellId()` function in
  `src/dpschart/matrix.ts` composes the ID from axis IDs. Verify the exact
  format during implementation (likely `${framework}:${eleadv}:${core}:${invest}`).

- **`@napi-rs/canvas` on Railway:** The bot deploys on Railway (Linux x64).
  `@napi-rs/canvas` ships prebuilt binaries for Linux — should work, but
  verify during the first deploy. If it fails, `canvas` (node-canvas,
  requires system cairo) is the fallback.

- **Build code version:** `decodeBuild()` rejects unknown versions. If
  nikke-sim bumps `BUILD_VERSION`, the bot's copied `build-code.ts` must be
  updated too.

- **Font for PNG rendering:** `drawTeamCard()` / `drawDpsChart()` use a
  specific font (`FONT` constant in `teamCard.ts`). The font must be
  available on the bot's runtime (Railway container). Either bundle the font
  file or use a system font fallback. Check what `FONT` resolves to during
  implementation.
