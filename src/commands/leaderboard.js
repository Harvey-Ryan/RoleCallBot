import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { db, getGuildConfig } from '../database.js';
import { buildLeaderboardEmbed } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('View the activity leaderboard')
  .addIntegerOption(opt =>
    opt.setName('page').setDescription('Page number').setMinValue(1)
  );

export async function execute(interaction) {
  await interaction.deferReply();

  const guildId = interaction.guild.id;
  const config = await getGuildConfig(guildId);

  async function fetchPage(page) {
    const offset = (page - 1) * 10;
    const [{ rows: countRows }, { rows }] = await Promise.all([
      db.query(`SELECT COUNT(*) FROM user_activity WHERE guild_id = $1`, [guildId]),
      db.query(
        `SELECT user_id, message_count, voice_minutes,
           (message_count * $3 + voice_minutes * $4) AS score
         FROM user_activity
         WHERE guild_id = $1
         ORDER BY score DESC
         LIMIT 10 OFFSET $2`,
        [guildId, offset, config.message_weight, config.voice_weight]
      ),
    ]);
    const total = parseInt(countRows[0].count);
    const totalPages = Math.max(1, Math.ceil(total / 10));
    return { rows, totalPages };
  }

  function buildButtons(page, totalPages) {
    if (totalPages <= 1) return [];
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('prev')
          .setLabel('◀ Prev')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page <= 1),
        new ButtonBuilder()
          .setCustomId('next')
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= totalPages)
      ),
    ];
  }

  let page = interaction.options.getInteger('page') ?? 1;
  let { rows, totalPages } = await fetchPage(page);

  const msg = await interaction.editReply({
    embeds: [buildLeaderboardEmbed(rows, page, totalPages, interaction.guild.name)],
    components: buildButtons(page, totalPages),
  });

  if (totalPages <= 1) return;

  const collector = msg.createMessageComponentCollector({ time: 120_000 });

  collector.on('collect', async btn => {
    await btn.deferUpdate();
    page = btn.customId === 'prev' ? page - 1 : page + 1;
    page = Math.max(1, Math.min(page, totalPages));
    const data = await fetchPage(page);
    rows = data.rows;
    totalPages = data.totalPages;
    await interaction.editReply({
      embeds: [buildLeaderboardEmbed(rows, page, totalPages, interaction.guild.name)],
      components: buildButtons(page, totalPages),
    });
  });

  collector.on('end', async () => {
    try {
      await interaction.editReply({ components: [] });
    } catch { /* message may have been deleted */ }
  });
}
