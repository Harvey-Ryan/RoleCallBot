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

// The public endpoints (recruitment page) answer only for these servers.
// PUBLIC_GUILD_IDS: comma-separated; default Fleet 919.
const PUBLIC_GUILD_IDS = new Set(
  (process.env.PUBLIC_GUILD_IDS ?? '1497395378495160493').split(',').map(s => s.trim()).filter(Boolean)
);

/** ?days= as a whole number of days, 1–365 (fallback when missing). Null when invalid. */
function parseDays(raw, fallback) {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null;
}

/** ?timezone= as an IANA zone Postgres and Intl both know, or null. */
function parseTimezone(raw) {
  const tz = raw ?? 'UTC';
  if (typeof tz !== 'string' || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** Shared by the heat map endpoints: checks the query, answers 400 itself when it's wrong. */
function heatmapQuery(req, res, defaultDays) {
  const days = parseDays(req.query.days, defaultDays);
  if (days === null) { res.status(400).json({ error: 'days must be a whole number from 1 to 365' }); return null; }
  const timezone = parseTimezone(req.query.timezone);
  if (!timezone) { res.status(400).json({ error: 'timezone must be an IANA time zone, e.g. America/Chicago' }); return null; }
  const type = req.query.type ?? 'combined';
  if (!['combined', 'message', 'voice', 'all'].includes(type)) {
    res.status(400).json({ error: 'type must be combined, message, voice, or all' }); return null;
  }
  return { days, timezone, type };
}

/**
 * Week x hour grids from activity_hourly rows (dow, hr, messages, voice_mins).
 * type 'all' answers with the combined grid plus the message and voice
 * layers, so a page showing all three asks once instead of three times.
 */
function heatmapBody(rows, config, type) {
  const blank = () => Array.from({ length: 7 }, () => new Array(24).fill(0));
  const layers = { combined: { grid: blank(), max: 0 }, message: { grid: blank(), max: 0 }, voice: { grid: blank(), max: 0 } };
  for (const row of rows) {
    const messages = Number(row.messages);
    const voice = Number(row.voice_mins);
    const scores = {
      combined: messages * Number(config.message_weight) + voice * Number(config.voice_weight),
      message: messages,
      voice,
    };
    for (const k of Object.keys(layers)) {
      layers[k].grid[row.dow][row.hr] = scores[k];
      if (scores[k] > layers[k].max) layers[k].max = scores[k];
    }
  }
  const main = layers[type === 'all' ? 'combined' : type];
  const body = { type, grid: main.grid, max: main.max };
  if (type === 'all') body.layers = layers;
  return body;
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
    // Fail closed: without a key, anyone who finds the URL could read and change every server's data.
    console.error('[server] ROLECALL_API_KEY is not set: the private API refuses every request until it is.');
  }

  // ── Public endpoint preflights — must be before the main CORS middleware ───
  // The main CORS middleware restricts by CORS_ORIGIN; public endpoints must
  // always allow any origin so the squeeze page can reach them.
  for (const path of ['/api/public/heatmap', '/api/public/daily-active-avg']) {
    app.options(path, (_req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.sendStatus(204);
    });
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

  // ── GET /api/public/heatmap ──────────────────────────────────────────────
  // No API key required — public endpoint for the recruitment squeeze page.
  // Registered before the auth middleware so it bypasses the key check.
  app.get('/api/public/heatmap', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { guildId } = req.query;
    if (!guildId) return res.status(400).json({ error: 'guildId required' });
    if (!PUBLIC_GUILD_IDS.has(guildId)) return res.status(404).json({ error: 'Not found' });
    const q = heatmapQuery(req, res, 365);
    if (!q) return;
    const { days, timezone, type } = q;
    try {
      const config = await getGuildConfig(guildId);
      const { rows } = await db.query(
        `SELECT
           EXTRACT(DOW FROM hour_utc AT TIME ZONE $3)::int AS dow,
           EXTRACT(HOUR FROM hour_utc AT TIME ZONE $3)::int AS hr,
           SUM(messages)   AS messages,
           SUM(voice_mins) AS voice_mins
         FROM activity_hourly
         WHERE guild_id = $1
           AND hour_utc >= NOW() - ($2 || ' days')::INTERVAL
         GROUP BY dow, hr`,
        [guildId, days, timezone]
      );
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json({ guild_id: guildId, days: Number(days), timezone, ...heatmapBody(rows, config, type) });
    } catch (err) {
      console.error('[public/heatmap]', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // ── GET /api/public/daily-active-avg ────────────────────────────────────
  // No API key required — public endpoint for the recruitment squeeze page.
  // Returns the average number of distinct active users per day over the last
  // 30 days, excluding days with zero activity from the average.
  app.get('/api/public/daily-active-avg', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');
    const { guildId } = req.query;
    if (!guildId) return res.status(400).json({ error: 'guildId required' });
    if (!PUBLIC_GUILD_IDS.has(guildId)) return res.status(404).json({ error: 'Not found' });
    try {
      const { rows } = await db.query(
        `WITH daily AS (
           SELECT
             DATE(hour_utc AT TIME ZONE 'UTC') AS day,
             COUNT(DISTINCT user_id)            AS active_users
           FROM activity_hourly
           WHERE guild_id = $1
             AND hour_utc >= NOW() - INTERVAL '30 days'
           GROUP BY DATE(hour_utc AT TIME ZONE 'UTC')
         )
         SELECT
           COUNT(*)                 AS days_with_activity,
           ROUND(AVG(active_users)) AS avg_daily_active
         FROM daily
         WHERE active_users > 0`,
        [guildId]
      );
      res.json({
        guild_id:           guildId,
        days_with_activity: parseInt(rows[0].days_with_activity) || 0,
        avg_daily_active:   parseInt(rows[0].avg_daily_active)   || 0,
      });
    } catch (err) {
      console.error('[public/daily-active-avg]', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // ── API key auth (scoped to /api only) ──────────────────────────────────
  app.use('/api', (req, res, next) => {
    if (!API_KEY) return res.status(503).json({ error: 'RoleCall API key not configured' });
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
         FROM user_activity WHERE guild_id = $1 AND has_left = FALSE`,
        [guildId]
      );
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/leaderboard ─────────────────────────────────────────────────
  app.get('/api/leaderboard', async (req, res) => {
    const { guildId, page = '1', includeInactive } = req.query;
    if (!guildId) return res.status(400).json({ error: 'guildId required' });
    try {
      const config = await getGuildConfig(guildId);
      const guild  = client.guilds.cache.get(guildId);
      const pg     = Math.max(1, parseInt(page));
      const offset = (pg - 1) * 25;
      // Inactive members are hidden unless asked for; ex-members never show.
      const showInactive = includeInactive === 'true' || includeInactive === '1';

      const [{ rows: countRows }, { rows }] = await Promise.all([
        db.query(
          `SELECT COUNT(*) FILTER (WHERE $2 OR is_inactive = FALSE) AS count,
                  COUNT(*) FILTER (WHERE is_inactive = TRUE)         AS inactive
           FROM user_activity
           WHERE guild_id = $1 AND has_left = FALSE AND (message_count > 0 OR voice_minutes > 0)`,
          [guildId, showInactive]
        ),
        db.query(
          `SELECT user_id, message_count, voice_minutes, streak_days, is_inactive,
             (message_count * $3 + voice_minutes * $4)                        AS score,
             (SELECT COUNT(*) FROM user_achievements
              WHERE user_id = ua.user_id AND guild_id = ua.guild_id)          AS achievement_count
           FROM user_activity ua
           WHERE guild_id = $1 AND has_left = FALSE AND ($5 OR is_inactive = FALSE)
             AND (message_count > 0 OR voice_minutes > 0)
           ORDER BY score DESC
           LIMIT 25 OFFSET $2`,
          [guildId, offset, config.message_weight, config.voice_weight, showInactive]
        ),
      ]);

      const total = parseInt(countRows[0].count);
      const inactiveCount = parseInt(countRows[0].inactive);
      const rowsWithMeta = rows.map(r => ({
        ...r,
        ...memberInfo(guild, r.user_id),
      }));

      res.json({
        rows: rowsWithMeta, total, page: pg, totalPages: Math.max(1, Math.ceil(total / 25)),
        inactiveCount, inactiveHidden: !showInactive,
      });
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
         WHERE guild_id = $1 AND has_left = FALSE AND is_inactive = FALSE
           AND (message_count * $3 + voice_minutes * $4) > $2`,
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
        `INSERT INTO guild_config (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING`,
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

  // ── GET /api/heatmap/guild ───────────────────────────────────────────────────
  app.get('/api/heatmap/guild', async (req, res) => {
    const { guildId } = req.query;
    if (!guildId) return res.status(400).json({ error: 'guildId required' });
    const q = heatmapQuery(req, res, 180);
    if (!q) return;
    const { days, timezone, type } = q;
    try {
      const config = await getGuildConfig(guildId);
      const { rows } = await db.query(
        `SELECT
           EXTRACT(DOW FROM hour_utc AT TIME ZONE $3)::int AS dow,
           EXTRACT(HOUR FROM hour_utc AT TIME ZONE $3)::int AS hr,
           SUM(messages)   AS messages,
           SUM(voice_mins) AS voice_mins
         FROM activity_hourly
         WHERE guild_id = $1
           AND hour_utc >= NOW() - ($2 || ' days')::INTERVAL
         GROUP BY dow, hr`,
        [guildId, days, timezone]
      );
      res.json({ guild_id: guildId, days: Number(days), timezone, ...heatmapBody(rows, config, type) });
    } catch (err) {
      console.error('[heatmap/guild]', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // ── GET /api/heatmap/user ────────────────────────────────────────────────────
  app.get('/api/heatmap/user', async (req, res) => {
    const { guildId, userId } = req.query;
    if (!guildId || !userId) return res.status(400).json({ error: 'guildId and userId required' });
    const q = heatmapQuery(req, res, 180);
    if (!q) return;
    const { days, timezone, type } = q;
    try {
      const config = await getGuildConfig(guildId);
      const { rows } = await db.query(
        `SELECT
           EXTRACT(DOW FROM hour_utc AT TIME ZONE $4)::int AS dow,
           EXTRACT(HOUR FROM hour_utc AT TIME ZONE $4)::int AS hr,
           SUM(messages)   AS messages,
           SUM(voice_mins) AS voice_mins
         FROM activity_hourly
         WHERE guild_id = $1
           AND user_id = $2
           AND hour_utc >= NOW() - ($3 || ' days')::INTERVAL
         GROUP BY dow, hr`,
        [guildId, userId, days, timezone]
      );
      res.json({ user_id: userId, guild_id: guildId, ...heatmapBody(rows, config, type), days: Number(days), timezone });
    } catch (err) {
      console.error('[heatmap/user]', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // ── GET /api/left-members ────────────────────────────────────────────────
  app.get('/api/left-members', async (req, res) => {
    const { guildId } = req.query;
    if (!guildId) return res.status(400).json({ error: 'guildId required' });
    try {
      const { rows } = await db.query(
        `SELECT user_id, message_count, voice_minutes, streak_days, last_active_at, left_at
         FROM user_activity
         WHERE guild_id = $1 AND has_left = TRUE
         ORDER BY left_at DESC NULLS LAST`,
        [guildId]
      );

      const guild = client.guilds.cache.get(guildId);
      const rowsWithMeta = rows.map(r => {
        const cached = client.users.cache.get(r.user_id);
        return {
          ...r,
          displayName: cached?.displayName ?? cached?.username ?? 'Unknown Member',
          username:    cached?.username    ?? r.user_id,
          avatar:      cached?.avatarURL({ size: 64 }) ?? defaultAvatar(r.user_id),
        };
      });

      // memberInfo fallback: if still in cache (e.g. shares another guild), prefer guild display name
      const withGuildMeta = rowsWithMeta.map(r => {
        const member = guild?.members.cache.get(r.user_id);
        if (!member) return r;
        return {
          ...r,
          displayName: member.displayName,
          username:    member.user.username,
          avatar:      member.user.avatarURL({ size: 64 }) ?? defaultAvatar(r.user_id),
        };
      });

      res.json({ rows: withGuildMeta, total: withGuildMeta.length });
    } catch (err) {
      console.error('[left-members]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(PORT, () => console.log(`[dashboard] http://localhost:${PORT}`));
}
