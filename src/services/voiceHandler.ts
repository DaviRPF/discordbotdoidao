import {
  VoiceConnection,
  EndBehaviorType,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import { GuildMember, VoiceChannel } from 'discord.js';
import * as prism from 'prism-media';
import * as fs from 'fs';
import * as path from 'path';
import { chat } from './gemini';
import { textToSpeech, cleanupTempFile } from './tts';
import { transcribeAudio } from './stt';

const TEMP_DIR = path.join(process.cwd(), 'temp');
const BOT_NAME = 'bot doidão';
const BOT_ALIASES = ['bot', 'doidão', 'doidao', 'botdoidao', 'bot doidao'];

// Garantir que o diretório temp existe
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const activeListeners = new Map<string, boolean>();
const audioPlayer = createAudioPlayer();

export async function setupVoiceReceiver(
  connection: VoiceConnection,
  channel: VoiceChannel
): Promise<void> {
  const guildId = channel.guild.id;
  activeListeners.set(guildId, true);

  console.log(`🎤 Ouvindo no canal: ${channel.name}`);

  // Esperar conexão estar pronta
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    console.error('Conexão não ficou pronta a tempo');
    return;
  }

  connection.subscribe(audioPlayer);

  const receiver = connection.receiver;

  receiver.speaking.on('start', async (userId) => {
    if (!activeListeners.get(guildId)) return;

    const member = channel.members.get(userId);
    if (!member || member.user.bot) return;

    console.log(`🎙️ ${member.user.username} começou a falar...`);

    const audioStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1500, // 1.5 segundos de silêncio
      },
    });

    const chunks: Buffer[] = [];
    const opusDecoder = new prism.opus.Decoder({
      frameSize: 960,
      channels: 2,
      rate: 48000,
    });

    audioStream.pipe(opusDecoder);

    opusDecoder.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    opusDecoder.on('end', async () => {
      if (chunks.length === 0) return;

      const audioBuffer = Buffer.concat(chunks);

      // Só processar se tiver áudio suficiente (mais de 0.5 segundo)
      if (audioBuffer.length < 48000) {
        console.log('Áudio muito curto, ignorando...');
        return;
      }

      try {
        await processUserAudio(audioBuffer, member, connection, guildId);
      } catch (error) {
        console.error('Erro ao processar áudio:', error);
      }
    });
  });
}

async function processUserAudio(
  audioBuffer: Buffer,
  member: GuildMember,
  connection: VoiceConnection,
  guildId: string
): Promise<void> {
  const timestamp = Date.now();
  const rawPath = path.join(TEMP_DIR, `${member.id}_${timestamp}.raw`);
  const wavPath = path.join(TEMP_DIR, `${member.id}_${timestamp}.wav`);

  try {
    // Salvar áudio raw
    fs.writeFileSync(rawPath, audioBuffer);

    // Converter para WAV usando ffmpeg
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    await execAsync(
      `ffmpeg -f s16le -ar 48000 -ac 2 -i "${rawPath}" -ar 16000 -ac 1 "${wavPath}" -y`
    );

    // Transcrever o áudio
    const transcription = await transcribeAudio(wavPath);

    if (!transcription || transcription.trim().length < 2) {
      console.log('Transcrição vazia ou muito curta');
      return;
    }

    console.log(`📝 ${member.user.username}: "${transcription}"`);

    // Verificar se o usuário chamou o bot
    const lowerTranscription = transcription.toLowerCase();
    const botWasCalled = BOT_ALIASES.some((alias) => lowerTranscription.includes(alias));

    if (!botWasCalled) {
      console.log('Bot não foi chamado, ignorando...');
      return;
    }

    console.log('🤖 Bot foi chamado! Gerando resposta...');

    // Remover o nome do bot da mensagem para o Gemini
    let cleanMessage = transcription;
    for (const alias of BOT_ALIASES) {
      cleanMessage = cleanMessage.replace(new RegExp(alias, 'gi'), '').trim();
    }

    if (cleanMessage.length < 2) {
      cleanMessage = 'Oi, você me chamou?';
    }

    // Obter resposta do Gemini
    const response = await chat(member.id, cleanMessage);
    console.log(`🤖 Bot: "${response}"`);

    // Converter resposta para áudio
    const audioFile = await textToSpeech(response, `response_${timestamp}`);

    // Tocar o áudio
    await playAudio(connection, audioFile);

    // Limpar arquivo de resposta
    cleanupTempFile(audioFile);
  } catch (error) {
    console.error('Erro no processamento:', error);
  } finally {
    // Limpar arquivos temporários
    cleanupTempFile(rawPath);
    cleanupTempFile(wavPath);
  }
}

async function playAudio(connection: VoiceConnection, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const resource = createAudioResource(filePath);

      audioPlayer.play(resource);

      audioPlayer.once(AudioPlayerStatus.Idle, () => {
        resolve();
      });

      audioPlayer.once('error', (error) => {
        console.error('Erro no audio player:', error);
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function stopListening(guildId: string): void {
  activeListeners.set(guildId, false);
  console.log('🔇 Parei de ouvir');
}
