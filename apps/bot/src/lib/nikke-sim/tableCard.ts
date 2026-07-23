// Compact table infographic renderer — draws a titled table to a Canvas2D
// context. Matches the visual style of dpsChart.ts / teamCard.ts (dark bg,
// blue accent, same font). Used by /bp and /ol for compact data displays.
import { type Canvas2DLike, FONT } from './teamCard.js';

export type { Canvas2DLike } from './teamCard.js';

export interface TableColumn {
  header: string;
  align?: 'left' | 'right';
}
export interface TableCardData {
  title: string;
  subtitle?: string;
  columns: TableColumn[];
  rows: string[][];
  footer?: string;
}

export const TABLE_W = 720;
const PAD_X = 32;
const HEAD_H = 96;
const COL_HEADER_H = 36;
const ROW_H = 38;
const FOOT_H = 40;

export const tableHeight = (rowCount: number): number =>
  HEAD_H + COL_HEADER_H + rowCount * ROW_H + FOOT_H;

export function drawTableCard(ctx: Canvas2DLike, data: TableCardData): void {
  const W = TABLE_W;
  const padX = PAD_X;
  const H = tableHeight(data.rows.length);

  // background + accent bar
  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#5b9dff';
  ctx.fillRect(0, 0, W, 5);

  // title + subtitle
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e7eaf0';
  ctx.font = `700 24px ${FONT}`;
  ctx.fillText(data.title, padX, 44);
  if (data.subtitle) {
    ctx.fillStyle = '#8b93a3';
    ctx.font = `400 14px ${FONT}`;
    ctx.fillText(data.subtitle, padX, 68);
  }

  // column layout: distribute width evenly, first column left-aligned
  const colCount = data.columns.length;
  const colW = (W - padX * 2) / colCount;
  const colX = (i: number): number => padX + i * colW;

  // column headers
  const headerY = HEAD_H + 22;
  ctx.fillStyle = '#5b6472';
  ctx.font = `600 13px ${FONT}`;
  data.columns.forEach((col, i) => {
    ctx.textAlign = col.align === 'right' ? 'right' : 'left';
    const x = col.align === 'right' ? colX(i) + colW - 8 : colX(i) + 8;
    ctx.fillText(col.header, x, headerY);
  });

  // separator line
  const sepY = HEAD_H + COL_HEADER_H - 4;
  ctx.fillStyle = '#2a2f3b';
  ctx.fillRect(padX, sepY, W - padX * 2, 1);

  // rows
  data.rows.forEach((row, ri) => {
    const y = HEAD_H + COL_HEADER_H + ri * ROW_H + 26;

    // zebra striping
    if (ri % 2 === 1) {
      ctx.fillStyle = '#171b22';
      ctx.fillRect(
        padX,
        HEAD_H + COL_HEADER_H + ri * ROW_H,
        W - padX * 2,
        ROW_H
      );
    }

    row.forEach((cell, ci) => {
      const col = data.columns[ci];
      ctx.textAlign = col?.align === 'right' ? 'right' : 'left';
      const x = col?.align === 'right' ? colX(ci) + colW - 8 : colX(ci) + 8;
      // first column is the label — brighter; rest are data
      ctx.fillStyle = ci === 0 ? '#e7eaf0' : '#c9cede';
      ctx.font = ci === 0 ? `600 15px ${FONT}` : `400 15px ${FONT}`;
      ctx.fillText(cell, x, y);
    });
  });

  // footer
  ctx.textAlign = 'left';
  ctx.fillStyle = '#8b93a3';
  ctx.font = `400 12px ${FONT}`;
  ctx.fillText(data.footer ?? 'nikke-sim · nikkesim.app', padX, H - 16);
}
