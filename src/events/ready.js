import { ChannelType } from 'discord.js';
import { voiceSessions } from './voiceStateUpdate.js';
import { startInactivityCheck } from '../tasks/inactivityCheck.js';
import { startLeaderboardPost } from '../tasks/leaderboardPost.js';
import { startServer } from '../server.js';

export const name = 'ready';
export const once = true;

export async function execute(client) {
  console.log(`✅ Logged in as ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildVoice) continue;
      if (channel.id === guild.afkChannelId) continue;
      for (const [memberId, member] of channel.members) {
        if (member.user.bot) continue;
        voiceSessions.set(`${guild.id}:${memberId}`, Date.now());
      }
    }
  }

  startInactivityCheck(client);
  startLeaderboardPost(client);
  startServer(client);
}
