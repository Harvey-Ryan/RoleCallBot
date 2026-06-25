const cooldowns = new Map();
const COOLDOWN_MS = 60_000;

export function checkCooldown(userId, guildId) {
  const key = `${userId}:${guildId}`;
  const last = cooldowns.get(key) ?? 0;
  const now = Date.now();
  if (now - last < COOLDOWN_MS) return false;
  cooldowns.set(key, now);
  return true;
}
