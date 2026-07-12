---
name: architecture
description: Understand and respect Bakery Bot's monorepo architecture (Discord bot + dashboard for Maiden's Bakery). Use this whenever you're about to add, move, or change code and need to know where it belongs, what the boundaries are, and what must not be broken — especially for non-developers who want to add features safely. Also use when making a design/structure decision or when asked "how is this project organized / where does X go".
---

# Bakery Bot — Architecture

Bakery Bot is the Discord bot + admin dashboard for **Maiden's Bakery**, a cluster of NIKKE unions. Read this before adding or changing code. It exists so that **anyone — including non-developers — can add features without breaking the system.** The safest change is one that copies an existing pattern.

## The map

A **TypeScript monorepo** (npm workspaces). Three workspaces, one allowed dependency direction:

```
apps/bot   ─┐
            ├─→ packages/db      (shared database layer)
apps/web   ─┘
```

- **`apps/bot`** (`@app/bot`) — the Discord bot. Uses **discord.js 14** as a **gateway** client: a long-running process that stays connected and receives every server event (messages, member joins, interactions). Runs 24/7 as a Railway worker. This is where commands and event handlers live.
- **`apps/web`** (`@app/web`) — a **Next.js 15** (App Router) admin dashboard. Read-oriented UI over the same database.
- **`packages/db`** (`@app/db`) — the **only** place that talks to Postgres. Drizzle ORM schema + a shared client. Both apps import from here.

## Boundaries — the rules that keep it maintainable

1. **The database is a single shared layer.** Only `@app/db` opens a connection or defines tables. `bot` and `web` import `db`; they never open their own connection.
2. **Dependency direction is one-way.** `db` must never import from `bot` or `web`. The two apps must never import each other. If you feel the urge to cross these lines, the logic probably belongs in `packages/db` (data) or in a shared helper.
3. **Snowflake IDs are `text`.** Discord user/guild/channel IDs overflow JS numbers. Always store and compare them as strings.
4. **Auto-loading over central registries.** Commands and events are discovered by scanning folders. You add capability by adding a correctly-shaped file — you never edit a big list. (See the `discord-feature` skill.)
5. **ESM with explicit extensions.** In `bot` and `db`, relative imports end in `.js` even though the source is `.ts` (NodeNext module resolution). Copy the style of neighbouring files.

## Where does my change go? (decision guide)

| I want to…                                         | Put it in…                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| Add a slash command (`/something`)                 | `apps/bot/src/commands/<category>/<name>.ts`                                |
| React to a Discord event (join, message, reaction) | `apps/bot/src/events/<name>.ts`                                             |
| Store new data (settings, points, requests, …)     | a new/edited table in `packages/db/src/schema.ts`, then a migration         |
| Share logic used by several commands               | `apps/bot/src/lib/`                                                         |
| Read/write a per-server setting                    | `getGuildConfig` / `setGuildConfig` in `apps/bot/src/lib/guildConfig.ts`    |
| Record an audited/privileged action                | `logModAction(...)` in `apps/bot/src/lib/modlog.ts`                         |
| Gate a command to admins                           | `ensureAdmin(...)` / `isBotAdmin(...)` in `apps/bot/src/lib/admin.ts`       |
| Add a dashboard page/stat                          | `apps/web/src/app/**` (server components can import `@app/db`)              |
| Add or update a test                               | a `<name>.test.ts` next to the code it covers (see the **`testing`** skill) |

## Data model (current)

Defined in `packages/db/src/schema.ts`:

- **`guild_config`** — one row per server: mod-log, welcome, and news channels.
- **`mod_actions`** — append-only audit log of privileged actions (written via `logModAction`).
- **`feature_requests`** — suggestions from `/feature-request`.
- **`nikke_characters` / `nikke_name_dictionary` / `nikke_sync_runs`** — NIKKE data + sync bookkeeping (populated by the daily sync in `lib/nikke`).

To change data: edit `schema.ts` → `npm run db:generate` (creates a migration file under `packages/db/drizzle/`) → `npm run db:migrate` (applies it). Never hand-write SQL against the DB; let Drizzle own the schema.

## Runtime & deploy shape

- **Bot**: `node dist/index.js` (built from TS). Boots a discord.js `Client`, loads commands + events, logs in. Restarts cleanly on SIGINT/SIGTERM.
- **Web**: standard Next.js `build` + `start`.
- **Railway**: one project, three services — Postgres + `bot` (config `railway.bot.json`) + `web` (config `railway.web.json`). They share `DATABASE_URL` via a Railway reference variable. The bot uses a **pre-deploy command** `npm run release` (root `package.json`) — applies DB migrations (drizzle-orm runtime migrator) + registers slash commands, compiled `dist` + prod deps only; runs once per deploy and blocks it on failure. The **start command** just runs the bot. Non-critical data loads (the NIKKE sync) run **in-process after startup** (`runStartupSyncIfStale` in `index.ts`), since Railway has no post-deploy hook.

## Before you finish a change — checklist

- [ ] New code lives in the workspace the table above points to.
- [ ] No new database connection outside `@app/db`; snowflakes stored as `text`.
- [ ] Did not import across the app boundary (`bot` ↔ `web`) or backwards into `db`.
- [ ] Relative imports use `.js` extensions (in `bot`/`db`).
- [ ] `npm test` passes (including the loader safety-net); added a test for new logic.
- [ ] `npm run typecheck` passes; `npm run build` passes.
- [ ] If you touched schema: generated **and** applied a migration.
- [ ] If you added an env var: updated `.env.example`.
- [ ] If you changed the architecture itself: updated `CLAUDE.md`, this skill, and `README.md`.

## For a new slash command or event specifically

Don't improvise the setup — follow the **`discord-feature`** skill, which has copy-paste templates and the exact steps (including registering the command with Discord).
