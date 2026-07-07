import { ChannelType, Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

// Replace the real mod-log (which hits the DB) with a stub for these tests.
vi.mock('../../lib/modlog.js', () => ({ logModAction: vi.fn() }));

import { command } from './perms.js';
import { logModAction } from '../../lib/modlog.js';

// --- Fakes -----------------------------------------------------------------

function fakeChannel(
  id: string,
  name: string,
  type: ChannelType,
  parentId: string | null
) {
  return {
    id,
    name,
    type,
    parentId,
    isThread: () => false,
    permissionOverwrites: { edit: vi.fn().mockResolvedValue(undefined) },
  };
}

// A representative server: two text channels, one voice, one category, and a
// thread (which must always be skipped).
function fakeGuildChannels() {
  const cache = new Collection<string, any>();
  cache.set('t1', fakeChannel('t1', 'general', ChannelType.GuildText, 'catA'));
  cache.set('t2', fakeChannel('t2', 'rules', ChannelType.GuildText, null));
  cache.set('v1', fakeChannel('v1', 'Voice 1', ChannelType.GuildVoice, 'catA'));
  cache.set(
    'catA',
    fakeChannel('catA', 'Category A', ChannelType.GuildCategory, null)
  );
  const thread = fakeChannel('th1', 'thread', ChannelType.PublicThread, 't1');
  thread.isThread = () => true;
  cache.set('th1', thread);
  return cache;
}

interface Opts {
  permission?: string;
  mode?: string;
  scope?: string;
  category?: { id: string } | null;
  apply?: boolean | null;
  botHasManageRoles?: boolean;
}

function fakeInteraction(opts: Opts) {
  const strings: Record<string, string> = {
    permission: opts.permission ?? 'SendMessages',
    mode: opts.mode ?? 'deny',
    scope: opts.scope ?? 'all',
  };
  const role = { id: 'role1', name: 'Members', toString: () => '<@&role1>' };

  return {
    inCachedGuild: () => true,
    guildId: 'g1',
    user: { id: 'mod1', tag: 'Mod#0001' },
    client: {},
    guild: {
      members: {
        me: {
          permissions: { has: () => opts.botHasManageRoles ?? true },
        },
      },
      channels: { cache: fakeGuildChannels() },
    },
    options: {
      getRole: vi.fn(() => role),
      getString: vi.fn((name: string) => strings[name] ?? null),
      getChannel: vi.fn(() => opts.category ?? null),
      getBoolean: vi.fn(() => opts.apply ?? null),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

function editsFor(interaction: ReturnType<typeof fakeInteraction>) {
  const cache = interaction.guild.channels.cache;
  const called: string[] = [];
  for (const [id, ch] of cache) {
    if ((ch.permissionOverwrites.edit as any).mock.calls.length > 0) {
      called.push(id);
    }
  }
  return called;
}

// --- Tests -----------------------------------------------------------------

describe('/perms', () => {
  it('previews without changing anything when apply is omitted', async () => {
    const interaction = fakeInteraction({ apply: null });
    await command.execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledOnce();
    const payload = interaction.reply.mock.calls[0]?.[0] as { content: string };
    expect(payload.content).toMatch(/preview/i);
    expect(editsFor(interaction)).toHaveLength(0); // nothing edited
    expect(logModAction).not.toHaveBeenCalled(); // nothing logged
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it('applies the change to every matching channel and logs it', async () => {
    const interaction = fakeInteraction({ apply: true, scope: 'all' });
    await command.execute(interaction as any);

    // t1, t2, v1, catA get edited; the thread (th1) is skipped.
    expect(editsFor(interaction).sort()).toEqual(['catA', 't1', 't2', 'v1']);

    const t1 = interaction.guild.channels.cache.get('t1');
    expect(t1.permissionOverwrites.edit).toHaveBeenCalledWith(
      'role1',
      { SendMessages: false }, // deny → false
      { reason: expect.any(String) }
    );

    expect(interaction.editReply).toHaveBeenCalledOnce();
    expect(logModAction).toHaveBeenCalledOnce();
    const logged = (logModAction as any).mock.calls[0][1];
    expect(logged).toMatchObject({ action: 'perms', metadata: 4 });
  });

  it('respects the voice scope (only voice channels change)', async () => {
    const interaction = fakeInteraction({ apply: true, scope: 'voice' });
    await command.execute(interaction as any);
    expect(editsFor(interaction)).toEqual(['v1']);
  });

  it('allow mode sets the permission to true', async () => {
    const interaction = fakeInteraction({
      apply: true,
      scope: 'text',
      mode: 'allow',
    });
    await command.execute(interaction as any);
    const t1 = interaction.guild.channels.cache.get('t1');
    expect(t1.permissionOverwrites.edit).toHaveBeenCalledWith(
      'role1',
      { SendMessages: true },
      { reason: expect.any(String) }
    );
  });

  it('refuses when the bot lacks Manage Roles', async () => {
    const interaction = fakeInteraction({
      apply: true,
      botHasManageRoles: false,
    });
    await command.execute(interaction as any);

    expect(interaction.reply).toHaveBeenCalledOnce();
    const payload = interaction.reply.mock.calls[0]?.[0] as { content: string };
    expect(payload.content).toMatch(/manage roles/i);
    expect(editsFor(interaction)).toHaveLength(0);
  });

  it("requires a category when scope is 'category'", async () => {
    const interaction = fakeInteraction({
      apply: true,
      scope: 'category',
      category: null,
    });
    await command.execute(interaction as any);

    const payload = interaction.reply.mock.calls[0]?.[0] as { content: string };
    expect(payload.content).toMatch(/category/i);
    expect(editsFor(interaction)).toHaveLength(0);
  });
});
