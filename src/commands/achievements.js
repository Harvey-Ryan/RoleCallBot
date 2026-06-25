import { SlashCommandBuilder } from 'discord.js';
import { getAchievementsForGuild, getUserEarnedAchievements } from '../services/achievementService.js';
import { buildAchievementsEmbed } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('achievements')
  .setDescription('View achievements')
  .addUserOption(opt =>
    opt.setName('user').setDescription('Member to look up (defaults to you)')
  );

export async function execute(interaction) {
  await interaction.deferReply();

  const target = interaction.options.getUser('user') ?? interaction.user;
  const guildId = interaction.guild.id;

  const [all, earned] = await Promise.all([
    getAchievementsForGuild(guildId),
    getUserEarnedAchievements(target.id, guildId),
  ]);

  let member;
  try {
    member = await interaction.guild.members.fetch(target.id);
  } catch {
    member = { user: target };
  }

  await interaction.editReply({
    embeds: [buildAchievementsEmbed(all, earned, member.user)],
  });
}
