import { EmbedBuilder } from 'discord.js';

export function buildLeaderboardEmbed(rows, page, totalPages, guildName) {
  const embed = new EmbedBuilder()
    .setTitle(`📊 ${guildName} Leaderboard`)
    .setColor(0x5865F2)
    .setFooter({ text: `Page ${page} of ${totalPages}` })
    .setTimestamp();

  if (rows.length === 0) {
    return embed.setDescription('No activity recorded yet.');
  }

  const medals = ['🥇', '🥈', '🥉'];
  const offset = (page - 1) * 10;

  const lines = rows.map((row, i) => {
    const rank = offset + i + 1;
    const prefix = medals[rank - 1] ?? `**#${rank}**`;
    const score = Number(row.score).toLocaleString();
    const msgs = Number(row.message_count).toLocaleString();
    const voiceHrs = (Number(row.voice_minutes) / 60).toFixed(1);
    return `${prefix} <@${row.user_id}> — **${score} pts** (${msgs} msgs · ${voiceHrs}h voice)`;
  });

  return embed.setDescription(lines.join('\n'));
}

export function buildStatsEmbed(activity, score, user, achievementCount, guildName) {
  const totalMinutes = Number(activity.voice_minutes);
  const voiceDisplay = `${Math.floor(totalMinutes / 60)}h ${Math.round(totalMinutes % 60)}m`;

  return new EmbedBuilder()
    .setTitle(`📈 ${user.displayName ?? user.username}'s Stats`)
    .setColor(0x57F287)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: '💬 Messages',     value: Number(activity.message_count).toLocaleString(), inline: true },
      { name: '🎙️ Voice Time',   value: voiceDisplay,                                   inline: true },
      { name: '⭐ Total Score',  value: Math.round(score).toLocaleString(),              inline: true },
      { name: '🔥 Streak',       value: `${activity.streak_days} days`,                 inline: true },
      { name: '🏆 Achievements', value: `${achievementCount} earned`,                   inline: true },
    )
    .setFooter({ text: guildName })
    .setTimestamp();
}

export function buildAchievementsEmbed(all, earned, user) {
  const earnedMap = new Map(earned.map(e => [e.achievement_id, e]));

  const lines = all.map(a => {
    const rec = earnedMap.get(a.id);
    const check = rec ? '✅' : '⬜';
    const when = rec
      ? ` · <t:${Math.floor(new Date(rec.earned_at).getTime() / 1000)}:R>`
      : '';
    return `${check} ${a.emoji} **${a.name}** — ${a.description}${when}`;
  });

  return new EmbedBuilder()
    .setTitle(`🏆 ${user.displayName ?? user.username}'s Achievements`)
    .setColor(0xFEE75C)
    .setDescription(lines.join('\n') || 'No achievements available.')
    .setThumbnail(user.displayAvatarURL());
}

export function buildAchievementNotifEmbed(achievement, user) {
  return new EmbedBuilder()
    .setTitle('🎉 Achievement Unlocked!')
    .setColor(0xFEE75C)
    .setDescription(`${achievement.emoji} **${achievement.name}**\n${achievement.description}`)
    .setThumbnail(user.displayAvatarURL())
    .setFooter({ text: `Earned by ${user.displayName ?? user.username}` })
    .setTimestamp();
}

export function buildHelpEmbed() {
  return new EmbedBuilder()
    .setTitle('📖 RoleCallBot — Commands')
    .setColor(0x5865F2)
    .addFields(
      {
        name: '👤 Member Commands',
        value: [
          '`/leaderboard [page]` — View the activity leaderboard',
          '`/stats [user]` — View your (or another member\'s) stats',
          '`/achievements [user]` — View earned achievements',
          '`/history [user]` — View role change history (others require Manage Server)',
          '`/help` — Show this message',
        ].join('\n'),
      },
      {
        name: '⚙️ Admin Commands',
        value: [
          '`/config view` — View current server configuration',
          '`/config inactivity-days <days>` — Set inactivity threshold',
          '`/config active-role <role>` — Role removed on inactivity',
          '`/config inactive-role <role>` — Role assigned on inactivity',
          '`/config achievements-channel <channel>` — Where achievements post',
          '`/config leaderboard-channel <channel>` — Where the leaderboard auto-posts',
          '`/config leaderboard-schedule <daily|weekly>` — Auto-post frequency',
          '`/config message-weight <number>` — Points per message (default: 1)',
          '`/config voice-weight <number>` — Points per voice minute (default: 2)',
          '`/achievement create` — Add a custom achievement',
          '`/achievement delete` — Remove a custom achievement',
          '`/achievement list` — List all achievements including custom',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Admin commands require Manage Server permission' });
}
