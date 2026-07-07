# Bakery Bot

The Discord bot **and** admin dashboard for **Maiden's Bakery** — the community server for a cluster of unions in [NIKKE: Goddess of Victory](https://nikke-en.com). Built to be extended safely: the architecture is simple, documented, and covered by tests, so non-developers can add features with Claude's help without breaking things. Ships with utility + admin commands and NIKKE features as worked examples.

- **`apps/bot`** — a [discord.js](https://discord.js.org) gateway bot (runs 24/7 as a Railway worker). Handles utility + admin slash commands, welcome messages, and the NIKKE features.
- **`apps/web`** — a [Next.js](https://nextjs.org) dashboard showing live stats.
- **`packages/db`** — shared [Drizzle ORM](https://orm.drizzle.team) schema + client for Postgres, used by both apps.

> **New here and not a developer?** Ask Claude to "use the `architecture` skill" to learn the layout, the `discord-feature` skill to add something, and the `testing` skill to make sure it works. Those three skills (under `.claude/skills/`) are written for you.

## Stack

TypeScript · discord.js 14 · Next.js 15 · Drizzle ORM · PostgreSQL · Railway · npm workspaces

## Commands (implemented)

| Category | Command                                                        | Description                                                                                         |
| -------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Utility  | `/ping`                                                        | Bot latency                                                                                         |
| Utility  | `/serverinfo`                                                  | Server stats                                                                                        |
| Utility  | `/userinfo [target]`                                           | User details                                                                                        |
| Utility  | `/guides`                                                      | Post curated NIKKE guides & community links                                                         |
| Utility  | `/time <when> <offset> [style]`                                | Convert a date/time to a `<t:…>` timestamp everyone sees in their own local zone                    |
| Utility  | `/nikke <name>`                                                | Look up a NIKKE's Prydwen tiers, Synergy arena stats & Tsareena priority (autocomplete)             |
| Utility  | `/help`                                                        | DM the user a list of every command                                                                 |
| Utility  | `/feature-request <idea>`                                      | Log a suggestion (saved to the DB + opens a GitHub issue if configured)                             |
| Admin    | `/config modlog\|welcome\|news\|show`                          | Set the mod-log / welcome / NIKKE-news channels (server admins + bot admins)                        |
| Admin    | `/perms <role> <permission> <mode> <scope> [category] [apply]` | Bulk-edit a role's permission across many channels — previews unless `apply:true`, and audit-logged |

> Moderation (ban/kick/timeout/purge/warn) is intentionally **not** included — Discord's built-in moderation tools already cover it.

Adding a command = drop a file in `apps/bot/src/commands/**` exporting `const command: Command`. It's auto-loaded and auto-registered.

**Gateway features (no slash command):**

- **NIKKE news auto-timestamp** — in each server, an admin sets a news channel with **`/config news #channel`**; the bot then watches it and replies to each tweet/announcement embed with a `<t:…>` stamp so event times render in every member's local timezone. It reads only the tweet text (never TweetShift's footer), skips posts with no explicit date/time, and assumes UTC+9 when a tweet states no zone. (`NIKKE_NEWS_CHANNEL_ID` still works as a global fallback for servers that haven't configured one.) See [messageCreate.ts](apps/bot/src/events/messageCreate.ts).

## NIKKE character data (`/nikke`)

`/nikke` reads from the local database, which a **daily sync** refreshes from [Nikke Synergy](https://nikke-synergy.com)'s public API (arena stats + the auto-built Japanese→English name dictionary), Tsareena's public sheet (pull priority + per-character builds), and [Prydwen](https://www.prydwen.gg/nikke) tiers. The bot runs the sync once a day; you can also trigger it manually:

```bash
npm run sync:nikke   # requires DATABASE_URL; loads/refreshes NIKKE data
```

**Prydwen tiers** are special: Prydwen is Cloudflare-protected and blocks automated fetches from servers (including Railway), so the bot never fetches it at runtime. Tiers live in a committed cache ([prydwen-data.ts](apps/bot/src/lib/nikke/prydwen-data.ts)) that the sync reads. Refresh it occasionally **from a normal computer** (not Railway) — e.g. when new characters release:

```bash
npm run refresh:prydwen   # one request → all characters' Story/Bossing/PVP tiers
```

It makes a **single** request (via `curl`, which gets past Cloudflare) to Prydwen's tier-list page — whose Next.js data payload carries every character's three tiers — parses it, and rewrites the cache file to commit. Design, data sources, and the cross-source name-matching approach are documented in [docs/nikke-feature-plan.md](docs/nikke-feature-plan.md). The sync logic lives in [apps/bot/src/lib/nikke/](apps/bot/src/lib/nikke/) and records every run in the `nikke_sync_runs` table.

## Local setup

1. **Install** (Node 20+):
   ```bash
   npm install
   ```
2. **Configure**: copy `.env.example` to `.env` and fill in your Discord + database values.
   Create the app/bot at <https://discord.com/developers/applications>, enable the
   **Server Members** and **Message Content** privileged intents, and invite it with
   the `bot` + `applications.commands` scopes.
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
npm test                 # run every test
npm run test:watch -w @app/bot   # re-run as you edit
```

The most important one is the **loader safety-net** (`apps/bot/src/lib/loaders.test.ts`): it loads every command + event exactly like the bot does and fails if any is misshapen (bad name, duplicate, missing export) — so a broken command is caught locally, before it ever reaches Discord. When you add a feature, add a test next to it; see the `testing` skill for copy-paste templates.

## Linting & formatting

The repo uses **ESLint** (flat config, `eslint.config.mjs`) + **Prettier** (`.prettierrc.json`), enforced automatically on commit via **Husky** + **lint-staged** — so you rarely run these by hand.

```bash
npm run lint          # check for problems (eslint across the whole monorepo)
npm run lint:fix      # auto-fix what eslint can
npm run format        # reformat everything with prettier
npm run format:check  # verify formatting without changing files
```

**On every `git commit`**, a pre-commit hook runs Prettier + ESLint `--fix` on your staged files, then a full `npm run typecheck`. If any of those fail, the commit is blocked — so broken or unformatted code can't land, even if you edit files by hand. Install the hook by running `npm install` once (the `prepare` script sets it up).

In **VS Code**, install the two recommended extensions when prompted (Prettier + ESLint, see `.vscode/extensions.json`); `.vscode/settings.json` turns on format-on-save and eslint auto-fix so your editor matches the hook.

## Deploying to Railway

One project, three services sharing a `DATABASE_URL`:

1. **Postgres** — add the Railway Postgres plugin.
2. **bot** service — in **Settings → Config-as-code**, set the **Railway config
   file** to `railway.bot.json` (⚠️ this uses a custom filename, so Railway will
   NOT pick it up automatically — if the path is unset, the pre-deploy step that
   runs migrations + registers commands never runs). Add `DISCORD_TOKEN`,
   `DISCORD_CLIENT_ID` and a reference variable for `DATABASE_URL` from the
   Postgres service. Set `DISCORD_GUILD_ID` to your server id for instant
   commands (comma-separated for several servers); leave it unset for global.
3. **web** service — set the Railway config file to `railway.web.json`, add the
   `DATABASE_URL` reference variable, and generate a public domain.

**Deploys are fully automatic**, split into the two phases Railway supports:

- **Pre-deploy** (`preDeployCommand: npm run release`) — runs once per deploy,
  between build and start, and **blocks the deploy if it fails** (rollback-safe).
  **`release`** ([root `package.json`](package.json)) does the critical steps
  using only compiled output + production deps (no `drizzle-kit`/`tsx` at
  runtime): `npm run migrate` (DB migrations via drizzle-orm's runtime migrator,
  [migrate.ts](packages/db/src/migrate.ts)) then `npm run register` (registers
  slash commands from [compiled deploy-commands](apps/bot/src/deploy-commands.ts)).
  So you never run `bot:deploy-commands` by hand.
- **Post-deploy** (in the bot process) — Railway has no post-deploy hook, so the
  bot itself runs a **background NIKKE data sync a moment after startup**
  ([index.ts](apps/bot/src/index.ts), `runStartupSyncIfStale`). It's non-blocking
  and fail-soft (a source outage never affects the deploy), and it skips if a
  sync ran in the last 2 hours — so a fresh DB gets data immediately, later
  deploys pick up new characters, and crash-restarts don't re-sync. The daily
  04:00 cron still runs regardless.

## Project layout

```
apps/
  bot/              discord.js gateway worker
    src/
      commands/     auto-loaded slash commands (admin | utility)
      events/       auto-loaded gateway event handlers
      lib/          loaders, mod-log + guild-config helpers
                    (tests live next to code as *.test.ts, run by Vitest)
      index.ts      client bootstrap
      deploy-commands.ts
  web/              Next.js dashboard
packages/
  db/               Drizzle schema + client (shared)
```
