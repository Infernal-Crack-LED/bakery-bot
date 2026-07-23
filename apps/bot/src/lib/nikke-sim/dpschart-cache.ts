/**
 * In-memory cache for the precomputed DPS-chart matrix served by nikkesim.app.
 * Fetched once on first access, refreshed every 6 hours. The JSON is a public
 * static asset regenerated on every nikke-sim deploy.
 */

const DPSCHART_URL = 'https://www.nikkesim.app/dpschart.json';
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface DpsUnit {
  name: string;
  element: string;
  elements: string[];
  weapon: string;
  tier: string;
  chartPop: boolean;
  imageUrl: string | null;
}

export interface DpsChartJson {
  generatedAt: string;
  meta: {
    frameworks: { id: string; label: string }[];
    eleadvs: { id: string; label: string }[];
    cores: { id: string; label: string; rate: number }[];
    invests: { id: string; label: string }[];
    headliners: unknown[];
  };
  units: Record<string, DpsUnit>;
  cells: Record<string, [string, number][]>;
}

let cached: DpsChartJson | null = null;
let fetchedAt = 0;
let inflight: Promise<DpsChartJson> | null = null;

export async function getDpsChart(): Promise<DpsChartJson> {
  if (cached && Date.now() - fetchedAt < TTL_MS) {
    return cached;
  }
  if (inflight) {
    return inflight;
  }
  inflight = (async () => {
    const res = await fetch(DPSCHART_URL);
    if (!res.ok) {
      throw new Error(`dpschart fetch ${res.status}`);
    }
    const json = (await res.json()) as DpsChartJson;
    cached = json;
    fetchedAt = Date.now();
    return json;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** The default ranking cell: Solo · Ele Weak · Core 100 · 8/12. */
export const DEFAULT_CELL_ID = 'solo.eleweak.c100.8of12';
/** Neutral (no element advantage) variant. */
export const NEUTRAL_CELL_ID = 'solo.neutral.c100.8of12';

export interface RankEntry {
  rank: number;
  total: number;
  dps: number;
  slug: string;
}

/** Look up a unit's rank in a cell. Returns null if the unit isn't on the chart. */
export function lookupRank(
  chart: DpsChartJson,
  cellId: string,
  slug: string
): RankEntry | null {
  const cell = chart.cells[cellId];
  if (!cell) {
    return null;
  }
  const idx = cell.findIndex(([s]) => s === slug);
  if (idx < 0) {
    return null;
  }
  return { rank: idx + 1, total: cell.length, dps: cell[idx]![1], slug };
}
