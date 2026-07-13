/**
 * Patch-note TLDR extractor (the condensed summary half of the official-site
 * flow — see officialSite.ts).
 *
 * PURE + injectable, exactly like ingest.ts: the LLM call comes in as an
 * `LlmComplete`, so the 3-pass + salvage + reconcile logic is fully
 * unit-testable with a fake completer. Nothing here does I/O.
 *
 * Why THREE passes (vs. the events pipeline's two): the TLDR is a small,
 * high-value payload (which characters/pass/gacha/raids shipped), so we spend a
 * third read and take the MAJORITY answer per field. Unanimous agreement across
 * the passes is the accuracy signal; a field the passes disagree on is dropped
 * (lists) or resolved by mode (scalars) and the run is flagged "partial".
 *
 * The local model wraps its JSON in reasoning prose, so every pass runs through
 * the same balanced-object salvage the events pipeline uses (salvage.ts).
 */

import type { PatchTldr, TldrDiagnostics } from '@app/db';
import { EmbedBuilder } from 'discord.js';
import { discordTimestamp } from '../discordTime.js';
import { extractJsonObjects } from './salvage.js';
import type { LlmComplete } from './ingest.js';

/** House embed color (pink), matching /nikke, /pull, /help. */
const EMBED_COLOR = 0xf472b6;

/** How many independent passes to run by default. */
export const DEFAULT_TLDR_PASSES = 3;

/** Build the TLDR-extraction prompt for one article. */
export function buildTldrPrompt(articleText: string): string {
  return `Extract a TLDR from this official NIKKE (GODDESS OF VICTORY: NIKKE) patch notice. Return ONLY a JSON object with EXACTLY these keys (no prose, no code fences, no commentary before or after):
{"patch_live_date": "<date the patch went live / maintenance ended, e.g. 'July 2, 2026'; null if unstated>",
 "new_characters": ["<each BRAND-NEW playable Nikke from the 'New Nikkes' section, full name with subtitle, WITHOUT the rarity prefix>"],
 "rerun_characters": ["<each RERUN Nikke from the rerun recruitment section, full name with subtitle, WITHOUT the rarity prefix>"],
 "pass_name": "<name of the new premium Pass, or null>",
 "pass_costume": "<the costume/skin obtained from that Pass, or null>",
 "costume_gacha_costume": "<the costume/skin featured in the new Costume Gacha, or null>",
 "rerun_skins": ["<each RETURNING costume/skin from the 'Limited Costume Rerun' section, full name with subtitle; [] if none>"],
 "union_raid": <true if a Union Raid runs in this patch, else false>,
 "solo_raid": <true if a Solo Raid runs in this patch, else false>,
 "coop": <true if a Coordinated Operation (co-op boss) runs in this patch, else false>}

Rules:
- Copy names character-for-character; keep the subtitle after the colon.
- Do NOT confuse brand-new characters with reruns — they are in separate sections.
- rerun_skins is ONLY the returning COSTUMES/skins (the "Limited Costume Rerun" section), NOT the new costume gacha and NOT rerun characters.
- Ignore arena modes, maintenance details, bug fixes, and shop bundles.

NOTICE:
${articleText}

Output only the JSON object, nothing else.`;
}

// ── deterministic coercion helpers (mirror validate.ts's private ones) ──────

function asText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === 'yes' || v === '1';
  }
  return value === 1;
}

/** Drop a leading rarity token ("SSR "/"SR "/"R ") the model sometimes prepends. */
export function stripRarityPrefix(name: string): string {
  return name.replace(/^\s*(?:SSR|SR|R)\s+/i, '').trim();
}

/** Coerce to a de-duplicated string list, optionally stripping a rarity prefix. */
function asList(value: unknown, stripRarity: boolean): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = asText(item);
    if (!text) {
      continue;
    }
    const name = stripRarity ? stripRarityPrefix(text) : text;
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

/** Normalize one salvaged object into a PatchTldr (deterministic, no throws). */
export function validateTldr(value: unknown): PatchTldr {
  const o =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    patchLiveDate: asText(o.patch_live_date),
    newCharacters: asList(o.new_characters, true),
    rerunCharacters: asList(o.rerun_characters, true),
    passName: asText(o.pass_name),
    passCostume: asText(o.pass_costume),
    costumeGachaCostume: asText(o.costume_gacha_costume),
    rerunSkins: asList(o.rerun_skins, false),
    unionRaid: asBool(o.union_raid),
    soloRaid: asBool(o.solo_raid),
    coop: asBool(o.coop),
  };
}

