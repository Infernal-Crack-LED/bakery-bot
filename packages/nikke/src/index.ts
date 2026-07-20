/**
 * @app/nikke — shared NIKKE / blablalink integration, usable from any deployable
 * (bot, web, and future services). Keep everything here framework-agnostic and
 * free of app-specific concerns (no discord.js, no Next.js) so all consumers can
 * import it. It may depend on @app/db (the shared kernel) for shared types.
 *
 *  - blablalink        the public game-data CDN client (roster, roledata,
 *                      portraits, equip/overload/cube tables, parsers)
 *  - blablalinkUser    the authenticated user API (roster + detail by open id)
 *  - favoriteItems     the Favorite Item (Treasure) resolver
 *  - syncedLoadout     normalize GetUserCharacterDetails → the sim's loadout
 *  - fandom            the community-wiki client for skill cooldowns
 *  - names             pure name-normalization helpers
 */
export * from './blablalink.js';
export * from './blablalinkUser.js';
export * from './favoriteItems.js';
export * from './syncedLoadout.js';
export * from './fandom.js';
export * from './names.js';
