import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
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
  // Quote-saver: the emoji members react with to save a message as a quote, and
  // how many such reactions a message needs. No emoji set ⇒ the feature is off.
  // The emoji is stored as the admin typed it (e.g. "⭐" or "<:MaidenCopium:123>").
  quoteEmoji: text('quote_emoji'),
  quoteThreshold: integer('quote_threshold'),
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

/**
 * Saved quotes. A message becomes a quote once it collects enough of the guild's
 * configured quote emoji (see guildConfig.quoteEmoji / quoteThreshold). Stored
 * under the message's author so `/quotes @user` can list them.
 */
export const quotes = pgTable(
  'quotes',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    // The quoted message, so we can link back to it and never store it twice.
    channelId: text('channel_id').notNull(),
    messageId: text('message_id').notNull(),
    // Whose quote it is (the message author) + a display tag captured at save
    // time, so it still renders if they later leave the server.
    userId: text('user_id').notNull(),
    authorTag: text('author_tag'),
    content: text('content').notNull(),
    // Who tipped the message over the threshold (the last reactor).
    addedBy: text('added_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    guildUserIdx: index('quotes_guild_user_idx').on(
      table.guildId,
      table.userId
    ),
    // One quote per message — makes storing idempotent (onConflictDoNothing).
    messageUnique: uniqueIndex('quotes_message_unique').on(table.messageId),
  })
);

export type Quote = typeof quotes.$inferSelect;
export type NewQuote = typeof quotes.$inferInsert;

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
  // What triggered this run: "cron" | "startup" | "cli" | a /sync label with the
  // server name + id (e.g. "command: Maiden (1523…) by user#0").
  trigger: text('trigger'),
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

/**
 * Servers Maiden is in — one row per guild, so you can see how many servers
 * have the bot and track joins/leaves over time. Maintained by the
 * guildCreate/guildDelete events plus a reconcile at startup. `leftAt` is null
 * while the bot is currently in that server, and set when it's removed;
 * `joinedAt` is preserved across a re-add.
 */
export const guilds = pgTable('guilds', {
  id: text('id').primaryKey(), // guild snowflake
  name: text('name'),
  memberCount: integer('member_count'),
  joinedAt: timestamp('joined_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  leftAt: timestamp('left_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type GuildRow = typeof guilds.$inferSelect;
export type NewGuildRow = typeof guilds.$inferInsert;

/**
 * "Dead installs" — guilds where Maiden was authorized for slash commands only
 * (no `bot` scope), so the bot isn't a member and gateway features don't work.
 * These are invisible to the guild list; we only learn of one when it sends an
 * interaction. Recorded here so you have the ids, and to throttle the re-invite
 * nudge (see events/interactionCreate.ts).
 */
export const commandsOnlyGuilds = pgTable('commands_only_guilds', {
  guildId: text('guild_id').primaryKey(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastNudgedAt: timestamp('last_nudged_at', { withTimezone: true }),
});

export type CommandsOnlyGuild = typeof commandsOnlyGuilds.$inferSelect;

// ─── Gacha event calendar (LLM-ingested, operator-approved) ────────────────
// Announcements in the watched news channels are parsed by a LOCAL LLM into
// proposed events. Nothing lands in `gacha_events` until an admin reviews the
// proposal diff and explicitly approves it (see apps/bot/src/lib/gacha +
// /events). `event_ingest_runs` mirrors the `nikke_sync_runs` audit pattern.

/** The valid gacha event categories a proposal may use. */
export type GachaEventType = 'banner' | 'event' | 'maintenance';

/**
 * One proposed event as parsed + validated from an announcement. Stored on the
 * ingest run (jsonb) until approved; on approval it is upserted into
 * `gacha_events`. `flags` carries low-confidence markers for the approval view
 * (e.g. "no-end", "midnight-start", "run-disagreement", "characters-scrubbed").
 */
export interface ProposedGachaEvent {
  name: string;
  type: GachaEventType;
  /** ISO 8601 with offset (e.g. "2026-07-02T18:00:00+09:00"), or null. */
  start: string | null;
  end: string | null;
  characters: string[];
  notes: string;
  flags: string[];
}

/** Diagnostics recorded on each ingest run — powers the approval view. */
export interface IngestDiagnostics {
  /** One entry per LLM pass (the pipeline double-runs the model). */
  runs: Array<{
    valid: boolean;
    repaired: boolean;
    salvage: string[];
    events: number;
    confidence: number | null;
  }>;
  /** Cross-run agreement: "agree" | "partial" | "single-run" | null (no runs). */
  agreement: string | null;
  errors: string[];
  /** First few hundred chars of the source text, for the review view. */
  sourceExcerpt?: string;
}

/**
 * Approved calendar entries — the ONLY table the calendar/reminder features
 * read. Rows are written exclusively by the /events approve flow (never by the
 * LLM pipeline directly). One row per (guild, type, name) so re-approving an
 * updated announcement upserts instead of duplicating.
 */
export const gachaEvents = pgTable(
  'gacha_events',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(), // GachaEventType
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    // Rate-up / featured character names (banners only; scrubbed elsewhere).
    characters: jsonb('characters').$type<string[]>(),
    notes: text('notes'),
    // Low-confidence flags carried over from the approved proposal.
    flags: jsonb('flags').$type<string[]>(),
    // Provenance: which announcement + ingest run produced this row, and who
    // approved it (Discord user id — snowflake, so text).
    sourceMessageId: text('source_message_id'),
    sourceChannelId: text('source_channel_id'),
    ingestRunId: integer('ingest_run_id'),
    approvedBy: text('approved_by'),
    // Reminder bookkeeping: set when the start/end reminder has been posted,
    // so a reminder is never sent twice.
    startReminderSentAt: timestamp('start_reminder_sent_at', {
      withTimezone: true,
    }),
    endReminderSentAt: timestamp('end_reminder_sent_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    guildStartIdx: index('gacha_events_guild_start_idx').on(
      table.guildId,
      table.startsAt
    ),
    // Idempotent approval: re-approving the same event updates it in place.
    guildTypeNameUnique: uniqueIndex('gacha_events_guild_type_name_unique').on(
      table.guildId,
      table.type,
      table.name
    ),
  })
);

export type GachaEvent = typeof gachaEvents.$inferSelect;
export type NewGachaEvent = typeof gachaEvents.$inferInsert;

/**
 * Audit log of announcement-ingest runs (mirrors `nikke_sync_runs`). A run is
 * created with status "proposed" (or "error") by the parse pipeline; an admin
 * decision moves it to "approved" / "rejected" and stamps who/when.
 */
export const eventIngestRuns = pgTable(
  'event_ingest_runs',
  {
    id: serial('id').primaryKey(),
    guildId: text('guild_id').notNull(),
    sourceMessageId: text('source_message_id'),
    sourceChannelId: text('source_channel_id'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status').notNull(), // "proposed" | "approved" | "rejected" | "error"
    // What triggered the run: "news" (auto from a watched channel) or a
    // command label like "command: Maiden (152…) by user#0".
    trigger: text('trigger'),
    proposal: jsonb('proposal').$type<ProposedGachaEvent[]>(),
    diagnostics: jsonb('diagnostics').$type<IngestDiagnostics>(),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => ({
    guildIdx: index('event_ingest_runs_guild_idx').on(table.guildId),
    messageIdx: index('event_ingest_runs_message_idx').on(
      table.sourceMessageId
    ),
  })
);

export type EventIngestRun = typeof eventIngestRuns.$inferSelect;
export type NewEventIngestRun = typeof eventIngestRuns.$inferInsert;
