import { describe, expect, it, vi } from 'vitest';
import { command } from './unprivate-blabla.js';

/**
 * Unit test for /unprivate-blabla.
 *
 * We fake the interaction (just an object with a `reply` spy), run the command,
 * and assert it replies once with an embed that contains the key instructions.
 */

function fakeInteraction() {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/unprivate-blabla', () => {
  it('replies once with an embed covering the blablalink steps', async () => {
    const interaction = fakeInteraction();

    await command.execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledOnce();

    const payload = interaction.reply.mock.calls[0]?.[0] as {
      embeds?: { toJSON: () => unknown }[];
      files?: unknown[];
    };
    expect(payload.embeds?.length ?? 0).toBeGreaterThanOrEqual(1);

    const serialized = JSON.stringify(
      payload.embeds!.map((embed) => embed.toJSON())
    );
    expect(serialized).toContain('https://www.blablalink.com/');
    expect(serialized).toContain('Visible to All');
    expect(serialized).toContain('padlock');
  });
});
