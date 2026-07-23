import { describe, expect, it } from 'vitest';
import { command } from './roster.js';

describe('/roster', () => {
  it('builds a command named "roster" with an optional name option', () => {
    const json = command.data.toJSON();
    expect(json.name).toBe('roster');
    const opt = json.options?.[0];
    expect(opt?.name).toBe('name');
    expect(opt?.required).toBeFalsy();
  });
});
