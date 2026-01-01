import { Client, GatewayIntentBits, Events, GuildMember, Message } from 'discord.js';
import { config } from 'dotenv';
import { joinVoiceChannel, getVoiceConnection, DiscordGatewayAdapterCreator } from '@discordjs/voice';
import { setupVoiceReceiver, stopListening, speakText, playAudio, pauseAudio, resumeAudio, stopAudio, getAudioStatus } from './services/voiceHandler';
import { startWebPanel, setConnection, setSpeakText, setPlayAudio, setPauseAudio, setResumeAudio, setStopAudio, setGetAudioStatus, setChat } from './services/webPanel';
import { chat } from './services/gemini';
import { addToQueue, skip, getMusicStatus, formatTime } from './services/musicPlayer';

config();

// Iniciar painel web
setSpeakText(speakText);
setPlayAudio(playAudio);
setPauseAudio(pauseAudio);
setResumeAudio(resumeAudio);
setStopAudio(stopAudio);
setGetAudioStatus(getAudioStatus);
setChat(chat);
startWebPanel(3000);

const PREFIX = 'ff!';
const AUTO_JOIN_USER_ID = '534771425442267137'; // Seu ID do Discord

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`🤖 Bot online como ${c.user.tag}`);
  console.log(`📢 Use ff!entrar para me chamar no voice!`);

  // Auto-join: procurar em qual canal de voz o usuário está
  for (const guild of c.guilds.cache.values()) {
    try {
      const member = await guild.members.fetch(AUTO_JOIN_USER_ID).catch(() => null);
      if (member?.voice.channel) {
        const voiceChannel = member.voice.channel;
        console.log(`🔍 Encontrei você no canal "${voiceChannel.name}"! Entrando...`);

        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: voiceChannel.guild.id,
          adapterCreator: voiceChannel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
          selfDeaf: false,
          selfMute: false,
        });

        await setupVoiceReceiver(connection, voiceChannel as any);
        setConnection(connection);
        console.log(`🎤 Entrei automaticamente no canal "${voiceChannel.name}"!`);
        break;
      }
    } catch (e) {
      // Ignorar erros ao buscar membro
    }
  }
});

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;
  if (!message.guild) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  // ff!entrar
  if (command === 'entrar') {
    const member = message.member as GuildMember;

    if (!member.voice.channel) {
      await message.reply('❌ Você precisa estar em um canal de voz primeiro!');
      return;
    }

    const voiceChannel = member.voice.channel;

    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });

      await setupVoiceReceiver(connection, voiceChannel as any);
      setConnection(connection);

      await message.reply(
        `🎤 Entrei no canal **${voiceChannel.name}**!\n\n` +
        `📢 Me chame dizendo **"Bot Doidão"** ou **"Bot"** seguido da sua pergunta!\n` +
        `Exemplo: "Bot, qual a capital do Brasil?"`
      );
    } catch (error) {
      console.error('Erro ao entrar no canal:', error);
      await message.reply('❌ Não consegui entrar no canal de voz!');
    }
  }

  // ff!sair
  if (command === 'sair') {
    const connection = getVoiceConnection(message.guild.id);

    if (!connection) {
      await message.reply('❌ Não estou em nenhum canal de voz!');
      return;
    }

    try {
      stopListening(message.guild.id);
      connection.destroy();
      setConnection(null);
      await message.reply('👋 Saí do canal de voz! Até mais!');
    } catch (error) {
      console.error('Erro ao sair do canal:', error);
      await message.reply('❌ Erro ao sair do canal!');
    }
  }

  // ff!fala <texto>
  if (command === 'fala') {
    const connection = getVoiceConnection(message.guild.id);

    if (!connection) {
      await message.reply('❌ Não estou em nenhum canal de voz!');
      return;
    }

    const texto = args.join(' ');
    if (!texto) {
      await message.reply('❌ Use: ff!fala <texto>');
      return;
    }

    console.log(`📢 ff!fala: ${texto}`);
    await speakText(connection, texto);
    await message.reply(`🎤 Falando: "${texto}"`);
  }

  // ff!quem
  if (command === 'quem') {
    const connection = getVoiceConnection(message.guild.id);

    if (!connection) {
      await message.reply('❌ Não estou em nenhum canal de voz!');
      return;
    }

    const member = message.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      await message.reply('❌ Você não está em um canal de voz!');
      return;
    }

    // Pegar membros do canal (excluindo bots)
    const members = voiceChannel.members.filter(m => !m.user.bot);
    const names = members.map(m => m.displayName);

    if (names.length === 0) {
      await speakText(connection, 'Não tem ninguém na call comigo.');
      return;
    }

    const text = names.length === 1
      ? `Só tem ${names[0]} na call comigo.`
      : `Na call comigo tem: ${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}.`;

    console.log(`📢 ff!quem: ${text}`);
    await speakText(connection, text);
    await message.reply(`🎤 ${text}`);
  }

  // ff!gpt <pergunta>
  if (command === 'gpt') {
    const pergunta = args.join(' ');
    if (!pergunta) {
      await message.reply('❌ Use: ff!gpt <sua pergunta>');
      return;
    }

    try {
      await message.channel.sendTyping();
      console.log(`🤖 ff!gpt: "${pergunta}"`);

      const resposta = await chat(message.author.id, pergunta);
      console.log(`💬 Resposta: "${resposta}"`);

      await message.reply(`🤖 **Bot Doidão:**\n${resposta}`);

      // Se estiver no voice, fala a resposta
      const connection = getVoiceConnection(message.guild.id);
      if (connection) {
        speakText(connection, resposta).catch(e => {
          console.error('❌ Erro ao falar:', e.message);
        });
      }
    } catch (error: any) {
      console.error('❌ Erro no ff!gpt:', error);
      await message.reply('❌ Deu ruim aqui, tenta de novo!');
    }
  }

  // ff!play <url do youtube>
  if (command === 'play') {
    const connection = getVoiceConnection(message.guild.id);

    if (!connection) {
      await message.reply('❌ Não estou em nenhum canal de voz! Use `ff!entrar` primeiro.');
      return;
    }

    const url = args[0];
    if (!url) {
      await message.reply('❌ Use: `ff!play <link do YouTube>`');
      return;
    }

    try {
      await message.channel.sendTyping();
      const song = await addToQueue(url, message.author.username);

      const status = getMusicStatus();
      const posicao = status.queue.length;

      if (posicao === 0 && status.isPlaying) {
        await message.reply(`🎵 **Tocando agora:** ${song.title}\n⏱️ Duração: ${formatTime(song.duration)}`);
      } else {
        await message.reply(`📝 **Adicionado à fila:** ${song.title}\n⏱️ Duração: ${formatTime(song.duration)}\n📍 Posição: ${posicao + 1}`);
      }
    } catch (error: any) {
      console.error('❌ Erro no ff!play:', error);
      await message.reply('❌ Erro ao adicionar música. Verifique se o link é válido.');
    }
  }

  // ff!skip
  if (command === 'skip' || command === 'pular') {
    const connection = getVoiceConnection(message.guild.id);

    if (!connection) {
      await message.reply('❌ Não estou em nenhum canal de voz!');
      return;
    }

    const status = getMusicStatus();
    if (!status.currentSong) {
      await message.reply('❌ Não tem música tocando!');
      return;
    }

    const skippedTitle = status.currentSong.title;
    const skipped = skip();

    if (skipped) {
      await message.reply(`⏭️ Pulei: **${skippedTitle}**`);
    } else {
      await message.reply('❌ Não consegui pular.');
    }
  }

  // ff!fila
  if (command === 'fila' || command === 'queue') {
    const status = getMusicStatus();

    if (!status.currentSong && status.queue.length === 0) {
      await message.reply('📭 A fila está vazia!');
      return;
    }

    let response = '';

    if (status.currentSong) {
      const progress = formatTime(status.progress);
      const duration = formatTime(status.duration);
      const pauseIcon = status.isPaused ? '⏸️' : '▶️';
      response += `${pauseIcon} **Tocando:** ${status.currentSong.title}\n`;
      response += `⏱️ ${progress} / ${duration}\n\n`;
    }

    if (status.queue.length > 0) {
      response += `📜 **Fila (${status.queue.length}):**\n`;
      status.queue.slice(0, 10).forEach((song, i) => {
        response += `${i + 1}. ${song.title} (${formatTime(song.duration)})\n`;
      });
      if (status.queue.length > 10) {
        response += `... e mais ${status.queue.length - 10} músicas`;
      }
    }

    await message.reply(response);
  }
});

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('❌ DISCORD_TOKEN não encontrado no .env');
  process.exit(1);
}

client.login(token);
