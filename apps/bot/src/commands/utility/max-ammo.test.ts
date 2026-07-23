import { describe, expect, it } from 'vitest';
import { command } from './max-ammo.js';

describe('/max-ammo', () => {
  it('builds a command named "max-ammo" with a required character', () => {
    const json = command.data.toJSON();
    expect(json.name).toBe('max-ammo');
    const opt = json.options?.[0];
    expect(opt?.name).toBe('character');
    expect(opt?.required).toBe(true);
  });
});
