import { SlashCommandBuilder, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { joinVoiceChannel, DiscordGatewayAdapterCreator } from '@discordjs/voice';
import { Command } from '../types';
import { setupVoiceReceiver } from '../services/voiceHandler';

export const joinCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('entrar')
    .setDescription('Bot entra no seu canal de voz para conversar'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.member as GuildMember;

    if (!member.voice.channel) {
      await interaction.reply({
        content: '❌ Você precisa estar em um canal de voz primeiro!',
        ephemeral: true,
      });
      return;
    }

    const voiceChannel = member.voice.channel;

    if (!voiceChannel.isVoiceBased()) {
      await interaction.reply({
        content: '❌ Canal inválido!',
        ephemeral: true,
      });
      return;
    }

    try {
      await interaction.deferReply();

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
        selfDeaf: false, // Não ficar surdo para ouvir usuários
        selfMute: false,
      });

      // Configurar o receptor de voz
      await setupVoiceReceiver(connection, voiceChannel as any);

      await interaction.editReply({
        content: `🎤 Entrei no canal **${voiceChannel.name}**!\n\n` +
          `📢 Me chame dizendo **"Bot Doidão"** ou **"Bot"** seguido da sua pergunta!\n` +
          `Exemplo: "Bot, qual a capital do Brasil?"`,
      });
    } catch (error) {
      console.error('Erro ao entrar no canal:', error);
      await interaction.editReply({
        content: '❌ Não consegui entrar no canal de voz!',
      });
    }
  },
};
