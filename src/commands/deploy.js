import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(__dirname).filter(f => f.endsWith('.js') && f !== 'deploy.js');

const commands = [];
for (const file of files) {
  const mod = await import(join(__dirname, file));
  if (mod.data) commands.push(mod.data.toJSON());
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);
const guildId = process.env.TEST_GUILD_ID;

console.log(`Registering ${commands.length} commands ${guildId ? `to guild ${guildId} (instant)` : 'globally (up to 1 hour)'}...`);
await rest.put(
  guildId
    ? Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId)
    : Routes.applicationCommands(process.env.CLIENT_ID),
  { body: commands }
);
console.log('Done!');
