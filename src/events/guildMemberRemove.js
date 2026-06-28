import { db } from '../database.js';

export const name = 'guildMemberRemove';

export async function execute(member) {
  if (member.user.bot) return;
  try {
    const roles = member.roles.cache
      .filter(r => r.id !== member.guild.id) // exclude @everyone
      .map(r => r.id);

    await db.query(
      `UPDATE user_activity SET has_left = TRUE, left_at = NOW()
       WHERE user_id = $1 AND guild_id = $2`,
      [member.id, member.guild.id]
    );

    await db.query(
      `INSERT INTO role_change_log
         (user_id, guild_id, change_type, roles_removed, roles_added, reason)
       VALUES ($1, $2, 'left_server', $3, '{}', 'Member left the server')`,
      [member.id, member.guild.id, roles]
    );

    console.log(`[guildMemberRemove] ${member.user.tag} left ${member.guild.name}`);
  } catch (err) {
    console.error('[guildMemberRemove]', err.message);
  }
}
