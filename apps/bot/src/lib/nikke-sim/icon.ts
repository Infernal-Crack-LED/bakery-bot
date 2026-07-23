import { readFileSync } from 'node:fs';
import { AttachmentBuilder } from 'discord.js';
import { Image } from '@napi-rs/canvas';

const ICON_NAME = 'nikkesim-icon.png';
const iconPng = readFileSync(
  new URL('../../assets/nikkesim-icon.png', import.meta.url)
);

export function iconAttachment(): AttachmentBuilder {
  return new AttachmentBuilder(iconPng, { name: ICON_NAME });
}

export const ICON_URL = `attachment://${ICON_NAME}`;

/** The nikkesim icon as a canvas-drawable Image (256×256, loaded once). */
const canvasIcon = new Image();
canvasIcon.src = iconPng;
export { canvasIcon as NS_ICON };
