import { botMeta, db } from '@app/db';
import { type Client, EmbedBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';

/**
 * Patch notes for Maiden.
 *
 * ─── To announce a release ───────────────────────────────────────────────
 * Add a NEW entry to the TOP of the list below with a new `version`, then
 * deploy. When the bot restarts, it posts that entry to the patch-notes
 * channel (`PATCH_NOTES_CHANNEL_ID`) exactly once — the version is remembered
 * in the database, so redeploys/restarts never post it again. Deploys that
 * don't add a new top entry post nothing.
 *
 * `version` just has to be unique (e.g. "v1.2.0"). `notes` are bullet points;
 * Discord markdown works (`**bold**`, `/commands`, links).
 */
export interface PatchNote {
  version: string;
  title?: string;
  notes: string[];
}

export const PATCH_NOTES: PatchNote[] = [
  {
    version: 'v1.0.0',
    title: 'Maiden is here! 🧁',
    notes: [
      '**`/nikke <name>`** — look up any NIKKE (nicknames like `rrh` work too) and get it all in one embed: a profile at a glance (weapon, burst + cooldown, class, manufacturer, element), **Prydwen** Story/Bossing/PvP tiers, **Nikke Synergy** arena pick & win rates, and **Tsareena’s** builds + pull priority — with links back to every source.',
      '**`/time`** — turn any event time into a Discord timestamp everyone sees in their own timezone.',
      '**Automatic news timestamps** — an admin picks channels with `/config news`, and Maiden adds a local-time stamp to game-news posts so nobody has to do timezone math.',
      '**Quick links** — `/guides`, plus `/build-guide`, `/pvp-teams-guide`, `/raid-usage`, `/pvp-team-builder`, and `/prydwen`.',
      '**Handy extras** — `/help`, `/feature-request`, `/unprivate-blabla`, `/github`, and the usual `/serverinfo` · `/userinfo` · `/ping`.',
      '**For admins** — `/config` (news / welcome / mod-log channels), `/sync` to refresh data, and `/perms` for safe bulk permission edits.',
      'Thanks for adding Maiden — feedback and ideas are always welcome via `/feature-request`! 💖',
    ],
  },
];

const STATE_KEY = 'last_patch_notes_version';

/** The embed for a single patch-notes entry. */
export function buildPatchNotesEmbed(note: PatchNote): EmbedBuilder {
  const heading = note.title ? `${note.version} — ${note.title}` : note.version;
  const body = note.notes.map((n) => `• ${n}`).join('\n');
  return new EmbedBuilder()
    .setColor(0xf472b6)
    .setTitle(`📝 Patch Notes · ${heading}`.slice(0, 256))
    .setDescription(body.slice(0, 4096) || '—');
}

/**
 * Post the newest patch note to `PATCH_NOTES_CHANNEL_ID` if it hasn't been
 * posted yet. Called once at startup; fail-soft.
 */
export async function postPatchNotesIfNew(client: Client): Promise<void> {
  const channelId = process.env.PATCH_NOTES_CHANNEL_ID;
  const latest = PATCH_NOTES[0];
  if (!channelId || !latest) {
    return;
  }

  const last = await db.query.botMeta.findFirst({
    where: eq(botMeta.key, STATE_KEY),
  });
  if (last?.value === latest.version) {
    return; // already announced
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) {
    console.warn(`[patchnotes] channel ${channelId} not found or not sendable`);
    return;
  }

  await channel.send({ embeds: [buildPatchNotesEmbed(latest)] });
  await db
    .insert(botMeta)
    .values({ key: STATE_KEY, value: latest.version })
    .onConflictDoUpdate({
      target: botMeta.key,
      set: { value: latest.version, updatedAt: new Date() },
    });
  console.log(`[patchnotes] posted ${latest.version}`);
}
