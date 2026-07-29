#!/usr/bin/env bash
set -euo pipefail

# dispatch-claude.sh — dispatch a cross-family review packet to Claude via the CLI.
#
#   bash scripts/gates/dispatch-claude.sh <packet.md> <model> <result-out.json>
#
# Prepends the subagent non-negotiables, pipes the full prompt to `claude -p` with
# tools disabled (--allowedTools ""), extracts the model's JSON from the CLI
# envelope, strips markdown fences, validates it parses as JSON, and writes to
# <result-out.json>.
#
# The model field is injected into the result so the verdict can report provenance.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Non-negotiables: try the worktree first, fall back to the main repo. Optional —
# if neither exists the packet is dispatched without the header.
NON_NEG=""
for candidate in "$ROOT/.claude/subagent-non-negotiables.md" \
                 "$HOME/bakery-bot/.claude/subagent-non-negotiables.md"; do
  if [[ -f "$candidate" ]]; then
    NON_NEG="$candidate"
    break
  fi
done

if [[ $# -lt 3 ]]; then
  echo "usage: dispatch-claude.sh <packet.md> <model> <result-out.json>" >&2
  exit 1
fi

PACKET="$1"
MODEL="$2"
OUT="$3"

if [[ ! -f "$PACKET" ]]; then
  echo "❌ packet not found: $PACKET" >&2
  exit 1
fi

# Build the full prompt: no-tools preamble + non-negotiables + the packet.
# The preamble is required: the templates say "Save to <path>" which triggers
# tool-use attempts; with tools disabled + --max-turns 1 the model burns its
# one turn on a denied tool call and never returns JSON. The preamble + the
# extra turns give it a clear instruction and a recovery path.
PROMPT="IMPORTANT: You have NO tools available. Do NOT attempt to use any tools (no file writes, no reads, no shell commands). Return your complete JSON response directly in your response text.

"
if [[ -n "$NON_NEG" ]]; then
  PROMPT+="$(cat "$NON_NEG")

---

"
fi
PROMPT+="$(cat "$PACKET")"

echo "→ dispatching $(basename "$PACKET") to $MODEL …" >&2

# Dispatch: tools DISABLED (--allowedTools "DISABLED" — a non-matching name;
# the empty string "" is treated as "no filter" by the CLI). Single turn, JSON
# envelope. The blind role must return JSON in its text response, not use tools
# to write files — this preserves the blindness boundary (it cannot read the
# driver's artifacts from the repo) and gives us the JSON on stdout to validate.
# NOTE: --bare breaks OAuth/keychain auth, so we don't use it.
RAW="$(printf '%s' "$PROMPT" | claude -p \
  --model "$MODEL" \
  --output-format json \
  --max-turns 3 \
  --allowedTools "DISABLED" \
  2>/dev/null)" || true

# Extract the model's text response from the CLI JSON envelope.
RESULT_TEXT="$(printf '%s' "$RAW" | jq -r '.result // empty' 2>/dev/null)" || true
if [[ -z "$RESULT_TEXT" ]]; then
  echo "❌ claude returned no .result field" >&2
  printf '%s' "$RAW" | jq '{is_error, stop_reason, terminal_reason, result}' >&2 2>/dev/null || true
  exit 1
fi

# Strip markdown code fences (```json ... ``` or ``` ... ```) if present, then extract the
# JSON object. Extraction uses Python's json.raw_decode — a REAL JSON parser — scanning for
# the first parseable object. This replaces the old hand-rolled brace-matcher, which tracked
# string/escape state manually and desynced on large embedded-code payloads (a testSource
# field full of escaped quotes + braces), truncating the response (dorothy-serendipity,
# 2026-07-25). raw_decode handles arbitrary embedded code correctly and ignores any preamble
# before / commentary after the JSON object.
CLEANED="$(printf '%s' "$RESULT_TEXT" | sed -e '/^```[a-zA-Z]*$/d' -e '/^```$/d')"
EXTRACTED="$(printf '%s' "$CLEANED" | python3 -c "
import sys, json
text = sys.stdin.read()
dec = json.JSONDecoder()
start = 0
while True:
    idx = text.find('{', start)
    if idx < 0:
        sys.exit(1)
    try:
        _, end = dec.raw_decode(text[idx:])
        break
    except json.JSONDecodeError:
        start = idx + 1
sys.stdout.write(text[idx:idx + end])
")" || {
  echo "❌ could not extract a JSON object from the model response" >&2
  echo "--- first 500 chars ---" >&2
  printf '%s' "$CLEANED" | head -c 500 >&2
  echo >&2
  exit 1
}
CLEANED="$EXTRACTED"

# Validate: must parse as JSON.
if ! printf '%s' "$CLEANED" | jq empty 2>/dev/null; then
  echo "❌ model response is not valid JSON" >&2
  echo "--- first 500 chars ---" >&2
  printf '%s' "$CLEANED" | head -c 500 >&2
  echo >&2
  exit 1
fi

# Inject the model provenance field.
FINAL="$(printf '%s' "$CLEANED" | jq --arg m "$MODEL" '. + {model: $m}')"

mkdir -p "$(dirname "$OUT")"
printf '%s\n' "$FINAL" > "$OUT"
echo "✓ $(basename "$OUT")  ($(printf '%s' "$FINAL" | wc -c | tr -d ' ') bytes, model=$MODEL)" >&2
