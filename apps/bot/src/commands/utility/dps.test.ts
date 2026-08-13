import { beforeEach, describe, expect, it, vi } from 'vitest';

// /dps only ever asks for a headline cell, which is pre-rendered — so the card
// comes back as a manifest URL, whose bytes card-reply.ts then fetches so the
// chart can be posted as an attachment instead of inside the embed.
const CHART_URL =
  'https://nikkesim.app/api/v1/img/dps/solo.eleweak.c100.8of12.all.aaa11111.png';

vi.mock('../../lib/nikkesim/client.js', () => ({
  DEFAULT_DPS_CELL: 'solo.eleweak.c100.8of12',
  NEUTRAL_DPS_CELL: 'solo.neutral.c100.8of12',
  dpsCardImage: vi.fn(() => Promise.resolve({ url: CHART_URL })),
  fetchImageAttachment: vi.fn((_url: string, name: string) =>
    Promise.resolve({ name } as never)
  ),
}));

import {
  dpsCardImage,
  fetchImageAttachment,
} from '../../lib/nikkesim/client.js';
import { command } from './dps.js';

/** Minimal interaction double: records the payload passed to editReply. */
function fakeInteraction(element?: string) {
  const editReply = vi.fn().mockResolvedValue(undefined);
  return {
    interaction: {
      deferReply: vi.fn().mockResolvedValue(undefined),
      options: { getString: () => element ?? null },
      editReply,
    },
    editReply,
  };
}

describe('/dps', () => {
  beforeEach(() => {
    vi.mocked(dpsCardImage).mockClear();
  });

  it('builds a command named "dps" with an optional element choice', () => {
    const json = command.data.toJSON();
    expect(json.name).toBe('dps');
    const opt = json.options?.[0];
    expect(opt?.name).toBe('element');
    expect(opt?.required).toBeFalsy();
  });

  it('posts the chart as an attachment, with the embed below it', async () => {
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    const payload = editReply.mock.calls[0]![0];
    const embed = payload.embeds[0].toJSON();
    // the picture is NOT the embed's — an embed caps it at the embed column
    expect(embed.image).toBeUndefined();
    expect(embed.thumbnail).toBeUndefined();
    expect(embed.author.name).toBe('nikkesim.app');
    expect(fetchImageAttachment).toHaveBeenCalledWith(
      CHART_URL,
      'dps-chart.png'
    );
    // card first, then the icon the author line references
    expect(payload.files).toHaveLength(2);
    expect(payload.files[0]).toEqual({ name: 'dps-chart.png' });
  });

  it('asks for the default cell with no element filter', async () => {
    const { interaction } = fakeInteraction();
    await command.execute(interaction as never);
    expect(dpsCardImage).toHaveBeenCalledWith({
      cell: 'solo.eleweak.c100.8of12',
      element: undefined,
    });
  });

  it('treats "neutral" as a cell, not an element filter', async () => {
    const { interaction } = fakeInteraction('neutral');
    await command.execute(interaction as never);
    expect(dpsCardImage).toHaveBeenCalledWith({
      cell: 'solo.neutral.c100.8of12',
      element: undefined,
    });
  });

  it('passes a real element through as a filter on the default cell', async () => {
    const { interaction } = fakeInteraction('fire');
    await command.execute(interaction as never);
    expect(dpsCardImage).toHaveBeenCalledWith({
      cell: 'solo.eleweak.c100.8of12',
      element: 'fire',
    });
  });

  it('replies with an error message when the image API is unreachable', async () => {
    vi.mocked(dpsCardImage).mockRejectedValueOnce(new Error('down'));
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(editReply.mock.calls[0]![0]).toContain('nikkesim.app');
  });
});
