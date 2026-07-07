import { Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { Command } from '../../types.js';
import { buildHelpEmbed, command } from './help.js';

function fakeCommand(name: string, description: string): Command {
  return { data: { name, description } as never, execute: vi.fn() };
}

describe('buildHelpEmbed', () => {
  it('lists commands alphabetically with their descriptions', () => {
    const embed = buildHelpEmbed([
      fakeCommand('ping', 'Bot latency'),
      fakeCommand('guides', 'NIKKE links'),
    ]);
    const desc = embed.toJSON().description ?? '';
    expect(desc).toContain('/ping');
    expect(desc).toContain('Bot latency');
    // sorted: guides before ping
    expect(desc.indexOf('/guides')).toBeLessThan(desc.indexOf('/ping'));
  });
});

describe('/help execute', () => {
  function fakeInteraction(sendImpl: () => Promise<unknown>) {
    const commands = new Collection<string, Command>();
    commands.set('ping', fakeCommand('ping', 'Bot latency'));
    return {
      user: { send: vi.fn(sendImpl) },
      client: { commands },
      reply: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('DMs the command list and confirms ephemerally', async () => {
    const interaction = fakeInteraction(() => Promise.resolve(undefined));
    await command.execute(interaction as never);

    expect(interaction.user.send).toHaveBeenCalledOnce();
    expect(interaction.reply).toHaveBeenCalledOnce();
    const payload = interaction.reply.mock.calls[0]?.[0] as { content: string };
    expect(payload.content).toMatch(/dm/i);
  });

  it('handles a DM failure (50007) gracefully', async () => {
    const interaction = fakeInteraction(() =>
      Promise.reject(new Error('Cannot send messages to this user'))
    );
    await command.execute(interaction as never);

    expect(interaction.reply).toHaveBeenCalledOnce();
    const payload = interaction.reply.mock.calls[0]?.[0] as { content: string };
    expect(payload.content).toMatch(/couldn't dm|enable/i);
  });
});
