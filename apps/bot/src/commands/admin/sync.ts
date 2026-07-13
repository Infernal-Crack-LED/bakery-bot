import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { ensureAdmin } from '../../lib/admin.js';
import { runNikkeSync } from '../../lib/nikke/sync.js';
import type { Command } from '../../types.js';

/**
 * /sync — manually refresh NIKKE data (the same job the daily cron runs):
 * Synergy API (characters, arena stats, attributes, dictionary) + Tsareena's
 * sheet, reconciled with the committed Prydwen tier cache. Admin only.
 *
 * (Prydwen's live tiers are refreshed separately/offline with
 * `npm run refresh:prydwen`, since its CDN blocks datacenter IPs.)
 */
export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('sync')
    .setDescription(
      'Refresh NIKKE data now (Synergy + Tsareena sheet + Prydwen cache). Admin only.'
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  execute: async (interaction) => {
    if (!(await ensureAdmin(interaction))) {
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const where = interaction.guild
      ? `${interaction.guild.name} (${interaction.guildId})`
      : 'DM';
    const trigger = `command: ${where} by ${interaction.user?.tag ?? 'unknown'}`;

    try {
      const summary = await runNikkeSync(trigger);
      const u = summary.unmatched;
      const lines = [
        `✅ Sync **${summary.status}** — ${summary.characters} characters, ` +
          `${summary.prydwenTiers} Prydwen tiers, ${summary.dictionaryEntries} dictionary entries` +
          `${summary.baseStatsFetched ? `, ${summary.baseStatsFetched} base-stat fetches` : ''}` +
          `${summary.portraits ? `, ${summary.portraits} portraits` : ''}` +
          `.`,
        `Unmatched — sheet ${u.sheet}, arena ${u.arenaStats}, untranslated ${u.untranslated}.`,
      ];
      if (summary.errors.length) {
        lines.push(
          `⚠️ ${summary.errors.length} source error(s): ${summary.errors.join('; ').slice(0, 500)}`
        );
      }
      await interaction.editReply({ content: lines.join('\n') });
    } catch (error) {
      await interaction.editReply({
        content: `❌ Sync failed: ${(error as Error).message}`,
      });
    }
  },
};
