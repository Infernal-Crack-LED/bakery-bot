import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { buildSetupGuideEmbed } from '../../lib/setupGuide.js';
import { command } from './setup-guide.js';

describe('buildSetupGuideEmbed', () => {
  it('covers the key sections and commands', () => {
    const json = buildSetupGuideEmbed().toJSON();
    expect(json.title).toContain('Maiden');
    const text = JSON.stringify(json);
    expect(text).toContain('Send Messages');
    expect(text).toContain('/config news');
    expect(text).toContain('/config quotes');
    expect(text).toContain('/sync');
  });
});

function fakeInteraction(opts: { admin?: boolean; dmFails?: boolean }) {
  const send = opts.dmFails
    ? vi.fn().mockRejectedValue(new Error('50007'))
    : vi.fn().mockResolvedValue(undefined);
  const reply = vi.fn().mockResolvedValue(undefined);
  return {
    interaction: {
      user: { id: 'user-1', send },
      member: undefined,
      memberPermissions: { has: () => opts.admin ?? true },
      reply,
    },
    send,
    reply,
  };
}

describe('/setup-guide', () => {
  it('DMs the guide to an admin and confirms ephemerally', async () => {
    const { interaction, send, reply } = fakeInteraction({ admin: true });

    await command.execute(interaction as never);

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toHaveProperty('embeds');
    const payload = reply.mock.calls[0]?.[0] as {
      content: string;
      flags: number;
    };
    expect(payload.content).toContain('DMs');
    expect(payload.flags).toBe(MessageFlags.Ephemeral);
  });

  it('falls back with guidance when DMs are closed', async () => {
    const { interaction, send, reply } = fakeInteraction({
      admin: true,
      dmFails: true,
    });

    await command.execute(interaction as never);

    expect(send).toHaveBeenCalledOnce();
    const payload = reply.mock.calls[0]?.[0] as { content: string };
    expect(payload.content).toContain("couldn't DM");
  });

  it('refuses non-admins and never DMs them', async () => {
    const { interaction, send, reply } = fakeInteraction({ admin: false });

    await command.execute(interaction as never);

    expect(send).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledOnce(); // the ensureAdmin rejection
  });
});
