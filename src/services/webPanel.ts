import express from 'express';
import multer from 'multer';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { VoiceConnection } from '@discordjs/voice';
import {
  addToQueue,
  skip,
  previous,
  pause as musicPause,
  resume as musicResume,
  stop as musicStop,
  removeFromQueue,
  clearQueue,
  getMusicStatus,
  setMusicConnection,
} from './musicPlayer';

const execAsync = promisify(exec);
const SOUNDS_DIR = path.join(process.cwd(), 'sounds');
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const YT_DLP_PATH = path.join(process.cwd(), 'yt-dlp.exe');

// Garantir que as pastas existem
if (!fs.existsSync(SOUNDS_DIR)) {
  fs.mkdirSync(SOUNDS_DIR, { recursive: true });
}

// Configurar multer para upload com pasta dinâmica
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = (req.query.folder as string) || '';
    const destPath = path.join(SOUNDS_DIR, folder);
    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(destPath, { recursive: true });
    }
    cb(null, destPath);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safeName);
  },
});
const upload = multer({ storage });

let currentConnection: VoiceConnection | null = null;
let speakTextFn: ((connection: VoiceConnection, text: string) => Promise<void>) | null = null;
let playAudioFn: ((connection: VoiceConnection, filePath: string) => Promise<void>) | null = null;
let pauseAudioFn: (() => boolean) | null = null;
let resumeAudioFn: (() => boolean) | null = null;
let stopAudioFn: (() => boolean) | null = null;
let getAudioStatusFn: (() => string) | null = null;
let chatFn: ((userId: string, message: string) => Promise<string>) | null = null;

export function setConnection(connection: VoiceConnection | null) {
  currentConnection = connection;
  setMusicConnection(connection);
}

export function setSpeakText(fn: (connection: VoiceConnection, text: string) => Promise<void>) {
  speakTextFn = fn;
}

export function setPlayAudio(fn: (connection: VoiceConnection, filePath: string) => Promise<void>) {
  playAudioFn = fn;
}

export function setPauseAudio(fn: () => boolean) {
  pauseAudioFn = fn;
}

export function setResumeAudio(fn: () => boolean) {
  resumeAudioFn = fn;
}

export function setStopAudio(fn: () => boolean) {
  stopAudioFn = fn;
}

export function setGetAudioStatus(fn: () => string) {
  getAudioStatusFn = fn;
}

export function setChat(fn: (userId: string, message: string) => Promise<string>) {
  chatFn = fn;
}

// Função para listar conteúdo de uma pasta
function listFolder(folderPath: string): { folders: string[]; files: string[] } {
  const fullPath = path.join(SOUNDS_DIR, folderPath);
  if (!fs.existsSync(fullPath)) {
    return { folders: [], files: [] };
  }

  const items = fs.readdirSync(fullPath, { withFileTypes: true });
  const folders = items.filter(i => i.isDirectory()).map(i => i.name);
  const files = items
    .filter(i => i.isFile() && ['.mp3', '.wav', '.ogg', '.m4a'].includes(path.extname(i.name).toLowerCase()))
    .map(i => i.name);

  return { folders, files };
}

