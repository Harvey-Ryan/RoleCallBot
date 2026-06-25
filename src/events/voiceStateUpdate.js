import { ChannelType } from 'discord.js';
import { recordVoiceEnd } from '../services/activityService.js';

export const name = 'voiceStateUpdate';

export const voiceSessions = new Map();

export async function execute(oldState, newState) {
  const member = oldState.member ?? newState.member;
  if (!member || member.user.bot) return;

  const userId = member.id;
  const guildId = member.guild.id;
  const key = `${guildId}:${userId}`;

  const wasInVoice = !!oldState.channelId;
  const nowInVoice = !!newState.channelId &&
    newState.channel?.id !== newState.guild.afkChannelId &&
    newState.channel?.type !== ChannelType.GuildStageVoice;

  const leftVoice = wasInVoice && (
    !newState.channelId ||
    newState.channel?.id === newState.guild.afkChannelId
  );

  const joinedVoice = !wasInVoice && nowInVoice;

  if (leftVoice) {
    const start = voiceSessions.get(key);
    if (start) {
      voiceSessions.delete(key);
      const minutes = Math.floor((Date.now() - start) / 60_000);
      try {
        await recordVoiceEnd(userId, guildId, minutes, oldState.client);
      } catch (err) {
        console.error('[voiceStateUpdate]', err.message);
      }
    }
  } else if (joinedVoice) {
    voiceSessions.set(key, Date.now());
  }
}
