#!/bin/bash
#
# End-to-end check of /api/blabla-roster's region handling, against a REAL Next
# server, the REAL blablalink API and the REAL database. apps/web has no unit
# test harness, so this is the instrument that proves the route works — the
# region support was verified with it before merging.
#
#   bash scripts/roster-route-e2e.sh <intl_open_id> <expected_area_id>
#
# It checks, for an account known to live in <expected_area_id>:
#   - that region returns a live roster with units and per-unit loadouts
#   - a region the account is NOT in fails instead of silently storing nothing
#   - an out-of-range ?area= is rejected as 400 bad_area
#   - omitting ?area= reuses the region the account last synced from
#   - a repeat read is served from the database, not blablalink
#
# Requires: DATABASE_URL, BLABLALINK_GAME_TOKEN, BLABLALINK_GAME_OPENID in the
# environment (the session variables live on the @app/web Railway service; see
# `npm run blabla:session -- --check`). WRITES to whatever DATABASE_URL points
# at — it stores the roster it reads, so point it at a database you mean to
# touch.
set -uo pipefail

OPENID="${1:-}"
EXPECTED_AREA="${2:-}"
if [ -z "$OPENID" ] || [ -z "$EXPECTED_AREA" ]; then
  echo "usage: bash scripts/roster-route-e2e.sh <intl_open_id> <expected_area_id>" >&2
  exit 2
fi
for var in DATABASE_URL BLABLALINK_GAME_TOKEN BLABLALINK_GAME_OPENID; do
  if [ -z "${!var:-}" ]; then
    echo "$var must be set" >&2
    exit 2
  fi
done

# Some region other than the expected one, to prove a wrong pick is visible.
OTHER_AREA=82
if [ "$EXPECTED_AREA" = "82" ]; then OTHER_AREA=83; fi

cd "$(dirname "$0")/.."
export BLABLA_PROBE_KEY="local-e2e-$$"
export SESSION_SECRET="${SESSION_SECRET:-local-e2e-secret}"

# Pick a port nothing is listening on. Do NOT honour an inherited $PORT: a
# collision doesn't fail loudly, it silently answers from whatever else is on
# that port (a Vite dev server happily served its index.html to every API call
# here, which reads as "the route is broken").
PORT=""
for candidate in $(seq 3200 3260); do
  if ! (echo >"/dev/tcp/127.0.0.1/$candidate") 2>/dev/null; then
    PORT="$candidate"
    break
  fi
done
if [ -z "$PORT" ]; then
  echo "no free port in 3200-3260" >&2
  exit 1
fi
echo "[e2e] using port $PORT"

npm run build:libs >/tmp/roster-e2e-build.log 2>&1 || {
  echo "build:libs FAILED — see /tmp/roster-e2e-build.log" >&2
  exit 1
}
(cd apps/web && npx next dev -p "$PORT" >/tmp/roster-e2e-next.log 2>&1) &
SERVER_PID=$!
# Kill by command line as well as by pid: `next dev` spawns a grandchild that
# outlives a plain `kill` on the subshell, and a leaked server then poisons the
# next run by holding the port.
trap 'kill $SERVER_PID 2>/dev/null; pkill -f "next dev -p $PORT" 2>/dev/null' EXIT

ready=""
for _ in $(seq 1 60); do
  # Insist on a JSON answer from OUR api, not merely "something responded".
  case "$(curl -s "http://localhost:$PORT/api/me")" in
    *'"error"'* | *'"id"'*)
      ready=1
      break
      ;;
  esac
  sleep 2
done
if [ -z "$ready" ]; then
  echo "server never came up — see /tmp/roster-e2e-next.log" >&2
  exit 1
fi

call() { # label, query-string
  printf '%-46s ' "$1"
  curl -s "http://localhost:$PORT/api/blabla-roster?openid=$OPENID&key=$BLABLA_PROBE_KEY&$2" \
    -w ' [HTTP %{http_code}]' | python3 -c "
import json,sys
raw=sys.stdin.read()
body,_,status=raw.rpartition(' [HTTP ')
try:
    d=json.loads(body)
    out={k:d[k] for k in ('source','areaId','count','syncLevel','error','msg') if k in d}
    if d.get('syncedLoadouts'):
        out['loadouts']=len(d['syncedLoadouts'])
    print('HTTP '+status.rstrip(')')+' '+json.dumps(out))
except Exception:
    print('HTTP '+status.rstrip(')')+' '+body[:120])
"
}

echo "=== stored row BEFORE ==="
psql "$DATABASE_URL" -tAc "select open_id, area_id, jsonb_array_length(characters) from nikke_rosters where open_id='$OPENID';"

echo "=== the account's own region (area=$EXPECTED_AREA) ==="
# refresh=1 so this exercises the LIVE blablalink path even on a re-run, when a
# snapshot from a previous run is already stored.
call "area=$EXPECTED_AREA + details (live)" "area=$EXPECTED_AREA&details=1&refresh=1"
echo "=== a region the account is not in (area=$OTHER_AREA) ==="
call "area=$OTHER_AREA" "area=$OTHER_AREA"
echo "=== validation + cache behaviour ==="
call "area=99 (invalid)" "area=99"
call "no area param (reuses stored region)" "details=1"
call "area=$EXPECTED_AREA again (expect source=db)" "area=$EXPECTED_AREA&details=1"

echo "=== stored row AFTER ==="
psql "$DATABASE_URL" -tAc "select open_id, area_id, jsonb_array_length(characters), sync_level from nikke_rosters where open_id='$OPENID';"
