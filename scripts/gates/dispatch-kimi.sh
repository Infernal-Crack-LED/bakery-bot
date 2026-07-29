#!/usr/bin/env bash
set -euo pipefail

# dispatch-kimi.sh — dispatch a cross-family review packet to Kimi via the CLI.
#
#   bash scripts/gates/dispatch-kimi.sh <packet.md> <model> <result-out.json>
#
# Kimi equivalent of dispatch-claude.sh: prepends the subagent non-negotiables,
# runs the full prompt through `kimi -p` with tools DISABLED (a --agent-file
# profile whose `tools: []` leaves the model with no tools at all — verified
# 2026-07-26: it cannot read files), extracts the assistant text from the
# stream-json envelope, strips markdown fences, validates it parses as JSON,
# and writes to <result-out.json>.
#
# The model field is injected into the result so the verdict can report provenance.
#
# Model names are config.toml aliases, e.g. `kimi-code/k3` (see
# .claude/skills/code-review/SKILL.md for the canonical routing).
#
# NOTE: --agent-file requires the v2 engine in -p mode, hence
# KIMI_CODE_EXPERIMENTAL_FLAG=1 below. Long dispatches (a ~44KB blind packet)
# take minutes — carve this script out of any short STOP-DON'T-WAIT timeout,
# same as dispatch-claude.sh.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# Agent profile: the tools-disabled gate reviewer next to this script. Override with
# KIMI_AGENT_FILE=<abs path> to dispatch a different role profile.
AGENT_FILE="${KIMI_AGENT_FILE:-$SCRIPT_DIR/kimi-gate-agent.md}"

# Resolve the kimi binary: PATH first, then the default install location.
KIMI="$(command -v kimi || true)"
if [[ -z "$KIMI" && -x "$HOME/.kimi-code/bin/kimi" ]]; then
  KIMI="$HOME/.kimi-code/bin/kimi"
fi
if [[ -z "$KIMI" ]]; then
  echo "❌ kimi CLI not found (looked on PATH and ~/.kimi-code/bin/kimi)" >&2
  exit 1
fi

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
  echo "usage: dispatch-kimi.sh <packet.md> <model> <result-out.json>" >&2
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
# The agent profile already removes the tools, but the preamble keeps the
# instruction unambiguous (the role templates say "Save to <path>", which the
# model must instead return as text).
PROMPT="IMPORTANT: You have NO tools available. Do NOT attempt to use any tools (no file writes, no reads, no shell commands). Return your complete JSON response directly in your response text.

"
if [[ -n "$NON_NEG" ]]; then
  PROMPT+="$(cat "$NON_NEG")

---

"
fi
PROMPT+="$(cat "$PACKET")"

echo "→ dispatching $(basename "$PACKET") to $MODEL …" >&2

# Dispatch: tools structurally DISABLED via the agent profile (tools: []).
# stream-json gives one JSON object per line on stdout; the model's reply is
# the assistant message(s). stderr carries thinking + progress (discarded).
RAW="$(KIMI_CODE_EXPERIMENTAL_FLAG=1 "$KIMI" -p "$PROMPT" \
  --model "$MODEL" \
  --agent-file "$AGENT_FILE" \
  --output-format stream-json \
  2>/dev/null)" || true

# Extract the assistant text from the JSONL envelope (last assistant message
# wins; with no tools there is exactly one).
RESULT_TEXT="$(printf '%s\n' "$RAW" | jq -rs '[.[] | select(.role == "assistant") | .content // empty] | last // empty' 2>/dev/null)" || true
if [[ -z "$RESULT_TEXT" ]]; then
  echo "❌ kimi returned no assistant message" >&2
  printf '%s\n' "$RAW" | head -c 1000 >&2 || true
  exit 1
fi

# Strip markdown code fences (```json ... ``` or ``` ... ```) if present,
# then extract the JSON object using brace-matching (models sometimes add
# preamble text before the JSON or trailing commentary after it).
CLEANED="$(printf '%s' "$RESULT_TEXT" | sed -e '/^```[a-zA-Z]*$/d' -e '/^```$/d')"
CLEANED="$(printf '%s' "$CLEANED" | python3 -c "
import sys
text = sys.stdin.read()
idx = text.find('{')
if idx < 0:
    sys.exit(1)
depth = 0
in_str = False
escape = False
for i, c in enumerate(text[idx:], idx):
    if escape:
        escape = False
        continue
    if c == '\\\\' and in_str:
        escape = True
        continue
    if c == '\"' and not escape:
        in_str = not in_str
        continue
    if in_str:
        continue
    if c == '{': depth += 1
    elif c == '}': depth -= 1
    if depth == 0:
        print(text[idx:i+1])
        break
")"

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
