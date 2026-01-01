import {
  VoiceConnection,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  AudioPlayer,
} from '@discordjs/voice';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

const MUSIC_DIR = path.join(process.cwd(), 'music');
const YT_DLP_PATH = path.join(process.cwd(), 'yt-dlp.exe');

// Garantir que o diretório existe
if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
}

export interface Song {
  id: string;
  title: string;
  url: string;
  filePath: string;
  duration: number;
  requestedBy: string;
  thumbnail?: string;
  isDownloading: boolean;
  isReady: boolean;
  downloadPromise?: Promise<string>;
}

interface MusicState {
  queue: Song[];
  currentSong: Song | null;
  isPlaying: boolean;
  isPaused: boolean;
  startTime: number;
  pausedAt: number;
  connection: VoiceConnection | null;
}

const state: MusicState = {
  queue: [],
  currentSong: null,
  isPlaying: false,
  isPaused: false,
  startTime: 0,
  pausedAt: 0,
  connection: null,
};

const musicPlayer: AudioPlayer = createAudioPlayer();

// Handler de erro
musicPlayer.on('error', (error) => {
  console.error('❌ [MUSIC] Erro no player:', error.message);
  playNext();
});

// Quando terminar de tocar, vai pra próxima
musicPlayer.on(AudioPlayerStatus.Idle, () => {
  if (state.isPlaying && !state.isPaused) {
    console.log('🎵 [MUSIC] Música terminou, próxima...');
    playNext();
  }
});

export function setMusicConnection(connection: VoiceConnection | null) {
  state.connection = connection;
  if (connection) {
    connection.subscribe(musicPlayer);
  }
}

// Pegar info do vídeo do YouTube (rápido, não baixa)
async function getVideoInfo(url: string): Promise<{ title: string; duration: number; thumbnail: string }> {
  try {
    const cmd = `"${YT_DLP_PATH}" --print "%(title)s|||%(duration)s|||%(thumbnail)s" --no-download "${url}"`;
    const { stdout } = await execAsync(cmd, { timeout: 30000 });
    const [title, durationStr, thumbnail] = stdout.trim().split('|||');
    return {
      title: title || 'Música desconhecida',
      duration: parseInt(durationStr) || 0,
      thumbnail: thumbnail || '',
    };
  } catch (error: any) {
    console.error('❌ [MUSIC] Erro ao pegar info:', error.message);
    return { title: 'Música desconhecida', duration: 0, thumbnail: '' };
  }
}

// Baixar música do YouTube (retorna Promise)
async function downloadSong(song: Song): Promise<string> {
  const outputPath = path.join(MUSIC_DIR, `${song.id}.mp3`);

  // Se já existe, retornar
  if (fs.existsSync(outputPath)) {
    return outputPath;
  }

  console.log(`🎵 [MUSIC] Baixando: "${song.title}"`);
  const cmd = `"${YT_DLP_PATH}" -x --audio-format mp3 --audio-quality 0 -o "${outputPath}" "${song.url}"`;

  try {
    await execAsync(cmd, { timeout: 300000 }); // 5 min timeout

    if (!fs.existsSync(outputPath)) {
      throw new Error('Arquivo não foi criado');
    }

    console.log(`✅ [MUSIC] Download concluído: "${song.title}"`);
    return outputPath;
  } catch (error: any) {
    console.error(`❌ [MUSIC] Erro no download de "${song.title}":`, error.message);
    throw error;
  }
}

// Iniciar download em background
function startBackgroundDownload(song: Song): void {
  if (song.isDownloading || song.isReady) return;

  song.isDownloading = true;
  song.downloadPromise = downloadSong(song)
    .then((filePath) => {
      song.filePath = filePath;
      song.isReady = true;
      song.isDownloading = false;
      console.log(`✅ [MUSIC] "${song.title}" pronto para tocar`);

      // Se não tem nada tocando e essa é a primeira da fila, começar
      if (!state.isPlaying && !state.currentSong && state.queue[0]?.id === song.id) {
        playNext();
      }

      return filePath;
    })
    .catch((error) => {
      song.isDownloading = false;
      console.error(`❌ [MUSIC] Falha no download de "${song.title}"`);

      // Remover da fila se falhou
      const index = state.queue.findIndex(s => s.id === song.id);
      if (index !== -1) {
        state.queue.splice(index, 1);
      }

      throw error;
    });
}

// Pré-baixar próximas músicas da fila
function prefetchNext(): void {
  // Baixar as próximas 2 músicas que ainda não estão baixando
  const toDownload = state.queue
    .filter(s => !s.isDownloading && !s.isReady)
    .slice(0, 2);

  toDownload.forEach(song => {
    console.log(`📥 [MUSIC] Pré-baixando: "${song.title}"`);
    startBackgroundDownload(song);
  });
}

