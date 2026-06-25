import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { db } from '../database.js';

const PAGE_SIZE = 10;

export const data = new SlashCommandBuilder()
  .setName('history')
  .setDescription("View a member's role change history")
  .addUserOption(opt =>
    opt.setName('user').setDescription('Member to look up (defaults to you)')
  )
  .addIntegerOption(opt =>
    opt.setName('page').setDescription('Page number').setMinValue(1)
  );

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const target = interaction.options.getUser('user') ?? interaction.user;
  const isOwnHistory = target.id === interaction.user.id;
  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);

  if (!isOwnHistory && !isAdmin) {
    return interaction.editReply({ content: 'You need the **Manage Server** permission to view another member\'s history.' });
  }

  const guildId = interaction.guild.id;
  const page = interaction.options.getInteger('page') ?? 1;
  const offset = (page - 1) * PAGE_SIZE;

  const [{ rows: countRows }, { rows }] = await Promise.all([
    db.query(
      `SELECT COUNT(*) FROM role_change_log WHERE user_id = $1 AND guild_id = $2`,
      [target.id, guildId]
    ),
    db.query(
      `SELECT id, change_type, roles_removed, roles_added, reason, changed_at
       FROM role_change_log
       WHERE user_id = $1 AND guild_id = $2
       ORDER BY changed_at DESC
       LIMIT $3 OFFSET $4`,
      [target.id, guildId, PAGE_SIZE, offset]
    ),
  ]);

  const total = parseInt(countRows[0].count);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  let member;
  try {
    member = await interaction.guild.members.fetch(target.id);
  } catch {
    member = { user: target };
  }

  const displayName = member.user.displayName ?? member.user.username;

  if (rows.length === 0) {
    return interaction.editReply({
      content: page > 1
        ? `No entries on page ${page}.`
        : `No role change history recorded for **${displayName}**.`,
    });
  }

  const lines = rows.map(row => {
    const ts = Math.floor(new Date(row.changed_at).getTime() / 1000);
    const removed = row.roles_removed?.map(id => `<@&${id}>`).join(', ') ?? '—';
    const added   = row.roles_added?.map(id => `<@&${id}>`).join(', ')   ?? '—';
    return [
      `**<t:${ts}:F>** · \`${row.change_type}\``,
      `  ➖ Removed: ${removed}`,
      `  ➕ Added: ${added}`,
      row.reason ? `  📋 ${row.reason}` : null,
    ].filter(Boolean).join('\n');
  });

  const embed = new EmbedBuilder()
    .setTitle(`📋 Role Change History — ${displayName}`)
    .setColor(0xEB459E)
    .setDescription(lines.join('\n\n'))
    .setFooter({ text: `${total} total entries · Page ${page} of ${totalPages}` })
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
