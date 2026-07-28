import { readFileSync } from 'node:fs';
import { AttachmentBuilder } from 'discord.js';

const ICON_NAME = 'nikkesim-icon.png';
const iconPng = readFileSync(
  new URL('../../assets/nikkesim-icon.png', import.meta.url)
);

export function iconAttachment(): AttachmentBuilder {
  return new AttachmentBuilder(iconPng, { name: ICON_NAME });
}

export const ICON_URL = `attachment://${ICON_NAME}`;
