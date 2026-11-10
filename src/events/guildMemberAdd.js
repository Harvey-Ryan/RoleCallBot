import { markRejoined } from '../services/membershipService.js';

export const name = 'guildMemberAdd';

export async function execute(member) {
  if (member.user.bot) return;
  try {
    if (await markRejoined(member.guild.id, member.id)) {
      console.log(`[guildMemberAdd] ${member.user.tag} rejoined ${member.guild.name}`);
    }
  } catch (err) {
    console.error('[guildMemberAdd]', err.message);
  }
}
