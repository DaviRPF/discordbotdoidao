import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import { joinCommand } from './commands/join';
import { leaveCommand } from './commands/leave';

config();

const commands = [joinCommand.data.toJSON(), leaveCommand.data.toJSON()];

const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

async function deployCommands() {
  try {
    console.log('🔄 Registrando comandos slash...');

    const clientId = process.env.DISCORD_CLIENT_ID;
    const guildId = process.env.DISCORD_GUILD_ID;

    if (!clientId) {
      console.error('❌ DISCORD_CLIENT_ID não encontrado no .env');
      process.exit(1);
    }

    if (guildId) {
      // Deploy para um servidor específico (mais rápido para testes)
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });
      console.log(`✅ Comandos registrados no servidor ${guildId}!`);
    } else {
      // Deploy global (pode demorar até 1 hora)
      await rest.put(Routes.applicationCommands(clientId), {
        body: commands,
      });
      console.log('✅ Comandos registrados globalmente!');
    }
  } catch (error) {
    console.error('❌ Erro ao registrar comandos:', error);
  }
}

deployCommands();
