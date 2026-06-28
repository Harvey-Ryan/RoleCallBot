CREATE TABLE IF NOT EXISTS guild_config (
  guild_id                TEXT        PRIMARY KEY,
  inactivity_days         INTEGER     NOT NULL DEFAULT 30,
  active_role_id          TEXT,
  inactive_role_id        TEXT,
  achievements_channel_id TEXT,
  leaderboard_channel_id  TEXT,
  leaderboard_schedule    TEXT        NOT NULL DEFAULT 'weekly',
  message_weight          NUMERIC     NOT NULL DEFAULT 1,
  voice_weight            NUMERIC     NOT NULL DEFAULT 2,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_activity (
  user_id          TEXT        NOT NULL,
  guild_id         TEXT        NOT NULL,
  message_count    INTEGER     NOT NULL DEFAULT 0,
  voice_minutes    NUMERIC     NOT NULL DEFAULT 0,
  last_active_at   TIMESTAMPTZ,
  streak_days      INTEGER     NOT NULL DEFAULT 0,
  last_streak_date DATE,
  is_inactive      BOOLEAN     NOT NULL DEFAULT FALSE,
  has_left         BOOLEAN     NOT NULL DEFAULT FALSE,
  left_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_ua_guild       ON user_activity (guild_id);
CREATE INDEX IF NOT EXISTS idx_ua_last_active ON user_activity (guild_id, last_active_at);

CREATE TABLE IF NOT EXISTS achievements (
  id          SERIAL      PRIMARY KEY,
  guild_id    TEXT,
  name        TEXT        NOT NULL,
  description TEXT        NOT NULL,
  emoji       TEXT        NOT NULL DEFAULT '🏆',
  type        TEXT        NOT NULL,
  threshold   NUMERIC,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_achievements_builtin
  ON achievements (name) WHERE guild_id IS NULL;

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id        TEXT        NOT NULL,
  guild_id       TEXT        NOT NULL,
  achievement_id INTEGER     NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  earned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, guild_id, achievement_id)
);

INSERT INTO achievements (guild_id, name, description, emoji, type, threshold) VALUES
  (NULL, 'First Step',      'Sent your first message or joined voice for the first time', '👋', 'newcomer',          NULL),
  (NULL, 'Getting Started', 'Sent 10 messages',                                           '💬', 'message_milestone', 10),
  (NULL, 'Regular',         'Sent 100 messages',                                          '📣', 'message_milestone', 100),
  (NULL, 'Veteran Chatter', 'Sent 500 messages',                                          '🗣️', 'message_milestone', 500),
  (NULL, 'Legend',          'Sent 1000 messages',                                         '⚡', 'message_milestone', 1000),
  (NULL, 'Voice Initiate',  'Spent 1 hour in voice channels',                             '🎙️', 'voice_milestone',   60),
  (NULL, 'Voice Regular',   'Spent 10 hours in voice channels',                           '🎧', 'voice_milestone',   600),
  (NULL, 'Voice Veteran',   'Spent 100 hours in voice channels',                          '📡', 'voice_milestone',   6000),
  (NULL, 'Week Warrior',    'Active 7 days in a row',                                     '🔥', 'streak',            7),
  (NULL, 'Monthly Legend',  'Active 30 days in a row',                                    '💎', 'streak',            30)
ON CONFLICT (name) WHERE guild_id IS NULL DO NOTHING;

CREATE TABLE IF NOT EXISTS activity_hourly (
  user_id    TEXT        NOT NULL,
  guild_id   TEXT        NOT NULL,
  hour_utc   TIMESTAMPTZ NOT NULL,
  messages   INTEGER     NOT NULL DEFAULT 0,
  voice_mins NUMERIC     NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, guild_id, hour_utc)
);
CREATE INDEX IF NOT EXISTS idx_ah_guild_hour ON activity_hourly (guild_id, hour_utc);
