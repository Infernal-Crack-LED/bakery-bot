import { describe, expect, it } from 'vitest';
import { command } from './teams.js';

describe('/teams', () => {
  it('builds a command named "teams" with an optional name option', () => {
    const json = command.data.toJSON();
    expect(json.name).toBe('teams');
    const opt = json.options?.[0];
    expect(opt?.name).toBe('name');
    expect(opt?.required).toBeFalsy();
  });
});
