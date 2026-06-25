import { SlashCommandBuilder } from 'discord.js';
import { db, getGuildConfig } from '../database.js';
import { buildStatsEmbed } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('View activity stats')
  .addUserOption(opt =>
    opt.setName('user').setDescription('Member to look up (defaults to you)')
  );

export async function execute(interaction) {
  await interaction.deferReply();

  const target = interaction.options.getUser('user') ?? interaction.user;
  const guildId = interaction.guild.id;
  const config = await getGuildConfig(guildId);

  const [{ rows: activityRows }, { rows: achRows }] = await Promise.all([
    db.query(
      `SELECT *, (message_count * $3 + voice_minutes * $4) AS score
       FROM user_activity WHERE user_id = $1 AND guild_id = $2`,
      [target.id, guildId, config.message_weight, config.voice_weight]
    ),
    db.query(
      `SELECT COUNT(*) FROM user_achievements WHERE user_id = $1 AND guild_id = $2`,
      [target.id, guildId]
    ),
  ]);

  if (activityRows.length === 0) {
    return interaction.editReply({
      content: `**${target.displayName ?? target.username}** has no recorded activity yet.`,
    });
  }

  const activity = activityRows[0];
  const achievementCount = parseInt(achRows[0].count);

  let member;
  try {
    member = await interaction.guild.members.fetch(target.id);
  } catch {
    member = { user: target };
  }

  await interaction.editReply({
    embeds: [buildStatsEmbed(activity, Number(activity.score), member.user, achievementCount, interaction.guild.name)],
  });
}
