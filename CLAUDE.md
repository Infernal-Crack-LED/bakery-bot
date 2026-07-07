# CLAUDE.md — Bakery Bot

Guidance for Claude (and Claude Code) working in this repo. **Read this before making changes.** The goal: anyone — including non-developers — should be able to add features here _without breaking the architecture_. When in doubt, follow the patterns already in the codebase rather than inventing new ones, and **let the tests tell you if you broke something** (`npm test`).

## What this is

**Bakery Bot** — the Discord bot **and** admin dashboard for **Maiden's Bakery**, the community server for a cluster of unions (guilds) in the game **NIKKE: Goddess of Victory**. It started from a general Discord-bot boilerplate; it ships with **utility** and **admin** commands plus the NIKKE features as worked examples, and new bakery/union features get added on top using the same patterns. (General moderation — ban/kick/etc. — is deliberately left to Discord's built-in tools.) The architecture is deliberately simple and heavily documented so non-developers can extend it safely with Claude's help.

## Architecture (the shape you must preserve)

A **TypeScript monorepo** using npm workspaces. Three parts, with a strict dependency direction:

```
apps/bot   ─┐
            ├─→ packages/db   (shared Drizzle schema + client)
apps/web   ─┘
```

| Workspace     | Package name | Role                                                                                                                |
| ------------- | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `apps/bot`    | `@app/bot`   | discord.js 14 **gateway** bot. Long-running worker (runs 24/7 on Railway). Handles slash commands + gateway events. |
| `apps/web`    | `@app/web`   | Next.js 15 (App Router) admin dashboard.                                                                            |
| `packages/db` | `@app/db`    | Drizzle ORM schema + Postgres client. The **only** place that talks to the database.                                |

**Dependency rule:** `bot` and `web` may import `@app/db`. `db` must **never** import from `bot` or `web`. The two apps must **never** import from each other.

## Golden rules (do not break these)

1. **All database access goes through `@app/db`.** Never `import postgres`/open a connection anywhere else. Add tables to `packages/db/src/schema.ts`, then generate a migration.
2. **Discord snowflake IDs are stored as `text`**, never numeric — they exceed JS safe-integer range.
3. **Commands and events are auto-loaded** from the filesystem (see the skills). Adding a feature = adding a file that matches the pattern. Do not hand-wire a central registry.
4. **ESM everywhere.** In `apps/bot` and `packages/db`, relative imports must use explicit `.js` extensions (NodeNext), even from `.ts` files.
5. **Respect Discord permissions.** Privileged commands gate access — either `.setDefaultMemberPermissions(...)` on the builder (e.g. `/perms`) or an `ensureAdmin(...)` check in code (e.g. `/config`, which also allows hardcoded bot admins in `lib/admin.ts`). Check the bot's own permissions before acting.
6. **Never commit secrets.** `DISCORD_TOKEN` and `DATABASE_URL` live in env vars / Railway, never in code. Update `.env.example` when adding a new variable.
7. **Test your changes.** Add a `<name>.test.ts` next to anything with real logic and keep `npm test` green — the loader safety-net test alone catches most broken commands/events. See the `testing` skill.
8. **Keep the docs in sync.** If you change the architecture, update this file, the skills under `.claude/skills/`, and the README.

## How to add features → use the skills

This repo ships three project skills. Prefer them over improvising:

- **`architecture`** — how the pieces fit, boundaries, and where new code belongs. Use it to understand the system or make a design decision.
- **`discord-feature`** — step-by-step recipes (with templates) for adding a slash command, a gateway event, or a database table.
- **`testing`** — how to write and run the unit tests that keep changes safe (templates included). Use it whenever you add or change logic.

## Commands

```bash
npm install                 # install all workspaces
npm run dev:bot             # run the bot (watch mode)
npm run dev:web             # run the dashboard at http://localhost:3000
npm run db:generate         # create a migration after editing schema.ts
npm run db:migrate          # apply migrations (drizzle-kit, local dev)
npm run release             # deploy step: apply migrations + register commands (compiled; used by Railway)
npm run bot:deploy-commands # register slash commands with Discord
npm run bot:clear-guild-commands # remove leftover per-guild commands (dupes of the global ones)
npm run sync:nikke          # refresh NIKKE data into the DB (Synergy + sheet + Prydwen cache)
npm run refresh:prydwen     # (run locally, NOT Railway) refresh the Prydwen tier cache
npm run build               # build db → bot → web (in order)
npm run typecheck           # typecheck everything
npm test                    # run the unit tests (fast; no Discord/DB needed)
npm run lint                # eslint the whole monorepo (flat config at root)
npm run format              # reformat everything with prettier
```

**Code style is enforced automatically.** ESLint (`eslint.config.mjs`) + Prettier (`.prettierrc.json`) run on staged files via a Husky pre-commit hook (`.husky/pre-commit`), which then runs `npm run typecheck`. A failing lint/format/typecheck **blocks the commit**. Match the existing style; if a rule fights you, fix the code rather than disabling the rule. Note: this repo keeps `export function ...` declarations (the `func-style` rule is intentionally omitted).

## Conventions cheat-sheet

- **DB client is lazy**: importing `@app/db` opens no connection; the pool is created on first query. So it's safe to import DB-backed command modules without `DATABASE_URL` (e.g. during `deploy-commands`).
- **Slash commands** live in `apps/bot/src/commands/<category>/<name>.ts` and `export const command: Command`.
- **Gateway events** live in `apps/bot/src/events/<name>.ts` and `export const event: Event`.
- **Privileged/audited actions** (e.g. `/perms` bulk edits) are recorded via `logModAction(...)` so they land in the audit log + mod-log channel.
- **Per-guild settings** go through `getGuildConfig` / `setGuildConfig`, not raw queries.
