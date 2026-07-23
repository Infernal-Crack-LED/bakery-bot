import { describe, expect, it } from 'vitest';
import { command } from './charge-speed.js';

describe('/charge-speed', () => {
  it('builds a command named "charge-speed" with an optional character', () => {
    const json = command.data.toJSON();
    expect(json.name).toBe('charge-speed');
    const opt = json.options?.[0];
    expect(opt?.name).toBe('character');
    expect(opt?.required).toBeFalsy();
  });
});
