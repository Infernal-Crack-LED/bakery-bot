/**
 * How a nikkesim.app card gets into a reply: as a plain ATTACHMENT above the
 * embed, never as the embed's own image.
 *
 * WHY (owner, 2026-08-13 — "when the image is inside the embed, it loads too
 * small and looks bad"): Discord caps an embed's image at the embed column's
 * width, which is much narrower than the message body, so a dense infographic
 * — a 900px chart, a 1040px roster card — renders shrunken and unreadable. An
 * attachment gets the full message width and its own lightbox. Discord also
 * renders a message's attachments ABOVE its embeds, so uploading the card and
 * leaving the embed unreferenced puts the picture first and the embed under it
 * as a caption. That ordering is the whole layout: do not call setImage() with
 * a card again.
 *
 * COST: an attachment needs BYTES, so a card that came back as a manifest URL
 * (client.ts's fast path — a hot URL Discord's proxy already holds) is fetched
 * here and uploaded with the message. That is one extra server-side GET and
 * ~100–300 KB per invocation, in exchange for the card being on screen, at
 * full size, the moment the reply lands.
 */
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { iconAttachment, ICON_URL } from './icon.js';
import { fetchImageAttachment, type CardImage } from './client.js';

/** nikkesim.app's own accent, the stripe on /dps, /teams and /roster. */
export const NIKKESIM_COLOR = 0x5b9dff;
/** The bot's house pink, the stripe on the calculator commands. */
export const BOT_COLOR = 0xf472b6;

/**
 * The nikkesim.app mark as the embed's AUTHOR line — the smallest icon slot
 * Discord offers (a ~24px circle beside one line of text), replacing the 80px
 * `setThumbnail` block. The card above already carries the full-size mark in
 * its top-right corner, so a second large logo in the embed is a duplicate.
 *
 * `color` is per-command and deliberately NOT unified here: the commands split
 * blue/pink before this existed, and the ruling that moved the image out of the
 * embed said nothing about recolouring five of them. Unifying them is a
 * separate, owner-visible change.
 */
export function brandEmbed(
  embed: EmbedBuilder,
  color: number = NIKKESIM_COLOR
): EmbedBuilder {
  return embed.setColor(color).setAuthor({
    name: 'nikkesim.app',
    iconURL: ICON_URL,
    url: 'https://www.nikkesim.app',
  });
}

/** Bytes for a card, whichever path it arrived on. */
async function cardAttachment(
  card: CardImage,
  name: string
): Promise<AttachmentBuilder> {
  // Already uploaded bytes (client.ts's dynamicCard path) — reuse them rather
  // than re-fetching an `attachment://` url, which is not fetchable at all.
  return card.file ?? (await fetchImageAttachment(card.url, name));
}

/**
 * Assemble a card reply: the card as a standalone attachment, the embed below
 * it, and the icon the embed's author line references.
 *
 * `card` is nullable because several commands treat the picture as optional
 * (the FAQ in /doll stands alone). And if the bytes can't be fetched, the embed
 * falls back to carrying the URL as its image — a small card beats no card, and
 * this is the only path that still does it.
 */
export async function cardReply(
  embed: EmbedBuilder,
  card: CardImage | null | undefined,
  name: string
): Promise<{ embeds: EmbedBuilder[]; files: AttachmentBuilder[] }> {
  const files: AttachmentBuilder[] = [];
  if (card) {
    try {
      files.push(await cardAttachment(card, name));
    } catch (err) {
      // "unavailable", not "upload failed": what threw is the server-side GET
      // in fetchImageAttachment — the upload has not been attempted yet.
      console.warn(
        `[nikkesim] ${name}: card bytes unavailable, embedding the url:`,
        err
      );
      embed.setImage(card.url);
    }
  }
  files.push(iconAttachment());
  return { embeds: [embed], files };
}
