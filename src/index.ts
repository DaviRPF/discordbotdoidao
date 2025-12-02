import { Client, GatewayIntentBits, Events, Collection } from 'discord.js';
import { config } from 'dotenv';
import { joinCommand } from './commands/join';
import { leaveCommand } from './commands/leave';
import { Command } from './types';

config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

const commands = new Collection<string, Command>();
commands.set(joinCommand.data.name, joinCommand);
commands.set(leaveCommand.data.name, leaveCommand);

client.once(Events.ClientReady, (c) => {
  console.log(`🤖 Bot online como ${c.user.tag}`);
  console.log(`📢 Use /entrar para me chamar no voice!`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);

  if (!command) {
    console.error(`Comando ${interaction.commandName} não encontrado.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    const reply = {
      content: 'Ocorreu um erro ao executar esse comando!',
      ephemeral: true,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('❌ DISCORD_TOKEN não encontrado no .env');
  process.exit(1);
}

client.login(token);
