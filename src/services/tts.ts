import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

const TEMP_DIR = path.join(process.cwd(), 'temp');

// Garantir que o diretório temp existe
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export async function textToSpeech(text: string, filename: string): Promise<string> {
  const outputPath = path.join(TEMP_DIR, `${filename}.mp3`);

  try {
    // Usar gtts-cli (Google Text-to-Speech) - gratuito
    // Escapar aspas e caracteres especiais
    const sanitizedText = text
      .replace(/"/g, '\\"')
      .replace(/'/g, "\\'")
      .replace(/\n/g, ' ')
      .substring(0, 500); // Limitar tamanho

    await execAsync(`gtts-cli "${sanitizedText}" -l pt -o "${outputPath}"`);

    return outputPath;
  } catch (error) {
    console.error('Erro no TTS:', error);
    throw error;
  }
}

export function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('Erro ao limpar arquivo temp:', error);
  }
}
