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
#   scripts/local.sh                          # refresh your prod data, then start the bot
#   scripts/local.sh npm run sync:nikke       # run any command against the local DB
#   scripts/local.sh npm run bot:deploy-commands
#
# Starting the bot (no arguments) first runs `npm run copy:my-data` to refresh
# your prod data into the local DB, so local dev runs against realistic data.
# This is best-effort: a failed copy (e.g. prod unreachable) only warns and the
# bot still starts on whatever local data exists. Set SKIP_COPY=1 to skip it.
# Passing an explicit command runs just that command, with no auto-copy.
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
  set -- npm run dev:bot
fi

exec "$@"
