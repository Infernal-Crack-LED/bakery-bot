# `/nikke` — Character Lookup: Design & Plan

**Status:** Phases 1 & 2 built. Phase 1 = Synergy + Tsareena sheet + `/nikke`
with autocomplete + daily sync (`npm run sync:nikke`). Phase 2 = Prydwen tiers
via a committed cache + offline refresh (see below). Goal: `/nikke <name>`
returns Tsareena priority + Prydwen tiers + Nikke Synergy stats, with links to
both sites — served from our **own database**, refreshed by a **daily sync** so
we never hammer the sources at command time.

## Phase 2 — Prydwen (Cloudflare workaround)

Prydwen is behind Cloudflare, which blocks Node/undici's TLS fingerprint (403)
and rate-limits datacenter IPs — so the bot never fetches Prydwen at runtime.
Instead:

- **Single tier-list fetch:** Prydwen's **tier-list page**
  (`/nikke/tier-list`, a Next.js App Router route) embeds every character's
  Story/Bossing/PVP ratings in its RSC "flight" payload (`self.__next_f`). So
  ONE request yields all ~211 characters' three tiers — no per-character
  requests (an earlier per-page approach hit ~191 requests and tripped
  Cloudflare). `parsePrydwenTierList` reassembles the flight payload and reads
  each character's `slug` + `rating_story/boss/pvp` (slug == our canonical id).
- **Committed cache:** `apps/bot/src/lib/nikke/prydwen-data.ts` exports
  `PRYDWEN_TIERS` (slug → `{story,bossing,pvp}`). The daily sync reads it — no
  network — and merges into `nikke_characters` (upsert uses `coalesce`, so a
  character missing from the cache never wipes existing tiers).
- **Offline refresh:** `npm run refresh:prydwen` (run from a normal computer, NOT
  Railway) makes the single fetch **via `curl`** (Cloudflare blocks Node fetch
  but allows curl's fingerprint), parses, and rewrites `prydwen-data.ts` to
  commit. Real coverage: 211 tier-list entries → 175/191 canonical characters
  matched (the rest are slug mismatches for overrides later).
- The parser runs anywhere; only the _fetch_ must be done off-Railway.

## Phase 3 — polish (built)

- **Name overrides:** `apps/bot/src/lib/nikke/overrides.ts` exports
  `SHEET_NAME_OVERRIDES` (normalized source name → canonical slug). The matcher
  consults it when normalization can't match. Seeded with 5 collab/renamed units
  (Little Mermaid, Rei, Mari, Takina, Chisato); this dropped real-data unmatched
  sheet names from 6 → 1 ("Anne: Miracle Fairy", genuinely absent from Synergy).
  Adding an override is the intended human fix for a reported mismatch.
- **Dashboard sync-health:** the web dashboard shows character counts, per-source
  coverage (Synergy / Prydwen / sheet), and the latest sync run (status, time,
  counts, total unmatched) — reads `nikke_characters` + `nikke_sync_runs`.
- **Local env loading:** `apps/bot/src/loadEnv.ts` loads the repo-root `.env`
  (Node's built-in `process.loadEnvFile`, no dependency) for the bot,
  deploy-commands, and `sync:nikke`; `drizzle.config.ts` loads it too. On Railway
  (no `.env`) it's a no-op. This is what makes the documented local activation
  sequence actually work.
- **Sheet build tabs (built):** Tsareena's 8 "\* Builds" tabs (one per priority
  bucket) are fetched by name via the gviz CSV endpoint and parsed by column
  position into `sheet_data.build` (skill levels, overload gear/rolls, cube,
  endgame uses, notes). `/nikke` shows a 🔧 Build field. Real coverage: 79/191
  characters (the sheet only documents priority units). See `parseBuildSheet` /
  `fetchTsareenaBuilds` in `lib/nikke/sheet.ts`.

**Phase 1 real-data coverage** (dry-run over live sources): 191 canonical
characters, 0 untranslated, 0 unmatched arena stats, 6 unmatched sheet names —
all collabs/limited units absent from Synergy's roster (Lycoris Recoil, EVA,
etc.). Those need manual entries or arrive with Prydwen in Phase 2.

## Data sources — confirmed feasible (2026-07)

| Source               | How we get it                                                                                                      | What it gives                                                                                                                                                         | Notes / risk                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tsareena's Sheet** | Public CSV export per tab: `https://docs.google.com/spreadsheets/d/16EE…/export?format=csv&gid=<gid>`              | Priority tier list (tab 1) + build sheets (other tabs)                                                                                                                | Names are English but messy, with `(T)/(L)/(C)` annotations. Must enumerate tab gids. Owner can restructure → parse defensively.                                                                                              |
| **Nikke Synergy**    | Public **Supabase/PostgREST** API: `https://api.nikke-synergy.com/rest/v1/<table>` with header `apikey: dummy-key` | `characters` (id, **JP** name, `image_filename`, weapon_type…), `character_season_stats` (**EN** `char_name`, win_rate, adoption_rate/season), `season_rate`, `cubes` | No browser needed. **No tier column** — the site's "tier" is computed client-side from these stats. JP↔EN name map is in the `translations` JS asset + the EN `char_name` column.                                             |
| **Prydwen**          | Fetch the character HTML page, parse with **cheerio**                                                              | Tiers under `.detailed-ratings.nikke` → `Story`, `Bossing`, `PVP` (letter each). Also element/class/burst/weapon/rarity.                                              | Reachable from a normal IP; **WebFetch/CDN blocks some datacenter IPs — must verify a fetch works from Railway** before relying on it. Enumerate slugs from the characters index/sitemap. Be polite (daily, spaced requests). |

