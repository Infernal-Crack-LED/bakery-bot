import { describe, expect, it } from 'vitest';
import { command } from './dps.js';

describe('/dps', () => {
  it('builds a command named "dps" with an optional element choice', () => {
    const json = command.data.toJSON();
    expect(json.name).toBe('dps');
    const opt = json.options?.[0];
    expect(opt?.name).toBe('element');
    expect(opt?.required).toBeFalsy();
  });
});
