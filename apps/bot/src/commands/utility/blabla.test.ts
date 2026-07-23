import { describe, expect, it } from 'vitest';
import { command } from './blabla.js';

describe('/blabla', () => {
  it('builds a command named "blabla"', () => {
    expect(command.data.toJSON().name).toBe('blabla');
  });
});
