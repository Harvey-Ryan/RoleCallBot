import { db } from '../database.js';
import { checkCooldown } from '../utils/cooldown.js';
import { checkAndAwardAchievements } from './achievementService.js';

export async function recordMessageActivity(userId, guildId, client) {
  if (!checkCooldown(userId, guildId)) return;

  const today = new Date().toISOString().split('T')[0];

  const { rows } = await db.query(
    `INSERT INTO user_activity (user_id, guild_id, message_count, last_active_at, streak_days, last_streak_date)
     VALUES ($1, $2, 1, NOW(), 1, $3::date)
     ON CONFLICT (user_id, guild_id) DO UPDATE SET
       message_count    = user_activity.message_count + 1,
       last_active_at   = NOW(),
       streak_days      = CASE
         WHEN user_activity.last_streak_date = $3::date - INTERVAL '1 day' THEN user_activity.streak_days + 1
         WHEN user_activity.last_streak_date = $3::date                     THEN user_activity.streak_days
         ELSE 1
       END,
       last_streak_date = $3::date
     RETURNING *, (xmax = 0) AS is_new`,
    [userId, guildId, today]
  );

  const activity = rows[0];
  await checkAndAwardAchievements(userId, guildId, activity, activity.is_new, client);
}

export async function recordVoiceEnd(userId, guildId, minutes, client) {
  if (minutes < 1) return;

  const today = new Date().toISOString().split('T')[0];

  const { rows } = await db.query(
    `INSERT INTO user_activity (user_id, guild_id, voice_minutes, last_active_at, streak_days, last_streak_date)
     VALUES ($1, $2, $3, NOW(), 1, $4::date)
     ON CONFLICT (user_id, guild_id) DO UPDATE SET
       voice_minutes    = user_activity.voice_minutes + $3,
       last_active_at   = NOW(),
       streak_days      = CASE
         WHEN user_activity.last_streak_date = $4::date - INTERVAL '1 day' THEN user_activity.streak_days + 1
         WHEN user_activity.last_streak_date = $4::date                     THEN user_activity.streak_days
         ELSE 1
       END,
       last_streak_date = $4::date
     RETURNING *, (xmax = 0) AS is_new`,
    [userId, guildId, minutes, today]
  );

  const activity = rows[0];
  await checkAndAwardAchievements(userId, guildId, activity, activity.is_new, client);
}
