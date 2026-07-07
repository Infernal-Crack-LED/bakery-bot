import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Per-guild configuration. One row per Discord server the bot is in.
 * Snowflake ids are stored as `text` because they exceed JS safe-integer range.
 */
export const guildConfig = pgTable('guild_config', {
  guildId: text('guild_id').primaryKey(),
  // Channel where moderation actions are logged.
  modLogChannelId: text('mod_log_channel_id'),
  // Channel where new members are welcomed.
  welcomeChannelId: text('welcome_channel_id'),
  // Deprecated: single news channel. Superseded by newsChannelIds; kept for
  // backfill/back-compat (see configuredNewsChannelIds).
  newsChannelId: text('news_channel_id'),
  // Channels the NIKKE news auto-timestamp watches (e.g. tweet feeds).
  newsChannelIds: jsonb('news_channel_ids').$type<string[]>(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Append-only audit log of privileged actions (e.g. /perms bulk edits).
 */
export const modActions = pgTable(
  'mod_actions',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    action: text('action').notNull(), // "ban" | "kick" | "timeout" | "purge" | ...
    targetId: text('target_id'),
    moderatorId: text('moderator_id').notNull(),
    reason: text('reason'),
    // Optional structured detail, e.g. purge count or timeout duration (ms).
    metadata: bigint('metadata', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    guildIdx: index('mod_actions_guild_idx').on(table.guildId),
  })
);

export type GuildConfig = typeof guildConfig.$inferSelect;
export type ModAction = typeof modActions.$inferSelect;
export type NewModAction = typeof modActions.$inferInsert;

/**
 * Feature requests submitted via /feature-request. Stored here and (when a
 * GitHub token is configured) mirrored to a GitHub issue.
 */
export const featureRequests = pgTable('feature_requests', {
  id: serial('id').primaryKey(),
  guildId: text('guild_id'),
  userId: text('user_id').notNull(),
  userTag: text('user_tag'),
  content: text('content').notNull(),
  githubIssueUrl: text('github_issue_url'),
  githubIssueNumber: integer('github_issue_number'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type FeatureRequest = typeof featureRequests.$inferSelect;
export type NewFeatureRequest = typeof featureRequests.$inferInsert;

// ─── NIKKE character data ───────────────────────────────────────────────────
// Aggregated from Tsareena's sheet + Prydwen + Nikke Synergy by the daily sync
// (see apps/bot/src/lib/nikke). These are game data, not Discord snowflakes, so
// normal column types are fine. The /nikke command reads ONLY these tables.

/** Structured tiers scraped from Prydwen's `.detailed-ratings.nikke`. */
export interface PrydwenTiers {
  story?: string;
  bossing?: string;
  pvp?: string;
}

/** Arena stats pulled from Nikke Synergy's public API (their "tier" source). */
export interface SynergyStats {
  season?: number;
  pickRate?: number;
  winRate?: number;
  players?: number;
}

/** Character info distilled from Tsareena's sheet. */
/** Per-character build guidance from Tsareena's "* Builds" tabs. */
export interface SheetBuild {
  skillLevels?: string; // e.g. "10/10/10"
  overloadGear?: string; // "Should you overload gear?" — "Yes" / "No"
  overloadLevelFive?: string; // "Should you level OL gear to 5?" — "Yes" / "No"
  levelDoll?: string; // "Should you level doll?" — "Yes" / "No"
  overloadMinimum?: string; // minimum OL rolls, e.g. "4x Element"
  overloadIdeal?: string; // ideal OL rolls, e.g. "4x Element · 4x Attack · 2x Ammo"
  cube?: string; // e.g. "Resilience / Destruction"
  endgameUses?: string; // e.g. "Story · Solo Raid · Union Raid · PvP"
  burstGen?: string; // "Burst Gen Auto (Manual)", e.g. "Low (Low)"
  pairWith?: string; // "Necessary Nikkes" — omitted when "none"
  notes?: string;
}

export interface SheetData {
  priority?: string; // e.g. "Highest Priority"
  annotations?: string[]; // e.g. ["T"], ["C"]
  build?: SheetBuild;
}

/**
 * Core profile attributes shown in Synergy's character header, translated to
 * English. Source: Synergy's `attack_damage_characters` table.
 */
export interface CharacterAttributes {
  weapon?: string; // "AR", "SG", "RL", …
  burst?: string; // "I" | "II" | "III" | "Λ"
  burstCooldown?: number; // seconds (Synergy stores frames = seconds × 60)
  class?: string; // "Attacker" | "Supporter" | "Defender"
  manufacturer?: string; // "Elysion" | "Missilis" | "Tetra" | "Pilgrim" | "Abnormal"
  element?: string; // "Fire" | "Water" | "Wind" | "Electric" | "Iron"
  rl3?: number; // Synergy's "3RL" stat (percent; from characters.speed_e)
  releaseDate?: string; // original release date, YYYY-MM-DD
}

/** Canonical character registry — one row per NIKKE, keyed by a stable slug. */
export const nikkeCharacters = pgTable('nikke_characters', {
  id: text('id').primaryKey(), // canonical slug, e.g. "anis-star"
  name: text('name').notNull(), // canonical English display name
  // Character portrait (hosted by Nikke Synergy); used as the embed thumbnail.
  imageUrl: text('image_url'),
  // Nicknames/abbreviations for search (from the sheet's aliases + an
  // auto-generated acronym). Lowercased; e.g. ["rrh"] for "Rapi: Red Hood".
  aliases: jsonb('aliases').$type<string[]>(),
  // Core attributes (best-effort; populated from Prydwen when available).
  rarity: text('rarity'),
  element: text('element'),
  charClass: text('char_class'),
  burst: text('burst'),
  weapon: text('weapon'),
  // Source keys + links.
  prydwenSlug: text('prydwen_slug'),
  prydwenUrl: text('prydwen_url'),
  synergyId: integer('synergy_id'),
  synergyUrl: text('synergy_url'),
  // Source payloads (flexible JSON so a source's shape can evolve).
  prydwenTiers: jsonb('prydwen_tiers').$type<PrydwenTiers>(),
  synergyStats: jsonb('synergy_stats').$type<SynergyStats>(),
  attributes: jsonb('attributes').$type<CharacterAttributes>(),
  sheetData: jsonb('sheet_data').$type<SheetData>(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Auto-maintained name dictionary. The sync rebuilds this from Nikke Synergy's
 * translations asset each run, mapping a source name (Japanese formal name or
 * arena shorthand, e.g. "スターアニス") to its English name ("Anis: Star").
 */
export const nikkeNameDictionary = pgTable('nikke_name_dictionary', {
  sourceKey: text('source_key').primaryKey(),
  english: text('english').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Audit log of sync runs — powers observability + the dashboard. */
export const nikkeSyncRuns = pgTable('nikke_sync_runs', {
  id: serial('id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull(), // "ok" | "partial" | "error"
  // Per-source counts, errors, and the unmatched list for humans to review.
  sources: jsonb('sources'),
});

export type NikkeCharacter = typeof nikkeCharacters.$inferSelect;
export type NewNikkeCharacter = typeof nikkeCharacters.$inferInsert;
export type NikkeNameDictionaryEntry = typeof nikkeNameDictionary.$inferSelect;
export type NikkeSyncRun = typeof nikkeSyncRuns.$inferSelect;
export type NewNikkeSyncRun = typeof nikkeSyncRuns.$inferInsert;

/**
 * Small key-value store for bot-wide state that isn't tied to a guild — e.g.
 * the last patch-notes version announced, so it's never posted twice.
 */
export const botMeta = pgTable('bot_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BotMeta = typeof botMeta.$inferSelect;
