import { startInactivityCheck } from '../tasks/inactivityCheck.js';
import { startLeaderboardPost } from '../tasks/leaderboardPost.js';
import { startServer } from '../server.js';
import { reconcileAllGuilds } from '../services/membershipService.js';
import { startVoiceTracker } from '../services/voiceTracker.js';

export const name = 'ready';
export const once = true;

export async function execute(client) {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Voice time: who's in voice is looked at once a minute (services/voiceTracker.js).
  startVoiceTracker(client);

  // Catch up on members who left or rejoined while the bot was offline.
  reconcileAllGuilds(client).catch(err => console.error('[membership] Startup check failed:', err.message));

  startInactivityCheck(client);
  startLeaderboardPost(client);
  startServer(client);
}
