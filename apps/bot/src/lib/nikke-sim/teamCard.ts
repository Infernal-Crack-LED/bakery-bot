// Shared summary-card renderer. Draws the result "share image" to any
// Canvas2D-compatible context, so the web app (browser canvas) and the bot
// (@napi-rs/canvas / node-canvas) produce a pixel-identical card. This module
// is DOM-free — the caller creates and sizes the canvas and hands us the ctx.
//
// Portraits: the caller may pass a pre-loaded, square-cropped portrait image per
// unit (`TeamCardUnit.img`) which is drawn (rounded-clipped) into the 60x60 slot;
// units without an image degrade to an element-tinted box + name initial. The bot
// has no CORS constraint, the browser loads CDN art with crossOrigin='anonymous'.

// Structural subset of CanvasRenderingContext2D we use — keeps this compilable
// without the DOM lib (root tsconfig) and works with node canvas contexts.
export interface Canvas2DLike {
  fillStyle: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  beginPath(): void;
  moveTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  closePath(): void;
  fill(): void;
  // portrait drawing (optional feature — callers that never pass images can omit
  // these; both browser Canvas2D and @napi-rs/canvas provide them).
  save(): void;
  restore(): void;
  clip(): void;
  drawImage(
    image: unknown,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  // source-cropping form (sx,sy,sw,sh → dx,dy,dw,dh): lets us crop a square out of a
  // tall portrait instead of squishing its aspect ratio into the destination box.
  drawImage(
    image: unknown,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

export const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

// Portrait square-crop framing — the single source of truth for how far down a
// square is anchored when cropped out of a tall portrait (fraction of the vertical
// overflow; 0 = top, 0.5 = center). Used by BOTH canvas crops (portraitThumb,
// dpsChart) and, via the `--portrait-crop-top` CSS var that main.tsx sets from it,
// the `object-position` on the sim-tab / chart <img>s. Change here to move all of
// them together.
export const PORTRAIT_CROP_TOP = 0.16;
export const ELEMENT_COLORS: Record<string, string> = {
  Fire: '#d92d38',
  Water: '#0075f8',
  Wind: '#00e554',
  Electric: '#bc1eb1',
  Iron: '#ff8321',
};

export interface TeamCardUnit {
  name: string;
  burst: string;
  weapon: string;
  element: string;
  advantaged: boolean;
  share: number; // 0..1
  totalDamage: number;
  // optional pre-loaded portrait (ideally an already square-cropped thumbnail);
  // a Canvas2D-drawable image. Omitted → placeholder box + initial.
  img?: unknown;
}
export interface TeamCardData {
  teamDamage: number;
  teamDps: number;
  fullBursts: number;
  fullBurstUptime: number; // 0..1
  units: TeamCardUnit[];
}
export interface TeamCardMeta {
  weakness: string | null; // boss weakness element
  level: number; // synchro
  coreLabel: string; // e.g. "100% core"
}

// layout constants (logical px; caller scales for device pixel ratio)
export const CARD_W = 1040;
const PAD_X = 40;
const HEAD_H = 156;
const ROW_H = 84;
const FOOT_H = 58;

export const cardHeight = (unitCount: number) =>
  HEAD_H + unitCount * ROW_H + FOOT_H;

const fmt = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(2)}B`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(2)}M`
      : n >= 1e3
        ? `${(n / 1e3).toFixed(1)}K`
        : n.toFixed(0);

export function roundRect(
  ctx: Canvas2DLike,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draw the card at logical (unscaled) coordinates. The caller must have created
// a canvas of CARD_W x cardHeight(units.length) (times dpr) and pre-scaled ctx.
export function drawTeamCard(
  ctx: Canvas2DLike,
  data: TeamCardData,
  meta: TeamCardMeta,
) {
  const W = CARD_W;
  const padX = PAD_X;
  const H = cardHeight(data.units.length);

  // background + accent bar
  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#5b9dff';
  ctx.fillRect(0, 0, W, 5);

  // title + summary
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#e7eaf0';
  ctx.font = `700 30px ${FONT}`;
  ctx.fillText('NIKKE Solo Raid Sim', padX, 56);
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(fmt(data.teamDamage), padX, 108);
  const bigW = ctx.measureText(fmt(data.teamDamage)).width;
  ctx.font = `400 18px ${FONT}`;
  ctx.fillStyle = '#8b93a3';
  ctx.fillText(
    `${fmt(data.teamDps)} DPS  ·  ${data.fullBursts} full bursts  ·  ${(
      data.fullBurstUptime * 100
    ).toFixed(0)}% FB uptime`,
    padX + bigW + 24,
    102,
  );
  ctx.fillText(
    `${meta.weakness ? `${meta.weakness}-weak boss` : 'no element'}  ·  lvl ${
      meta.level
    }  ·  ${meta.coreLabel}  ·  180s`,
    padX,
    136,
  );

  const maxShare = Math.max(...data.units.map((u) => u.share), 0.0001);
  const barX = 430;
  const barW = W - barX - 250;
  data.units.forEach((u, i) => {
    const y = HEAD_H + i * ROW_H;
    const col = ELEMENT_COLORS[u.element] ?? '#9aa3b2';
    if (u.img) {
      // real portrait: draw the (square) art clipped into a rounded square. A
      // thin element-tinted ring keeps the element legible at a glance.
      ctx.save();
      roundRect(ctx, padX, y + 10, 60, 60, 10);
      ctx.clip();
      ctx.fillStyle = '#1f232d';
      ctx.fillRect(padX, y + 10, 60, 60); // backdrop for any transparency
      ctx.drawImage(u.img, padX, y + 10, 60, 60);
      ctx.restore();
    } else {
      // placeholder portrait: element-tinted rounded square with initial
      ctx.fillStyle = '#1f232d';
      roundRect(ctx, padX, y + 10, 60, 60, 10);
      ctx.fill();
      ctx.fillStyle = col;
      roundRect(ctx, padX, y + 10, 60, 60, 10);
      ctx.globalAlpha = 0.22;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.font = `700 26px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText((u.name[0] ?? '?').toUpperCase(), padX + 30, y + 49);
      ctx.textAlign = 'left';
    }

    // name + tag
    ctx.fillStyle = '#e7eaf0';
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(u.name + (u.advantaged ? '  ▲' : ''), padX + 78, y + 36);
    ctx.fillStyle = '#8b93a3';
    ctx.font = `400 14px ${FONT}`;
    ctx.fillText(`B${u.burst} · ${u.weapon} · ${u.element}`, padX + 78, y + 58);

    // share bar
    ctx.fillStyle = '#2a2f3b';
    roundRect(ctx, barX, y + 30, barW, 16, 8);
    ctx.fill();
    ctx.fillStyle = '#5b9dff';
    roundRect(ctx, barX, y + 30, (u.share / maxShare) * barW, 16, 8);
    ctx.fill();

    // share % + damage (right aligned)
    ctx.textAlign = 'right';
    ctx.fillStyle = '#5b9dff';
    ctx.font = `600 18px ${FONT}`;
    ctx.fillText(`${(u.share * 100).toFixed(1)}%`, W - padX, y + 34);
    ctx.fillStyle = '#8b93a3';
    ctx.font = `400 14px ${FONT}`;
    ctx.fillText(fmt(u.totalDamage), W - padX, y + 56);
    ctx.textAlign = 'left';
  });

  // footer
  ctx.fillStyle = '#8b93a3';
  ctx.font = `400 13px ${FONT}`;
  ctx.fillText(
    'nikke-sim · expected-value crits · always in range · 0 enemy debuffs',
    padX,
    H - 22,
  );
}

// ---------------------------------------------------------------------------
// Roster card — a simplified 5-team summary (Solo-Raid Roster Generator). Per
// team: the 5 portraits + a total-team-damage bar. No per-unit rows, no DPS/FB.
// ---------------------------------------------------------------------------
export interface RosterCardUnit {
  name: string;
  element: string;
  img?: unknown; // optional pre-loaded portrait (see TeamCardUnit.img)
}
export interface RosterCardTeam {
  teamDamage: number;
  units: RosterCardUnit[];
  // per-team boss options line (union raid); rendered beside the team label
  bossLabel?: string;
}
export interface RosterCardData {
  totalDamage: number; // sum across all teams
  teams: RosterCardTeam[];
  // card title override (defaults to "NIKKE Solo Raid Sim · Roster Generator")
  title?: string;
}

const R_HEAD_H = 156;
const R_ROW_H = 96;
const R_FOOT_H = 58;
const R_PS = 58; // portrait square
const R_GAP = 7;

export const rosterCardHeight = (teamCount: number) =>
  R_HEAD_H + teamCount * R_ROW_H + R_FOOT_H;

// Draw the roster summary card at logical (unscaled) coordinates. The caller must
// have created a canvas of CARD_W x rosterCardHeight(teams.length) (times dpr) and
// pre-scaled ctx (mirrors drawTeamCard's contract).
export function drawRosterCard(
  ctx: Canvas2DLike,
  data: RosterCardData,
  meta: TeamCardMeta,
) {
  const W = CARD_W;
  const padX = PAD_X;
  const H = rosterCardHeight(data.teams.length);
  const hasBossLabels = data.teams.some((t) => t.bossLabel);

  // background + accent bar
  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#5b9dff';
  ctx.fillRect(0, 0, W, 5);

  // title + summary (total only — no DPS/FB, per the roster card spec)
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e7eaf0';
  ctx.font = `700 30px ${FONT}`;
  ctx.fillText(
    data.title ?? 'NIKKE Solo Raid Sim · Roster Generator',
    padX,
    56,
  );
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(fmt(data.totalDamage), padX, 108);
  const bigW = ctx.measureText(fmt(data.totalDamage)).width;
  ctx.font = `400 18px ${FONT}`;
  ctx.fillStyle = '#8b93a3';
  ctx.fillText(
    `total damage across all ${data.teams.length} teams`,
    padX + bigW + 24,
    102,
  );
  // global meta line — omitted when per-team boss labels carry the options
  if (!hasBossLabels) {
    ctx.fillText(
      `${meta.weakness ? `${meta.weakness}-weak boss` : 'no element'}  ·  lvl ${
        meta.level
      }  ·  ${meta.coreLabel}  ·  180s`,
      padX,
      136,
    );
  } else {
    ctx.fillText(`lvl ${meta.level}  ·  180s`, padX, 136);
  }

  // one row per team: portraits then a total-damage bar scaled to the top team.
  const stripW = data.teams[0]
    ? data.teams[0].units.length * R_PS +
      (data.teams[0].units.length - 1) * R_GAP
    : 0;
  const barX = padX + stripW + 28;
  const barW = W - barX - 200;
  const maxDmg = Math.max(...data.teams.map((t) => t.teamDamage), 1);
  data.teams.forEach((t, i) => {
    const y = R_HEAD_H + i * R_ROW_H;
    const py = y + (R_ROW_H - R_PS) / 2;
    // portraits
    t.units.forEach((u, j) => {
      const px = padX + j * (R_PS + R_GAP);
      const col = ELEMENT_COLORS[u.element] ?? '#9aa3b2';
      if (u.img) {
        ctx.save();
        roundRect(ctx, px, py, R_PS, R_PS, 9);
        ctx.clip();
        ctx.fillStyle = '#1f232d';
        ctx.fillRect(px, py, R_PS, R_PS);
        ctx.drawImage(u.img, px, py, R_PS, R_PS);
        ctx.restore();
      } else {
        ctx.fillStyle = '#1f232d';
        roundRect(ctx, px, py, R_PS, R_PS, 9);
        ctx.fill();
        ctx.fillStyle = col;
        roundRect(ctx, px, py, R_PS, R_PS, 9);
        ctx.globalAlpha = 0.22;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = col;
        ctx.font = `700 24px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(
          (u.name[0] ?? '?').toUpperCase(),
          px + R_PS / 2,
          py + R_PS / 2 + 8,
        );
        ctx.textAlign = 'left';
      }
    });
    // team label (+ per-team boss options when present)
    ctx.fillStyle = '#8b93a3';
    ctx.font = `600 13px ${FONT}`;
    const label = t.bossLabel
      ? `team ${i + 1}  ·  ${t.bossLabel}`
      : `team ${i + 1}`;
    ctx.fillText(label, padX, py - 6);
    // damage bar (scaled to the strongest team)
    const barY = y + R_ROW_H / 2 - 11;
    ctx.fillStyle = '#2a2f3b';
    roundRect(ctx, barX, barY, barW, 22, 11);
    ctx.fill();
    ctx.fillStyle = '#5b9dff';
    roundRect(
      ctx,
      barX,
      barY,
      Math.max(2, (t.teamDamage / maxDmg) * barW),
      22,
      11,
    );
    ctx.fill();
    // value (right aligned)
    ctx.textAlign = 'right';
    ctx.fillStyle = '#e7eaf0';
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText(fmt(t.teamDamage), W - padX, y + R_ROW_H / 2 + 6);
    ctx.textAlign = 'left';
  });

  // footer
  ctx.fillStyle = '#8b93a3';
  ctx.font = `400 13px ${FONT}`;
  ctx.fillText(
    'nikke-sim · expected-value crits · always in range · 0 enemy debuffs',
    padX,
    H - 22,
  );
}
