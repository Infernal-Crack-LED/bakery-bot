import { describe, expect, it } from 'vitest';
import { buildPatchNotesEmbed, PATCH_NOTES } from './patchNotes.js';

describe('buildPatchNotesEmbed', () => {
  it('renders the version, title, and bullet points', () => {
    const embed = buildPatchNotesEmbed({
      version: 'v1.2.0',
      title: 'Cool stuff',
      notes: ['Added `/github`', 'Fixed a bug'],
    }).toJSON();
    expect(embed.title).toBe('📝 Patch Notes · v1.2.0 — Cool stuff');
    expect(embed.description).toBe('• Added `/github`\n• Fixed a bug');
  });

  it('omits the title separator when there is no title', () => {
    const embed = buildPatchNotesEmbed({
      version: 'v1.0.0',
      notes: ['First release'],
    }).toJSON();
    expect(embed.title).toBe('📝 Patch Notes · v1.0.0');
  });
});

describe('PATCH_NOTES', () => {
  it('has unique version strings (dedup key)', () => {
    const versions = PATCH_NOTES.map((n) => n.version);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
