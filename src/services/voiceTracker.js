// Voice time, counted by looking at who is in voice once a minute.
//
// Before, a session's minutes were only saved when the member left, all in the
// hour they left (a 4-hour evening showed as 240 minutes at 11 pm), and every
// restart forgot the sessions in progress. Now each minute in voice is filed in
// the hour it happened, kept in memory and saved every few minutes and when the
// bot shuts down (Railway sends SIGTERM on a redeploy), so a crash loses at most
// a few minutes and a deploy loses none.
//
// A minute counts when the member is in a normal voice channel (not the AFK
// channel, not a stage), isn't deafened, and has at least one other person
// there: someone parked alone or deafened overnight isn't "active".

import { ChannelType } from 'discord.js';
import { recordVoiceMinutes } from './activityService.js';

const SAMPLE_MS = 60_000;
const SAVE_MS = 5 * 60_000;

/** `${guildId}:${userId}` → Map(hour (ISO, UTC) → minutes) not saved yet */
const pending = new Map();

function hourOf(date) {
  const h = new Date(date);
  h.setUTCMinutes(0, 0, 0);
  return h.toISOString();
}

function isBot(client, voiceState) {
  return voiceState.member?.user.bot ?? client.users.cache.get(voiceState.id)?.bot ?? false;
}

/**
 * Who counts this minute, per guild: [guildId, userId][]. Exported for tests.
 * People are grouped by channel so "not alone" means another person in the same channel.
 */
export function countedNow(client) {
  const out = [];
  for (const guild of client.guilds.cache.values()) {
    const byChannel = new Map();
    for (const vs of guild.voiceStates.cache.values()) {
      if (!vs.channelId || vs.channelId === guild.afkChannelId) continue;
      if (vs.channel?.type === ChannelType.GuildStageVoice) continue;
      if (isBot(client, vs)) continue;
      const list = byChannel.get(vs.channelId) ?? [];
      list.push(vs);
      byChannel.set(vs.channelId, list);
    }
    for (const people of byChannel.values()) {
      if (people.length < 2) continue;              // alone in the channel
      for (const vs of people) {
        if (vs.deaf) continue;                      // self- or server-deafened
        out.push([guild.id, vs.id]);
      }
    }
  }
  return out;
}

function sample(client) {
  const hour = hourOf(Date.now());
  for (const [guildId, userId] of countedNow(client)) {
    const key = `${guildId}:${userId}`;
    const hours = pending.get(key) ?? new Map();
    hours.set(hour, (hours.get(hour) ?? 0) + 1);
    pending.set(key, hours);
  }
}

let saving = null;

/** Writes everything counted so far. Safe to call at any time; calls don't overlap. */
export async function saveVoiceMinutes(client) {
  if (saving) return saving;
  saving = (async () => {
    const batch = [...pending.entries()];
    pending.clear();
    for (const [key, hours] of batch) {
      const [guildId, userId] = key.split(':');
      try {
        await recordVoiceMinutes(userId, guildId, [...hours.entries()], client);
      } catch (err) {
        console.error(`[voice] Could not save voice time for ${userId} in ${guildId}; retrying next time:`, err.message);
        // Put it back (merged with anything counted meanwhile).
        const now = pending.get(key) ?? new Map();
        for (const [h, m] of hours) now.set(h, (now.get(h) ?? 0) + m);
        pending.set(key, now);
      }
    }
  })().finally(() => { saving = null; });
  return saving;
}

let started = false;

export function startVoiceTracker(client) {
  if (started) return;
  started = true;
  setInterval(() => sample(client), SAMPLE_MS).unref();
  setInterval(() => { void saveVoiceMinutes(client); }, SAVE_MS).unref();

  // Save what's counted before the process stops (redeploys send SIGTERM).
  const stop = async (signal) => {
    console.log(`[voice] ${signal}: saving voice time before shutting down`);
    try {
      await Promise.race([saveVoiceMinutes(client), new Promise((r) => setTimeout(r, 8_000))]);
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGTERM', () => void stop('SIGTERM'));
  process.once('SIGINT', () => void stop('SIGINT'));
}
