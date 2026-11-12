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

        // The period's activity (last 7 days, or last day), not all-time totals.
        const days = config.leaderboard_schedule === 'weekly' ? 7 : 1;
        const { rows } = await db.query(
          `SELECT h.user_id,
                  SUM(h.messages)   AS message_count,
                  SUM(h.voice_mins) AS voice_minutes,
                  SUM(h.messages) * $2 + SUM(h.voice_mins) * $3 AS score
           FROM activity_hourly h
           JOIN user_activity ua ON ua.user_id = h.user_id AND ua.guild_id = h.guild_id
           WHERE h.guild_id = $1
             AND h.hour_utc >= NOW() - ($4 || ' days')::INTERVAL
             AND ua.has_left = FALSE
           GROUP BY h.user_id
           HAVING SUM(h.messages) * $2 + SUM(h.voice_mins) * $3 > 0
           ORDER BY score DESC
           LIMIT 10`,
          [guildId, config.message_weight, config.voice_weight, days]
        );

        if (rows.length === 0) continue;

        const label = config.leaderboard_schedule === 'weekly' ? 'Weekly' : 'Daily';
        const embed = buildLeaderboardEmbed(rows, 1, 1, guild.name);
        embed.setTitle(`📊 ${label} Leaderboard — ${guild.name}`);
        embed.setFooter({ text: config.leaderboard_schedule === 'weekly' ? 'Activity in the last 7 days' : 'Activity in the last 24 hours' });

        await channel.send({ embeds: [embed] });
      } catch (err) {
        console.error(`[leaderboardPost] Error in guild ${guildId}:`, err.message);
      }
    }
  });
}
