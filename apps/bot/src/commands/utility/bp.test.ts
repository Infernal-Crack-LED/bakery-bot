import { describe, expect, it } from 'vitest';
import { command } from './bp.js';

describe('/bp', () => {
  it('builds a command named "bp" with an optional character option', () => {
    const json = command.data.toJSON();
    expect(json.name).toBe('bp');
    const opt = json.options?.[0];
    expect(opt?.name).toBe('character');
    expect(opt?.required).toBeFalsy();
  });
});
