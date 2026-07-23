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
#   scripts/local.sh                        # start the bot (npm run dev:bot)
#   scripts/local.sh npm run sync:nikke     # run any command against the local DB
#   scripts/local.sh npm run bot:deploy-commands
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
  set -- npm run dev:bot
fi

exec "$@"