/**
 * Recover the TLDR object from a raw reply. Tries a direct parse, then scans
 * for balanced `{…}` blocks and prefers the LAST one carrying our key — the
 * model's reasoning often emits a template/example object first.
 */
export function salvageTldr(raw: string): unknown | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to prose salvage
  }
  const parsed: unknown[] = [];
  for (const candidate of extractJsonObjects(trimmed)) {
    try {
      parsed.push(JSON.parse(candidate));
    } catch {
      // skip truncated / non-JSON fragments
    }
  }
  if (parsed.length === 0) {
    return null;
  }
  const isTldrShape = (v: unknown): boolean =>
    typeof v === 'object' &&
    v !== null &&
    'patch_live_date' in (v as Record<string, unknown>);
  // Prefer the LAST object that looks like our envelope; else the last object.
  for (let i = parsed.length - 1; i >= 0; i--) {
    if (isTldrShape(parsed[i])) {
      return parsed[i];
    }
  }
  return parsed[parsed.length - 1];
}

// ── reconciliation across passes ────────────────────────────────────────────

/** Majority-vote a list of names across passes (item kept if it wins a strict majority). */
function reconcileList(lists: string[][], passCount: number): string[] {
  const votes = new Map<string, { display: string; count: number }>();
  for (const list of lists) {
    // one vote per (pass, name); the map already de-dupes within a pass
    for (const name of new Set(list.map((n) => n.toLowerCase()))) {
      const display = list.find((n) => n.toLowerCase() === name)!;
      const entry = votes.get(name) ?? { display, count: 0 };
      entry.count += 1;
      votes.set(name, entry);
    }
  }
  return [...votes.values()]
    .filter((v) => v.count > passCount / 2)
    .map((v) => v.display);
}

/** Pick the most common non-null scalar (ties broken by first-seen order). */
function reconcileScalar(values: Array<string | null>): string | null {
  const votes = new Map<string, { display: string; count: number }>();
  for (const value of values) {
    if (value == null) {
      continue;
    }
    const key = value.toLowerCase();
    const entry = votes.get(key) ?? { display: value, count: 0 };
    entry.count += 1;
    votes.set(key, entry);
  }
  let best: { display: string; count: number } | null = null;
  for (const entry of votes.values()) {
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }
  return best?.display ?? null;
}

/** Majority-true vote for a boolean field. */
function reconcileBool(values: boolean[], passCount: number): boolean {
  return values.filter(Boolean).length > passCount / 2;
}

/** A stable fingerprint of a TLDR, for detecting cross-pass agreement. */
function fingerprint(t: PatchTldr): string {
  const norm = (xs: string[]): string[] =>
    [...xs].map((x) => x.toLowerCase()).sort();
  return JSON.stringify({
    d: t.patchLiveDate?.toLowerCase() ?? null,
    nc: norm(t.newCharacters),
    rc: norm(t.rerunCharacters),
    pn: t.passName?.toLowerCase() ?? null,
    pc: t.passCostume?.toLowerCase() ?? null,
    cg: t.costumeGachaCostume?.toLowerCase() ?? null,
    rs: norm(t.rerunSkins),
    ur: t.unionRaid,
    sr: t.soloRaid,
    co: t.coop,
  });
}

/** The reconciled TLDR plus the accuracy diagnostics. */
export interface TldrResult {
  tldr: PatchTldr;
  diagnostics: TldrDiagnostics;
}

const EMPTY_TLDR: PatchTldr = {
  patchLiveDate: null,
  newCharacters: [],
  rerunCharacters: [],
  passName: null,
  passCostume: null,
  costumeGachaCostume: null,
  rerunSkins: [],
  unionRaid: false,
  soloRaid: false,
  coop: false,
};

/**
 * Extract a patch TLDR by running the model `passes` times (default 3) and
 * reconciling the results field-by-field (majority vote per field). A pass
 * whose reply can't be salvaged into JSON is recorded as an error and ignored
 * in the vote. Returns an empty TLDR (agreement=null) only when every pass
 * failed.
 */
