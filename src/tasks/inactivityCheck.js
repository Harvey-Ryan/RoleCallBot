import cron from 'node-cron';
import { db, getGuildConfig } from '../database.js';

export function startInactivityCheck(client) {
  cron.schedule('0 0 * * *', async () => {
    console.log('[inactivityCheck] Running daily sweep...');

    for (const [guildId, guild] of client.guilds.cache) {
      try {
        const config = await getGuildConfig(guildId);
        if (!config.active_role_id && !config.inactive_role_id) continue;

        const { rows } = await db.query(
          `SELECT user_id FROM user_activity
           WHERE guild_id = $1
             AND is_inactive = FALSE
             AND last_active_at IS NOT NULL
             AND last_active_at < NOW() - ($2 || ' days')::INTERVAL`,
          [guildId, config.inactivity_days]
        );

        for (const { user_id } of rows) {
          try {
            const member = await guild.members.fetch(user_id);
            if (config.active_role_id) await member.roles.remove(config.active_role_id);
            if (config.inactive_role_id) await member.roles.add(config.inactive_role_id);
            await db.query(
              `UPDATE user_activity SET is_inactive = TRUE WHERE user_id = $1 AND guild_id = $2`,
              [user_id, guildId]
            );
            await db.query(
              `INSERT INTO role_change_log (user_id, guild_id, change_type, roles_removed, roles_added, reason)
               VALUES ($1, $2, 'went_inactive', $3, $4, $5)`,
              [
                user_id,
                guildId,
                config.active_role_id   ? [config.active_role_id]   : null,
                config.inactive_role_id ? [config.inactive_role_id] : null,
                `Inactivity sweep: no activity for ${config.inactivity_days}+ days`,
              ]
            );
          } catch {
            // Member may have left the server
          }
        }

        if (rows.length > 0) {
          console.log(`[inactivityCheck] ${rows.length} users marked inactive in ${guild.name}`);
        }
      } catch (err) {
        console.error(`[inactivityCheck] Error in guild ${guildId}:`, err.message);
      }
    }
  });
}
