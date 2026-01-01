import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);
const TEMP_DIR = path.join(process.cwd(), 'temp');
const PYTHON_PATH = 'C:\\Users\\davir\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe';

// Garantir que o diretório temp existe
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export async function textToSpeech(text: string, filename: string): Promise<string> {
  const outputPath = path.join(TEMP_DIR, `${filename}.mp3`);
  const scriptPath = path.join(TEMP_DIR, `${filename}.py`);

  try {
    const sanitizedText = text
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, ' ')
      .substring(0, 500);

    // Criar arquivo Python temporário para evitar problemas de escape
    const pythonScript = `# -*- coding: utf-8 -*-
from gtts import gTTS
gTTS('${sanitizedText}', lang='pt').save('${outputPath.replace(/\\/g, '/')}')
`;
    fs.writeFileSync(scriptPath, pythonScript, 'utf-8');

    await execAsync(`"${PYTHON_PATH}" "${scriptPath}"`);

    // Limpar script temporário
    if (fs.existsSync(scriptPath)) {
      fs.unlinkSync(scriptPath);
    }

    if (!fs.existsSync(outputPath)) {
      throw new Error('Arquivo TTS não criado');
    }

    return outputPath;
  } catch (error: any) {
    console.error('❌ Erro TTS:', error?.message);
    // Limpar script em caso de erro
    if (fs.existsSync(scriptPath)) {
      fs.unlinkSync(scriptPath);
    }
    throw error;
  }
}

// Gerar som de notificação "plum"
export async function generateNotificationSound(): Promise<string> {
  const outputPath = path.join(TEMP_DIR, 'notification.mp3');

  // Se já existe, retorna
  if (fs.existsSync(outputPath)) {
    console.log('🔊 Som de notificação já existe');
    return outputPath;
  }

  try {
    console.log('🔊 Criando som de notificação...');
    // Gerar um tom curto com ffmpeg (800Hz por 0.15s)
    const cmd = `ffmpeg -f lavfi -i "sine=frequency=800:duration=0.15" -af "afade=t=out:st=0.1:d=0.05" "${outputPath}" -y -loglevel error`;
    console.log('🔊 Comando:', cmd);
    await execAsync(cmd);

    if (!fs.existsSync(outputPath)) {
      throw new Error('Arquivo não foi criado');
    }

    console.log('🔊 Som criado em:', outputPath);
    return outputPath;
  } catch (error: any) {
    console.error('❌ Erro ao gerar som:', error?.message);
    console.error('❌ stderr:', error?.stderr);
    throw error;
  }
}

export function cleanupTempFile(filePath: string): void {
  try {
    if (filePath.includes('notification')) return; // Não deletar som de notificação
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignorar erros de cleanup
  }
}
