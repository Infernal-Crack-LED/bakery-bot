/**
 * Build helper: copy non-TypeScript assets (e.g. PNG icons) from `src/assets/`
 * into `dist/assets/`. `tsc` only emits compiled JS, so image files loaded at
 * runtime relative to `import.meta.url` (see `commands/utility/blabla.ts` and
 * `lib/nikke-sim/icon.ts`) would be missing from the deployed build otherwise.
 */
import { cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

cpSync(join(root, 'src', 'assets'), join(root, 'dist', 'assets'), {
  recursive: true,
  filter: (src) => !src.endsWith('.ts'),
});
