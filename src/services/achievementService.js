import { db, getGuildConfig } from '../database.js';
import { buildAchievementNotifEmbed } from '../utils/embeds.js';

export async function getAchievementsForGuild(guildId) {
  const { rows } = await db.query(
    `SELECT * FROM achievements
     WHERE guild_id IS NULL OR guild_id = $1
     ORDER BY type, threshold NULLS LAST`,
    [guildId]
  );
  return rows;
}

export async function getUserEarnedAchievements(userId, guildId) {
  const { rows } = await db.query(
    `SELECT * FROM user_achievements WHERE user_id = $1 AND guild_id = $2`,
    [userId, guildId]
  );
  return rows;
}

export async function checkAndAwardAchievements(userId, guildId, activity, isNew, client) {
  const [achievements, earned] = await Promise.all([
    getAchievementsForGuild(guildId),
    getUserEarnedAchievements(userId, guildId),
  ]);

  const earnedIds = new Set(earned.map(e => e.achievement_id));
  const toAward = [];

  for (const a of achievements) {
    if (earnedIds.has(a.id)) continue;

    let qualifies = false;
    switch (a.type) {
      case 'newcomer':
        qualifies = isNew;
        break;
      case 'message_milestone':
        qualifies = Number(activity.message_count) >= Number(a.threshold);
        break;
      case 'voice_milestone':
        qualifies = Number(activity.voice_minutes) >= Number(a.threshold);
        break;
      case 'streak':
        qualifies = Number(activity.streak_days) >= Number(a.threshold);
        break;
    }

    if (qualifies) toAward.push(a);
  }

  if (toAward.length === 0) return;

  for (const a of toAward) {
    await db.query(
      `INSERT INTO user_achievements (user_id, guild_id, achievement_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [userId, guildId, a.id]
    );
  }

  await postAchievementNotifications(userId, guildId, toAward, client);
}

async function postAchievementNotifications(userId, guildId, achievements, client) {
  const config = await getGuildConfig(guildId);
  if (!config.achievements_channel_id) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(config.achievements_channel_id);
  if (!channel) return;

  let member;
  try {
    member = await guild.members.fetch(userId);
  } catch {
    return;
  }

  for (const achievement of achievements) {
    await channel.send({
      content: `<@${userId}>`,
      embeds: [buildAchievementNotifEmbed(achievement, member.user)],
    });
  }
}
