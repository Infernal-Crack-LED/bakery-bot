/**
 * Tsareena's build/priority sheet as a data source (public — read via Google's
 * CSV endpoints, no auth/googleapis).
 *
 *  - PRIORITY tab (gid 0): characters bucketed by pull priority. Row shape:
 *      Highest Priority,,,,          ← a header row (label in column 0)
 *      ,Rapi: Red Hood,Anis: Star,…  ← names row (column 0 empty, names after)
 *  - "* Builds" tabs: one per priority bucket, one row per character, with
 *    columns for skill levels, overload advice, cube, endgame uses, etc.
 *
 * Names may carry annotations: (T) treasure, (L) limited, (C) collab.
 */

import type { SheetBuild } from '@app/db';

const SHEET_ID = '16EECdnWsdbfeJ_r1KKG0vIhpdeagAbMOjy6xKsSTvh4';
export const PRIORITY_GID = 0;
const UA =
  'Mozilla/5.0 (compatible; BakeryBot/1.0; +https://github.com/maidens-bakery)';

/** The per-priority "* Builds" tabs, fetched by name via the gviz endpoint. */
const BUILD_TABS = [
  'Highest Prio Builds',
  'High Prio Builds',
  'High Support Prio Builds',
  'High PvE Prio Builds',
  'Medium Prio Builds',
  'PvE Prio Builds',
  'PvP Prio Builds',
  'Low Prio Builds',
];

export interface SheetCharacter {
  name: string; // base name, annotations + notes stripped
  priority: string; // e.g. "Highest Priority"
  annotations: string[]; // e.g. ["T"], ["C"]
}

export interface SheetBuildEntry {
  name: string; // base name (annotations stripped)
  build: SheetBuild;
  aliases: string[]; // nicknames/abbreviations, lowercased (may be empty)
}

type Fetch = typeof fetch;

/**
 * Minimal RFC-4180 CSV parser: handles quoted fields, escaped quotes (""),
 * commas/newlines inside quotes, and CRLF or LF line endings.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // swallow; the following \n (if any) ends the row
    } else {
      field += ch;
    }
  }
  // Flush trailing field/row if the file didn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Split a raw name cell into a base name + its (T)/(L)/(C) annotations. */
function parseNameCell(cell: string): {
  name: string;
  annotations: string[];
} | null {
  const raw = cell.trim();
  if (!raw) {
    return null;
  }
  const annotations = [...raw.matchAll(/\(([TLC])\)/g)].map((m) => m[1]!);
  // Everything up to the first annotation is the name; drop trailing notes.
  const name = raw
    .replace(/\(([TLC])\).*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) {
    return null;
  }
  return { name, annotations };
}

/** Parse the priority tab CSV into a flat list of characters. */
export function parsePrioritySheet(csv: string): SheetCharacter[] {
  const rows = parseCsv(csv);
  const out: SheetCharacter[] = [];
  let currentPriority: string | null = null;

  for (const row of rows) {
    const first = (row[0] ?? '').trim();
    if (first) {
      // A row with text in column 0 is a section header — but only priority
      // headers start a bucket; legend/footer rows reset it so their text is
      // never captured as characters.
      currentPriority = /priority/i.test(first) ? first : null;
      continue;
    }
    if (!currentPriority) {
      continue;
    }
    for (const cell of row.slice(1)) {
      const parsed = parseNameCell(cell);
      if (parsed) {
        out.push({ ...parsed, priority: currentPriority });
      }
    }
  }
  return out;
}

async function fetchSheetCsv(gid: number, fetchImpl: Fetch): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    throw new Error(`Sheet GET gid=${gid} → HTTP ${res.status}`);
  }
  return res.text();
}

/** Fetch + parse the priority tab. */
export async function fetchTsareenaPriority(
  fetchImpl: Fetch = fetch
): Promise<SheetCharacter[]> {
  return parsePrioritySheet(await fetchSheetCsv(PRIORITY_GID, fetchImpl));
}

/** Collapse whitespace; undefined if empty. */
function clean(s: string | undefined): string | undefined {
  const v = (s ?? '').replace(/\s+/g, ' ').trim();
  return v || undefined;
}

/** Multi-value cell: runs of 2+ spaces separate items → join with " · ". */
function cleanList(s: string | undefined): string | undefined {
  const v = (s ?? '')
    .split(/\s{2,}/)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(' · ');
  return v || undefined;
}

/** Drop a cell whose only content is a literal "none" (case-insensitive). */
function nonNone(s: string | undefined): string | undefined {
  const v = cleanList(s);
  return v && !/^none$/i.test(v) ? v : undefined;
}

/**
 * Parse a "* Builds" tab. Columns are positional (the headers have erratic
 * spacing, so we read by index):
 *   0 Name · 2 Endgame Uses · 3 Skill Levels · 4 Overload gear? ·
 *   5 Level OL to 5? · 6 Minimum OL rolls · 7 Ideal OL rolls · 8 Level doll? ·
 *   9 Cube · 10 Burst Gen Auto (Manual) · 11 Necessary Nikkes · 12 Notes ·
 *   13 Abbreviations of name
 */
export function parseBuildSheet(csv: string): SheetBuildEntry[] {
  const rows = parseCsv(csv);
  const out: SheetBuildEntry[] = [];
  for (const row of rows.slice(1)) {
    // header is row 0
    const parsed = parseNameCell(row[0] ?? '');
    if (!parsed) {
      continue;
    }
    const build: SheetBuild = {
      endgameUses: cleanList(row[2]),
      skillLevels: clean(row[3]),
      overloadGear: clean(row[4]),
      overloadLevelFive: clean(row[5]),
      overloadMinimum: cleanList(row[6]),
      overloadIdeal: cleanList(row[7]),
      levelDoll: clean(row[8]),
      cube: cleanList(row[9]),
      burstGen: clean(row[10]),
      pairWith: nonNone(row[11]),
      notes: clean(row[12]),
    };
    // Abbreviations column: multi-value, lowercased, deduped.
    const aliases = [
      ...new Set(
        (row[13] ?? '')
          .split(/\s{2,}/)
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean)
      ),
    ];
    const hasBuild =
      build.skillLevels || build.cube || build.overloadIdeal || build.pairWith;
    if (!hasBuild && aliases.length === 0) {
      continue; // nothing useful on this row
    }
    out.push({ name: parsed.name, build, aliases });
  }
  return out;
}

async function fetchGvizCsv(sheet: string, fetchImpl: Fetch): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    throw new Error(`Sheet gviz "${sheet}" → HTTP ${res.status}`);
  }
  return res.text();
}

/** Fetch + parse every "* Builds" tab (one failing tab doesn't sink the rest). */
export async function fetchTsareenaBuilds(
  fetchImpl: Fetch = fetch
): Promise<SheetBuildEntry[]> {
  const all: SheetBuildEntry[] = [];
  for (const tab of BUILD_TABS) {
    try {
      all.push(...parseBuildSheet(await fetchGvizCsv(tab, fetchImpl)));
    } catch (error) {
      console.warn(
        `[sheet] build tab "${tab}" failed: ${(error as Error).message}`
      );
    }
  }
  return all;
}
