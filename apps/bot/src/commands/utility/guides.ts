import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';

/**
 * Curated NIKKE community links.
 *
 * To add or remove a guide, edit this array — nothing else needs to change.
 * Each entry becomes a clickable `[label](url)` link in the embed.
 */
const GUIDES: { label: string; url: string; description: string }[] = [
  {
    label: "Tsareena's NIKKE Build Guide",
    url: 'https://docs.google.com/spreadsheets/d/16EECdnWsdbfeJ_r1KKG0vIhpdeagAbMOjy6xKsSTvh4/edit?gid=0#gid=0',
    description: 'Community build sheet',
  },
  {
    label: 'NIKKE Synergy',
    url: 'https://nikke-synergy.com/lp_en',
    description: 'PVP/PVE strategy & teams',
  },
  {
    label: 'Enikk App',
    url: 'https://enikk.app/',
    description: 'Raid usage history',
  },
  {
    label: 'NIKKE Deck',
    url: 'https://nikke-deck.com/en',
    description: 'PVP team builder',
  },
  {
    label: 'Prydwen',
    url: 'https://www.prydwen.gg/nikke',
    description: 'General guides',
  },
];

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('guides')
    .setDescription(
      'Post a curated list of NIKKE guides & community resources.'
    ),
  execute: async (interaction) => {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('NIKKE Guides & Resources')
      .setDescription(
        GUIDES.map(
          (guide) => `**[${guide.label}](${guide.url})** — ${guide.description}`
        ).join('\n')
      );

    await interaction.reply({ embeds: [embed] });
  },
};
