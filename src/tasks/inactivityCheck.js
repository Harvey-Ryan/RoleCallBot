import cron from 'node-cron';
import { db, getGuildConfig } from '../database.js';
import { reconcileMembers, markLeft, UNKNOWN_MEMBER } from '../services/membershipService.js';

export function startInactivityCheck(client) {
  cron.schedule('0 0 * * *', () => runInactivitySweep(client));
}

export async function runInactivitySweep(client) {
    console.log('[inactivityCheck] Running daily sweep...');

    for (const [guildId, guild] of client.guilds.cache) {
      try {
        const config = await getGuildConfig(guildId);
        const usesRoles = !!(config.active_role_id || config.inactive_role_id);

        // First catch up on anyone who left (or came back) without us noticing.
        try {
          await reconcileMembers(guild);
        } catch (err) {
          console.error(`[inactivityCheck] Membership check failed in ${guild.name}:`, err.message);
        }

        const { rows } = await db.query(
          `SELECT user_id FROM user_activity
           WHERE guild_id = $1
             AND is_inactive = FALSE
             AND has_left = FALSE
             AND last_active_at IS NOT NULL
             AND last_active_at < NOW() - ($2 || ' days')::INTERVAL`,
          [guildId, config.inactivity_days]
        );

        for (const { user_id } of rows) {
          try {
            if (!usesRoles) {
              // No activity roles configured: just flag them (hides them from leaderboards).
              await db.query(
                `UPDATE user_activity SET is_inactive = TRUE WHERE user_id = $1 AND guild_id = $2`,
                [user_id, guildId]
              );
              continue;
            }
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
          } catch (err) {
            if (err?.code === UNKNOWN_MEMBER) {
              // Not in the server any more: record that instead of failing every night.
              await markLeft(guildId, user_id, 'Not in the server during the inactivity sweep');
              continue;
            }
            console.error(`[inactivityCheck] Failed to update roles for user ${user_id} in guild ${guildId}:`, err.message);
          }
        }

        if (rows.length > 0) {
          console.log(`[inactivityCheck] ${rows.length} users marked inactive in ${guild.name}`);
        }
      } catch (err) {
        console.error(`[inactivityCheck] Error in guild ${guildId}:`, err.message);
      }
    }
}
