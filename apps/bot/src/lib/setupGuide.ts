import { EmbedBuilder } from 'discord.js';

/**
 * Discord-formatted version of the server setup guide, DM'd by `/setup-guide`.
 * Mirrors docs/setup.md — keep the two roughly in sync when either changes.
 * (An embed reads far better in a DM than the raw markdown, whose headings and
 * tables don't render in Discord.)
 */
export function buildSetupGuideEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf472b6)
    .setTitle('Setting Maiden up in your server')
    .setDescription(
      "Everything to do after adding me. Two steps matter; the rest is optional or automatic — and it's all done in Discord.\n\n" +
        "**If you only read one thing:** I can't post in a **locked channel** (news feeds, announcements) unless you explicitly let me. If you set something up and nothing ever appears, that's almost always why — see step 1."
    )
    .addFields(
      {
        name: '1 · Permissions (mostly automatic)',
        value:
          'Adding me creates a **Maiden** role that already has what I need — View ' +
          'Channels, Send Messages, Embed Links, Read Message History. In normal ' +
          "channels there's nothing to do.",
      },
      {
        name: '⚠️ Locked / announcement channels',
        value:
          'News & announcement channels block *everyone* from posting — me included. For each channel I should post in (news, announcements, welcome), open **Edit Channel → Permissions**, add the **Maiden** role, and enable **View Channel**, **Send Messages**, **Embed Links**.\n' +
          'Skip this and news stamps silently never appear.',
      },
      {
        name: '2 · Turn on features — /config',
        value:
          'Admin-only. Run `/config show` to review. Pick what you want:\n' +
          '• **News stamps** — `/config news #channel` (repeat to add; `remove:true` to stop)\n' +
          '• **Welcome** — `/config welcome #channel`\n' +
          '• **Mod-log** — `/config modlog #channel`\n' +
          '• **Quotes** — `/config quotes emoji:⭐ threshold:3` → view with `/quotes @user`',
      },
      {
        name: '3 · NIKKE data (automatic)',
        value:
          '`/nikke`, `/time`, and the guides work right away; data refreshes daily & after updates. Force a refresh with `/sync`.',
      },
      {
        name: "4 · Check it's working",
        value:
          '• `/nikke rapi` → a profile card\n' +
          '• `/config show` → your settings\n' +
          '• Post `Event 7/9 5:00 ~ 7/30 4:59 (UTC+9)` in a watched channel → I reply with a 🕒 stamp',
      },
      {
        name: 'Not working?',
        value:
          "• **News stamps never appear** → I can't Send Messages there (fix the locked-channel perms in step 1)\n" +
          '• **A command is missing right after inviting** → global commands can take ~1h the first time\n' +
          "• **`/perms` won't change things** → I need **Manage Roles**, above the role I'm editing",
      }
    )
    .setFooter({
      text: 'Full guide on GitHub: Infernal-Crack-LED/bakery-bot → docs/setup.md',
    });
}
