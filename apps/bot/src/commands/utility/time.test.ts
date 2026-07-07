import { describe, expect, it, vi } from 'vitest';
import { command } from './time.js';

/**
 * Unit tests for /time. We fake the interaction: `options.getString` returns
 * the when/offset/style values, and `reply` records what the command sent.
 */

function fakeInteraction(opts: {
  when: string;
  offset: string;
  style?: string | null;
}) {
  return {
    options: {
      getString: vi.fn((name: string) => {
        if (name === 'when') {
          return opts.when;
        }
        if (name === 'offset') {
          return opts.offset;
        }
        if (name === 'style') {
          return opts.style ?? null;
        }
        return null;
      }),
    },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('/time', () => {
  it('replies publicly with a Discord timestamp for valid input', async () => {
    const interaction = fakeInteraction({
      when: '2025-07-06 20:00',
      offset: '0',
    });

    await command.execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledOnce();
    const arg = interaction.reply.mock.calls[0]?.[0] as {
      content: string;
      flags?: number;
    };
    expect(arg.content).toContain('<t:');
    // Public reply => not ephemeral (no flags set).
    expect(arg.flags).toBeUndefined();
  });

  it('replies with an ephemeral error for an invalid offset', async () => {
    const interaction = fakeInteraction({
      when: '2025-07-06 20:00',
      offset: 'banana',
    });

    await command.execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledOnce();
    const arg = interaction.reply.mock.calls[0]?.[0] as {
      content: string;
      flags?: number;
    };
    expect(arg.content.toLowerCase()).toContain('offset');
    expect(arg.flags).toBeDefined();
  });

  it('replies with an ephemeral error for an unparseable date/time', async () => {
    const interaction = fakeInteraction({
      when: 'not a date',
      offset: '+9',
    });

    await command.execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledOnce();
    const arg = interaction.reply.mock.calls[0]?.[0] as {
      content: string;
      flags?: number;
    };
    expect(arg.content.toLowerCase()).toContain('date/time');
    expect(arg.flags).toBeDefined();
  });
});
