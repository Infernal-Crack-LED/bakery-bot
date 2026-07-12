import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PatchTldr } from '@app/db';

const { recentPatchUpdates } = vi.hoisted(() => ({
  recentPatchUpdates: vi.fn(),
}));
vi.mock('../../lib/gacha/store.js', () => ({ recentPatchUpdates }));

import { command } from './patch.js';

const TLDR: PatchTldr = {
  patchLiveDate: 'July 2, 2026',
  newCharacters: ['Cinderella: Crystal Wave'],
  rerunCharacters: ['Dorothy: Serendipity'],
  passName: 'SEA LIZZIE PASS',
  passCostume: 'Tia - Sea Lizzie',
  costumeGachaCostume: 'Little Mermaid - Shell Princess',
  rerunSkins: ['Pepper - Ocean Vitamin'],
  unionRaid: true,
  soloRaid: true,
  coop: false,
};

function fakeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    contentId: 'c1',
    title: 'Update on July 2',
    publishedAt: new Date('2026-07-02T00:00:00Z'),
    tldr: TLDR,
    diagnostics: null,
    sourceUrl: 'https://nikke-en.com/newsdetail.html?content_id=c1',
    createdAt: new Date(),
    ...overrides,
  };
}

/** A fake interaction capturing the reply payload; count option is injectable. */
function fakeInteraction(count: number | null) {
  const reply = vi.fn();
  return {
    reply,
    options: { getInteger: vi.fn(() => count) },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/patch', () => {
  it('defaults to the latest patch (count 1) as one embed', async () => {
    recentPatchUpdates.mockResolvedValue([fakeRow()]);
    const interaction = fakeInteraction(null);

    await command.execute(interaction);

    expect(recentPatchUpdates).toHaveBeenCalledWith(1);
    const payload = (
      interaction as never as { reply: ReturnType<typeof vi.fn> }
    ).reply.mock.calls[0]![0];
    expect(payload.embeds).toHaveLength(1);
    const embed = payload.embeds[0].toJSON();
    expect(embed.title).toBe('Update on July 2');
    expect(
      embed.fields.some((f: { value: string }) =>
        f.value.includes('Cinderella: Crystal Wave')
      )
    ).toBe(true);
  });

  it('honors the count arg and renders one embed per patch', async () => {
    recentPatchUpdates.mockResolvedValue([
      fakeRow({ contentId: 'c1', title: 'Patch A' }),
      fakeRow({ contentId: 'c2', title: 'Patch B' }),
      fakeRow({ contentId: 'c3', title: 'Patch C' }),
    ]);
    const interaction = fakeInteraction(3);

    await command.execute(interaction);

    expect(recentPatchUpdates).toHaveBeenCalledWith(3);
    const payload = (
      interaction as never as { reply: ReturnType<typeof vi.fn> }
    ).reply.mock.calls[0]![0];
    expect(payload.embeds).toHaveLength(3);
  });

  it('shows a friendly message when nothing has been summarized yet', async () => {
    recentPatchUpdates.mockResolvedValue([]);
    const interaction = fakeInteraction(null);

    await command.execute(interaction);

    const payload = (
      interaction as never as { reply: ReturnType<typeof vi.fn> }
    ).reply.mock.calls[0]![0];
    expect(payload.content).toMatch(/No patch summaries yet/);
    expect(payload.embeds).toBeUndefined();
  });
});