Synergy character URL: `https://nikke-synergy.com/character?id=<id zero-padded to 4>`
(e.g. db `id` 191 → `?id=0191`). Prydwen URL: `…/nikke/characters/<slug>`.

## The hard part: cross-source name matching

Three different naming schemes must resolve to one canonical character:

- Synergy: JP name + numeric id (release order) → English via the translations map / `char_name`.
- Prydwen: English display name + slug (`Asuka Shikinami Langley: Wille` → `asuka-shikinami-langley-wille`).
- Tsareena: English-ish names with annotations (`Asuka WILLE (C)`, `Snow White: Heavy Arms`).

**Approach:** a canonical `nikke_characters` registry keyed by a stable slug.
Match by a normalized English name (lowercase, strip punctuation/annotations),
backed by a **committed override map** for the cases normalization can't solve
(collabs, renames, alt versions). Every sync **reports unmatched entries** so a
human can add an override — silent mismatches are the main failure mode.

**Extra wrinkle — Synergy arena stats naming:** the Synergy character _list_
(`characters`) uses formal JP names, but the per-character _stat_ tables
(`character_season_stats`) key on **JP community shorthand** — e.g. `スターアニス`
(Anis: Star), `ヘビスノ` (Snow White: Heavy Arms), `宝モラン` (Moran (T)). So the
win/pick stats need a **shorthand→canonical dictionary** to attach to a
character. Plan: seed that dictionary once, maintain overrides, and for any
character we can't confidently map, **omit the stats line but still link to the
Synergy page**. Stats coverage grows as the dictionary fills in.

## Storage (`packages/db/src/schema.ts`)

New tables (these are NOT Discord snowflakes, so normal types are fine):

- `nikke_characters` — canonical registry: `id` (slug) PK, `name`, core
  attributes (element/class/burst/weapon/rarity), `prydwenSlug`, `prydwenUrl`,
  `synergyId`, `synergyUrl`, and JSON blobs: `prydwenTiers` `{story,bossing,pvp}`,
  `synergyStats` `{winRate,pickRate,season}`, `sheetData` `{priority,annotations,build}`,
  plus `updatedAt`.
- `nikke_sync_runs` — audit log: `startedAt`, `finishedAt`, `status`
  (`ok|partial|error`), `sources` JSON (per-source counts + errors + unmatched list).
- `nikke_name_overrides` — manual cross-source mappings the sync respects.

## Sync pipeline (`apps/bot/src/lib/nikke/`)

- `sources/synergy.ts` — pull `characters` + `character_season_stats` via REST; build id↔EN map.
- `sources/prydwen.ts` — enumerate slugs, fetch + cheerio-parse tiers.
- `sources/sheet.ts` — fetch CSV tabs, parse rows.
- `match.ts` — reconcile into canonical records (normalize + overrides).
- `sync.ts` — `runNikkeSync()`: gather → match → upsert → record a `nikke_sync_runs` row.
- `apps/bot/src/scripts/sync-nikke.ts` — CLI wrapper so **`npm run sync:nikke`** runs it manually (requirement #5).

**Schedule (daily): DECIDED — `node-cron` in the bot process** calls
`runNikkeSync()` once a day. The manual `npm run sync:nikke` script runs the
same function on demand.

## The command (`apps/bot/src/commands/utility/nikke.ts`)

`/nikke <name>` → DB lookup → one embed: name + Prydwen tiers (+ link), Synergy
stats (+ link), Tsareena priority & build summary. Reads only the DB, so it's
instant. **DECIDED — ship with name autocomplete** (live suggestions as you
type); this means `interactionCreate` must also route `AutocompleteInteraction`s
to the command, so the `Command` type gains an optional `autocomplete` handler.

## New dependencies

`cheerio` (Prydwen HTML), `node-cron` (schedule). CSV parsed with a tiny helper
or `csv-parse`. All in `apps/bot`. DB tables in `packages/db`. Nothing crosses
the architecture boundaries.

## Phased delivery

1. **P1 — reliable sources first:** schema + Synergy (API) + Tsareena (sheet)
   sources + `runNikkeSync` + `/nikke` command + manual `npm run sync:nikke`.
   Both sources are clean JSON/CSV, so this ships value fast and de-risks the
   matching logic. Tests for the parsers/matcher with fixture data.
2. **P2 — Prydwen:** add slug enumeration + cheerio tier parsing to the sync and
   embed. Gate on confirming Prydwen fetches succeed from Railway.
3. **P3 — automation & polish:** daily `node-cron` schedule, unmatched-report
   surfacing, optional `/nikke` autocomplete + a dashboard tab for sync health.

## Open decisions (see the questions posed alongside this doc)

- Synergy "tier": surface objective win/pick-rate stats, or reverse-engineer their letter tier?
- Scheduler: `node-cron` in the bot vs a separate Railway cron service.
- Autocomplete now or later.
