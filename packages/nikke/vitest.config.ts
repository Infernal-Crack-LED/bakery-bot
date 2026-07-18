import { defineConfig } from 'vitest/config';

// Unit tests for the shared NIKKE package. Tests live next to the code they
// cover as `<name>.test.ts`. Run from the repo root with `npm test`, or
// `npm run test:watch` in packages/nikke while you work.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
