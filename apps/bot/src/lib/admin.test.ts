import { PermissionFlagsBits } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureAdmin, isAdmin, isBotAdmin } from './admin.js';

const ADMIN_ID = '111111111111111111';

afterEach(() => vi.unstubAllEnvs());

describe('isBotAdmin', () => {
  it('recognizes a configured bot admin (BOT_ADMIN_ID)', () => {
    vi.stubEnv('BOT_ADMIN_ID', ADMIN_ID);
    expect(isBotAdmin(ADMIN_ID)).toBe(true);
    expect(isBotAdmin('999')).toBe(false);
  });
});

describe('isAdmin', () => {
  it('allows a server admin (Manage Server)', () => {
    const interaction = {
      user: { id: '999' },
      memberPermissions: {
        has: (p: bigint) => p === PermissionFlagsBits.ManageGuild,
      },
    };
    expect(isAdmin(interaction as never)).toBe(true);
  });

  it('allows the bot admin regardless of server perms', () => {
    vi.stubEnv('BOT_ADMIN_ID', ADMIN_ID);
    const interaction = {
      user: { id: ADMIN_ID },
      memberPermissions: { has: () => false },
    };
    expect(isAdmin(interaction as never)).toBe(true);
  });

  it('rejects a normal member', () => {
    const interaction = {
      user: { id: '999' },
      memberPermissions: { has: () => false },
    };
    expect(isAdmin(interaction as never)).toBe(false);
  });

  it('allows a member holding a configured Bot Admin role', () => {
    vi.stubEnv('BOT_ADMIN_ROLE_ID', '555, 777');
    const interaction = {
      user: { id: '999' },
      memberPermissions: { has: () => false },
      member: { roles: { cache: new Map([['777', {}]]) } },
    };
    expect(isAdmin(interaction as never)).toBe(true);
  });
});

describe('ensureAdmin', () => {
  it('replies ephemerally and returns false for non-admins', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: '999' },
      memberPermissions: { has: () => false },
      reply,
    };
    expect(await ensureAdmin(interaction as never)).toBe(false);
    expect(reply).toHaveBeenCalledOnce();
  });

  it('returns true for an admin without replying', async () => {
    vi.stubEnv('BOT_ADMIN_ID', ADMIN_ID);
    const reply = vi.fn();
    const interaction = {
      user: { id: ADMIN_ID },
      memberPermissions: { has: () => false },
      reply,
    };
    expect(await ensureAdmin(interaction as never)).toBe(true);
    expect(reply).not.toHaveBeenCalled();
  });
});
