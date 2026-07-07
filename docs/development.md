# Development & architecture

Everything a contributor or self-hoster needs. For what Maiden does from a user's point of view, see the [README](../README.md).

## Stack

TypeScript · discord.js 14 · Next.js 15 · Drizzle ORM · PostgreSQL · Railway · npm workspaces

## Architecture

A TypeScript monorepo (npm workspaces) with three parts and a strict dependency direction:

```
apps/bot   ─┐
            ├─→ packages/db   (shared Drizzle schema + client)
apps/web   ─┘
```

- **`apps/bot`** (`@app/bot`) — a [discord.js](https://discord.js.org) gateway bot (runs 24/7 as a Railway worker). Handles utility + admin slash commands, welcome messages, and the NIKKE features.
- **`apps/web`** (`@app/web`) — a [Next.js](https://nextjs.org) dashboard showing live stats.
- **`packages/db`** (`@app/db`) — shared [Drizzle ORM](https://orm.drizzle.team) schema + client for Postgres, used by both apps.

**Dependency rule:** `bot` and `web` may import `@app/db`; `db` must never import from the apps, and the two apps must never import from each other.

Commands and events are **auto-loaded** from the filesystem: adding a command = drop a file in `apps/bot/src/commands/**` exporting `const command: Command` (and `events/**` exporting `const event: Event`). It's auto-registered — no central registry to edit.

> **Not a developer?** Ask Claude to "use the `architecture` skill" to learn the layout, the `discord-feature` skill to add a command/event/table, and the `testing` skill to cover it with tests. Those three skills (under `.claude/skills/`) are written for non-developers extending the bot with Claude's help. See also [CLAUDE.md](../CLAUDE.md).

## NIKKE character data (`/nikke`)

`/nikke` reads from the local database, which a **daily sync** refreshes from three sources:

- [Nikke Synergy](https://nikke-synergy.com)'s public API — arena pick/win stats, character profile attributes (weapon/burst/class/manufacturer/element/etc.), and an auto-built Japanese→English name dictionary.
- **Tsareena's** public sheet — pull priority + per-character builds (parsed by column position; the layout is documented in the sync code).
- [Prydwen](https://www.prydwen.gg/nikke) — Story / Bossing / PvP tiers (preferring a unit's `-treasure` variant when it has one).

The bot runs the sync once a day (and a moment after startup if data is stale); trigger it manually with `/sync` in Discord or:

```bash
npm run sync:nikke   # requires DATABASE_URL; loads/refreshes NIKKE data
```

**Prydwen tiers are special.** Prydwen is Cloudflare-protected and blocks automated fetches from servers (including Railway), so the bot never fetches it at runtime. Tiers live in a committed cache ([prydwen-data.ts](../apps/bot/src/lib/nikke/prydwen-data.ts)) that the sync reads. Refresh it occasionally **from a normal computer** (not CI/Railway) — e.g. when new characters release:

```bash
npm run refresh:prydwen   # one curl request → all characters' Story/Bossing/PVP tiers
```

It makes a **single** request (via `curl`, which gets past Cloudflare) to Prydwen's tier-list page — whose Next.js data payload carries every character's tiers — parses it, and rewrites the cache file to commit. Cross-source name matching (nicknames, treasure variants, collab spellings) lives in [apps/bot/src/lib/nikke/](../apps/bot/src/lib/nikke/), and every run is recorded in the `nikke_sync_runs` table. Design notes: [docs/nikke-feature-plan.md](nikke-feature-plan.md).

Profile icons in the embed are Discord **application emojis** the bot registers on startup (and via `npm run sync:emojis`).

## Local setup

1. **Install** (Node 20+):
   ```bash
   npm install
   ```
2. **Configure**: copy `.env.example` to `.env` and fill in your Discord + database values. Create the app/bot at <https://discord.com/developers/applications>, enable the **Server Members** and **Message Content** privileged intents, and invite it with the `bot` + `applications.commands` scopes.
3. **Database**: point `DATABASE_URL` at a local or Railway Postgres, then:
   ```bash
   npm run db:generate   # create migration from schema
   npm run db:migrate    # apply it
   ```
4. **Register slash commands** (instant when `DISCORD_GUILD_ID` is set):
   ```bash
   npm run bot:deploy-commands
   ```
5. **Run**:
   ```bash
   npm run dev:bot   # the bot
   npm run dev:web   # the dashboard (http://localhost:3000)
   ```

## Testing

Fast unit tests run without a Discord token or a database — a fake `interaction` is just an object, and the DB client is lazy.

```bash
npm test                         # run every test
npm run test:watch -w @app/bot   # re-run as you edit
```

The most important one is the **loader safety-net** ([apps/bot/src/lib/loaders.test.ts](../apps/bot/src/lib/loaders.test.ts)): it loads every command + event exactly like the bot does and fails if any is misshapen (bad name, duplicate, missing export) — so a broken command is caught locally, before it ever reaches Discord. When you add a feature, add a test next to it; see the `testing` skill for copy-paste templates.

## Linting & formatting

**ESLint** (flat config, `eslint.config.mjs`) + **Prettier** (`.prettierrc.json`), enforced automatically on commit via **Husky** + **lint-staged**, so you rarely run these by hand:

```bash
npm run lint          # eslint across the whole monorepo
npm run lint:fix      # auto-fix what eslint can
npm run format        # reformat everything with prettier
npm run format:check  # verify formatting without changing files
```

On every `git commit`, a pre-commit hook runs Prettier + ESLint `--fix` on staged files, then a full `npm run typecheck`; a failure blocks the commit. Install the hook by running `npm install` once (the `prepare` script sets it up). In VS Code, install the two recommended extensions when prompted (see `.vscode/extensions.json`) for format-on-save + eslint auto-fix.

## Deploying (Railway via GitHub Actions)

Hosting is one Railway project with three services sharing a `DATABASE_URL`:

1. **Postgres** — the Railway Postgres plugin.
2. **bot** service — Railway config file `railway.bot.json`; env `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `BOT_ADMIN_ID`, a `DATABASE_URL` reference to the Postgres service, and `DISCORD_GUILD_ID` (comma-separated for several servers; unset = global).
3. **web** service — Railway config file `railway.web.json`, a `DATABASE_URL` reference, and a generated public domain.

Deploys are driven by **GitHub Actions** rather than a Railway↔GitHub connection ([.github/workflows/deploy.yml](../.github/workflows/deploy.yml)): every push to `main` runs the checks, then — only if green — `railway up` for the bot and web services, authenticated with a Railway **project token** stored as the `RAILWAY_TOKEN` repo secret.

Each deploy still uses Railway's two phases:

- **Pre-deploy** (`preDeployCommand: npm run release`) — runs once, between build and start, and **blocks the deploy if it fails**. `release` ([root `package.json`](../package.json)) runs `npm run migrate` (DB migrations via drizzle-orm's runtime migrator, no `drizzle-kit`/`tsx` at runtime) then `npm run register` (registers slash commands from compiled output). So you never run `bot:deploy-commands` by hand in production.
- **Post-deploy** (in the bot process) — Railway has no post-deploy hook, so the bot runs a **background NIKKE sync shortly after startup** ([index.ts](../apps/bot/src/index.ts), `runStartupSyncIfStale`): non-blocking, fail-soft, and skipped if a sync ran in the last 2 hours. The daily 04:00 cron still runs regardless.

## Project layout

```
apps/
  bot/              discord.js gateway worker
    src/
      commands/     auto-loaded slash commands (admin | utility)
      events/       auto-loaded gateway event handlers
      lib/          loaders, NIKKE data pipeline, mod-log + guild-config helpers
                    (tests live next to code as *.test.ts, run by Vitest)
      index.ts      client bootstrap
      deploy-commands.ts
  web/              Next.js dashboard
packages/
  db/               Drizzle schema + client (shared)
```
