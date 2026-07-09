import { PermissionFlagsBits } from 'discord.js';

/**
 * The permissions Maiden needs when she's added to a server — the SINGLE SOURCE
 * OF TRUTH for the re-invite link and the install-settings sync.
 *
 * ⚠️ If you change this set, keep these in sync so new adds don't silently
 * regress (the bot joining without the right perms, or not joining at all):
 *   1. **Live app install settings** — run `npm run sync:install`
 *      (src/scripts/sync-install.ts PATCHes the app's Guild Install defaults from
 *      this constant). WITHOUT this, the App Directory "Add" button keeps
 *      granting the OLD permissions.
 *   2. **Setup docs** — the permission list in `docs/setup.md` §1 and the
 *      "1 · Permissions" field in `src/lib/setupGuide.ts`.
 *
 * Kept as named flags (not a magic number) so the set is self-documenting and
 * can't drift numerically.
 */
export const REQUIRED_PERMISSIONS = (
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.EmbedLinks |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.UseExternalEmojis
).toString();

/** OAuth2 URL that adds the bot as a real member with REQUIRED_PERMISSIONS. */
export function reinviteUrl(
  clientId = process.env.DISCORD_CLIENT_ID ?? ''
): string {
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${REQUIRED_PERMISSIONS}&scope=bot+applications.commands`;
}
