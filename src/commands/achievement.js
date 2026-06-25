import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { db } from '../database.js';
import { getAchievementsForGuild } from '../services/achievementService.js';

export const data = new SlashCommandBuilder()
  .setName('achievement')
  .setDescription('Manage custom achievements')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(sub =>
    sub.setName('create')
      .setDescription('Create a custom achievement')
      .addStringOption(opt =>
        opt.setName('name').setDescription('Achievement name').setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('description').setDescription('What earns this achievement').setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('type').setDescription('Trigger type').setRequired(true)
          .addChoices(
            { name: 'Message milestone',        value: 'message_milestone' },
            { name: 'Voice milestone (minutes)', value: 'voice_milestone' },
            { name: 'Streak (days)',             value: 'streak' },
            { name: 'Manual (admin awards)',     value: 'custom' },
          )
      )
      .addNumberOption(opt =>
        opt.setName('threshold').setDescription('Value required to earn (not needed for manual type)')
      )
      .addStringOption(opt =>
        opt.setName('emoji').setDescription('Emoji icon (default: 🏆)')
      )
  )
  .addSubcommand(sub =>
    sub.setName('delete')
      .setDescription('Delete a custom achievement by ID')
      .addIntegerOption(opt =>
        opt.setName('id').setDescription('Achievement ID (find with /achievement list)').setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('list')
      .setDescription('List all achievements including custom ones')
  );

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const guildId = interaction.guild.id;
  const sub = interaction.options.getSubcommand();

  if (sub === 'create') {
    const name = interaction.options.getString('name');
    const description = interaction.options.getString('description');
    const type = interaction.options.getString('type');
    const threshold = interaction.options.getNumber('threshold') ?? null;
    const emoji = interaction.options.getString('emoji') ?? '🏆';

    if (type !== 'custom' && threshold === null) {
      return interaction.editReply('A threshold is required for non-manual achievement types.');
    }

    const { rows } = await db.query(
      `INSERT INTO achievements (guild_id, name, description, emoji, type, threshold)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [guildId, name, description, emoji, type, threshold]
    );

    await interaction.editReply(`✅ Achievement **${name}** created with ID \`${rows[0].id}\`.`);

  } else if (sub === 'delete') {
    const id = interaction.options.getInteger('id');
    const { rowCount } = await db.query(
      `DELETE FROM achievements WHERE id = $1 AND guild_id = $2`,
      [id, guildId]
    );

    if (rowCount === 0) {
      return interaction.editReply(`No custom achievement found with ID \`${id}\` in this server.`);
    }
    await interaction.editReply(`✅ Achievement \`${id}\` deleted.`);

  } else if (sub === 'list') {
    const all = await getAchievementsForGuild(guildId);
    const lines = all.map(a => {
      const scope = a.guild_id ? '*(custom)*' : '*(built-in)*';
      const thresh = a.threshold != null ? ` · threshold: ${a.threshold}` : '';
      return `\`${String(a.id).padStart(3)}\` ${a.emoji} **${a.name}** ${scope} — ${a.type}${thresh}`;
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🏆 All Achievements')
          .setColor(0xFEE75C)
          .setDescription(lines.join('\n') || 'No achievements found.'),
      ],
    });
  }
}
