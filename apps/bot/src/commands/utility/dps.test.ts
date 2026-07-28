import { beforeEach, describe, expect, it, vi } from 'vitest';

const CHART_URL =
  'https://www.nikkesim.app/api/v1/img/dps/solo.eleweak.c100.8of12.all.aaa11111.png';

vi.mock('../../lib/nikkesim/client.js', () => ({
  DEFAULT_DPS_CELL: 'solo.eleweak.c100.8of12',
  NEUTRAL_DPS_CELL: 'solo.neutral.c100.8of12',
  dpsImageUrl: vi.fn(() => Promise.resolve(CHART_URL)),
}));

import { dpsImageUrl } from '../../lib/nikkesim/client.js';
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
    vi.mocked(dpsImageUrl).mockClear();
  });

  it('builds a command named "dps" with an optional element choice', () => {
    const json = command.data.toJSON();
    expect(json.name).toBe('dps');
    const opt = json.options?.[0];
    expect(opt?.name).toBe('element');
    expect(opt?.required).toBeFalsy();
  });

  it('embeds the chart image and attaches only the icon', async () => {
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    const payload = editReply.mock.calls[0]![0];
    expect(payload.embeds[0].toJSON().image.url).toBe(CHART_URL);
    expect(payload.files).toHaveLength(1); // icon thumbnail only
  });

  it('asks for the default cell with no element filter', async () => {
    const { interaction } = fakeInteraction();
    await command.execute(interaction as never);
    expect(dpsImageUrl).toHaveBeenCalledWith({
      cell: 'solo.eleweak.c100.8of12',
      element: undefined,
    });
  });

  it('treats "neutral" as a cell, not an element filter', async () => {
    const { interaction } = fakeInteraction('neutral');
    await command.execute(interaction as never);
    expect(dpsImageUrl).toHaveBeenCalledWith({
      cell: 'solo.neutral.c100.8of12',
      element: undefined,
    });
  });

  it('passes a real element through as a filter on the default cell', async () => {
    const { interaction } = fakeInteraction('fire');
    await command.execute(interaction as never);
    expect(dpsImageUrl).toHaveBeenCalledWith({
      cell: 'solo.eleweak.c100.8of12',
      element: 'fire',
    });
  });

  it('replies with an error message when the image API is unreachable', async () => {
    vi.mocked(dpsImageUrl).mockRejectedValueOnce(new Error('down'));
    const { interaction, editReply } = fakeInteraction();
    await command.execute(interaction as never);
    expect(editReply.mock.calls[0]![0]).toContain('nikkesim.app');
  });
});
