import { db, nikkeCharacters } from '@app/db';
import { eq, ilike } from 'drizzle-orm';
import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types.js';
import {
  brandEmbed,
  cardReply,
  BOT_COLOR,
} from '../../lib/nikkesim/card-reply.js';
import { tableCardImage, type CardImage } from '../../lib/nikkesim/client.js';
import { respondNikkeNameAutocomplete } from '../../lib/nikke/nameCache.js';

async function findCharacter(query: string) {
  const direct =
    (await db.query.nikkeCharacters.findFirst({
      where: eq(nikkeCharacters.id, query),
    })) ??
    (await db.query.nikkeCharacters.findFirst({
      where: ilike(nikkeCharacters.name, query),
    })) ??
    (await db.query.nikkeCharacters.findFirst({
      where: ilike(nikkeCharacters.name, `%${query}%`),
    }));
  if (direct) {
    return direct;
  }
  const q = query.trim().toLowerCase();
  const all = await db.query.nikkeCharacters.findMany();
  return all.find((c) => (c.aliases ?? []).some((a) => a.includes(q)));
}

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('charge-speed')
    .setDescription('Charge-speed breakpoints per OL line count.')
    .addStringOption((o) =>
      o
        .setName('character')
        .setDescription('Character name (autocomplete)')
        .setRequired(false)
        .setAutocomplete(true)
    ),
  autocomplete: respondNikkeNameAutocomplete,
  execute: async (interaction) => {
    const query = interaction.options.getString('character');
    // Deferred on both paths. The generic table is normally a pre-rendered URL,
    // but a manifest miss falls back to an on-demand render whose bytes we then
    // upload — that can outlast the 3s Discord gives an initial response, and
    // blowing that deadline loses the whole reply rather than just delaying it.
    await interaction.deferReply();

    if (!query) {
      // Generic (1.0s) table — the pre-rendered manifest image.
      let card: CardImage;
      try {
        card = await tableCardImage('charge-speed');
      } catch {
        await interaction.editReply(
          'Could not fetch the charge-speed table from nikkesim.app \u2014 try again later.'
        );
        return;
      }
      const embed = brandEmbed(new EmbedBuilder(), BOT_COLOR, {
        name: 'Full calculator on nikkesim.app',
        url: 'https://www.nikkesim.app/charge',
      }).setDescription(
        'Use `/charge-speed character:<name>` for unit-specific breakpoints.'
      );
      await interaction.editReply(
        await cardReply(embed, card, 'charge-speed-table.png')
      );
      return;
    }

    const character = await findCharacter(query);
    if (!character) {
      await interaction.editReply(
        `Couldn't find a NIKKE matching **${query}**.`
      );
      return;
    }

    const weapon = character.attributes?.weapon;
    const chargeTime = character.roleWeapon?.shot_detail?.charge_time;

    if (
      !chargeTime ||
      chargeTime <= 0 ||
      (weapon !== 'SR' && weapon !== 'RL')
    ) {
      await interaction.editReply({
        content:
          weapon === 'SR' || weapon === 'RL'
            ? `${character.name}: no charge data synced.`
            : `${character.name} (${weapon ?? '??'}) is not a charge weapon.`,
      });
      return;
    }

    // The DB character id IS the nikkesim slug — the API renders the table
    // server-side from the same data. The two sides still drift (a NIKKE
    // released since nikke-sim's last deploy is unknown there), so surface the
    // API's reason instead of posting an embed with a silently blank image.
    let card: CardImage;
    try {
      card = await tableCardImage('charge-speed', { unit: character.id });
    } catch (err) {
      await interaction.editReply(
        `Couldn't render the Charge Speed table for **${character.name}** — ${
          err instanceof Error ? err.message : 'nikkesim.app is unavailable'
        }.\n**[Full calculator on nikkesim.app](https://www.nikkesim.app/charge)**`
      );
      return;
    }
    const embed = brandEmbed(new EmbedBuilder(), BOT_COLOR, {
      name: 'Full calculator on nikkesim.app',
      url: 'https://www.nikkesim.app/charge',
    });
    await interaction.editReply(
      await cardReply(embed, card, 'charge-speed-table.png')
    );
  },
};
