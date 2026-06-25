import { SlashCommandBuilder } from 'discord.js';
import { buildHelpEmbed } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show all available commands');

export async function execute(interaction) {
  await interaction.reply({ embeds: [buildHelpEmbed()], ephemeral: true });
}
