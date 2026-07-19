// Discord user ↔ NIKKE account (open id) links, so users don't re-enter their
// open id each session. The most recently used account is the user's *current*
// one; switching demotes the prior row to current=false, keeping it as history.
// See the nikkeAccountLinks table in @app/db.

import {
  db,
  nikkeAccountLinks,
  nikkeRosters,
  type NikkeAccountLink,
} from '@app/db';
import { and, desc, eq, ne } from 'drizzle-orm';

/** A linked account plus its roster's last-sync time (null if never synced). */
export interface LinkedAccount {
  id: string;
  openId: string;
  label: string | null;
  current: boolean;
  createdAt: Date;
  updatedAt: Date;
  syncedAt: Date | null;
}

/** A user's accounts — current first, then most-recently-used — with sync time. */
export function listLinkedAccounts(
  discordId: string
): Promise<LinkedAccount[]> {
  return db
    .select({
      id: nikkeAccountLinks.id,
      openId: nikkeAccountLinks.openId,
      label: nikkeAccountLinks.label,
      current: nikkeAccountLinks.current,
      createdAt: nikkeAccountLinks.createdAt,
      updatedAt: nikkeAccountLinks.updatedAt,
      syncedAt: nikkeRosters.syncedAt,
    })
    .from(nikkeAccountLinks)
    .leftJoin(nikkeRosters, eq(nikkeAccountLinks.openId, nikkeRosters.openId))
    .where(eq(nikkeAccountLinks.discordId, discordId))
    .orderBy(
      desc(nikkeAccountLinks.current),
      desc(nikkeAccountLinks.updatedAt)
    );
}

/**
 * Make `openId` the user's current account, demoting any other current link to
 * history (current=false). Idempotent and cheap on the hot path: if the given
 * open id is already current (and no new label), it does nothing. Safe to call
 * on every authenticated roster read. `label` undefined ⇒ leave any existing
 * label untouched.
 */
export async function setCurrentAccount(
  discordId: string,
  openId: string,
  label?: string | null
): Promise<void> {
  // Fast path: already the current account and no label change → no write.
  const [cur] = await db
    .select({ openId: nikkeAccountLinks.openId })
    .from(nikkeAccountLinks)
    .where(
      and(
        eq(nikkeAccountLinks.discordId, discordId),
        eq(nikkeAccountLinks.current, true)
      )
    )
    .limit(1);
  if (cur?.openId === openId && label === undefined) {
    return;
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    // Demote whatever else is current (keeps it as a historical row).
    await tx
      .update(nikkeAccountLinks)
      .set({ current: false, updatedAt: now })
      .where(
        and(
          eq(nikkeAccountLinks.discordId, discordId),
          eq(nikkeAccountLinks.current, true),
          ne(nikkeAccountLinks.openId, openId)
        )
      );
    // Promote (or first-time link) this account as current.
    await tx
      .insert(nikkeAccountLinks)
      .values({ discordId, openId, label: label ?? null, current: true })
      .onConflictDoUpdate({
        target: [nikkeAccountLinks.discordId, nikkeAccountLinks.openId],
        set: {
          current: true,
          updatedAt: now,
          ...(label !== undefined ? { label } : {}),
        },
      });
  });
}

/** Remove a link entirely (drops it from history too). */
export async function unlinkAccount(
  discordId: string,
  openId: string
): Promise<void> {
  await db
    .delete(nikkeAccountLinks)
    .where(
      and(
        eq(nikkeAccountLinks.discordId, discordId),
        eq(nikkeAccountLinks.openId, openId)
      )
    );
}

export type { NikkeAccountLink };
