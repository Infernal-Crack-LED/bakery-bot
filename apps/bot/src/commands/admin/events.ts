import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { ensureAdmin } from '../../lib/admin.js';
import { diffProposal, renderProposalDiff } from '../../lib/gacha/diff.js';
import {
  applyProposal,
  decideRun,
  getRun,
  listGuildEvents,
  listPendingRuns,
} from '../../lib/gacha/store.js';
import type { Command } from '../../types.js';

/**
 * /events — operator-approve flow for LLM-ingested gacha events (F2 req 1:
 * a human reviews a DIFF before anything reaches the calendar).
 *
 * - pending          list proposals awaiting a decision
 * - show run:<id>    render the proposal as a diff vs the current calendar,
 *                    with low-confidence flags + double-run agreement
 * - approve run:<id> upsert the proposal into gacha_events + stamp the run
 * - reject run:<id>  stamp the run rejected; the calendar is untouched
 *
 * Decisions land on the `event_ingest_runs` audit row (status/decidedBy/
 * decidedAt), mirroring the nikkeSyncRuns pattern. Admin-gated like /sync.
 */
export const command: Command = {
  data: new SlashCommandBuilder()
    .setName('events')
    .setDescription(
      'Review and approve LLM-proposed gacha calendar events. Admin only.'
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('pending')
        .setDescription('List event proposals awaiting review.')
    )
    .addSubcommand((sub) =>
      sub
        .setName('show')
        .setDescription(
          'Show a proposal as a diff against the current calendar.'
        )
        .addIntegerOption((o) =>
          o
            .setName('run')
            .setDescription('Proposal id (from /events pending)')
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('approve')
        .setDescription('Approve a proposal — writes it to the calendar.')
        .addIntegerOption((o) =>
          o
            .setName('run')
            .setDescription('Proposal id (from /events pending)')
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('reject')
        .setDescription('Reject a proposal — the calendar stays untouched.')
        .addIntegerOption((o) =>
          o
            .setName('run')
            .setDescription('Proposal id (from /events pending)')
            .setRequired(true)
            .setMinValue(1)
        )
    ),
  execute: async (interaction) => {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'This command only works in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!(await ensureAdmin(interaction))) {
      return;
    }
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'pending') {
      const runs = await listPendingRuns(guildId);
      if (runs.length === 0) {
        await interaction.reply({
          content:
            'No proposals waiting for review. New ones appear here when an ' +
            'announcement in a watched news channel is parsed.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const lines = runs.map((run) => {
        const n = run.proposal?.length ?? 0;
        const agreement = run.diagnostics?.agreement ?? 'n/a';
        const link =
          run.sourceChannelId && run.sourceMessageId
            ? ` · [source](https://discord.com/channels/${run.guildId}/${run.sourceChannelId}/${run.sourceMessageId})`
            : '';
        return `**#${run.id}** — ${n} event(s), agreement **${agreement}**${link}`;
      });
      await interaction.reply({
        content: [
          `📋 **${runs.length} proposal(s) pending** — review with \`/events show\`:`,
          ...lines,
        ].join('\n'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // show / approve / reject all address one run.
    const runId = interaction.options.getInteger('run', true);
    const run = await getRun(guildId, runId);
    if (!run) {
      await interaction.reply({
        content: `❌ No proposal #${runId} in this server.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'show') {
      const diff = diffProposal(
        run.proposal ?? [],
        await listGuildEvents(guildId)
      );
      const statusNote =
        run.status === 'proposed'
          ? `Approve with \`/events approve run:${run.id}\` or reject with \`/events reject run:${run.id}\`.`
          : `_Already **${run.status}**${run.decidedBy ? ` by <@${run.decidedBy}>` : ''}._`;
      await interaction.reply({
        content: [
          `🔍 **Proposal #${run.id}** (${run.status})`,
          renderProposalDiff(diff, run.diagnostics),
          '',
          statusNote,
        ].join('\n'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // approve / reject: only an undecided proposal can be decided.
    if (run.status !== 'proposed') {
      await interaction.reply({
        content: `❌ Proposal #${run.id} is already **${run.status}** — nothing to do.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'approve') {
      const count = await applyProposal(run, interaction.user.id);
      await decideRun(run.id, 'approved', interaction.user.id);
      await interaction.reply({
        content:
          `✅ Approved proposal #${run.id} — **${count} event(s)** written to the calendar. ` +
          'View them with `/calendar`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'reject') {
      await decideRun(run.id, 'rejected', interaction.user.id);
      await interaction.reply({
        content: `🗑️ Rejected proposal #${run.id}. The calendar was not changed.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
