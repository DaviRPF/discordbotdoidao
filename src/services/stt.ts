import Groq from 'groq-sdk';
import { spawn } from 'child_process';

// Lazy initialization para esperar dotenv carregar
let groq: Groq | null = null;

function getGroq(): Groq {
  if (!groq) {
    groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }
  return groq;
}

// Transcreve áudio PCM 16-bit mono 16kHz
export async function transcribeBuffer(audioBuffer: Buffer): Promise<string> {
  try {
    // Converter PCM para WAV em memória via ffmpeg
    const wavBuffer = await new Promise<Buffer>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 's16le',
        '-ar', '16000',
        '-ac', '1',
        '-i', 'pipe:0',
        '-f', 'wav',
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

    // Criar um File-like object para o Groq
    const file = new File([wavBuffer], 'audio.wav', { type: 'audio/wav' });

    const transcription = await getGroq().audio.transcriptions.create({
      file,
      model: 'whisper-large-v3-turbo',
      language: 'pt',
    });

    return transcription.text?.trim() || '';
  } catch (error: any) {
    console.error('❌ Erro STT Groq:', error?.message);
    return '';
  }
}

// Compatibilidade com função antiga
export async function transcribeAudio(wavPath: string): Promise<string> {
  const fs = await import('fs');

  if (!fs.existsSync(wavPath)) {
    return '';
  }

  try {
    const wavBuffer = fs.readFileSync(wavPath);
    const file = new File([wavBuffer], 'audio.wav', { type: 'audio/wav' });

    const transcription = await getGroq().audio.transcriptions.create({
      file,
      model: 'whisper-large-v3-turbo',
      language: 'pt',
    });

    return transcription.text?.trim() || '';
  } catch (error: any) {
    console.error('❌ Erro STT Groq:', error?.message);
    return '';
  }
}
