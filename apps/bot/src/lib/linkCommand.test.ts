import { describe, expect, it, vi } from 'vitest';
import { makeLinkCommand } from './linkCommand.js';

describe('makeLinkCommand', () => {
  const command = makeLinkCommand({
    name: 'raid-usage',
    description: 'Link the Enikk app.',
    label: 'Enikk App',
    url: 'https://enikk.app/',
    note: 'Raid usage history',
  });

  it('builds a command with the given name + description', () => {
    const json = command.data.toJSON();
    expect(json.name).toBe('raid-usage');
    expect(json.description).toBe('Link the Enikk app.');
  });

  it('replies once with an embed linking the resource', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await command.execute({ reply } as never);
    expect(reply).toHaveBeenCalledOnce();
    const embed = reply.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.description).toContain('https://enikk.app/');
    expect(embed.description).toContain('Enikk App');
  });
});
