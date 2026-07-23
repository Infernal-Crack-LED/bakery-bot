// Shared DPS-chart infographic renderer. Draws a ranked horizontal bar chart to any
// Canvas2D-compatible context, so the web app (browser canvas) and the bakery-bot
// (@napi-rs/canvas / node-canvas) produce a pixel-identical image. DOM-free — the
// caller creates and sizes the canvas and hands us the ctx. Mirrors teamCard.ts.
import {
  type Canvas2DLike,
  roundRect,
  FONT,
  ELEMENT_COLORS,
  PORTRAIT_CROP_TOP,
} from './teamCard.js';

export type { Canvas2DLike } from './teamCard.js';

// Relative-normalized score against the chart's #1 (the top/longest bar): the #1 is
// 1.000, every other row = its dps ÷ the #1's dps (so 0.95 = 95% of the top unit's
// damage). 3 decimals to keep tightly-clustered ranks distinguishable. Shared by the
// on-page chart and the PNG so both show identical labels.
export const relScore = (dps: number, top: number): string =>
  (top > 0 ? dps / top : 0).toFixed(3);

export interface DpsBar {
  name: string;
  element: string;
  dps: number;
  slug: string;
  advantaged?: boolean;
  imageUrl?: string | null; // portrait source (loaded by the caller into `img`)
  img?: unknown; // pre-loaded CanvasImageSource; drawn if present
}
export interface DpsCompare {
  name: string;
  element: string;
  dps: number;
  rank: number;
  total: number; // population size the rank is out of
}
export interface DpsChartData {
  title: string;
  subtitle?: string;
  bars: DpsBar[]; // already sorted desc, already sliced to top-N
  compare?: DpsCompare | null;
  icon?: unknown; // optional canvas-drawable image drawn beside the title
  footer?: string; // override the default footer text
}

export const CHART_W = 900;
const PAD_X = 36;
const HEAD_H = 118;
const ROW_H = 52;
const FOOT_H = 44;
const COMPARE_H = 52;

export const chartHeight = (barCount: number, hasCompare: boolean) =>
  HEAD_H + barCount * ROW_H + (hasCompare ? COMPARE_H : 0) + FOOT_H;

export function drawDpsChart(ctx: Canvas2DLike, data: DpsChartData) {
  const W = CHART_W;
  const padX = PAD_X;
  const H = chartHeight(data.bars.length, !!data.compare);

  // background + accent bar
  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#5b9dff';
  ctx.fillRect(0, 0, W, 5);

  // icon + title + subtitle
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const ICON = 34;
  let textX = padX;
  if (data.icon) {
    ctx.drawImage(data.icon, padX, 50 - ICON + 4, ICON, ICON);
    textX = padX + ICON + 12;
  }
  ctx.fillStyle = '#e7eaf0';
  ctx.font = `700 26px ${FONT}`;
  ctx.fillText(data.title, textX, 50);
  if (data.subtitle) {
    ctx.fillStyle = '#8b93a3';
    ctx.font = `400 16px ${FONT}`;
    ctx.fillText(data.subtitle, textX, 78);
  }
  ctx.fillStyle = '#8b93a3';
  ctx.font = `400 13px ${FONT}`;
  ctx.fillText('relative to #1 DPS (1.00 = top) · 180s', textX, 102);

  const maxDps = Math.max(...data.bars.map((b) => b.dps), 1);
  const hasPortraits = data.bars.some((b) => b.img);
  const labelW = hasPortraits ? 210 : 168; // rank (+ portrait) + name column
  const barX = padX + labelW;
  const valueW = 96;
  const barW = W - barX - valueW - padX;
  const PORTRAIT = 40;

  data.bars.forEach((b, i) => {
    const y = HEAD_H + i * ROW_H;
    const col = ELEMENT_COLORS[b.element] ?? '#9aa3b2';

    // rank
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5b6472';
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText(`${i + 1}`, padX, y + 30);

    // portrait (rounded-clipped), then name shifted right to make room. Portraits
    // are tall (e.g. 256×512), so crop a square from the source rather than
    // squishing the whole art into a square box — anchored 12.5% down from the top
    // to match the Sim tab's `object-position` so portraits look identical app-wide.
    if (b.img) {
      const px = padX + 20;
      const py = y + (ROW_H - PORTRAIT) / 2;
      const im = b.img as {
        naturalWidth?: number;
        naturalHeight?: number;
        width?: number;
        height?: number;
      };
      const iw = im.naturalWidth ?? im.width ?? PORTRAIT;
      const ih = im.naturalHeight ?? im.height ?? PORTRAIT;
      const side = Math.min(iw, ih);
      const sx = (iw - side) / 2;
      const sy = (ih - side) * PORTRAIT_CROP_TOP; // matches CSS object-position
      ctx.save();
      roundRect(ctx, px, py, PORTRAIT, PORTRAIT, 8);
      ctx.clip();
      ctx.drawImage(b.img, sx, sy, side, side, px, py, PORTRAIT, PORTRAIT);
      ctx.restore();
    }
    const nameX = b.img ? padX + 20 + PORTRAIT + 12 : padX + 30;
    ctx.fillStyle = '#e7eaf0';
    ctx.font = `600 17px ${FONT}`;
    ctx.fillText(b.name + (b.advantaged ? '  ▲' : ''), nameX, y + 30);

    // track + bar
    ctx.fillStyle = '#2a2f3b';
    roundRect(ctx, barX, y + 16, barW, 20, 10);
    ctx.fill();
    ctx.fillStyle = col;
    roundRect(ctx, barX, y + 16, Math.max(6, (b.dps / maxDps) * barW), 20, 10);
    ctx.fill();

    // value: score relative to the #1 (top) bar
    ctx.textAlign = 'right';
    ctx.fillStyle = '#c9cede';
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText(relScore(b.dps, maxDps), W - padX, y + 31);
  });

  // compare-unit annotation
  if (data.compare) {
    const y = HEAD_H + data.bars.length * ROW_H;
    ctx.fillStyle = '#171b22';
    ctx.fillRect(0, y, W, COMPARE_H);
    ctx.fillStyle = '#5b9dff';
    ctx.fillRect(0, y, 4, COMPARE_H);
    const c = data.compare;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e7eaf0';
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText(c.name, padX, y + 32);
    ctx.fillStyle = '#8b93a3';
    ctx.font = `400 15px ${FONT}`;
    ctx.fillText(`rank ${c.rank} / ${c.total}`, padX + 200, y + 32);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#c9cede';
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText(relScore(c.dps, maxDps), W - padX, y + 32);
  }

  // footer
  ctx.fillStyle = '#8b93a3';
  ctx.font = `400 12px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(data.footer ?? 'nikkesim.app/dpschart', padX, H - 18);
}
