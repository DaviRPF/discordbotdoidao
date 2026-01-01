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
import { textToSpeech, cleanupTempFile, generateNotificationSound } from './tts';
import { transcribeBuffer } from './stt';

const TEMP_DIR = path.join(process.cwd(), 'temp');
const BOT_NAME = 'bot doidão';
const BOT_ALIASES = ['bote', 'bot', 'doidão', 'doidao', 'botdoidao', 'bot doidao']; // 'bote' primeiro pq Whisper transcreve assim
const DEBOUNCE_MS = 500; // Esperar 500ms de silêncio antes de processar

// Garantir que o diretório temp existe
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const activeListeners = new Map<string, boolean>();
const audioPlayer = createAudioPlayer();

// Handler de erro global para erros não tratados
audioPlayer.on('error', (error) => {
  console.error('❌ Erro no audioPlayer:', error.message);
});

// Ignorar erros de decriptação no processo
process.on('uncaughtException', (error) => {
  if (error.message?.includes('decrypt') || error.message?.includes('Decryption')) {
    console.log('⚠️ Erro de decriptação ignorado');
    return;
  }
  console.error('❌ Erro não tratado:', error);
});

// Debounce: acumular áudio do mesmo usuário
const userAudioBuffers = new Map<string, { chunks: Buffer[]; timeout: NodeJS.Timeout | null; activeStream: boolean }>();
const processingUsers = new Set<string>(); // Evitar processamento duplo

// Usuários que chamaram o bot e estão aguardando para falar o comando
const awaitingCommand = new Map<string, NodeJS.Timeout>(); // userId -> timeout para expirar

export async function setupVoiceReceiver(
  connection: VoiceConnection,
  channel: VoiceChannel
): Promise<void> {
  const guildId = channel.guild.id;
  activeListeners.set(guildId, true);

  console.log(`🎤 Bot conectado no canal: ${channel.name}`);

  connection.on('error', (error) => {
    console.error('❌ Erro na conexão:', error.message);
  });

  // Esperar conexão estar pronta
  try {
    if (connection.state.status !== VoiceConnectionStatus.Ready) {
      await entersState(connection, VoiceConnectionStatus.Ready, 60_000);
    }
    console.log('✅ Conexão pronta! Aguardando falas...');
  } catch (error) {
    console.log('⚠️ Timeout na conexão, tentando continuar...');
  }

  connection.subscribe(audioPlayer);
  const receiver = connection.receiver;

  receiver.speaking.on('start', async (userId) => {
    if (!activeListeners.get(guildId)) return;

    const member = channel.members.get(userId);
    if (!member || member.user.bot) return;

    // Verificar se já tem um stream ativo para este usuário
    let userBuffer = userAudioBuffers.get(userId);
    if (userBuffer?.activeStream) {
      // Já está capturando, só cancelar o timeout
      if (userBuffer.timeout) {
        clearTimeout(userBuffer.timeout);
        userBuffer.timeout = null;
      }
      return;
    }

    // Inicializar buffer do usuário
    if (!userBuffer) {
      userBuffer = { chunks: [], timeout: null, activeStream: true };
      userAudioBuffers.set(userId, userBuffer);
      console.log(`🎙️ ${member.user.username} está falando...`);
    } else {
      userBuffer.activeStream = true;
    }

    // Cancelar timeout anterior se existir
    if (userBuffer.timeout) {
      clearTimeout(userBuffer.timeout);
      userBuffer.timeout = null;
    }

    const audioStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1500,
      },
    });

    // Ignorar erros de decriptação (bug do Discord)
    audioStream.on('error', (error) => {
      if (error.message?.includes('decrypt')) {
        // Ignorar silenciosamente erros de decriptação
        return;
      }
      console.error('❌ Erro no audioStream:', error.message);
    });

    try {
      const opusDecoder = new prism.opus.Decoder({
        frameSize: 960,
        channels: 2,
        rate: 48000,
      });

      audioStream.pipe(opusDecoder);

      opusDecoder.on('data', (chunk: Buffer) => {
        userBuffer!.chunks.push(chunk);
      });

      opusDecoder.on('error', (error) => {
        console.error('❌ Erro no decoder:', error.message);
      });

      opusDecoder.on('end', () => {
        userBuffer!.activeStream = false;

        // Agendar processamento após DEBOUNCE_MS de silêncio
        userBuffer!.timeout = setTimeout(async () => {
          // Se já está processando, ignorar
          if (processingUsers.has(userId)) return;

          const chunks = userBuffer!.chunks;
          if (chunks.length === 0) return;

          // Limpar e processar
          userBuffer!.chunks = [];
          userAudioBuffers.delete(userId);

          const audioBuffer = Buffer.concat(chunks);
          console.log(`📊 Áudio: ${chunks.length} chunks, ${(audioBuffer.length / 1024).toFixed(0)}KB`);

          if (audioBuffer.length < 48000) {
            console.log(`⚠️ Muito curto, ignorando`);
            return;
          }

          processingUsers.add(userId);
          try {
            await processUserAudio(audioBuffer, member, connection, guildId);
          } finally {
            processingUsers.delete(userId);
          }
        }, DEBOUNCE_MS);
      });
    } catch (error: any) {
      console.error('❌ Erro ao criar decoder:', error.message);
    }
  });
}