export async function extractTldr(
  articleText: string,
  complete: LlmComplete,
  opts: { passes?: number } = {}
): Promise<TldrResult> {
  const passCount = Math.max(1, opts.passes ?? DEFAULT_TLDR_PASSES);
  const prompt = buildTldrPrompt(articleText);

  const results: PatchTldr[] = [];
  const errors: string[] = [];
  for (let i = 0; i < passCount; i++) {
    let raw: string;
    try {
      raw = await complete(prompt);
    } catch (err) {
      errors.push(`pass ${i + 1}: completion failed: ${errorMessage(err)}`);
      continue;
    }
    const salvaged = salvageTldr(raw);
    if (salvaged == null) {
      errors.push(`pass ${i + 1}: reply could not be salvaged into JSON`);
      continue;
    }
    results.push(validateTldr(salvaged));
  }

  const n = results.length;
  if (n === 0) {
    return {
      tldr: EMPTY_TLDR,
      diagnostics: { passes: 0, agreement: null, errors },
    };
  }

  const tldr: PatchTldr = {
    patchLiveDate: reconcileScalar(results.map((r) => r.patchLiveDate)),
    newCharacters: reconcileList(
      results.map((r) => r.newCharacters),
      n
    ),
    rerunCharacters: reconcileList(
      results.map((r) => r.rerunCharacters),
      n
    ),
    passName: reconcileScalar(results.map((r) => r.passName)),
    passCostume: reconcileScalar(results.map((r) => r.passCostume)),
    costumeGachaCostume: reconcileScalar(
      results.map((r) => r.costumeGachaCostume)
    ),
    rerunSkins: reconcileList(
      results.map((r) => r.rerunSkins),
      n
    ),
    unionRaid: reconcileBool(
      results.map((r) => r.unionRaid),
      n
    ),
    soloRaid: reconcileBool(
      results.map((r) => r.soloRaid),
      n
    ),
    coop: reconcileBool(
      results.map((r) => r.coop),
      n
    ),
  };

  let agreement: TldrDiagnostics['agreement'];
  if (n === 1) {
    agreement = 'single-run';
  } else {
    const first = fingerprint(results[0]!);
    agreement = results.every((r) => fingerprint(r) === first)
      ? 'agree'
      : 'partial';
  }

  return { tldr, diagnostics: { passes: n, agreement, errors } };
}

// ── Discord rendering ───────────────────────────────────────────────────────

/**
 * Whether the patch is already live, judged against `now`. `patchLiveDate` is a
 * free-form date string from the notice ("July 2, 2026"); if it can't be parsed
 * we return null (status unknown) rather than guessing.
 */
export function isPatchLive(
  patchLiveDate: string | null,
  now: Date
): boolean | null {
  if (!patchLiveDate) {
    return null;
  }
  const ms = Date.parse(patchLiveDate);
  if (Number.isNaN(ms)) {
    return null;
  }
  return ms <= now.getTime();
}

/**
 * Render the TLDR as a Discord message. Empty fields are omitted (no "Pass"
 * line if there's no pass); the raid trio always shows ✅/❌. When the live date
 * parses, it's shown as a `<t:…>` day stamp so each member sees it locally.
 */
