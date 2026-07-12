import { describe, expect, it } from 'vitest';
import { extractJsonObjects, salvageJson } from './salvage.js';

/**
 * Unit tests for the hardened JSON salvage. These reproduce the failure shapes
 * the F2 feasibility trial actually saw: clean JSON, fenced JSON, an object
 * wrapped in reasoning prose, a duplicated object, and unrecoverable truncation.
 */

const envelope = {
  events: [{ name: 'Rapunzel Banner', type: 'banner' }],
  confidence: 0.9,
};

describe('extractJsonObjects', () => {
  it('finds a single top-level object', () => {
    expect(extractJsonObjects('{"a":1}')).toEqual(['{"a":1}']);
  });

  it('ignores braces inside strings', () => {
    const text = '{"notes":"rate-up {SSR} 50%"}';
    expect(extractJsonObjects(text)).toEqual([text]);
  });

  it('pulls an object out of surrounding prose', () => {
    const text = 'Here is the data:\n{"events":[]}\nHope that helps!';
    expect(extractJsonObjects(text)).toEqual(['{"events":[]}']);
  });

  it('returns each of several top-level objects in order', () => {
    expect(extractJsonObjects('{"a":1} noise {"b":2}')).toEqual([
      '{"a":1}',
      '{"b":2}',
    ]);
  });

  it('returns nothing for a truncated (unbalanced) object', () => {
    expect(extractJsonObjects('{"events":[{"name":"Rap')).toEqual([]);
  });
});

describe('salvageJson', () => {
  it('parses clean JSON as-is with no notes', () => {
    const result = salvageJson(JSON.stringify(envelope));
    expect(result?.value).toEqual(envelope);
    expect(result?.notes).toEqual([]);
  });

  it('strips ```json code fences', () => {
    const result = salvageJson(
      '```json\n' + JSON.stringify(envelope) + '\n```'
    );
    expect(result?.value).toEqual(envelope);
    expect(result?.notes).toContain('stripped-code-fences');
  });

  it('recovers an object wrapped in reasoning prose', () => {
    const raw = `Let me extract the events.\n${JSON.stringify(envelope)}\nDone.`;
    const result = salvageJson(raw);
    expect(result?.value).toEqual(envelope);
    expect(result?.notes).toContain('stripped-prose');
  });

  it('dedupes a doubled object and prefers the envelope shape', () => {
    const raw = `${JSON.stringify(envelope)}\n${JSON.stringify(envelope)}`;
    const result = salvageJson(raw);
    expect(result?.value).toEqual(envelope);
    expect(result?.notes).toContain('deduped-repeated-object');
  });

  it('prefers the object carrying an events array over an unrelated one', () => {
    const raw = `{"reasoning":"first"}\n${JSON.stringify(envelope)}`;
    const result = salvageJson(raw);
    expect(result?.value).toEqual(envelope);
    expect(result?.notes).toContain('multiple-distinct-objects');
  });

  it('returns null on unrecoverable truncation', () => {
    expect(salvageJson('{"events":[{"name":"Rapunzel')).toBeNull();
  });
});
