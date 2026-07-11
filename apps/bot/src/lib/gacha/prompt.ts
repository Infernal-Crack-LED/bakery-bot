/**
 * Prompts for the announcement→event-data parse (see ingest.ts).
 *
 * Derived from the F2 feasibility trial's prompt, which was scored against
 * hand-labeled ground truth on real NIKKE patch notes. The rules below encode
 * the trial's findings: trust the body over the TL;DR, never invent names,
 * keep the announced timezone, and resolve "after maintenance" starts to the
 * maintenance END time.
 */

/** Build the extraction prompt for one announcement. */
export function buildParsePrompt(announcementText: string): string {
  return `You are a data-extraction service for a Discord bot that tracks gacha-game schedules (game: GODDESS OF VICTORY: NIKKE). Below is the raw text of a patch-notes/announcement post. Extract every schedulable calendar item into STRICT JSON.

Output ONLY a single JSON object, no prose, matching exactly this schema:
{
  "events": [
    {
      "name": "string — official name of the banner/event/raid",
      "type": "banner | event | maintenance",
      "start": "ISO 8601 with offset, e.g. 2026-07-02T18:00:00+09:00; if the source says 'from the end of the maintenance', use the maintenance END time; null if truly unstated",
      "end": "ISO 8601 with offset; null if unstated",
      "characters": ["rate-up / featured character names, exactly as written; [] if none"],
      "notes": "short string: rate-up %, boss name/element weakness, rerun-vs-new, or ''"
    }
  ],
  "confidence": 0.0
}

Rules:
- type "banner" = any character recruitment (Limited-Time Recruitment, Special Recruit, Limited Select Recruit). One entry per banner window; a select-recruit with multiple selectable characters is ONE banner listing all its characters.
- type "maintenance" = server maintenance windows.
- type "event" = everything else with a schedule: story events, mini-games, login events, raids (solo/union/co-op), arena seasons, passes, shop/costume sale windows.
- Times: the game announces in UTC+9 unless another zone is explicitly given. Never convert zones; keep the zone the body text uses. If a TL;DR/summary section conflicts with the detailed body text, TRUST THE BODY TEXT.
- Do NOT invent events from: bug-fix notes, balance-change leaks/speculation, legal/compliance notices, website subscription/ad footers, or coupon codes.
- Do NOT invent character names; copy them character-for-character from the text.
- "characters" is ONLY for recruitment banners. For raids/events, put boss or costume names in "notes", NEVER in "characters".
- "confidence": your overall 0-1 confidence that the extraction is complete and correct.

ANNOUNCEMENT TEXT:
${announcementText}`;
}

/** How much of a broken reply to send back for the repair attempt. */
const REPAIR_EXCERPT_CHARS = 8000;

/**
 * Build the repair prompt used when a reply couldn't be salvaged into valid
 * JSON (F2 requirement 3: re-prompt/repair on parse failure rather than drop).
 */
export function buildRepairPrompt(brokenReply: string, error: string): string {
  return `Your previous reply was supposed to be a single valid JSON object but it could not be parsed (${error}). Here is what you sent:

${brokenReply.slice(0, REPAIR_EXCERPT_CHARS)}

Reply with ONLY the corrected JSON object — no prose, no code fences, no reasoning, and the object exactly ONCE. Keep the same "events" content, just fix the JSON formatting.`;
}
