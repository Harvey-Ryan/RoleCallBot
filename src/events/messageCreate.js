import { recordMessageActivity } from '../services/activityService.js';

export const name = 'messageCreate';

export async function execute(message) {
  if (message.author.bot || !message.guild) return;
  try {
    await recordMessageActivity(message.author.id, message.guild.id, message.client);
  } catch (err) {
    console.error('[messageCreate]', err.message);
  }
}
