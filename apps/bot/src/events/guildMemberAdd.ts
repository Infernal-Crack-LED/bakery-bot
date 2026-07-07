import { EmbedBuilder, Events } from 'discord.js';
import { getGuildConfig } from '../lib/guildConfig.js';
import type { Event } from '../types.js';

export const event: Event<Events.GuildMemberAdd> = {
  name: Events.GuildMemberAdd,
  execute: async (member) => {
    const cfg = await getGuildConfig(member.guild.id);
    if (!cfg?.welcomeChannelId) {
      return;
    }

    const channel = await member.guild.channels
      .fetch(cfg.welcomeChannelId)
      .catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) {
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`Welcome to ${member.guild.name}!`)
      .setDescription(`Welcome, ${member}! Make yourself at home.`)
      .setThumbnail(member.user.displayAvatarURL())
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => null);
  },
};
