import express from 'express';
import { db, getGuildConfig, invalidateConfig } from './database.js';

const PORT = process.env.PORT || 3000;

function defaultAvatar(userId) {
  try {
    return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) % BigInt(6))}.png`;
  } catch {
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }
}

function memberInfo(guild, userId) {
  const member = guild?.members.cache.get(userId);
  return {
    displayName: member?.displayName ?? 'Unknown Member',
    username:    member?.user.username ?? userId,
    avatar:      member?.user.avatarURL({ size: 64 }) ?? defaultAvatar(userId),
  };
}

export function startServer(client) {
  const app = express();
  const API_KEY     = process.env.ROLECALL_API_KEY;
  const CORS_ORIGIN = process.env.CORS_ORIGIN;

  if (!API_KEY) {
    console.warn('[server] ROLECALL_API_KEY not set — API is unprotected');
  }

  // ── CORS (scoped to /api only) ───────────────────────────────────────────
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (CORS_ORIGIN) {
      if (origin === CORS_ORIGIN) res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json());

  // ── API key auth (scoped to /api only) ──────────────────────────────────
  app.use('/api', (req, res, next) => {
    if (!API_KEY) return next();
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${API_KEY}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });

  // Pre-warm the member cache for all guilds so the dashboard resolves names
  setTimeout(async () => {
    for (const guild of client.guilds.cache.values()) {
      try {
        await guild.members.fetch();
      } catch {
        // Ignore — cache will be populated on-demand by normal bot activity
      }
    }
  }, 3000);

  // ── GET /api/guilds ──────────────────────────────────────────────────────
  app.get('/api/guilds', (_req, res) => {
    const guilds = client.guilds.cache.map(g => ({
      id:          g.id,
      name:        g.name,
      icon:        g.iconURL({ size: 64 }) ?? null,
      memberCount: g.memberCount,
    }));
    res.json(guilds);
  });

  // ── GET /api/stats ───────────────────────────────────────────────────────
  app.get('/api/stats', async (req, res) => {
    const { guildId } = req.query;
    if (!guildId) return res.status(400).json({ error: 'guildId required' });
    try {
      const { rows } = await db.query(
        `SELECT
           COUNT(*)                                               AS total_members,
           COALESCE(SUM(message_count), 0)                       AS total_messages,
           COALESCE(SUM(voice_minutes), 0)                       AS total_voice_minutes,
           COUNT(*) FILTER (WHERE is_inactive = TRUE)            AS inactive_count,
           COALESCE(MAX(streak_days), 0)                         AS top_streak
         FROM user_activity WHERE guild_id = $1`,
        [guildId]
      );
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/leaderboard ─────────────────────────────────────────────────
  app.get('/api/leaderboard', async (req, res) => {
    const { guildId, page = '1' } = req.query;
    if (!guildId) return res.status(400).json({ error: 'guildId required' });
    try {
      const config = await getGuildConfig(guildId);
      const guild  = client.guilds.cache.get(guildId);
      const pg     = Math.max(1, parseInt(page));
      const offset = (pg - 1) * 25;

      const [{ rows: countRows }, { rows }] = await Promise.all([
        db.query(`SELECT COUNT(*) FROM user_activity WHERE guild_id = $1`, [guildId]),
        db.query(
          `SELECT user_id, message_count, voice_minutes, streak_days, is_inactive,
             (message_count * $3 + voice_minutes * $4)                        AS score,
             (SELECT COUNT(*) FROM user_achievements
              WHERE user_id = ua.user_id AND guild_id = ua.guild_id)          AS achievement_count
           FROM user_activity ua
           WHERE guild_id = $1
           ORDER BY score DESC
           LIMIT 25 OFFSET $2`,
          [guildId, offset, config.message_weight, config.voice_weight]
        ),
      ]);

      const total = parseInt(countRows[0].count);
      const rowsWithMeta = rows.map(r => ({
        ...r,
        ...memberInfo(guild, r.user_id),
      }));

      res.json({ rows: rowsWithMeta, total, page: pg, totalPages: Math.max(1, Math.ceil(total / 25)) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/member ──────────────────────────────────────────────────────
  app.get('/api/member', async (req, res) => {
    const { guildId, userId } = req.query;
    if (!guildId || !userId) return res.status(400).json({ error: 'guildId and userId required' });
    try {
      const config = await getGuildConfig(guildId);
      const guild  = client.guilds.cache.get(guildId);

      const [{ rows: actRows }, { rows: achRows }, { rows: histRows }] = await Promise.all([
        db.query(
          `SELECT *, (message_count * $3 + voice_minutes * $4) AS score
           FROM user_activity WHERE user_id = $1 AND guild_id = $2`,
          [userId, guildId, config.message_weight, config.voice_weight]
        ),
        db.query(
          `SELECT a.id, a.name, a.description, a.emoji, a.type, a.threshold, ua.earned_at
           FROM achievements a
           LEFT JOIN user_achievements ua
             ON ua.achievement_id = a.id AND ua.user_id = $1 AND ua.guild_id = $2
           WHERE a.guild_id IS NULL OR a.guild_id = $2
           ORDER BY a.type, a.threshold NULLS LAST`,
          [userId, guildId]
        ),
        db.query(
          `SELECT id, change_type, roles_removed, roles_added, reason, changed_at
           FROM role_change_log
           WHERE user_id = $1 AND guild_id = $2
           ORDER BY changed_at DESC LIMIT 50`,
          [userId, guildId]
        ),
      ]);

      if (actRows.length === 0) return res.status(404).json({ error: 'Member not found' });

      const { rows: rankRows } = await db.query(
        `SELECT COUNT(*) AS rank FROM user_activity
         WHERE guild_id = $1 AND (message_count * $3 + voice_minutes * $4) > $2`,
        [guildId, actRows[0].score, config.message_weight, config.voice_weight]
      );

      res.json({
        activity:     actRows[0],
        rank:         parseInt(rankRows[0].rank) + 1,
        achievements: achRows,
        history:      histRows,
        member:       memberInfo(guild, userId),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/config ──────────────────────────────────────────────────────
  app.get('/api/config', async (req, res) => {
    const { guildId } = req.query;
    if (!guildId) return res.status(400).json({ error: 'guildId required' });
    try {
      const config = await getGuildConfig(guildId);
      res.json(config);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PATCH /api/config ────────────────────────────────────────────────────
  app.patch('/api/config', async (req, res) => {
    const { guildId } = req.query;
    if (!guildId) return res.status(400).json({ error: 'guildId required' });

    const {
      inactivity_days, active_role_id, inactive_role_id,
      achievements_channel_id, leaderboard_channel_id,
      leaderboard_schedule, message_weight, voice_weight,
    } = req.body ?? {};

    // Validate
    if (inactivity_days !== undefined && (typeof inactivity_days !== 'number' || inactivity_days < 1 || inactivity_days > 365))
      return res.status(400).json({ error: 'inactivity_days must be 1–365' });
    if (leaderboard_schedule !== undefined && !['daily', 'weekly'].includes(leaderboard_schedule))
      return res.status(400).json({ error: 'leaderboard_schedule must be daily or weekly' });
    if (message_weight !== undefined && (typeof message_weight !== 'number' || message_weight < 0))
      return res.status(400).json({ error: 'message_weight must be >= 0' });
    if (voice_weight !== undefined && (typeof voice_weight !== 'number' || voice_weight < 0))
      return res.status(400).json({ error: 'voice_weight must be >= 0' });

    const fields = [];
    const values = [];
    let i = 1;
    const set = (col, val) => { fields.push(`${col} = $${i++}`); values.push(val); };

    if (inactivity_days         !== undefined) set('inactivity_days',         Math.round(inactivity_days));
    if (active_role_id          !== undefined) set('active_role_id',          active_role_id ?? null);
    if (inactive_role_id        !== undefined) set('inactive_role_id',        inactive_role_id ?? null);
    if (achievements_channel_id !== undefined) set('achievements_channel_id', achievements_channel_id ?? null);
    if (leaderboard_channel_id  !== undefined) set('leaderboard_channel_id',  leaderboard_channel_id ?? null);
    if (leaderboard_schedule     !== undefined) set('leaderboard_schedule',    leaderboard_schedule);
    if (message_weight          !== undefined) set('message_weight',          message_weight);
    if (voice_weight            !== undefined) set('voice_weight',            voice_weight);

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    set('updated_at', new Date());
    values.push(guildId);

    try {
      await db.query(
        `INSERT INTO guild_config (guild_id) VALUES ($${i}) ON CONFLICT (guild_id) DO NOTHING`,
        [guildId]
      );
      await db.query(
        `UPDATE guild_config SET ${fields.join(', ')} WHERE guild_id = $${i}`,
        values
      );
      invalidateConfig(guildId);
      const config = await getGuildConfig(guildId);
      res.json(config);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/role-change-log ─────────────────────────────────────────────
  app.get('/api/role-change-log', async (req, res) => {
    const { guildId, page = '1' } = req.query;
    if (!guildId) return res.status(400).json({ error: 'guildId required' });
    try {
      const guild  = client.guilds.cache.get(guildId);
      const pg     = Math.max(1, parseInt(page));
      const offset = (pg - 1) * 50;

      const [{ rows: countRows }, { rows }] = await Promise.all([
        db.query(`SELECT COUNT(*) FROM role_change_log WHERE guild_id = $1`, [guildId]),
        db.query(
          `SELECT id, user_id, change_type, roles_removed, roles_added, reason, changed_at
           FROM role_change_log WHERE guild_id = $1
           ORDER BY changed_at DESC LIMIT 50 OFFSET $2`,
          [guildId, offset]
        ),
      ]);

      const total = parseInt(countRows[0].count);
      const rowsWithMeta = rows.map(r => ({
        ...r,
        ...memberInfo(guild, r.user_id),
      }));

      res.json({ rows: rowsWithMeta, total, page: pg, totalPages: Math.max(1, Math.ceil(total / 50)) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(PORT, () => console.log(`[dashboard] http://localhost:${PORT}`));
}