export function renderTldr(
  tldr: PatchTldr,
  opts: { title?: string; now?: Date; sourceUrl?: string } = {}
): string {
  const now = opts.now ?? new Date();
  const lines: string[] = [];

  if (opts.title) {
    lines.push(`📰 **${opts.title}**`);
  }

  const live = isPatchLive(tldr.patchLiveDate, now);
  if (tldr.patchLiveDate) {
    const ms = Date.parse(tldr.patchLiveDate);
    const when = Number.isNaN(ms)
      ? tldr.patchLiveDate
      : discordTimestamp(Math.floor(ms / 1000), 'D');
    if (live === true) {
      lines.push(`🟢 **Patch is live** — went up ${when}`);
    } else if (live === false) {
      lines.push(`🟡 **Patch not live yet** — goes live ${when}`);
    } else {
      lines.push(`📅 **Patch live date:** ${when}`);
    }
  } else {
    lines.push('⚪ **Patch status:** live date not stated');
  }

  lines.push('');

  if (tldr.newCharacters.length > 0) {
    lines.push(`- **New characters:** ${tldr.newCharacters.join(', ')}`);
  }
  if (tldr.rerunCharacters.length > 0) {
    lines.push(`- **Rerun banners:** ${tldr.rerunCharacters.join(', ')}`);
  }
  if (tldr.passName) {
    const costume = tldr.passCostume ? ` → ${tldr.passCostume}` : '';
    lines.push(`- **Pass:** ${tldr.passName}${costume}`);
  }
  if (tldr.costumeGachaCostume) {
    lines.push(`- **Costume gacha:** ${tldr.costumeGachaCostume}`);
  }
  if (tldr.rerunSkins.length > 0) {
    lines.push(`- **Rerun skins:** ${tldr.rerunSkins.join(', ')}`);
  }
  const mark = (b: boolean): string => (b ? '✅' : '❌');
  lines.push(`- **Union Raid:** ${mark(tldr.unionRaid)}`);
  lines.push(`- **Solo Raid:** ${mark(tldr.soloRaid)}`);
  lines.push(`- **Co-op:** ${mark(tldr.coop)}`);

  if (opts.sourceUrl) {
    lines.push('');
    lines.push(`[Read the full notice](${opts.sourceUrl})`);
  }

  return lines.join('\n');
}

/** The status headline (used as the embed description). */
function statusLine(patchLiveDate: string | null, now: Date): string {
  if (!patchLiveDate) {
    return '⚪ **Patch status:** live date not stated';
  }
  const ms = Date.parse(patchLiveDate);
  const when = Number.isNaN(ms)
    ? patchLiveDate
    : discordTimestamp(Math.floor(ms / 1000), 'D');
  const live = isPatchLive(patchLiveDate, now);
  if (live === true) {
    return `🟢 **Patch is live** — went up ${when}`;
  }
  if (live === false) {
    return `🟡 **Patch not live yet** — goes live ${when}`;
  }
  return `📅 **Patch live date:** ${when}`;
}

/**
 * Build the patch TLDR as a Discord embed (house pink). Empty fields are
 * omitted; the raid trio is three inline ✅/❌ fields. Used for the news-channel
 * broadcast and the /patch command.
 */
export function buildTldrEmbed(
  tldr: PatchTldr,
  opts: { title?: string; now?: Date; sourceUrl?: string } = {}
): EmbedBuilder {
  const now = opts.now ?? new Date();
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(opts.title ?? 'NIKKE Patch Summary')
    .setDescription(statusLine(tldr.patchLiveDate, now))
    .setFooter({ text: 'NIKKE · EN patch notes' });
  if (opts.sourceUrl) {
    embed.setURL(opts.sourceUrl);
  }

  if (tldr.newCharacters.length > 0) {
    embed.addFields({
      name: '🆕 New characters',
      value: tldr.newCharacters.join(', '),
      inline: false,
    });
  }
  if (tldr.rerunCharacters.length > 0) {
    embed.addFields({
      name: '🔁 Rerun banners',
      value: tldr.rerunCharacters.join(', '),
      inline: false,
    });
  }
  if (tldr.passName) {
    embed.addFields({
      name: '🎟️ Pass',
      value: tldr.passCostume
        ? `${tldr.passName} → ${tldr.passCostume}`
        : tldr.passName,
      inline: false,
    });
  }
  if (tldr.costumeGachaCostume) {
    embed.addFields({
      name: '👗 Costume gacha',
      value: tldr.costumeGachaCostume,
      inline: false,
    });
  }
  if (tldr.rerunSkins.length > 0) {
    embed.addFields({
      name: '🔁 Rerun skins',
      value: tldr.rerunSkins.join(', '),
      inline: false,
    });
  }
  const mark = (b: boolean): string => (b ? '✅' : '❌');
  embed.addFields(
    { name: '⚔️ Union Raid', value: mark(tldr.unionRaid), inline: true },
    { name: '🗡️ Solo Raid', value: mark(tldr.soloRaid), inline: true },
    { name: '🤝 Co-op', value: mark(tldr.coop), inline: true }
  );

  return embed;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
