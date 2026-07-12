---
name: discord-feature
description: Add a new feature to this Discord bot — a slash command, a gateway event handler, or a new database table — using the project's established patterns. Use this whenever someone wants the bot to do something new (e.g. "add a /poll command", "welcome new members in a thread", "track user points", "add a mute command"). Provides copy-paste templates and the exact end-to-end steps, aimed at non-developers.
---

# Adding a Discord bot feature

Follow the recipe that matches what you're building. Each produces a working feature by copying the project's existing patterns. Read the **`architecture`** skill first if you're unsure where something belongs.

Golden context you must keep true:

- New files use **ESM imports with `.js` extensions** (even though the file is `.ts`).
- Slash commands **auto-load** from `apps/bot/src/commands/**`; events from `apps/bot/src/events/**`. You never edit a central list.
- Any database access uses **`@app/db`** — never open your own connection.
- After adding/changing a command's _shape_ (name, options, description), you must **re-register** it with Discord (step at the end).
- **Add a test** for anything with real logic, and run `npm test` before you finish. The **`testing`** skill has the templates; the safety-net test alone will catch a mis-shaped command file the moment you run it.

---

## Recipe A — Add a slash command

1. Create a file at `apps/bot/src/commands/<category>/<name>.ts`.
   Categories today: `utility`, `admin`. Add a new folder if it's a genuinely new category.

2. Paste this template and edit the marked parts. This is a **utility** command (no special permissions, no database):

   ```ts
   import { SlashCommandBuilder } from 'discord.js';
   import type { Command } from '../../types.js';

   export const command: Command = {
     data: new SlashCommandBuilder()
       .setName('hello') // ← command name (lowercase, no spaces)
       .setDescription('Say hello.') // ← shown in Discord's command picker
       .addUserOption(
         (o) => o.setName('target').setDescription('Who to greet') // ← optional; delete if unused
       ),
     execute: async (interaction) => {
       const user = interaction.options.getUser('target') ?? interaction.user;
       await interaction.reply(`👋 Hello, ${user}!`);
     },
   };
   ```

3. For an **admin / permission-gated** command, copy the shape of `apps/bot/src/commands/admin/sync.ts`. Two ways to gate it:
   - `.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)` on the builder (Discord hides it from members without that permission — see `/sync`); or
   - an `ensureAdmin(interaction)` check at the top of `execute` (allows server admins **and** hardcoded bot admins from `lib/admin.ts` — see `/config`).
     Audit privileged actions with `logModAction(...)`, and check the bot's own permissions before acting.

4. To read/write data in a command, import from `@app/db` (see Recipe C) — e.g. `import { db, featureRequests } from "@app/db";` — and query with Drizzle, mirroring `apps/bot/src/commands/utility/feature-request.ts` (a `db.insert`) or `nikke.ts` (a `db.query`).

5. **Write a test** next to your command as `<name>.test.ts`. Copy `apps/bot/src/commands/utility/ping.test.ts` (simple) or the mocking pattern in the **`testing`** skill (for admin/DB commands). Run `npm test`.

6. **Register + test** (see "Register commands" at the bottom).

### Slash command option types (quick reference)

`.addStringOption` · `.addIntegerOption` (`.setMinValue/.setMaxValue`) · `.addUserOption` · `.addChannelOption` (`.addChannelTypes(...)`) · `.addBooleanOption`. Chain `.setRequired(true)` for mandatory options. Group related actions with `.addSubcommand(...)` (see `config.ts`).

---

## Recipe B — React to a Discord event (gateway event)

Use this to make the bot respond to things that happen (a member joins, a message is posted, a reaction is added).

1. Create `apps/bot/src/events/<eventName>.ts`.

2. Template (example: greet members — model it on `guildMemberAdd.ts`):

   ```ts
   import { Events } from 'discord.js';
   import type { Event } from '../types.js';

   export const event: Event<Events.GuildMemberAdd> = {
     name: Events.GuildMemberAdd, // ← the event to listen for
     // once: true,                    // ← uncomment for one-time events like ClientReady
     execute: async (member) => {
       // your logic here
     },
   };
   ```

3. **Intents & privileged access.** The bot only receives events it has _intents_ for. Intents are set in `apps/bot/src/index.ts` (the `intents: [...]` array). Common gotchas:
   - Reading message text needs `GatewayIntentBits.MessageContent` **and** the "Message Content Intent" toggle in the Discord Developer Portal.
   - Member joins need `GatewayIntentBits.GuildMembers` **and** the "Server Members Intent" toggle.
     If your handler never fires, a missing intent is the most likely cause.

4. Save. Events auto-load on the next bot start — no registration step needed (that's only for slash commands).

5. **Write a test** next to it as `<eventName>.test.ts` — model it on `apps/bot/src/events/interactionCreate.test.ts`. Build a fake payload (member/message/interaction) and assert the side effect. Run `npm test`.

---

## Recipe C — Store new data (add or change a table)

Do this when a feature needs to remember something (points, tags, reminders, etc.).

1. Edit `packages/db/src/schema.ts`. Add a table using the existing style:

   ```ts
   import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

   export const points = pgTable('points', {
     id: serial('id').primaryKey(),
     guildId: text('guild_id').notNull(), // ← snowflakes are ALWAYS text
     userId: text('user_id').notNull(),
     amount: text('amount').notNull().default('0'),
     updatedAt: timestamp('updated_at', { withTimezone: true })
       .notNull()
       .defaultNow(),
   });

   export type Points = typeof points.$inferSelect; // handy row type
   export type NewPoints = typeof points.$inferInsert;
   ```

2. Generate and apply the migration:

   ```bash
   npm run db:generate   # writes a SQL migration under packages/db/drizzle/
   npm run db:migrate    # applies it to the database in DATABASE_URL
   ```

3. Rebuild the shared package so the apps see the new types/exports:

   ```bash
   npm run build:db
   ```

4. Use it from a command: `import { db, points } from "@app/db";` then query with Drizzle (`db.insert(...)`, `db.query.points.findMany(...)`, etc.), mirroring `feature-request.ts`.

**Never** edit the database by hand or write raw `CREATE TABLE`. Drizzle owns the schema; migrations are the source of truth.

---

## Register commands (required after adding/renaming a command or its options)

Slash commands must be uploaded to Discord before they appear. Events do **not** need this.

```bash
npm run bot:deploy-commands
```

- With `DISCORD_GUILD_ID` set in `.env`, commands register to just that server and appear **instantly** — use this while developing.
- Without it, they register globally and can take up to ~1 hour to show up.

## Test your feature

```bash
npm test               # run the unit tests (fast; no Discord/DB needed)
npm run typecheck      # catch type mistakes before running
npm run dev:bot        # run the bot; try the command/event in Discord
```

If typecheck fails, read the error location — it usually points at a missing `.js` import extension, a wrong option accessor, or a type mismatch. Fix and re-run.

## Finishing up (don't skip)

- [ ] `npm test`, `npm run typecheck`, and `npm run build` all pass.
- [ ] Added a test for the new command/event/logic (see the **`testing`** skill).
- [ ] Slash command? You ran `npm run bot:deploy-commands`.
- [ ] New table? You generated **and** applied a migration and ran `npm run build:db`.
- [ ] New env var? Added to `.env.example`.
- [ ] Audited/privileged action? Routed through `logModAction`. Per-guild setting? Routed through `getGuildConfig`/`setGuildConfig`. Admin-only? Gated via `setDefaultMemberPermissions` or `ensureAdmin`.
- [ ] Stayed inside the boundaries in the `architecture` skill.
