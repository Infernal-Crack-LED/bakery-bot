#!/usr/bin/env bash
#
# Run the bot (or any npm script) against `.env.local`, which OVERRIDES the
# repo-root `.env`.
#
# The bot's own loader (apps/bot/src/loadEnv.ts) only reads `.env`, and Node's
# `process.loadEnvFile` never overrides a variable that is already set. So this
# script sources `.env.local` into the environment FIRST; every key it defines
# wins, and `.env` fills in the rest (e.g. ANTHROPIC_API_KEY). This is the same
# `.env.local`-overrides-`.env` convention the Next.js web app uses.
#
# Usage:
#   scripts/local.sh                          # sync data + commands, then start the bot
#   scripts/local.sh npm run sync:nikke       # run any command against the local DB
#   scripts/local.sh npm run bot:deploy-commands
#
# Starting the bot (no arguments) first:
#   1. builds the shared libs (@app/db + @app/nikke),
#   2. runs `npm run copy:my-data` to refresh your prod data into the local DB,
#   3. runs `npm run bot:deploy-commands` to register slash commands to the
#      guild(s) in DISCORD_GUILD_ID,
#   4. starts the bot (`npm run dev:bot`).
# Steps 2 and 3 are best-effort: if one fails (e.g. prod unreachable, or the dev
# bot isn't in the guild yet) it only warns and the bot still starts. Command
# registrations persist on Discord, so a skipped/failed deploy keeps the previous
# set. Opt out with SKIP_COPY=1 and/or SKIP_DEPLOY=1.
# Passing an explicit command runs just that command, with none of the above.
#
# `.env.local` only needs the LOCAL OVERRIDES (Discord dev app + local database
# + bot admin). Keep secrets you want to share with `.env` out of here.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f .env.local ]]; then
  echo "error: .env.local not found — create it with your local Discord + DB values" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source .env.local
set +a

if [[ $# -eq 0 ]]; then
  # Build the shared libs once up front so the pre-start steps below (and the
  # bot) run against current @app/db + @app/nikke. dev:bot rebuilds via its own
  # pre-hook; tsc is incremental, so the extra pass is cheap. A real build error
  # aborts startup (the bot couldn't run anyway).
  npm run build:libs

  # 1. Refresh your prod data into the local DB (best-effort; SKIP_COPY=1 to skip).
  if [[ -n "${SKIP_COPY:-}" ]]; then
    echo "[local] skipping prod data copy (SKIP_COPY is set)"
  else
    echo "[local] refreshing your prod data into the local DB (copy:my-data)..."
    if npm run copy:my-data; then
      echo "[local] prod data refreshed"
    else
      echo "[local] warning: copy:my-data failed — starting with existing local data" >&2
    fi
  fi

  # 2. Register slash commands to the guild(s) in DISCORD_GUILD_ID (best-effort;
  #    SKIP_DEPLOY=1 to skip). Guild-scoped commands register instantly.
  if [[ -n "${SKIP_DEPLOY:-}" ]]; then
    echo "[local] skipping command deploy (SKIP_DEPLOY is set)"
  else
    echo "[local] registering slash commands (bot:deploy-commands)..."
    if npm run bot:deploy-commands; then
      echo "[local] slash commands registered"
    else
      echo "[local] warning: bot:deploy-commands failed — starting with previously registered commands" >&2
    fi
  fi

  set -- npm run dev:bot
fi

exec "$@"
