/**
 * Manually trigger the NIKKE data sync.
 *
 *   npm run sync:nikke        (from the repo root)
 *
 * Requires DATABASE_URL to be set. The bot also runs this same sync daily on a
 * schedule, so you normally only need this for a first load or an on-demand
 * refresh after a source updates.
 */
import '../loadEnv.js';
import { runNikkeSync } from '../lib/nikke/sync.js';

runNikkeSync('cli')
  .then((summary) => {
    console.log('[sync:nikke] done:', JSON.stringify(summary, null, 2));
    process.exit(summary.status === 'error' ? 1 : 0);
  })
  .catch((error) => {
    console.error('[sync:nikke] failed', error);
    process.exit(1);
  });
