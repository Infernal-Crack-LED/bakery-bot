// Compact, versioned, isomorphic codec for a full sim "build" — the entire
// team + per-slot loadout + global boss options. This is the payload the share
// link (?b=) carries and the payload a saved team stores (keyed by Discord id).
// One format, three consumers: the web app, the DB, and the bot.
//
// Format: base64url( JSON( Build ) ). The version field lets the shape evolve
// without breaking old links / saved rows. Kept dependency-free and identical
// across browser (btoa/atob) and node (Buffer) by base64ing the UTF-8 bytes.

export interface SlotBuild {
  slug: string | null;
  cubeId: string; // 'resilience' | 'bastion' | 'other' | 'none'
  cubeLevel: number;
  ol: 'base5' | 0 | 5; // gear level; 'base5' = scope-lock base gear
  doll: boolean; // legacy: true == SSR/15 (kept so old codes still decode)
  dollRarity?: 'none' | 'R' | 'SR' | 'SSR'; // doll rarity (supersedes `doll`)
  dollLevel?: number; // doll level 0-15
  gearStats?: { atk: number; hp: number } | null; // synced real gear stats (T10 + Outpost)
  hasOverloadGear?: boolean; // synced: on full T10 overload gear
  stars: number; // 0-3
  core: number; // 0-7
  skill1: number; // 1-10
  skill2: number;
  burst: number;
  lambdaStage?: 0 | 1 | 2 | 3;
  mode?: string;
  mpPriority?: boolean;
  olElem?: string;
  olAtk?: string;
  olExtra?: { type: string; value: string }[];
}

export interface GlobalsBuild {
  weakness: string | null; // boss weakness element, or null
  bossDef: string;
  core: number; // core-visibility preset 0..1
  coreCustom: boolean;
  coreCustomVal: string;
  level: string; // synchro
}

export interface Build {
  v: number; // format version
  g: GlobalsBuild;
  s: SlotBuild[]; // exactly 5
  blocked?: string[]; // don't-own / excluded slugs (Team/Roster generator link)
  roster?: (string | null)[][]; // Roster Sim: teams × 5 slugs (shared loadout in `s`)
  rosterMode?: 'solo' | 'union'; // which Roster Sim grid `roster` is (default solo)
  unionBoss?: UnionBossBuild[]; // per-team boss options when rosterMode = 'union'
}

// Per-team boss options for a saved Union Raid roster (mirrors the sim's
// UnionBossOpts). Only present when rosterMode = 'union'.
export interface UnionBossBuild {
  weakness: string | null;
  bossDef: string;
  core: number;
  coreCustom: boolean;
  coreCustomVal: string;
}

export const BUILD_VERSION = 1;

// ---- isomorphic base64url of a UTF-8 string --------------------------------
// `Buffer` in node, `btoa`/`atob` in the browser. Referenced via globalThis so
// this file compiles under both the DOM (web) and node tsconfigs.
const nodeBuffer: any = (globalThis as any).Buffer;
function bytesToB64(bytes: Uint8Array): string {
  if (nodeBuffer) {
    return nodeBuffer.from(bytes).toString('base64');
  }
  let bin = '';
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return (globalThis as any).btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array {
  if (nodeBuffer) {
    return new Uint8Array(nodeBuffer.from(b64, 'base64'));
  }
  const bin = (globalThis as any).atob(b64);
  return Uint8Array.from(bin, (c: string) => c.charCodeAt(0));
}
function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return bytesToB64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function b64urlDecode(code: string): string {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  return new TextDecoder().decode(b64ToBytes(b64 + pad));
}

// ---- encode / decode -------------------------------------------------------
export function encodeBuild(build: Build): string {
  return b64urlEncode(JSON.stringify(build));
}

// Returns null for anything malformed or an unknown version — callers should
// treat null as "no valid build" (fall back to empty team).
export function decodeBuild(code: string): Build | null {
  try {
    const obj = JSON.parse(b64urlDecode(code.trim()));
    if (
      !obj ||
      typeof obj !== 'object' ||
      obj.v !== BUILD_VERSION ||
      !obj.g ||
      !Array.isArray(obj.s) ||
      obj.s.length !== 5
    ) {
      return null;
    }
    return obj as Build;
  } catch {
    return null;
  }
}
