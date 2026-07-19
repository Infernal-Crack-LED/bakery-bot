/**
 * @app/nikke — shared NIKKE / blablalink integration, usable from any deployable
 * (bot, web, and future services). Keep everything here framework-agnostic and
 * free of app-specific or DB concerns so all consumers can import it.
 *
 * Currently exposes the authenticated blablalink user API (roster + character
 * detail reads by open id). Additional blablalink surfaces (the public CDN
 * client, parsers) can move here over time.
 */
export * from './blablalinkUser.js';
export * from './syncedLoadout.js';
