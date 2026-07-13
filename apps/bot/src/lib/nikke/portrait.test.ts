import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  cropPortraitSquare,
  fetchPortraitThumbnail,
  squarePortraitCrop,
} from './portrait.js';

describe('squarePortraitCrop', () => {
  it('crops a full-width square 12.5% down from a 1:2 portrait', () => {
    // blablalink "mi" portraits are 256×512 → 256² square, top at 512/8 = 64.
    expect(squarePortraitCrop(256, 512)).toEqual({
      left: 0,
      top: 64,
      width: 256,
      height: 256,
    });
  });

  it('centres horizontally and clamps the top for a near-square source', () => {
    // Wider-than-tall never happens for portraits, but the region must stay in
    // bounds: a 300×320 source → 300² is impossible, so size = 300, and the
    // 12.5% top (40) is clamped to height-size = 20.
    expect(squarePortraitCrop(300, 320)).toEqual({
      left: 0,
      top: 20,
      width: 300,
      height: 300,
    });
  });

  it('is a no-op offset for an exactly square source', () => {
    expect(squarePortraitCrop(128, 128)).toEqual({
      left: 0,
      top: 0,
      width: 128,
      height: 128,
    });
  });
});

describe('cropPortraitSquare', () => {
  it('produces a square PNG from a 256×512 source', async () => {
    const src = await sharp({
      create: {
        width: 256,
        height: 512,
        channels: 4,
        background: { r: 200, g: 100, b: 50, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const out = await cropPortraitSquare(src);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
  });
});

describe('fetchPortraitThumbnail', () => {
  it('returns the cropped square on a successful fetch', async () => {
    const src = await sharp({
      create: {
        width: 256,
        height: 512,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(src, { status: 200 }))
    );

    const out = await fetchPortraitThumbnail(
      'https://cdn.example/mi_c090_00_s.png',
      fetchImpl as never
    );
    expect(out).not.toBeNull();
    expect((await sharp(out!).metadata()).height).toBe(256);
  });

  it('returns null (no throw) on a non-OK response', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('nope', { status: 404 }))
    );
    expect(
      await fetchPortraitThumbnail(
        'https://cdn.example/missing.png',
        fetchImpl as never
      )
    ).toBeNull();
  });
});
