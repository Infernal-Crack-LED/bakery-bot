import { describe, expect, it, vi } from 'vitest';
import { command } from './guides.js';

/**
 * Unit test for /guides.
 *
 * A Discord `interaction` is just an object — we fake one with a `vi.fn()`
 * `reply`, run `command.execute(fake)`, then assert on what it did.
 */

const EXPECTED_URLS = [
  'https://docs.google.com/spreadsheets/d/16EECdnWsdbfeJ_r1KKG0vIhpdeagAbMOjy6xKsSTvh4/edit?gid=0#gid=0',
  'https://nikke-synergy.com/lp_en',
  'https://enikk.app/',
  'https://nikke-deck.com/en',
  'https://www.prydwen.gg/nikke',
];

function fakeInteraction() {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/guides', () => {
  it('replies once with at least one embed containing all guide links', async () => {
    const interaction = fakeInteraction();

    await command.execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledOnce();

    const payload = interaction.reply.mock.calls[0]?.[0] as {
      embeds?: { toJSON: () => unknown }[];
    };
    expect(payload.embeds?.length ?? 0).toBeGreaterThanOrEqual(1);

    const serialized = JSON.stringify(
      payload.embeds!.map((embed) => embed.toJSON())
    );
    for (const url of EXPECTED_URLS) {
      expect(serialized).toContain(url);
    }
  });
});
