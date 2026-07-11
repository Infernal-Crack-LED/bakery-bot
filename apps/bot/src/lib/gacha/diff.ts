/**
 * Proposal-vs-calendar diff for the /events approval view (F2 requirement 1:
 * an admin always reviews a DIFF before anything reaches `gacha_events`).
 *
 * PURE: takes the stored proposal + the guild's current approved rows and
 * produces structured entries plus a Discord-markdown rendering. All times are
 * shown as `<t:…>` dynamic timestamps (via lib/discordTime.ts) so each
 * reviewer sees their own local time, and every low-confidence flag from the
 * validation layer (F2 requirement 5) is surfaced next to its event.
 */

import type {
  GachaEvent,
  IngestDiagnostics,
  ProposedGachaEvent,
} from '@app/db';
import { discordTimestamp } from '../discordTime.js';
import { parseIsoInstant } from './validate.js';

/** Convert a proposal's validated ISO-with-offset string to a JS Date. */
export function proposedDate(iso: string | null): Date | null {
  if (!iso) {
    return null;
  }
  const instant = parseIsoInstant(iso);
  return instant ? new Date(instant.epochSeconds * 1000) : null;
}

export interface EventDiffEntry {
  kind: 'new' | 'changed' | 'unchanged';
  proposed: ProposedGachaEvent;
  existing?: GachaEvent;
  /** Human-readable field changes, e.g. "start: <t:…> → <t:…>". */
  changes: string[];
}

/** Identity across proposal + calendar: type + case-folded name. */
function key(type: string, name: string): string {
  return `${type}::${name.toLowerCase()}`;
}

function fmtInstant(date: Date | null): string {
  return date ? discordTimestamp(Math.floor(date.getTime() / 1000), 'f') : '∅';
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

/**
 * Diff a proposal against the guild's current approved calendar rows.
 * Every proposed event yields exactly one entry (new / changed / unchanged);
 * existing rows the proposal doesn't mention are left untouched by design —
 * approval upserts, it never deletes.
 */
export function diffProposal(
  proposal: ProposedGachaEvent[],
  current: GachaEvent[]
): EventDiffEntry[] {
  const byKey = new Map(current.map((row) => [key(row.type, row.name), row]));

  return proposal.map((p) => {
    const existing = byKey.get(key(p.type, p.name));
    if (!existing) {
      return { kind: 'new' as const, proposed: p, changes: [] };
    }

    const changes: string[] = [];
    const newStart = proposedDate(p.start);
    const newEnd = proposedDate(p.end);
    if (!sameInstant(existing.startsAt, newStart)) {
      changes.push(
        `start: ${fmtInstant(existing.startsAt)} → ${fmtInstant(newStart)}`
      );
    }
    if (!sameInstant(existing.endsAt, newEnd)) {
      changes.push(
        `end: ${fmtInstant(existing.endsAt)} → ${fmtInstant(newEnd)}`
      );
    }
    const oldChars = (existing.characters ?? []).join(', ');
    const newChars = p.characters.join(', ');
    if (oldChars !== newChars) {
      changes.push(`characters: ${oldChars || '∅'} → ${newChars || '∅'}`);
    }
    const oldNotes = existing.notes ?? '';
    if (oldNotes !== p.notes) {
      changes.push(`notes: ${oldNotes || '∅'} → ${p.notes || '∅'}`);
    }

    return {
      kind: changes.length > 0 ? ('changed' as const) : ('unchanged' as const),
      proposed: p,
      existing,
      changes,
    };
  });
}

const KIND_MARKER: Record<EventDiffEntry['kind'], string> = {
  new: '🆕',
  changed: '🔁',
  unchanged: '⏸',
};

/** Discord messages cap at 2000 chars; leave headroom for the footer. */
const MAX_RENDER_CHARS = 1900;

/**
 * Render the diff + run diagnostics as Discord markdown. Includes the
 * cross-run agreement label (F2 req 7) and per-event low-confidence flags
 * (F2 req 5). Output is truncated to fit a single Discord message.
 */
export function renderProposalDiff(
  entries: EventDiffEntry[],
  diagnostics: IngestDiagnostics | null
): string {
  const lines: string[] = [];

  if (diagnostics) {
    const agreement = diagnostics.agreement ?? 'n/a';
    const marker =
      agreement === 'agree' ? '✅' : agreement === 'partial' ? '⚠️' : 'ℹ️';
    lines.push(
      `${diagnostics.runs.length} parse run(s) — agreement: **${agreement}** ${marker}` +
        (agreement === 'partial'
          ? ' (runs disagreed — review extra carefully)'
          : '')
    );
    for (const err of diagnostics.errors) {
      lines.push(`⚠️ run error: ${err.slice(0, 150)}`);
    }
    lines.push('');
  }

  if (entries.length === 0) {
    lines.push('_The proposal contains no events._');
  }

  for (const e of entries) {
    const chars =
      e.proposed.characters.length > 0
        ? ` — ${e.proposed.characters.join(', ')}`
        : '';
    lines.push(
      `${KIND_MARKER[e.kind]} **${e.proposed.name}** (${e.proposed.type})${chars}` +
        (e.kind === 'unchanged' ? ' — no changes' : '')
    );
    if (e.kind === 'new') {
      lines.push(
        `> start ${fmtInstant(proposedDate(e.proposed.start))} · end ${fmtInstant(
          proposedDate(e.proposed.end)
        )}`
      );
    }
    for (const change of e.changes) {
      lines.push(`> ${change}`);
    }
    if (e.proposed.notes) {
      lines.push(`> _${e.proposed.notes.slice(0, 120)}_`);
    }
    if (e.proposed.flags.length > 0) {
      lines.push(`> ⚠️ ${e.proposed.flags.join(', ')}`);
    }
  }

  let out = lines.join('\n');
  if (out.length > MAX_RENDER_CHARS) {
    out = `${out.slice(0, MAX_RENDER_CHARS)}\n… (truncated)`;
  }
  return out;
}
