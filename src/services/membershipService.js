import { db, getGuildConfig } from '../database.js';

// Discord's member list can come back incomplete (gateway hiccup, rate limit).
// If we got fewer than this share of the guild's reported member count, skip
// the check rather than marking real members as gone.
const MIN_FETCH_SHARE = 0.9;
const UNKNOWN_MEMBER = 10007;

async function logChange(guildId, userIds, changeType, reason) {
  if (userIds.length === 0) return;
  await db.query(
    `INSERT INTO role_change_log (user_id, guild_id, change_type, roles_removed, roles_added, reason)
     SELECT u, $2, $3, '{}', '{}', $4 FROM unnest($1::text[]) AS u`,
    [userIds, guildId, changeType, reason]
  );
}

/**
 * Brings has_left in line with who is actually in the server: marks tracked
 * members who are gone (e.g. left while the bot was offline, or before leaves
 * were tracked) and un-marks anyone who is back. Nothing is deleted.
 */
export async function reconcileMembers(guild) {
  const members = await guild.members.fetch();
  const expected = guild.memberCount ?? members.size;
  if (expected > 0 && members.size < expected * MIN_FETCH_SHARE) {
    console.warn(`[membership] ${guild.name}: got ${members.size} of ${expected} members from Discord; skipping check`);
    return { left: 0, rejoined: 0, skipped: true };
  }
  const ids = [...members.keys()];

  const { rows: left } = await db.query(
    `UPDATE user_activity SET has_left = TRUE, left_at = COALESCE(left_at, NOW())
     WHERE guild_id = $1 AND has_left = FALSE AND NOT (user_id = ANY($2::text[]))
     RETURNING user_id`,
    [guild.id, ids]
  );
  const { rows: back } = await db.query(
    `UPDATE user_activity SET has_left = FALSE, left_at = NULL
     WHERE guild_id = $1 AND has_left = TRUE AND user_id = ANY($2::text[])
     RETURNING user_id`,
    [guild.id, ids]
  );

  // Members who have never chatted or been in voice get a row too, dated from
  // when they joined, so the inactivity sweep sees them: someone silent for
  // longer than the guild's inactivity window is marked inactive like anyone
  // else. Newer members get the full window from their join date.
  const humans = [...members.values()].filter(m => !m.user.bot);
  const { rowCount: added } = await db.query(
    `INSERT INTO user_activity (user_id, guild_id, last_active_at)
     SELECT u, $1, j FROM unnest($2::text[], $3::timestamptz[]) AS t(u, j)
     ON CONFLICT (user_id, guild_id) DO NOTHING`,
    [guild.id, humans.map(m => m.id), humans.map(m => (m.joinedAt ?? new Date()).toISOString())]
  );

  await logChange(guild.id, left.map(r => r.user_id), 'left_server', 'Not in the server when membership was checked');
  await logChange(guild.id, back.map(r => r.user_id), 'rejoined', 'Back in the server when membership was checked');

  if (left.length || back.length || added) {
    console.log(`[membership] ${guild.name}: ${left.length} marked as left, ${back.length} back, ${added} silent members now tracked`);
  }
  return { left: left.length, rejoined: back.length, added, skipped: false };
}

export async function reconcileAllGuilds(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      await reconcileMembers(guild);
    } catch (err) {
      console.error(`[membership] Check failed in ${guild.name}:`, err.message);
    }
  }
}

/** A member (re)joined the server: show them again. */
export async function markRejoined(guildId, userId) {
  const { rowCount } = await db.query(
    `UPDATE user_activity SET has_left = FALSE, left_at = NULL
     WHERE guild_id = $1 AND user_id = $2 AND has_left = TRUE`,
    [guildId, userId]
  );
  if (rowCount) await logChange(guildId, [userId], 'rejoined', 'Member rejoined the server');
  return rowCount > 0;
}

/** Marks one member as left (used when Discord says they no longer exist in the guild). */
export async function markLeft(guildId, userId, reason) {
  await db.query(
    `UPDATE user_activity SET has_left = TRUE, left_at = COALESCE(left_at, NOW())
     WHERE guild_id = $1 AND user_id = $2 AND has_left = FALSE`,
    [guildId, userId]
  );
  await logChange(guildId, [userId], 'left_server', reason);
}

/**
 * A member flagged inactive was active again (activity already cleared the
 * flag): swap the inactive role back to the active role, if the guild uses them.
 */
export async function reactivateMember(client, guildId, userId) {
  const config = await getGuildConfig(guildId);
  const removed = [];
  const added = [];
  if (config.active_role_id || config.inactive_role_id) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      try {
        const member = await guild.members.fetch(userId);
        if (config.inactive_role_id && member.roles.cache.has(config.inactive_role_id)) {
          await member.roles.remove(config.inactive_role_id);
          removed.push(config.inactive_role_id);
        }
        if (config.active_role_id && !member.roles.cache.has(config.active_role_id)) {
          await member.roles.add(config.active_role_id);
          added.push(config.active_role_id);
        }
      } catch (err) {
        if (err?.code !== UNKNOWN_MEMBER) {
          console.error(`[membership] Could not restore roles for ${userId} in ${guildId}:`, err.message);
        }
      }
    }
  }
  await db.query(
    `INSERT INTO role_change_log (user_id, guild_id, change_type, roles_removed, roles_added, reason)
     VALUES ($1, $2, 'became_active', $3, $4, 'Active again after being marked inactive')`,
    [userId, guildId, removed, added]
  );
}

export { UNKNOWN_MEMBER };
