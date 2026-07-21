import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
  // Channel where approved gacha-event reminders are posted (see
  // apps/bot/src/lib/gacha/reminders.ts). Unset ⇒ reminders are off for this
  // guild — the reminder sweep is strictly opt-in per server.
  reminderChannelId: text('reminder_channel_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Append-only audit log of privileged actions (written via logModAction).
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

/**
 * Message ids already stamped with the NIKKE news auto-timestamp reply (see
 * apps/bot/src/events/messageCreate.ts). Durable so a bot restart between two
 * Discord edits of the same tweet (e.g. TweetShift's embed resolving in
 * several steps) can't re-post a duplicate reply — an in-memory Set alone
 * loses this bookkeeping on every restart.
 */
export const newsTimestampReplies = pgTable('news_timestamp_replies', {
  messageId: text('message_id').primaryKey(),
  guildId: text('guild_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type NewsTimestampReply = typeof newsTimestampReplies.$inferSelect;

// ─── NIKKE character data ───────────────────────────────────────────────────
// Aggregated from Tsareena's sheet + Prydwen + Nikke Synergy by the daily sync,
// plus one-time base stats from blablalink (see apps/bot/src/lib/nikke). These
// are game data, not Discord snowflakes, so normal column types are fine. The
// /nikke command reads ONLY these tables.

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
  normalAttackMultiplier?: number; // percent, e.g. 32.02
  coreAttackMultiplier?: number; // percent, e.g. 200
  ammo?: number; // magazine size
  reloadSeconds?: number; // in-game reload stat in seconds, e.g. 2.5
  // NOTE: skill prose is NO LONGER carried here. Skill text + per-level
  // coefficients now come from blablalink roledata and live in the
  // `skillDescriptions` / `skillLevels` columns below (single source of truth).
}

/**
 * Intrinsic base stats + dupe/level scaling, sourced ONCE per character from
 * blablalink's ShiftyPad game data (see apps/bot/src/lib/nikke/blablalink.ts).
 * These never change for a released unit, so the sync fetches them only for
 * characters that don't have them yet — see runNikkeSync.
 *
 * Level scaling isn't stored per-character (the synchro curve is shared across
 * the roster up to sub-0.01% rounding); the one shared multiplier lives in
 * `bot_meta` under NIKKE_LEVEL_MULTIPLIER_KEY. A consumer reconstructs a stat at
 * synchro level L (1-indexed), with `g` Limit Breaks and `c` Core levels, as:
 *   base = floor(atk * mult.attack[L-1] * (1 + g*grade.ratio/1e4) + g*grade.atk)
 *   stat = round(base * (1 + c*core.atk/1e4))
 * (the level-1 values below are `mult[0] === 1`). HP/DEF are analogous.
 */
export interface BaseStats {
  /** blablalink resource_id — the `nikke=<id>` slider param; the re-fetch key. */
  resourceId: number;
  // Level-1 base stats (before any Limit Break / Core / gear).
  atk: number;
  hp: number;
  def: number;
  critRate: number; // percent, e.g. 15
  critDamage: number; // percent, e.g. 150
  /** Highest synchro level present in the shared level curve (e.g. 1200). */
  maxLevel: number;
  /** Per-Limit-Break increment. `ratio` is basis points (200 = +2% per LB). */
  grade: { ratio: number; atk: number; hp: number; def: number };
  /** Per-Core-level increment, in basis points of the stat (200 = +2% / core). */
  core: { atk: number; hp: number; def: number };
}

/**
 * Per-level skill-coefficient arrays, sourced from blablalink roledata alongside
 * `baseStats` (see apps/bot/src/lib/nikke/blablalink.ts). Each inner array is one
 * placeholder's value across synchro levels 1..10 (index = level−1). The order of
 * arrays matches the order of `{description_value_NN}` placeholders in the raw
 * template, so `skill1[k]` is the array for `{description_value_(k+1)}`. The sim
 * reads these to substitute lower-level skill magnitudes; it never scales the
 * constant duration arrays (e.g. `[10,10,…]`), which are kept so indices line up.
 */
export interface SkillLevels {
  skill1: number[][]; // from skill1_detail
  skill2: number[][]; // from skill2_detail
  burst: number[][]; // from ulti_skill_detail
}

/**
 * Skill cooldowns in **seconds**, one per skill slot. Sourced from the NIKKE
 * community wiki (Fandom) because blablalink's roledata carries a cooldown for
 * the **burst** (`ulti_skill_detail.skill_cooltime`) but NOT for skills 1 & 2 —
 * the gap this fills. `null` means "no cooldown" (a passive skill, or the wiki's
 * `N/A`); a number is the fixed cooldown. Cooldowns do NOT scale with skill
 * level in NIKKE, so each is a single scalar (unlike `skillLevels`). `burst` is
 * carried too for a one-stop read; it can be cross-checked against blablalink's
 * roledata. Lives inside `skillDescriptions.cooldowns` (see below) — the same
 * JSON the sim already reads — not in its own column.
 */
export interface SkillCooldowns {
  skill1: number | null;
  skill2: number | null;
  burst: number | null;
}

/**
 * Skill prose (English), resolved from the same roledata skill-detail blocks with
 * every `{description_value_NN}` placeholder filled in at MAX LEVEL (index 9) and
 * blablalink's markup tags stripped. Resolving at level 10 keeps these numbers
 * equal to `skillLevels[*][*][9]` by construction, which is what the sim's
 * level-scaling matcher depends on. Supersedes Synergy's old skill_*_en prose.
 *
 * `cooldowns` is folded into this same object (from the Fandom wiki) so the sim,
 * which already reads `skill_descriptions`, gets skill cooldowns without a new
 * column. It's optional: null until the Fandom cooldown sync fills it, and the
 * roledata backfill that writes skill1/2/burst leaves it untouched.
 */
export interface SkillDescriptions {
  skill1: string; // from skill1_detail
  skill2: string; // from skill2_detail
  burst: string; // from ulti_skill_detail
  cooldowns?: SkillCooldowns; // seconds per slot (null = passive); from Fandom
}

// ─── blablalink roledata snapshot (verbatim game-source fields) ─────────────
// The columns below store curated fields straight from blablalink's roledata —
// the game's OWN data. Because they come from the source, they SUPERSEDE the
// values distilled from Synergy/Prydwen/the sheet (which overlap: rarity, class,
// element, manufacturer, crit, dupe/core scaling, burst tier, skill text).
//
// NOTE on naming: unlike the rest of the schema, these interfaces keep
// blablalink's raw snake_case field names verbatim (and its raw integer scaling,
// e.g. critical_ratio 1500 = 15%). That's deliberate — they're a faithful
// snapshot of the source, so a field maps 1:1 and the projector is a plain pick.
// TODO(source-dedup): once consumers read these, strip the now-redundant fields
// from the non-blablalink sources (see the sync + memory note).

/** blablalink `shot_detail` — the weapon/firing model (timing, ammo, charge). */
export interface RoleShotDetail {
  id: number;
  name_localkey: string;
  description_localkey: string;
  camera_work: string;
  weapon_type: string; // "SR" | "AR" | "SG" | "MG" | "RL" | "SMG"
  attack_type: string;
  counter_enermy: string; // (blablalink's spelling)
  prefer_target: string;
  prefer_target_condition: string;
  shot_timing: string;
  fire_type: string;
  input_type: string;
  is_targeting: boolean;
  damage: number; // ×100 (6904 = 69.04% of ATK per shot)
  shot_count: number;
  muzzle_count: number;
  multi_target_count: number;
  center_shot_count: number;
  max_ammo: number;
  maintain_fire_stance: number;
  uptype_fire_timing: number;
  reload_time: number;
  reload_bullet: number;
  reload_start_ammo: number;
  rate_of_fire_reset_time: number;
  rate_of_fire: number;
  end_rate_of_fire: number;
  rate_of_fire_change_pershot: number;
  burst_energy_pershot: number;
  target_burst_energy_pershot: number;
  spot_first_delay: number;
  spot_last_delay: number;
  start_accuracy_circle_scale: number;
  end_accuracy_circle_scale: number;
  accuracy_change_pershot: number;
  accuracy_change_speed: number;
  auto_start_accuracy_circle_scale: number;
  auto_end_accuracy_circle_scale: number;
  auto_accuracy_change_pershot: number;
  auto_accuracy_change_speed: number;
  zoom_rate: number;
  multi_aim_range: number;
  spot_projectile_speed: number;
  charge_time: number; // ×100 (100 = 1.00 sec)
  full_charge_damage: number; // ×100 (25000 = 250%)
  full_charge_burst_energy: number;
  spot_radius_object: number;
  spot_radius: number;
  spot_explosion_range: number;
  core_damage_rate: number; // ×100 (20000 = 200%)
  penetration: number;
  use_function_id_list: number[];
  hurt_function_id_list: number[];
  shake_id: number;
  ShakeType: string;
  ShakeWeight: number;
}

/** One entry of blablalink `element_details`. */
export interface RoleElementDetail {
  id: number;
  element: string; // "Water" | "Fire" | "Wind" | "Electric" | "Iron"
  group_id: number;
  weak_element_id: number;
  element_name_localekey: string; // (blablalink's spelling)
  element_code_name_localekey: string;
  element_desc_localekey: string;
  element_icon: string;
}

/** blablalink `piece_detail` — the Limit-Break "Spare Body" item. */
export interface RolePieceDetail {
  id: number;
  inventory_filter: string[];
  order: number;
  name_localkey: string;
  description_localkey: string;
  resource_id: number;
  item_type: string;
  item_sub_type: string;
  item_rare: string;
  corporation: string;
  class: string;
  use_type: string;
  use_id: number;
  use_value: number;
  use_limit_count: boolean;
  stack_max: number;
}

/** One placeholder's per-level values inside a skill-detail's value list. */
export interface RoleSkillValueEntry {
  description_value?: string[];
}

/** blablalink `skill1_detail` / `skill2_detail` — a passive skill block. */
export interface RoleSkillDetail {
  id: number;
  group_id: number;
  skill_level: number;
  next_level_id: number;
  level_up_cost_id: number;
  icon: string;
  name_localkey: string;
  description_localkey: string;
  info_description_localkey: string;
  description_value_list: RoleSkillValueEntry[];
}

/** blablalink `ulti_skill_detail` — the burst skill block (richer than passives). */
export interface RoleUltiSkillDetail {
  id: number;
  skill_cooltime: number;
  attack_type: string;
  counter_type: string;
  prefer_target: string;
  prefer_target_condition: string;
  skill_type: string;
  skill_value_data: Array<{ skill_value_type: string; skill_value: number }>;
  duration_type: string;
  duration_value: number;
  before_use_function_id_list: number[];
  before_hurt_function_id_list: number[];
  after_use_function_id_list: number[];
  after_hurt_function_id_list: number[];
  resource_name: string;
  icon: string;
  shake_id: number;
  group_id: number;
  skill_level: number;
  next_level_id: number;
  level_up_cost_id: number;
  name_localkey: string;
  description_localkey: string;
  info_description_localkey: string;
  description_value_list: RoleSkillValueEntry[];
  skill_cooltime_list: number[];
}

/** blablalink `stat_enhance_detail` — per-Limit-Break + per-Core stat scaling. */
export interface RoleStatEnhanceDetail {
  id: number;
  grade_ratio: number;
  grade_hp: number;
  grade_attack: number;
  grade_defence: number;
  grade_energy_resist: number;
  grade_metal_resist: number;
  grade_bio_resist: number;
  core_hp: number;
  core_attack: number;
  core_defence: number;
  core_energy_resist: number;
  core_metal_resist: number;
  core_bio_resist: number;
}

// ── The 7 grouped columns (see the column definitions on nikke_characters) ──
// Fields are optional: a column is null until the roledata fetch runs, and a
// partial/older feed may omit a field. Consumers should null-check.

/** `role_weapon`: firing model + the range window bonus damage applies in. */
export interface RoleWeapon {
  shot_id?: number;
  bonusrange_min?: number;
  bonusrange_max?: number;
  shot_detail?: RoleShotDetail;
}

/** `role_burst_meta`: burst-gauge behaviour (tier, step change, delay, window). */
export interface RoleBurstMeta {
  use_burst_skill?: string; // "Step1" | "Step2" | "Step3" (= Burst I/II/III)
  change_burst_step?: string; // e.g. "StepFull"
  burst_apply_delay?: number;
  burst_duration?: number;
}

/** `role_skill_details`: the three full skill blocks + their id/table refs. */
export interface RoleSkillDetails {
  ulti_skill_id?: number;
  skill1_id?: number;
  skill1_table?: string;
  skill2_id?: number;
  skill2_table?: string;
  skill1_detail?: RoleSkillDetail;
  skill2_detail?: RoleSkillDetail;
  ulti_skill_detail?: RoleUltiSkillDetail;
}

/** `role_stat_scaling`: dupe/core scaling table + its id refs. */
export interface RoleStatScaling {
  grade_core_id?: number;
  grow_grade?: number;
  stat_enhance_id?: number;
  stat_enhance_detail?: RoleStatEnhanceDetail;
}

/** `role_element`: the unit's element id(s) + the element detail block(s). */
export interface RoleElementInfo {
  element_id?: number[];
  element_details?: RoleElementDetail[];
}

/** `role_piece`: the Limit-Break Spare-Body item. */
export interface RolePiece {
  piece_id?: number;
  piece_detail?: RolePieceDetail;
}

/** `role_meta`: identity + classification scalars (verbatim from roledata). */
export interface RoleMeta {
  id?: number; // blablalink internal id (e.g. 235201), NOT our slug
  name_localkey?: string;
  resource_id?: number;
  name_code?: number;
  order?: number; // roster display order
  original_rare?: string; // "SSR" | "SR" | "R"
  class?: string; // "Attacker" | "Supporter" | "Defender"
  corporation?: string; // "ELYSION" | "MISSILIS" | "TETRA" | "PILGRIM" | "ABNORMAL"
  critical_ratio?: number; // ×100 (1500 = 15%)
  critical_damage?: number; // ×100 (15000 = 150%)
  eff_category_type?: string;
  eff_category_value?: number;
  category_type_1?: string;
  category_type_2?: string;
  category_type_3?: string;
}

/** Canonical character registry — one row per NIKKE, keyed by a stable slug. */
export const nikkeCharacters = pgTable('nikke_characters', {
  id: text('id').primaryKey(), // canonical slug, e.g. "anis-star"
  name: text('name').notNull(), // canonical English display name
  // Character portrait, used as the embed thumbnail. Set to the high-res
  // blablalink portrait (derived from baseStats.resourceId in the sync); falls
  // back to the Nikke Synergy portrait until a character's resource_id is known.
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
  // Intrinsic base stats + dupe scaling from blablalink; fetched once (null until
  // the sync first matches this character to its blablalink resource_id).
  baseStats: jsonb('base_stats').$type<BaseStats>(),
  // Per-level skill coefficients + resolved skill prose, both from the SAME
  // blablalink roledata fetch that fills base_stats. blablalink is the single
  // source of truth for skills (skill text no longer comes from Synergy). Null
  // until that character's roledata has been fetched.
  skillLevels: jsonb('skill_levels').$type<SkillLevels>(),
  // Resolved skill prose + (folded in) skill cooldowns — see SkillDescriptions.
  skillDescriptions: jsonb('skill_descriptions').$type<SkillDescriptions>(),
  // For Treasure (Favorite-Item) units only: the blablalink Favorite Item id
  // (favorite_item_tid) whose per-level skill data was folded into skill_levels /
  // skill_descriptions above, replacing the plain roledata kit. Doubles as the
  // "already synced" marker so the Favorite-Item sync stays fetch-only-new. Null
  // for non-Treasure units (see syncFavoriteItemSkills in the bot's sync).
  favoriteItemId: integer('favorite_item_id'),
  // Curated blablalink roledata snapshot, grouped by concern (see the Role*
  // interfaces above). Straight from the game's data, so these SUPERSEDE the
  // overlapping Synergy/Prydwen/sheet-derived columns. All populated in the same
  // one-time roledata fetch as base_stats; null until that fetch runs.
  roleWeapon: jsonb('role_weapon').$type<RoleWeapon>(),
  roleBurstMeta: jsonb('role_burst_meta').$type<RoleBurstMeta>(),
  roleSkillDetails: jsonb('role_skill_details').$type<RoleSkillDetails>(),
  roleStatScaling: jsonb('role_stat_scaling').$type<RoleStatScaling>(),
  roleElement: jsonb('role_element').$type<RoleElementInfo>(),
  rolePiece: jsonb('role_piece').$type<RolePiece>(),
  roleMeta: jsonb('role_meta').$type<RoleMeta>(),
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
 * `bot_meta` key holding the shared synchro-level stat multiplier, written once
 * by the NIKKE sync (see blablalink.ts). Value is JSON:
 *   { attack: number[]; hp: number[]; def: number[] }  // ratio to level 1, index = level-1
 * Combined with a character's `baseStats` to reconstruct stats at any level.
 */
export const NIKKE_LEVEL_MULTIPLIER_KEY = 'nikke_level_multiplier';

/** Shape stored (JSON-encoded) in the NIKKE_LEVEL_MULTIPLIER_KEY bot_meta row. */
export interface NikkeLevelMultiplier {
  attack: number[];
  hp: number[];
  def: number[];
}

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

// ─── Gacha event calendar (LLM-ingested from the official site) ────────────
// The global official-site check (apps/bot/src/lib/gacha/officialSite.ts) reads
// each new nikke-en.com patch notice with a LOCAL LLM, extracts its schedulable
// events, and auto-populates `gacha_events` for the servers that track NIKKE
// news. There is no human approval step — the official notice is the source of
// truth.

/** The valid gacha event categories an extracted event may use. */
export type GachaEventType = 'banner' | 'event' | 'maintenance';

/**
 * One event as parsed + validated from a patch notice. Produced by the extract
 * pipeline (apps/bot/src/lib/gacha/ingest.ts) and upserted into `gacha_events`.
 * `flags` carries low-confidence markers (e.g. "no-end", "midnight-start",
 * "characters-scrubbed") surfaced in logs.
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

/** Diagnostics from an extraction run — surfaced in logs. */
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
 * The event calendar — the table the calendar/reminder features read. Rows are
 * written by the official-site auto-apply (store.applyEventsToGuild); one row
 * per (guild, type, name) so a re-read of the same patch upserts instead of
 * duplicating.
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
    // Low-confidence flags carried over from extraction.
    flags: jsonb('flags').$type<string[]>(),
    // Provenance: the CMS content id of the official article this came from.
    sourceContentId: text('source_content_id'),
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
    // Idempotent apply: re-reading the same event updates it in place.
    guildTypeNameUnique: uniqueIndex('gacha_events_guild_type_name_unique').on(
      table.guildId,
      table.type,
      table.name
    ),
  })
);

export type GachaEvent = typeof gachaEvents.$inferSelect;
export type NewGachaEvent = typeof gachaEvents.$inferInsert;

// ─── Official-site patch TLDRs (GLOBAL, LLM-summarized) ────────────────────
// A tweet landing in the OFFICIAL community server's news channel triggers ONE
// global check of nikke-en.com (see lib/gacha/officialSite.ts). Each new
// article is summarized ONCE — three LLM passes reconciled for accuracy — and
// stored here keyed by the CMS `content_id`. This table is deliberately
// guild-LESS: the source is the single official feed, so the summary is
// computed once per patch, not once per server (the extracted events it also
// produces DO land per-guild, in `gacha_events`, via applyEventsToGuild).

/**
 * The condensed patch summary the 3-pass extractor produces. Intentionally
 * date-light: the only time that matters is when the patch goes live.
 */
export interface PatchTldr {
  /** When the patch went live, as stated in the notice (e.g. "July 2, 2026"); null if unstated. */
  patchLiveDate: string | null;
  /** Brand-new playable characters added this patch (from the "New Nikkes" section). */
  newCharacters: string[];
  /** Characters returning on a rerun banner. */
  rerunCharacters: string[];
  /** New premium pass name, or null if none this patch. */
  passName: string | null;
  /** Costume/skin obtained from that pass, or null. */
  passCostume: string | null;
  /** Costume/skin featured in the new costume gacha, or null if none. */
  costumeGachaCostume: string | null;
  /** Returning costumes/skins (the "Limited Costume Rerun" section). */
  rerunSkins: string[];
  /** Whether a Union Raid runs in this patch. */
  unionRaid: boolean;
  /** Whether a Solo Raid runs in this patch. */
  soloRaid: boolean;
  /** Whether a Coordinated Operation (co-op boss) runs in this patch. */
  coop: boolean;
}

/**
 * Cross-pass diagnostics for a TLDR extraction — the accuracy signal. "agree"
 * means every pass produced the same summary (high confidence); "partial"
 * means the passes disagreed on at least one field (review before trusting).
 */
export interface TldrDiagnostics {
  /** How many of the passes produced a usable object. */
  passes: number;
  /** "agree" | "partial" | "single-run" | null (no usable passes). */
  agreement: string | null;
  errors: string[];
}

/**
 * One official-site patch summary. Guild-less; one row per CMS `content_id`
 * (the dedup key that guarantees each article is summarized exactly once).
 */
export const nikkePatchUpdates = pgTable('nikke_patch_updates', {
  id: serial('id').primaryKey(),
  // CMS content_id — the global dedup key so each article is summarized once.
  contentId: text('content_id').notNull().unique(),
  title: text('title').notNull(),
  // Article publish time from the feed (pub_timestamp).
  publishedAt: timestamp('published_at', { withTimezone: true }),
  // The reconciled 3-pass summary + the accuracy diagnostics.
  tldr: jsonb('tldr').$type<PatchTldr>().notNull(),
  diagnostics: jsonb('diagnostics').$type<TldrDiagnostics>(),
  sourceUrl: text('source_url'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type NikkePatchUpdate = typeof nikkePatchUpdates.$inferSelect;
export type NewNikkePatchUpdate = typeof nikkePatchUpdates.$inferInsert;

/**
 * NIKKE-sim saved teams. One row per (Discord user, team name). `code` is the
 * opaque build-code from nikke-sim (`src/share/build-code.ts`) — the full team
 * + loadout + boss globals, base64url-encoded. Saved from the sim site (Discord
 * OAuth) and listed/loaded by the site and the `/myteams` bot command.
 */
export const userTeams = pgTable(
  'user_teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    discordId: text('discord_id').notNull(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('user_teams_discord_id_idx').on(t.discordId),
    uniqueIndex('user_teams_discord_id_name_uq').on(t.discordId, t.name),
  ]
);

export type UserTeam = typeof userTeams.$inferSelect;
export type NewUserTeam = typeof userTeams.$inferInsert;

/**
 * NIKKE-sim saved profiles — a generic, kind-tagged store for reusable save
 * data. One row per (Discord user, kind, name). `kind` discriminates the payload
 * shape so the same table serves many features: 'include'/'exclude' Nikke lists
 * today, positioned team/roster builds later. `code` is an opaque base64url
 * blob the sim encodes/decodes per kind (see nikke-sim web/src/auth.ts) — the DB
 * never interprets it, so new kinds (e.g. teams that remember order/location)
 * need no schema change.
 */
export const userProfiles = pgTable(
  'user_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    discordId: text('discord_id').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('user_profiles_discord_id_idx').on(t.discordId),
    uniqueIndex('user_profiles_discord_id_kind_name_uq').on(
      t.discordId,
      t.kind,
      t.name
    ),
  ]
);

export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;

/**
 * Persisted NIKKE roster snapshots, keyed by the account's blablalink open id
 * (NOT the Discord user — one person may own several NIKKE accounts, so the open
 * id the caller supplies is the identity). Written by the web app's roster sync
 * (apps/web .../api/blabla-roster) so the sim can read a roster across sessions
 * without a live blablalink fetch; a "force resync" overwrites the row.
 *
 * `characters` is the GetUserCharacters summary list (always present).
 * `details` is the heavier per-character GetUserCharacterDetails payload, stored
 * only when a sync fetched it (nullable so a list-only sync doesn't wipe it).
 */
export interface RosterCharacter {
  name_code: number;
  combat: number;
  lv: number;
  grade: number;
  core: number;
  costume_id: number;
}

export const nikkeRosters = pgTable('nikke_rosters', {
  openId: text('open_id').primaryKey(),
  areaId: integer('area_id').notNull(),
  characters: jsonb('characters').$type<RosterCharacter[]>().notNull(),
  details: jsonb('details').$type<unknown[]>(),
  // Normalized, sim-ready per-unit loadouts derived from `details` (see
  // @app/nikke syncedLoadout). Opaque to the DB — the sim consumes it. Present
  // only when a sync fetched details. `syncLevel` is the account synchro level.
  syncedLoadouts: jsonb('synced_loadouts').$type<unknown[]>(),
  syncLevel: integer('sync_level'),
  syncedAt: timestamp('synced_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type NikkeRoster = typeof nikkeRosters.$inferSelect;
export type NewNikkeRoster = typeof nikkeRosters.$inferInsert;

/**
 * Discord user ↔ NIKKE account (open id) links, so a user's account persists
 * across sessions and they never re-enter an open id. The account most recently
 * synced is auto-linked as the user's *current* account (`current = true`);
 * switching to a different open id flips the previous row to `current = false`,
 * so the table doubles as a historical record of every account a user has used.
 * One-to-many (a user may have used several accounts over time), but at most one
 * is current — enforced by the partial unique index below. `label` is an
 * optional user-facing name ("main", "alt"). The roster snapshot itself lives in
 * nikke_rosters, keyed by open id; join on open_id for each account's last sync.
 */
export const nikkeAccountLinks = pgTable(
  'nikke_account_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    discordId: text('discord_id').notNull(),
    openId: text('open_id').notNull(),
    label: text('label'),
    // The active account is the single row with current=true; a superseded
    // account stays as a row with current=false (the historical record).
    current: boolean('current').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('nikke_account_links_discord_id_idx').on(t.discordId),
    uniqueIndex('nikke_account_links_discord_open_uq').on(
      t.discordId,
      t.openId
    ),
    // At most one current account per Discord user.
    uniqueIndex('nikke_account_links_one_current_uq')
      .on(t.discordId)
      .where(sql`${t.current}`),
  ]
);

export type NikkeAccountLink = typeof nikkeAccountLinks.$inferSelect;
export type NewNikkeAccountLink = typeof nikkeAccountLinks.$inferInsert;
