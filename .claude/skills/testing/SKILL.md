---
name: testing
description: Write and run unit tests for the Bakery Bot so changes are safe. Use this whenever you add or change a command, event, or shared helper, or when someone asks "how do I test this", "is this covered", "why did the test fail", or wants to add a test. Explains the test setup, the safety-net tests, and gives copy-paste templates aimed at non-developers.
---

# Testing Bakery Bot

Tests exist so **anyone can change the bot and know within seconds if they broke something** — without a Discord connection or a database. Run them constantly; they're fast.

## How to run the tests

```bash
npm test                       # run every test in the repo (from the repo root)
npm run test --workspace=@app/bot   # just the bot's tests
npm run test:watch -w @app/bot # re-run automatically as you edit (great while coding)
```

Tests live **next to the code they cover**, named `<name>.test.ts`. The runner is [Vitest](https://vitest.dev). A Discord `interaction` is just a plain object, so we fake it — no bot token or live server needed. The database client is lazy, so importing command modules never opens a connection.

## The safety net (already written — keep it green)

`apps/bot/src/lib/loaders.test.ts` loads **every** command and event file exactly like the running bot does and checks each one is valid: unique lowercase name, a description, an `execute` function, and that it serializes to a valid Discord payload (the same step `deploy-commands` runs).

**What this means for you:** when you add a command file and run `npm test`, you find out immediately if its name clashes, its builder is misconfigured, or an export is missing — _before_ it ever reaches Discord. If this test goes red after you add a file, read the failure message; it names the offending command.

## Recipe A — test a single command

Copy the pattern in `apps/bot/src/commands/utility/ping.test.ts`. Build a fake interaction with `vi.fn()` stubs for the methods your command calls, run `execute`, then assert what it did:

```ts
import { describe, expect, it, vi } from 'vitest';
import { command } from './mycommand.js'; // ← the command under test

describe('/mycommand', () => {
  it('does the thing', async () => {
    const interaction = {
      // Only stub what your command actually uses:
      options: { getString: vi.fn().mockReturnValue('hello') },
      reply: vi.fn().mockResolvedValue(undefined),
    };

    await command.execute(interaction as any); // `as any`: it's a fake, not a real interaction

    expect(interaction.reply).toHaveBeenCalledOnce();
  });
});
```

Assert on the arguments a stub was called with via `interaction.reply.mock.calls[0][0]`.

## Recipe B — test a command that calls a helper (mock the helper)

Some commands call a shared helper that hits the DB or network — `/sync` calls `runNikkeSync`, `/feature-request` calls `createGithubIssue`. In a test you don't want the real thing, so **mock the helper** to keep the test pure. Model it on `apps/bot/src/commands/admin/sync.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

// Replace the real helpers with stubs for this whole test file:
vi.mock('../../lib/admin.js', () => ({ ensureAdmin: vi.fn() }));
vi.mock('../../lib/nikke/sync.js', () => ({ runNikkeSync: vi.fn() }));

import { command } from './sync.js';
import { ensureAdmin } from '../../lib/admin.js';
import { runNikkeSync } from '../../lib/nikke/sync.js';

describe('/sync', () => {
  it('does not sync when the user is not an admin', async () => {
    vi.mocked(ensureAdmin).mockResolvedValue(false);
    const interaction = {
      /* fake interaction with vi.fn() stubs — see sync.test.ts */
    };
    await command.execute(interaction as any);
    expect(runNikkeSync).not.toHaveBeenCalled(); // gated out, so nothing runs
  });
});
```

`vi.mock(path, factory)` must use the **same import path the source file uses** (here `"../../lib/nikke/sync.js"`), and it applies to the whole test file. (`github.test.ts` shows the same idea by injecting a fake `fetch`.)

## Recipe C — test an event handler

Events are just as testable — see `apps/bot/src/events/interactionCreate.test.ts`. Build a fake event payload (a member, a message, an interaction) and assert on the side effects your handler performs.

## What to test (and what not to)

- **Do** test your command's _decisions_: the guardrails (permission/hierarchy checks that must block), the branches (each subcommand, the "nothing found" path), and that it replies to the user.
- **Do** keep the safety-net (`loaders.test.ts`) green — never delete it.
- **Don't** test discord.js itself, or try to reach the real Discord API / a real database. Mock at the boundary (`@app/db`, `logModAction`, `getGuildConfig`).
- **Don't** chase 100% coverage. One test per meaningful branch beats many trivial ones.

## When you're done

```bash
npm test           # all green
npm run typecheck  # types still valid
```

If a test fails, read the message and the file:line it points to. A red safety-net test almost always means a newly added command/event file is misshapen — fix the file, not the test. See the **discord-feature** skill for the templates the tests are checking, and **architecture** for where code belongs.
