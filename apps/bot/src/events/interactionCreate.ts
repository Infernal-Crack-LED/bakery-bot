import { Events, MessageFlags } from 'discord.js';
import { noteCommandsOnly, reinviteUrl } from '../lib/deadInstall.js';
import type { Event } from '../types.js';

export const event: Event<Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  execute: async (interaction) => {
    // Autocomplete requests are a separate interaction type — route them to the
    // command's optional `autocomplete` handler and stop.
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command?.autocomplete) {
        return;
      }
      try {
        await command.autocomplete(interaction);
      } catch (error) {
        console.error(
          `[interaction] autocomplete error in /${interaction.commandName}`,
          error
        );
      }
      return;
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      console.warn(`[interaction] unknown command: ${interaction.commandName}`);
      return;
    }

    // "Dead install": the command was authorized but the bot isn't a member of
    // this guild (commands-only add), so its gateway features silently do
    // nothing. We can only detect this when such a guild sends an interaction.
    const deadInstall =
      !!interaction.guildId &&
      !interaction.client.guilds.cache.has(interaction.guildId);

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(
        `[interaction] error in /${interaction.commandName}`,
        error
      );
      const payload = {
        content: 'Something went wrong running that command.',
        flags: MessageFlags.Ephemeral,
      } as const;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => null);
      } else {
        await interaction.reply(payload).catch(() => null);
      }
    }

    if (deadInstall && interaction.guildId) {
      await nudgeDeadInstall(interaction);
    }
  },
};

/**
 * Record a commands-only guild and, if not recently nudged, tell the user to
 * re-invite Maiden as a full member. Sent ephemerally so it doesn't clutter the
 * channel, and fail-soft so it never breaks the command.
 */
async function nudgeDeadInstall(
  interaction: import('discord.js').ChatInputCommandInteraction
): Promise<void> {
  try {
    const shouldNudge = await noteCommandsOnly(interaction.guildId!);
    if (!shouldNudge) {
      return;
    }
    const payload = {
      content:
        "⚠️ I'm only **partially installed** here — slash commands work, but I'm " +
        'not actually in this server, so news timestamps, quotes, welcomes, and ' +
        `announcements won't work. An admin can fix it by re-adding me:\n${reinviteUrl()}`,
      flags: MessageFlags.Ephemeral,
    } as const;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => null);
    } else {
      await interaction.reply(payload).catch(() => null);
    }
  } catch (error) {
    console.error('[interaction] dead-install nudge failed', error);
  }
}
