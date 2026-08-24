// Prints the distinct Overload line labels from the live CDN option table
// (`equip/equip_option_table_v2-en.json` `description_localkey`) with their
// `state_effect_group_id`s — the exact strings the synced-roster route forwards
// to nikke-sim, which matches them against data/ol-lines.json `name` verbatim.
// Run it whenever the sim reports synced OL lines as unmapped, to see whether
// the game's labels drifted from the sim's pinned set.
//
//   npx tsx scripts/dump-overload-labels.ts
//
// Instrument of record for the 2026-08-23 label correction (nikke-sim
// docs/DECISIONS.md "Overload line names corrected to the game's real labels"):
// the sim's original "Increase …" names were invented, and every real synced
// line went unmapped until they were re-pinned to this script's output.
import { fetchOverloadLineIds } from '../packages/nikke/src/blablalink.js';

async function main(): Promise<void> {
  const lines = await fetchOverloadLineIds();
  const byLabel = new Map<string, number>();
  for (const line of lines) {
    if (!byLabel.has(line.description_localkey)) {
      byLabel.set(line.description_localkey, line.state_effect_group_id);
    }
  }
  for (const [label, groupId] of byLabel) {
    console.log(`${String(groupId).padStart(6)}  ${label}`);
  }
  console.log(
    `(${byLabel.size} distinct labels, ${lines.length} table entries)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
