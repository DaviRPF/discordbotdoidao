import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { Command } from '../types';
import { stopListening } from '../services/voiceHandler';

export const leaveCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('sair')
    .setDescription('Bot sai do canal de voz'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({
        content: '❌ Esse comando só funciona em servidores!',
        ephemeral: true,
      });
      return;
    }

    const connection = getVoiceConnection(guildId);

    if (!connection) {
      await interaction.reply({
        content: '❌ Não estou em nenhum canal de voz!',
        ephemeral: true,
      });
      return;
    }

    try {
      stopListening(guildId);
      connection.destroy();

      await interaction.reply({
        content: '👋 Saí do canal de voz! Até mais!',
      });
    } catch (error) {
      console.error('Erro ao sair do canal:', error);
      await interaction.reply({
        content: '❌ Erro ao sair do canal!',
        ephemeral: true,
      });
    }
  },
};
