import {
  AttachmentBuilder,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../../types.js';
import { blablaPadlockPng } from '../../assets/blabla-padlock.js';

/**
 * Walk a member through making their NIKKE roster public on blablalink.com so
 * SHIFTYPAD (and therefore /nikke) can read it.
 *
 * The steps are a plain array so a non-developer can reword them without
 * touching the embed logic. The final step shows the padlock screenshot, which
 * is embedded in the bot (see ../../assets/blabla-padlock.ts) rather than
 * hotlinked, so it never breaks.
 */
const STEPS: string[] = [
  'Sign in to **[blablalink.com](https://www.blablalink.com/)**.',
  'Click your **profile icon** in the top-right.',
  'Click your **profile card**.',
  'Click the **padlock icon** in the top-right (highlighted below).',
  'Set **"In SHIFTYPAD, show my My Nikkes."** to **"Visible to All"**.',
];

const IMAGE_NAME = 'blabla-padlock.png';

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('unprivate-blabla')
    .setDescription(
      'How to make your NIKKE roster public on blablalink.com (for /nikke).'
    ),
  execute: async (interaction) => {
    const embed = new EmbedBuilder()
      .setColor(0xf472b6)
      .setTitle('Make your NIKKE roster public')
      .setDescription(
        'So SHIFTYPAD can read your Nikkes for `/nikke`, unprivate your ' +
          'roster on blablalink.com:\n\n' +
          STEPS.map((step, i) => `**${i + 1}.** ${step}`).join('\n')
      );

    // The screenshot ships with the bot; only attach it once real bytes exist
    // so the command still works if the asset hasn't been filled in yet.
    const files: AttachmentBuilder[] = [];
    if (blablaPadlockPng.length > 0) {
      files.push(new AttachmentBuilder(blablaPadlockPng, { name: IMAGE_NAME }));
      embed.setImage(`attachment://${IMAGE_NAME}`);
    }

    await interaction.reply({ embeds: [embed], files });
  },
};
