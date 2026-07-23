/**
 * Register bundled Roboto fonts with @napi-rs/canvas so infographics render
 * text on any platform (Railway Linux has no system fonts). Roboto is
 * Apache 2.0 licensed (googlefonts/roboto). Import this module once before
 * any canvas rendering — the renderers reference 'Roboto' by name.
 */
import { GlobalFonts } from '@napi-rs/canvas';

const dir = new URL('../../assets/', import.meta.url);
GlobalFonts.registerFromPath(
  new URL('Roboto-Regular.ttf', dir).pathname,
  'Roboto'
);
GlobalFonts.registerFromPath(
  new URL('Roboto-Bold.ttf', dir).pathname,
  'Roboto'
);
GlobalFonts.registerFromPath(
  new URL('Roboto-Medium.ttf', dir).pathname,
  'Roboto'
);
