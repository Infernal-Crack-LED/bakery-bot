/**
 * Warm up all canvas infrastructure at bot startup so the first infographic
 * command renders instantly. Exercises fonts, portrait loading, and each
 * renderer with a tiny throwaway canvas.
 */
import { createCanvas } from '@napi-rs/canvas';
import {
  drawTeamCard,
  CARD_W,
  cardHeight,
  type Canvas2DLike,
} from './teamCard.js';
import { drawTableCard, TABLE_W, tableHeight } from './tableCard.js';
import { loadPortraitSlug } from './portrait.js';
import { NS_ICON } from './icon.js';

export function warmUp(): void {
  try {
    // Load a few portraits to warm the disk cache + decode pipeline.
    for (const slug of ['crown', 'helm', 'anis-star']) {
      loadPortraitSlug(slug);
    }

    // Render a tiny team card (exercises fonts + icon + portrait drawing).
    const tc = createCanvas(CARD_W, cardHeight(1));
    drawTeamCard(
      tc.getContext('2d') as unknown as Canvas2DLike,
      {
        teamDamage: 0,
        teamDps: 0,
        fullBursts: 0,
        fullBurstUptime: 0,
        units: [
          {
            name: 'Warmup',
            burst: 'I',
            weapon: 'AR',
            element: 'Fire',
            advantaged: false,
            share: 0,
            totalDamage: 0,
            img: loadPortraitSlug('crown') ?? undefined,
          },
        ],
      },
      {
        weakness: null,
        level: 400,
        coreLabel: '0% core',
        icon: NS_ICON,
        footer: 'warmup',
      }
    );

    // Render a tiny table card (exercises table layout + fonts).
    const tt = createCanvas(TABLE_W, tableHeight(1));
    drawTableCard(tt.getContext('2d') as unknown as Canvas2DLike, {
      title: 'Warmup',
      columns: [{ header: 'A' }],
      rows: [['1']],
      icon: NS_ICON,
    });

    console.log('[ready] canvas warm-up complete');
  } catch (e) {
    console.warn(
      '[ready] canvas warm-up failed (first command may be slow):',
      e
    );
  }
}