// Adicionar música na fila (retorna imediatamente após pegar info)
export async function addToQueue(url: string, requestedBy: string): Promise<Song> {
  // Validar URL do YouTube
  if (!url.match(/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//)) {
    throw new Error('URL inválida. Use um link do YouTube.');
  }

  const songId = `song_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  console.log(`🎵 [MUSIC] Pegando info: ${url}`);

  // Pegar info do vídeo (rápido)
  const info = await getVideoInfo(url);

  const song: Song = {
    id: songId,
    title: info.title,
    url,
    filePath: '',
    duration: info.duration,
    requestedBy,
    thumbnail: info.thumbnail,
    isDownloading: false,
    isReady: false,
  };

  state.queue.push(song);
  console.log(`✅ [MUSIC] "${song.title}" adicionada à fila (${state.queue.length} na fila)`);

  // Iniciar download em background
  startBackgroundDownload(song);

  // Se não está tocando nada e essa é a primeira, tentar tocar
  if (!state.isPlaying && !state.currentSong && state.queue.length === 1) {
    // Esperar o download se for a primeira
    if (song.downloadPromise) {
      song.downloadPromise.then(() => {
        if (!state.isPlaying && !state.currentSong) {
          playNext();
        }
      }).catch(() => {});
    }
  }

  return song;
}

// Tocar próxima música
export async function playNext(): Promise<boolean> {
  state.currentSong = null;
  state.isPlaying = false;
  state.isPaused = false;
  state.startTime = 0;
  state.pausedAt = 0;

  if (state.queue.length === 0) {
    console.log('🎵 [MUSIC] Fila vazia');
    musicPlayer.stop();
    return false;
  }

  const song = state.queue[0];

  // Esperar download se ainda não terminou
  if (!song.isReady) {
    console.log(`⏳ [MUSIC] Aguardando download de "${song.title}"...`);

    if (song.downloadPromise) {
      try {
        await song.downloadPromise;
      } catch {
        // Remove da fila e tenta próxima
        state.queue.shift();
        return playNext();
      }
    } else {
      // Começar download se não iniciou
      startBackgroundDownload(song);
      if (song.downloadPromise) {
        try {
          await song.downloadPromise;
        } catch {
          state.queue.shift();
          return playNext();
        }
      }
    }
  }

  // Remover da fila
  state.queue.shift();

  try {
    state.currentSong = song;
    state.isPlaying = true;
    state.startTime = Date.now();

    if (!state.connection) {
      throw new Error('Não conectado a um canal de voz');
    }

    state.connection.subscribe(musicPlayer);

    const resource = createAudioResource(song.filePath);
    musicPlayer.play(resource);

    console.log(`🎵 [MUSIC] Tocando: "${song.title}"`);

    // Pré-baixar próximas músicas
    prefetchNext();

    return true;
  } catch (error: any) {
    console.error(`❌ [MUSIC] Erro ao tocar "${song.title}":`, error.message);
    return playNext();
  }
}

// Pular música atual
export function skip(): boolean {
  if (!state.currentSong) {
    return false;
  }

  console.log(`⏭️ [MUSIC] Pulando: "${state.currentSong.title}"`);
  musicPlayer.stop();
  return true;
}

// Voltar para música anterior (reinicia a música atual)
export function previous(): boolean {
  if (!state.currentSong) {
    return false;
  }

  try {
    const resource = createAudioResource(state.currentSong.filePath);
    musicPlayer.play(resource);
    state.startTime = Date.now();
    state.isPaused = false;
    console.log(`⏮️ [MUSIC] Reiniciando: "${state.currentSong.title}"`);
    return true;
  } catch {
    return false;
  }
}

// Pausar
export function pause(): boolean {
  if (!state.isPlaying || state.isPaused) {
    return false;
  }

  musicPlayer.pause();
  state.isPaused = true;
  state.pausedAt = Date.now() - state.startTime;
  console.log('⏸️ [MUSIC] Pausado');
  return true;
}

// Retomar
export function resume(): boolean {
  if (!state.isPaused) {
    return false;
  }

  musicPlayer.unpause();
  state.isPaused = false;
  state.startTime = Date.now() - state.pausedAt;
  console.log('▶️ [MUSIC] Retomado');
  return true;
}

// Parar tudo
export function stop(): void {
  musicPlayer.stop();
  state.queue = [];
  state.currentSong = null;
  state.isPlaying = false;
  state.isPaused = false;
  state.startTime = 0;
  state.pausedAt = 0;
  console.log('⏹️ [MUSIC] Parado');
}

// Remover música da fila por índice
export function removeFromQueue(index: number): Song | null {
  if (index < 0 || index >= state.queue.length) {
    return null;
  }
  const removed = state.queue.splice(index, 1)[0];
  console.log(`🗑️ [MUSIC] Removido da fila: "${removed.title}"`);
  return removed;
}

// Limpar fila
export function clearQueue(): void {
  state.queue = [];
  console.log('🗑️ [MUSIC] Fila limpa');
}

// Pegar estado atual (sem expor downloadPromise)
export function getMusicStatus(): {
  currentSong: Omit<Song, 'downloadPromise'> | null;
  queue: Omit<Song, 'downloadPromise'>[];
  isPlaying: boolean;
  isPaused: boolean;
  progress: number;
  duration: number;
} {
  let progress = 0;

  if (state.currentSong && state.isPlaying) {
    if (state.isPaused) {
      progress = Math.floor(state.pausedAt / 1000);
    } else {
      progress = Math.floor((Date.now() - state.startTime) / 1000);
    }
  }

  // Remover downloadPromise do retorno
  const sanitizeSong = (song: Song): Omit<Song, 'downloadPromise'> => {
    const { downloadPromise, ...rest } = song;
    return rest;
  };

  return {
    currentSong: state.currentSong ? sanitizeSong(state.currentSong) : null,
    queue: state.queue.map(sanitizeSong),
    isPlaying: state.isPlaying,
    isPaused: state.isPaused,
    progress,
    duration: state.currentSong?.duration || 0,
  };
}

// Formatar tempo
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
