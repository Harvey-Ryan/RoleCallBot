import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { db, getGuildConfig, invalidateConfig } from '../database.js';

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Configure RoleCallBot for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(sub =>
    sub.setName('view').setDescription('View current configuration')
  )
  .addSubcommand(sub =>
    sub.setName('inactivity-days')
      .setDescription('Days without activity before roles are changed')
      .addIntegerOption(opt =>
        opt.setName('days').setDescription('Number of days (default: 30)').setRequired(true).setMinValue(1).setMaxValue(365)
      )
  )
  .addSubcommand(sub =>
    sub.setName('active-role')
      .setDescription('Role removed when a member goes inactive')
      .addRoleOption(opt =>
        opt.setName('role').setDescription('Role to remove').setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('inactive-role')
      .setDescription('Role assigned when a member goes inactive')
      .addRoleOption(opt =>
        opt.setName('role').setDescription('Role to assign').setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('achievements-channel')
      .setDescription('Channel where achievement notifications are posted')
      .addChannelOption(opt =>
        opt.setName('channel').setDescription('Channel').setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('leaderboard-channel')
      .setDescription('Channel where the leaderboard auto-posts')
      .addChannelOption(opt =>
        opt.setName('channel').setDescription('Channel').setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('leaderboard-schedule')
      .setDescription('How often the leaderboard auto-posts')
      .addStringOption(opt =>
        opt.setName('schedule').setDescription('Frequency').setRequired(true)
          .addChoices(
            { name: 'Daily',             value: 'daily' },
            { name: 'Weekly (Mondays)',  value: 'weekly' },
          )
      )
  )
  .addSubcommand(sub =>
    sub.setName('message-weight')
      .setDescription('Points awarded per message (default: 1)')
      .addNumberOption(opt =>
        opt.setName('weight').setDescription('Points per message').setRequired(true).setMinValue(0)
      )
  )
  .addSubcommand(sub =>
    sub.setName('voice-weight')
      .setDescription('Points awarded per voice minute (default: 2)')
      .addNumberOption(opt =>
        opt.setName('weight').setDescription('Points per minute').setRequired(true).setMinValue(0)
      )
  );

const COLUMN_MAP = {
  'inactivity-days':       { col: 'inactivity_days',         getValue: i => i.options.getInteger('days') },
  'active-role':           { col: 'active_role_id',           getValue: i => i.options.getRole('role').id },
  'inactive-role':         { col: 'inactive_role_id',         getValue: i => i.options.getRole('role').id },
  'achievements-channel':  { col: 'achievements_channel_id',  getValue: i => i.options.getChannel('channel').id },
  'leaderboard-channel':   { col: 'leaderboard_channel_id',   getValue: i => i.options.getChannel('channel').id },
  'leaderboard-schedule':  { col: 'leaderboard_schedule',     getValue: i => i.options.getString('schedule') },
  'message-weight':        { col: 'message_weight',           getValue: i => i.options.getNumber('weight') },
  'voice-weight':          { col: 'voice_weight',             getValue: i => i.options.getNumber('weight') },
};

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const guildId = interaction.guild.id;
  const sub = interaction.options.getSubcommand();

  if (sub === 'view') {
    const config = await getGuildConfig(guildId);

    const fmt = {
      activeRole:   config.active_role_id          ? `<@&${config.active_role_id}>`         : '*(not set)*',
      inactiveRole: config.inactive_role_id         ? `<@&${config.inactive_role_id}>`       : '*(not set)*',
      achChannel:   config.achievements_channel_id  ? `<#${config.achievements_channel_id}>` : '*(not set)*',
      lbChannel:    config.leaderboard_channel_id   ? `<#${config.leaderboard_channel_id}>`  : '*(not set)*',
    };

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('⚙️ Server Configuration')
          .setColor(0x5865F2)
          .addFields(
            { name: 'Inactivity Threshold', value: `${config.inactivity_days} days`,    inline: true },
            { name: 'Active Role (removed)', value: fmt.activeRole,                      inline: true },
            { name: 'Inactive Role (assigned)', value: fmt.inactiveRole,                 inline: true },
            { name: 'Achievements Channel', value: fmt.achChannel,                       inline: true },
            { name: 'Leaderboard Channel',  value: fmt.lbChannel,                        inline: true },
            { name: 'Leaderboard Schedule', value: config.leaderboard_schedule,          inline: true },
            { name: 'Message Weight',       value: `${config.message_weight} pt/msg`,    inline: true },
            { name: 'Voice Weight',         value: `${config.voice_weight} pt/min`,      inline: true },
          ),
      ],
    });
  }

  const mapping = COLUMN_MAP[sub];
  const value = mapping.getValue(interaction);

  await db.query(
    `UPDATE guild_config SET ${mapping.col} = $1, updated_at = NOW() WHERE guild_id = $2`,
    [value, guildId]
  );

  invalidateConfig(guildId);
  await interaction.editReply(`✅ **${sub}** updated successfully.`);
}
