import { describe, expect, it } from 'vitest';
import { loadCommands, loadEvents } from './loaders.js';

/**
 * Registry integrity — the safety net.
 *
 * These tests load EVERY command and event file the same way the running bot
 * does. If someone adds a broken command (bad name, missing description,
 * duplicate name, forgotten export), these tests fail *before* it ever reaches
 * Discord. This is the single most valuable test in the repo for non-devs:
 * add a command file, run `npm test`, and know immediately if it's shaped right.
 */

// Discord's rule for slash-command names: 1–32 chars, lowercase, letters /
// numbers / dashes / underscores only. `data.toJSON()` enforces this too, but
// we check explicitly for a friendlier failure message.
const SLASH_NAME = /^[-_\p{L}\p{N}]{1,32}$/u;

describe('loadCommands', () => {
  it('loads at least one command', async () => {
    const commands = await loadCommands();
    expect(commands.length).toBeGreaterThan(0);
  });

  it('every command has a valid name and description', async () => {
    const commands = await loadCommands();
    for (const command of commands) {
      const { name, description } = command.data;
      expect(name, `command name "${name}"`).toMatch(SLASH_NAME);
      expect(name, `command "${name}" must be lowercase`).toBe(
        name.toLowerCase()
      );
      expect(
        description.length,
        `command "${name}" needs a description`
      ).toBeGreaterThan(0);
      expect(description.length).toBeLessThanOrEqual(100);
      expect(typeof command.execute, `command "${name}".execute`).toBe(
        'function'
      );
    }
  });

  it('command names are unique (no two files claim the same name)', async () => {
    const commands = await loadCommands();
    const names = commands.map((c) => c.data.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every command serializes to a valid Discord payload', async () => {
    // This is exactly what `deploy-commands` sends to Discord. If a builder is
    // misconfigured, `.toJSON()` throws here instead of failing the deploy.
    const commands = await loadCommands();
    for (const command of commands) {
      expect(
        () => command.data.toJSON(),
        `command "${command.data.name}"`
      ).not.toThrow();
    }
  });

  it('ships the expected worked-example commands', async () => {
    const names = (await loadCommands()).map((c) => c.data.name);
    for (const expected of [
      'ping',
      'guides',
      'time',
      'config',
      'nikke',
    ]) {
      expect(names, `missing /${expected}`).toContain(expected);
    }
  });
});

describe('loadEvents', () => {
  it('every event has a name and an execute function', async () => {
    const events = await loadEvents();
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(typeof event.name).toBe('string');
      expect(event.name.length).toBeGreaterThan(0);
      expect(typeof event.execute).toBe('function');
    }
  });

  it('wires up the core gateway handlers', async () => {
    const names = (await loadEvents()).map((e) => e.name);
    expect(names).toContain('interactionCreate');
    expect(names).toContain('guildMemberAdd');
  });
});
