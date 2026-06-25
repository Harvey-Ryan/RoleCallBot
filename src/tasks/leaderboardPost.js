import cron from 'node-cron';
import { db, getGuildConfig } from '../database.js';
import { buildLeaderboardEmbed } from '../utils/embeds.js';

export function startLeaderboardPost(client) {
  cron.schedule('0 9 * * *', async () => {
    const isMonday = new Date().getDay() === 1;

    for (const [guildId, guild] of client.guilds.cache) {
      try {
        const config = await getGuildConfig(guildId);
        if (!config.leaderboard_channel_id) continue;
        if (config.leaderboard_schedule === 'weekly' && !isMonday) continue;

        const channel = guild.channels.cache.get(config.leaderboard_channel_id);
        if (!channel) continue;

        const { rows } = await db.query(
          `SELECT user_id, message_count, voice_minutes,
             (message_count * $2 + voice_minutes * $3) AS score
           FROM user_activity
           WHERE guild_id = $1
           ORDER BY score DESC
           LIMIT 10`,
          [guildId, config.message_weight, config.voice_weight]
        );

        if (rows.length === 0) continue;

        const label = config.leaderboard_schedule === 'weekly' ? 'Weekly' : 'Daily';
        const embed = buildLeaderboardEmbed(rows, 1, 1, guild.name);
        embed.setTitle(`📊 ${label} Leaderboard — ${guild.name}`);

        await channel.send({ embeds: [embed] });
      } catch (err) {
        console.error(`[leaderboardPost] Error in guild ${guildId}:`, err.message);
      }
    }
  });
}
