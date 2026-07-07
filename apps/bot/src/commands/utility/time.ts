import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  discordTimestamp,
  parseToEpochSeconds,
  parseUtcOffset,
  type DiscordTimeStyle,
} from '../../lib/discordTime.js';
import type { Command } from '../../types.js';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('time')
    .setDescription(
      "Convert a date/time into a timestamp that shows in everyone's local time."
    )
    .addStringOption((o) =>
      o
        .setName('when')
        .setDescription(
          "Date/time, e.g. '2025-07-06 20:00', '8pm', 'July 6 8:30pm'"
        )
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('offset')
        .setDescription('Your UTC offset, e.g. +9, -5, +5:30, or 0 for UTC')
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('style')
        .setDescription(
          'How the timestamp should look (default: Short Date/Time)'
        )
        .addChoices(
          { name: 'Short Time', value: 't' },
          { name: 'Long Time', value: 'T' },
          { name: 'Short Date', value: 'd' },
          { name: 'Long Date', value: 'D' },
          { name: 'Short Date/Time', value: 'f' },
          { name: 'Long Date/Time', value: 'F' },
          { name: 'Relative', value: 'R' }
        )
    ),
  execute: async (interaction) => {
    const when = interaction.options.getString('when', true);
    const offsetInput = interaction.options.getString('offset', true);
    const style = (interaction.options.getString('style') ??
      'f') as DiscordTimeStyle;

    let offsetMinutes: number;
    try {
      offsetMinutes = parseUtcOffset(offsetInput);
    } catch {
      await interaction.reply({
        content: "I couldn't read that offset — try +9, -5, +5:30, or 0.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const epochSeconds = parseToEpochSeconds(when, offsetMinutes);
    if (epochSeconds === null) {
      await interaction.reply({
        content:
          "I couldn't understand that date/time. Try something like '2025-07-06 20:00' or '8pm'.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const styled = discordTimestamp(epochSeconds, style);
    const relative = discordTimestamp(epochSeconds, 'R');

    await interaction.reply({
      content: `🕒 ${styled} (${relative})\nCopy: \`${styled}\``,
    });
  },
};
