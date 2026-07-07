import { describe, expect, it } from 'vitest';
import type { GuildConfig } from '@app/db';
import {
  DEFAULT_QUOTE_THRESHOLD,
  emojiKey,
  matchesQuoteEmoji,
  quoteThreshold,
  reactionEmojiKey,
} from './quotes.js';

const cfg = (patch: Partial<GuildConfig>): GuildConfig => patch as GuildConfig;

describe('emojiKey', () => {
  it('returns the unicode char for a standard emoji', () => {
    expect(emojiKey('⭐')).toBe('⭐');
    expect(emojiKey('  ⭐  ')).toBe('⭐'); // trims
  });

  it('returns the id for a custom emoji', () => {
    expect(emojiKey('<:Maiden:1234567890123456789>')).toBe(
      '1234567890123456789'
    );
    expect(emojiKey('<a:spin:9876543210987654321>')).toBe(
      '9876543210987654321'
    ); // animated
  });

  it('returns null for empty/blank input', () => {
    expect(emojiKey(null)).toBeNull();
    expect(emojiKey(undefined)).toBeNull();
    expect(emojiKey('')).toBeNull();
  });
});

describe('reactionEmojiKey', () => {
  it('prefers the id, falls back to the name', () => {
    expect(reactionEmojiKey({ id: '123', name: 'Maiden' })).toBe('123');
    expect(reactionEmojiKey({ id: null, name: '⭐' })).toBe('⭐');
  });
});

describe('quoteThreshold', () => {
  it('defaults when unset or invalid', () => {
    expect(quoteThreshold(undefined)).toBe(DEFAULT_QUOTE_THRESHOLD);
    expect(quoteThreshold(cfg({ quoteThreshold: null }))).toBe(
      DEFAULT_QUOTE_THRESHOLD
    );
    expect(quoteThreshold(cfg({ quoteThreshold: 0 }))).toBe(
      DEFAULT_QUOTE_THRESHOLD
    );
  });

  it('uses the configured value when set', () => {
    expect(quoteThreshold(cfg({ quoteThreshold: 5 }))).toBe(5);
  });
});

describe('matchesQuoteEmoji', () => {
  it('is off when no emoji is configured', () => {
    expect(matchesQuoteEmoji(undefined, { name: '⭐' })).toBe(false);
    expect(matchesQuoteEmoji(cfg({}), { name: '⭐' })).toBe(false);
  });

  it('matches a standard emoji by char', () => {
    const c = cfg({ quoteEmoji: '⭐' });
    expect(matchesQuoteEmoji(c, { id: null, name: '⭐' })).toBe(true);
    expect(matchesQuoteEmoji(c, { id: null, name: '❤️' })).toBe(false);
  });

  it('matches a custom emoji by id despite differing shapes', () => {
    const c = cfg({ quoteEmoji: '<:Maiden:1234567890123456789>' });
    expect(
      matchesQuoteEmoji(c, { id: '1234567890123456789', name: 'Maiden' })
    ).toBe(true);
    expect(
      matchesQuoteEmoji(c, { id: '9999999999999999999', name: 'Maiden' })
    ).toBe(false);
  });
});
