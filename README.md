# Maiden

**Maiden** is the Discord bot **and** admin dashboard for **Maiden's Bakery** — the community server for a cluster of unions in [NIKKE: Goddess of Victory](https://nikke-en.com). Built to be extended safely: the architecture is simple, documented, and covered by tests, so non-developers can add features with Claude's help without breaking things. Ships with utility + admin commands and NIKKE features as worked examples.

- **`apps/bot`** — a [discord.js](https://discord.js.org) gateway bot (runs 24/7 as a Railway worker). Handles utility + admin slash commands, welcome messages, and the NIKKE features.
- **`apps/web`** — a [Next.js](https://nextjs.org) dashboard showing live stats.
- **`packages/db`** — shared [Drizzle ORM](https://orm.drizzle.team) schema + client for Postgres, used by both apps.

Feel free to reach out to me on Discord or check me out on Blablalink.

[![Discord](https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white)](https://discord.com/users/177179150669316096) [![Blablalink](https://img.shields.io/badge/Blablalink-2B2B2B?logo=data:image/png;base64,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&logoColor=white)](https://www.blablalink.com/)

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
