# Contributing to Bakery Bot

Thanks for helping out! This repo powers the Discord bot **and** admin dashboard for
**Maiden's Bakery**. It's built so that **anyone — including non-developers — can add
features safely**, with tests and skills that catch mistakes before they ship.

Please read [CLAUDE.md](CLAUDE.md) once before your first change — it explains the
architecture and the rules that keep the project from breaking.

## How contributions work here

This is a repo where **only the maintainer (@Infernal-Crack-LED) can merge to
`main`.** You contribute through a **pull request**, the maintainer reviews it, and they
merge it. You cannot (and don't need to) push to `main` yourself.

Depending on the access you were given, you'll either:

- **Push a branch to this repo** (if you have Write access), or
- **Fork the repo** to your own account and push there (if you have Read/Triage access),
  then open the PR from your fork.

Either way, the flow below is the same.

## The flow

1. **Get the code running** (once):

   ```bash
   npm install
   cp .env.example .env    # then fill in the values you were given
   ```

2. **Make a branch** off `main`:

   ```bash
   git checkout main
   git pull
   git checkout -b my-feature      # e.g. feature/poll-command
   ```

3. **Make your change.** If you're adding a bot feature (a slash command, a gateway
   event, or a database table), follow the recipes in the project skills — they have
   copy-paste templates:
   - **`discord-feature`** — add a command / event / table
   - **`architecture`** — where new code belongs and what not to break
   - **`testing`** — write the unit test that keeps your change safe

   Add a `<name>.test.ts` next to anything with real logic (see the `testing` skill).

4. **Run the checks locally** before you push — these are the same ones CI runs:

   ```bash
   npm test          # unit tests (fast; no Discord/DB needed)
   npm run typecheck # TypeScript
   npm run lint      # ESLint
   npm run format    # Prettier (auto-fixes formatting)
   ```

   A pre-commit hook runs lint-staged + typecheck automatically, but running them
   yourself first avoids surprises.

5. **Commit and push:**

   ```bash
   git add -A
   git commit -m "Add /poll command"
   git push -u origin my-feature        # or push to your fork
   ```

6. **Open a pull request** against `main` (`gh pr create`, or the GitHub website).
   Describe what you changed and why. CI will run your tests, typecheck, lint, and
   format check on the PR — make sure it's green.

7. **The maintainer reviews and merges.** Please don't merge your own PR even if you
   have the button; `main` is the maintainer's to keep stable.

## Ground rules (from CLAUDE.md — the short version)

- **All database access goes through `@app/db`.** Never open your own DB connection.
- **Discord IDs are stored as `text`**, never numbers.
- **Commands and events auto-load from the filesystem** — add a file that matches the
  pattern; don't hand-wire a registry.
- **ESM everywhere** in `apps/bot` and `packages/db` — relative imports need explicit
  `.js` extensions, even from `.ts` files.
- **Never commit secrets.** `DISCORD_TOKEN` / `DATABASE_URL` live in env vars, never in
  code. Update `.env.example` when you add a new variable.
- **Keep `npm test` green** and **keep the docs/skills in sync** if you change how
  things work.

## Reporting bugs & requesting features

Open a **GitHub issue** — anyone with access can. Include what you expected, what
happened, and steps to reproduce if it's a bug. For feature ideas, describe the behavior
you want (e.g. "a `/poll` command that lets union members vote").

## Questions

If you're not sure where something goes or how to do it safely, ask in the issue or PR —
or ask Claude Code with one of the skills above. When in doubt, **follow the patterns
already in the codebase** rather than inventing new ones, and let the tests tell you if
something broke.
