import { describe, expect, it, vi } from 'vitest';
import { command } from './ping.js';

/**
 * Example: unit-testing a single command's behaviour.
 *
 * Copy this pattern when you add a command. The trick is that a Discord
 * `interaction` is just an object — you don't need a real Discord connection.
 * Build a fake one with `vi.fn()` stubs for the methods your command calls,
 * run `command.execute(fake)`, then assert on what it did.
 */

function fakeInteraction() {
  return {
    createdTimestamp: 1000,
    client: { ws: { ping: 42 } },
    // /ping calls reply({ withResponse: true }) and reads the returned message.
    reply: vi.fn().mockResolvedValue({
      resource: { message: { createdTimestamp: 1100 } },
    }),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/ping', () => {
  it('replies then edits with a pong that reports latency', async () => {
    const interaction = fakeInteraction();

    await command.execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledOnce();
    expect(interaction.editReply).toHaveBeenCalledOnce();
    const message = interaction.editReply.mock.calls[0]?.[0] as string;
    expect(message).toContain('Pong');
    // roundtrip = 1100 - 1000 = 100ms; ws ping = 42ms
    expect(message).toContain('100ms');
    expect(message).toContain('42ms');
  });
});
