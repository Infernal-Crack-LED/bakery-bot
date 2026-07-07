import { defineConfig } from 'vitest/config';

// Unit tests for the bot. Tests live next to the code they cover as
// `<name>.test.ts`. Run them with `npm test` (from the repo root) or
// `npm run test:watch` (in apps/bot) while you work.
export default defineConfig({
  test: {
    // We import { describe, it, expect } from "vitest" explicitly in each test,
    // so no global types are needed and the build config can ignore test files.
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
