import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';

/**
 * Factory for a "single link" slash command — it just posts one clickable
 * resource link in an embed. Several NIKKE resources each get their own command
 * (e.g. /prydwen, /raid-usage) so members can pull up one quickly; /guides still
 * lists them all together.
 *
 * To add another, create a one-line command file that calls this — see the
 * commands next to it for the shape.
 */
export interface LinkCommandSpec {
  name: string; // slash command name, e.g. "raid-usage"
  description: string; // shown in Discord's command picker
  label: string; // the resource's display name
  url: string;
  note: string; // short blurb after the link
}

export function makeLinkCommand(spec: LinkCommandSpec): Command {
  return {
    data: new SlashCommandBuilder()
      .setName(spec.name)
      .setDescription(spec.description),
    execute: async (interaction) => {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(spec.label)
        .setDescription(`**[${spec.label}](${spec.url})** — ${spec.note}`);
      await interaction.reply({ embeds: [embed] });
    },
  };
}