export function startWebPanel(port: number = 3000) {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  // Listar conteúdo de uma pasta
  app.get('/api/sounds', (req, res) => {
    try {
      const folder = (req.query.folder as string) || '';
      const result = listFolder(folder);
      res.json(result);
    } catch {
      res.json({ folders: [], files: [] });
    }
  });

  // Criar pasta
  app.post('/api/folders', (req, res) => {
    const { name, parent } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Nome da pasta não fornecido' });
    }

    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    const folderPath = path.join(SOUNDS_DIR, parent || '', safeName);

    try {
      if (fs.existsSync(folderPath)) {
        return res.status(400).json({ error: 'Pasta já existe' });
      }
      fs.mkdirSync(folderPath, { recursive: true });
      res.json({ success: true, name: safeName });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Deletar pasta
  app.delete('/api/folders', (req, res) => {
    const { folder } = req.body;
    if (!folder) {
      return res.status(400).json({ error: 'Pasta não especificada' });
    }

    const folderPath = path.join(SOUNDS_DIR, folder);

    try {
      if (!fs.existsSync(folderPath)) {
        return res.status(404).json({ error: 'Pasta não encontrada' });
      }
      fs.rmSync(folderPath, { recursive: true });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Upload de som
  app.post('/api/sounds/upload', upload.single('sound'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }
    res.json({ success: true, filename: req.file.filename });
  });

  // Renomear arquivo ou pasta
  app.post('/api/sounds/rename', (req, res) => {
    const { oldPath, newName } = req.body;
    if (!oldPath || !newName) {
      return res.status(400).json({ error: 'Caminho ou novo nome não fornecido' });
    }

    const fullOldPath = path.join(SOUNDS_DIR, oldPath);
    const ext = path.extname(oldPath);
    const dir = path.dirname(oldPath);
    const safeName = newName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    const newFileName = ext ? `${safeName}${ext}` : safeName;
    const fullNewPath = path.join(SOUNDS_DIR, dir, newFileName);

    try {
      if (!fs.existsSync(fullOldPath)) {
        return res.status(404).json({ error: 'Arquivo não encontrado' });
      }
      if (fs.existsSync(fullNewPath)) {
        return res.status(400).json({ error: 'Já existe um arquivo com esse nome' });
      }
      fs.renameSync(fullOldPath, fullNewPath);
      res.json({ success: true, newName: newFileName });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Mover arquivo para outra pasta
  app.post('/api/sounds/move', (req, res) => {
    const { filePath, targetFolder } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: 'Arquivo não especificado' });
    }

    const fullOldPath = path.join(SOUNDS_DIR, filePath);
    const fileName = path.basename(filePath);
    const fullNewPath = path.join(SOUNDS_DIR, targetFolder || '', fileName);

    try {
      if (!fs.existsSync(fullOldPath)) {
        return res.status(404).json({ error: 'Arquivo não encontrado' });
      }
      if (fs.existsSync(fullNewPath)) {
        return res.status(400).json({ error: 'Já existe um arquivo com esse nome na pasta destino' });
      }
      fs.renameSync(fullOldPath, fullNewPath);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Deletar som
  app.delete('/api/sounds', (req, res) => {
    const filepath = req.query.path as string;
    if (!filepath) {
      return res.status(400).json({ error: 'Caminho não especificado' });
    }
    const filePath = path.join(SOUNDS_DIR, filepath);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Arquivo não encontrado' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Download do YouTube
  app.post('/api/sounds/youtube', async (req, res) => {
    const { url, name, folder } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL não fornecida' });
    }

    if (!url.match(/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//)) {
      return res.status(400).json({ error: 'URL inválida. Use um link do YouTube.' });
    }

    try {
      const safeName = (name || 'youtube_audio').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
      const targetFolder = path.join(SOUNDS_DIR, folder || '');
      if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder, { recursive: true });
      }
      const outputPath = path.join(targetFolder, `${safeName}.mp3`);

      console.log(`🎵 Baixando do YouTube: ${url}`);

      const cmd = `"${YT_DLP_PATH}" -x --audio-format mp3 --audio-quality 0 -o "${outputPath}" "${url}"`;
      await execAsync(cmd, { timeout: 120000 });

      if (!fs.existsSync(outputPath)) {
        throw new Error('Arquivo não foi criado');
      }

      console.log(`✅ Download concluído: ${safeName}.mp3`);
      res.json({ success: true, filename: `${safeName}.mp3` });
    } catch (e: any) {
      console.error('❌ Erro no download:', e.message);
      res.status(500).json({ error: 'Erro ao baixar. Verifique se o link é válido.' });
    }
  });

  // Tocar som (suporta subpastas)
  app.post('/api/sounds/play', async (req, res) => {
    if (!currentConnection) {
      return res.status(400).json({ error: 'Bot não está em um canal de voz' });
    }
    if (!playAudioFn) {
      return res.status(500).json({ error: 'Função de áudio não configurada' });
    }

    const filepath = req.query.path as string;
    if (!filepath) {
      return res.status(400).json({ error: 'Caminho não especificado' });
    }

    const filePath = path.join(SOUNDS_DIR, filepath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }

    try {
      console.log(`🔊 Painel: Tocando ${filepath}`);
      await playAudioFn(currentConnection, filePath);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Falar texto (TTS)
  app.post('/api/speak', async (req, res) => {
    if (!currentConnection) {
      return res.status(400).json({ error: 'Bot não está em um canal de voz' });
    }
    if (!speakTextFn) {
      return res.status(500).json({ error: 'Função TTS não configurada' });
    }

    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Texto não fornecido' });
    }

    try {
      console.log(`🔊 Painel: Falando "${text}"`);
      await speakTextFn(currentConnection, text);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Pausar áudio
  app.post('/api/audio/pause', (req, res) => {
    if (!pauseAudioFn) {
      return res.status(500).json({ error: 'Função não configurada' });
    }
    const paused = pauseAudioFn();
    res.json({ success: paused, status: paused ? 'paused' : 'not_playing' });
  });

  // Retomar áudio
  app.post('/api/audio/resume', (req, res) => {
    if (!resumeAudioFn) {
      return res.status(500).json({ error: 'Função não configurada' });
    }
    const resumed = resumeAudioFn();
    res.json({ success: resumed, status: resumed ? 'playing' : 'not_paused' });
  });

  // Parar áudio
  app.post('/api/audio/stop', (req, res) => {
    if (!stopAudioFn) {
      return res.status(500).json({ error: 'Função não configurada' });
    }
    stopAudioFn();
    res.json({ success: true, status: 'stopped' });
  });

  // Status do áudio
  app.get('/api/audio/status', (req, res) => {
    const status = getAudioStatusFn ? getAudioStatusFn() : 'unknown';
    res.json({ status });
  });

  // Chat com IA
  app.post('/api/chat', async (req, res) => {
    if (!chatFn) {
      return res.status(500).json({ error: 'Função de chat não configurada' });
    }

    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Mensagem não fornecida' });
    }

    try {
      console.log(`💬 Painel: Pergunta "${message}"`);
      const response = await chatFn('web-panel', message);
      console.log(`🤖 Painel: Resposta "${response}"`);

      // Se estiver conectado, fala a resposta
      if (currentConnection && speakTextFn) {
        speakTextFn(currentConnection, response).catch(e => {
          console.error('❌ Erro ao falar resposta:', e.message);
        });
      }

      res.json({ success: true, response });
    } catch (e: any) {
      console.error('❌ Erro no chat:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ==================== MUSIC ENDPOINTS ====================

  // Status da música
  app.get('/api/music/status', (req, res) => {
    res.json(getMusicStatus());
  });

  // Adicionar música na fila
  app.post('/api/music/play', async (req, res) => {
    if (!currentConnection) {
      return res.status(400).json({ error: 'Bot não está em um canal de voz' });
    }

    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL não fornecida' });
    }

    try {
      const song = await addToQueue(url, 'web-panel');
      res.json({ success: true, song });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Pular música
  app.post('/api/music/skip', (req, res) => {
    const skipped = skip();
    res.json({ success: skipped });
  });

  // Música anterior / reiniciar
  app.post('/api/music/previous', (req, res) => {
    const result = previous();
    res.json({ success: result });
  });

  // Pausar música
  app.post('/api/music/pause', (req, res) => {
    const paused = musicPause();
    res.json({ success: paused });
  });

  // Retomar música
  app.post('/api/music/resume', (req, res) => {
    const resumed = musicResume();
    res.json({ success: resumed });
  });

  // Parar música e limpar fila
  app.post('/api/music/stop', (req, res) => {
    musicStop();
    res.json({ success: true });
  });

  // Remover da fila
  app.delete('/api/music/queue', (req, res) => {
    const index = parseInt(req.query.index as string);
    if (isNaN(index)) {
      return res.status(400).json({ error: 'Índice inválido' });
    }
    const removed = removeFromQueue(index);
    res.json({ success: !!removed, removed });
  });

  // Limpar fila
  app.post('/api/music/queue/clear', (req, res) => {
    clearQueue();
    res.json({ success: true });
  });

  // ==================== END MUSIC ENDPOINTS ====================

  // Status
  app.get('/api/status', (req, res) => {
    res.json({
      connected: currentConnection !== null,
    });
  });

  app.listen(port, () => {
    console.log(`🌐 Painel web disponível em http://localhost:${port}`);
  });
}
