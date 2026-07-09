import { Collection } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/deadInstall.js', () => ({
  noteCommandsOnly: vi.fn(),
  reinviteUrl: () => 'https://invite.example',
}));

import { noteCommandsOnly } from '../lib/deadInstall.js';
import { event } from './interactionCreate.js';
import type { Command } from '../types.js';

/**
 * Example: testing a gateway event handler.
 *
 * `interactionCreate` is the router that dispatches slash commands. We give it a
 * fake interaction whose `client.commands` we control, and check that it (a)
 * runs the matching command, (b) ignores non-command interactions, and
 * (c) reports an error to the user without throwing when a command blows up.
 */

function fakeCommandInteraction(
  commandName: string,
  commands: Collection<string, Command>
) {
  return {
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    commandName,
    replied: false,
    deferred: false,
    client: { commands },
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
}

describe('interactionCreate', () => {
  it('dispatches to the matching command', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const commands = new Collection<string, Command>();
    commands.set('demo', { data: { name: 'demo' } as never, execute });

    const interaction = fakeCommandInteraction('demo', commands);

    await event.execute(interaction as any);

    expect(execute).toHaveBeenCalledOnce();
  });

  it("ignores interactions that aren't chat-input commands", async () => {
    const interaction = {
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      reply: vi.fn(),
    };
    await expect(event.execute(interaction as any)).resolves.toBeUndefined();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("routes autocomplete requests to the command's autocomplete handler", async () => {
    const autocomplete = vi.fn().mockResolvedValue(undefined);
    const commands = new Collection<string, Command>();
    commands.set('demo', {
      data: { name: 'demo' } as never,
      execute: vi.fn(),
      autocomplete,
    });

    const interaction = {
      isAutocomplete: () => true,
      isChatInputCommand: () => false,
      commandName: 'demo',
      client: { commands },
    };

    await event.execute(interaction as any);

    expect(autocomplete).toHaveBeenCalledOnce();
  });

  it('tells the user something went wrong when a command throws', async () => {
    // The handler logs the failure with console.error; silence it so the test
    // output stays clean, and assert it happened.
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    const execute = vi.fn().mockRejectedValue(new Error('boom'));
    const commands = new Collection<string, Command>();
    commands.set('bad', { data: { name: 'bad' } as never, execute });

    const interaction = fakeCommandInteraction('bad', commands);
    // Should swallow the error, not rethrow.

    await event.execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledOnce();
    const payload = interaction.reply.mock.calls[0]?.[0] as { content: string };
    expect(payload.content).toMatch(/went wrong/i);
    expect(errorLog).toHaveBeenCalled();

    errorLog.mockRestore();
  });
});

describe('interactionCreate — dead-install nudge', () => {
  beforeEach(() => vi.clearAllMocks());

  function fakeGuildInteraction(
    commands: Collection<string, Command>,
    opts: { botIsMember: boolean }
  ) {
    return {
      isChatInputCommand: () => true,
      isAutocomplete: () => false,
      commandName: 'demo',
      guildId: 'guild-x',
      replied: false,
      deferred: false,
      client: {
        commands,
        guilds: { cache: { has: () => opts.botIsMember } },
      },
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
  }

  function withDemo() {
    const commands = new Collection<string, Command>();
    commands.set('demo', { data: { name: 'demo' } as never, execute: vi.fn() });
    return commands;
  }

  it('nudges when the bot is NOT a member of the guild', async () => {
    vi.mocked(noteCommandsOnly).mockResolvedValue(true);
    const interaction = fakeGuildInteraction(withDemo(), {
      botIsMember: false,
    });

    await event.execute(interaction as any);

    expect(noteCommandsOnly).toHaveBeenCalledWith('guild-x');
    // command didn't reply, so the nudge uses reply()
    const payload = interaction.reply.mock.calls.at(-1)?.[0] as {
      content: string;
    };
    expect(payload.content).toMatch(/partially installed/i);
    expect(payload.content).toContain('https://invite.example');
  });

  it('does nothing when the bot IS a member', async () => {
    const interaction = fakeGuildInteraction(withDemo(), { botIsMember: true });

    await event.execute(interaction as any);

    expect(noteCommandsOnly).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('stays quiet when recently nudged (cooldown)', async () => {
    vi.mocked(noteCommandsOnly).mockResolvedValue(false);
    const interaction = fakeGuildInteraction(withDemo(), {
      botIsMember: false,
    });

    await event.execute(interaction as any);

    expect(noteCommandsOnly).toHaveBeenCalledOnce();
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