async function processUserAudio(
  audioBuffer: Buffer,
  member: GuildMember,
  connection: VoiceConnection,
  guildId: string
): Promise<void> {
  const userId = member.id;
  const timestamp = Date.now();

  try {
    const startTime = Date.now();

    // Converter áudio para 16kHz mono via ffmpeg pipe (sem salvar arquivo)
    const { spawn } = require('child_process');

    const convertedBuffer = await new Promise<Buffer>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        '-i', 'pipe:0',
        '-f', 's16le',
        '-ar', '16000',
        '-ac', '1',
        'pipe:1',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      const chunks: Buffer[] = [];

      ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      ffmpeg.on('close', (code: number) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`ffmpeg exit code ${code}`));
        }
      });
      ffmpeg.on('error', reject);

      ffmpeg.stdin.write(audioBuffer);
      ffmpeg.stdin.end();
    });

    console.log(`⏱️ FFmpeg: ${Date.now() - startTime}ms`);

    const sttStart = Date.now();
    const transcription = await transcribeBuffer(convertedBuffer);
    console.log(`⏱️ Groq: ${Date.now() - sttStart}ms`);

    if (!transcription || transcription.trim().length < 2) {
      return;
    }

    console.log(`📝 "${transcription}"`);

    const lowerTranscription = transcription.toLowerCase();
    const isAwaitingCommand = awaitingCommand.has(userId);

    // Se está aguardando comando, manda direto pro Gemini
    if (isAwaitingCommand) {
      // Cancelar timeout
      const timeout = awaitingCommand.get(userId);
      if (timeout) clearTimeout(timeout);
      awaitingCommand.delete(userId);

      console.log('🤖 Processando comando...');
      const response = await chat(userId, transcription);
      console.log(`💬 "${response}"`);

      if (response && response.trim().length > 0) {
        const audioFile = await textToSpeech(response, `response_${timestamp}`);
        await playAudio(connection, audioFile);
        cleanupTempFile(audioFile);
      }
      return;
    }

    // Verificar se chamou o bot
    const botWasCalled = BOT_ALIASES.some((alias) => lowerTranscription.includes(alias));

    if (!botWasCalled) {
      return; // Ignorar silenciosamente
    }

    // Remover o nome do bot da mensagem
    let cleanMessage = transcription;
    for (const alias of BOT_ALIASES) {
      cleanMessage = cleanMessage.replace(new RegExp(alias, 'gi'), '').trim();
    }
    // Remover pontuação e espaços extras
    cleanMessage = cleanMessage.replace(/[.,!?;:]+/g, '').replace(/\s+/g, ' ').trim();

    // Se só falou o nome do bot (sem comando), tocar som e aguardar
    if (cleanMessage.length < 3) {
      console.log('🔔 Bot chamado! Aguardando comando...');

      // Tocar som de notificação
      try {
        console.log('🔊 Gerando som de notificação...');
        const notifSound = await generateNotificationSound();
        console.log('🔊 Tocando som:', notifSound);
        await playAudio(connection, notifSound);
        console.log('🔊 Som tocado!');
      } catch (e: any) {
        console.error('❌ Erro ao tocar som:', e?.message);
      }

      // Aguardar comando por 10 segundos
      const timeout = setTimeout(() => {
        awaitingCommand.delete(userId);
        console.log('⏰ Timeout aguardando comando');
      }, 10000);

      awaitingCommand.set(userId, timeout);
      return;
    }

    // Se falou o nome do bot + comando junto, processar direto
    console.log('🤖 Bot chamado com comando!');
    const response = await chat(userId, cleanMessage);
    console.log(`💬 "${response}"`);

    if (response && response.trim().length > 0) {
      const audioFile = await textToSpeech(response, `response_${timestamp}`);
      await playAudio(connection, audioFile);
      cleanupTempFile(audioFile);
    }
  } catch (error: any) {
    console.error('❌ Erro:', error.message);
  }
}

export async function playAudio(connection: VoiceConnection, filePath: string): Promise<void> {
  // Garantir que a conexão está subscrita ao player
  connection.subscribe(audioPlayer);
  return new Promise((resolve, reject) => {
    try {
      const resource = createAudioResource(filePath);
      audioPlayer.play(resource);

      audioPlayer.once(AudioPlayerStatus.Idle, () => resolve());
      audioPlayer.once('error', (error) => {
        console.error('❌ Erro ao tocar áudio:', error.message);
        reject(error);
      });
    } catch (error: any) {
      console.error('❌ Erro ao criar áudio:', error.message);
      reject(error);
    }
  });
}

export function stopListening(guildId: string): void {
  activeListeners.set(guildId, false);
  console.log('🔇 Parei de ouvir');
}

export function pauseAudio(): boolean {
  if (audioPlayer.state.status === AudioPlayerStatus.Playing) {
    audioPlayer.pause();
    console.log('⏸️ Áudio pausado');
    return true;
  }
  return false;
}

export function resumeAudio(): boolean {
  if (audioPlayer.state.status === AudioPlayerStatus.Paused) {
    audioPlayer.unpause();
    console.log('▶️ Áudio retomado');
    return true;
  }
  return false;
}

export function stopAudio(): boolean {
  audioPlayer.stop();
  console.log('⏹️ Áudio parado');
  return true;
}

export function getAudioStatus(): string {
  return audioPlayer.state.status;
}

export async function speakText(connection: VoiceConnection, text: string): Promise<void> {
  const timestamp = Date.now();
  console.log('🔊 speakText: Gerando TTS...');
  const audioFile = await textToSpeech(text, `speak_${timestamp}`);
  console.log('🔊 speakText: Arquivo gerado:', audioFile);

  // Garantir que a conexão está subscrita ao player
  connection.subscribe(audioPlayer);

  console.log('🔊 speakText: Tocando áudio...');
  await playAudio(connection, audioFile);
  console.log('🔊 speakText: Áudio tocado!');
  cleanupTempFile(audioFile);
}
