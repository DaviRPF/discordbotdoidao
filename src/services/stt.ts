import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execAsync = promisify(exec);

// Usaremos a API do Google Speech-to-Text via CLI ou uma alternativa grátis
// Por enquanto, vamos usar o Vosk (offline) ou a API do Google

export async function transcribeAudio(wavPath: string): Promise<string> {
  // Verificar se o arquivo existe
  if (!fs.existsSync(wavPath)) {
    console.error('Arquivo de áudio não encontrado:', wavPath);
    return '';
  }

  try {
    // Opção 1: Usar a API do Google Cloud Speech-to-Text
    // Requer GOOGLE_APPLICATION_CREDENTIALS configurado
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      return await transcribeWithGoogle(wavPath);
    }

    // Opção 2: Usar Whisper da OpenAI (requer API key)
    if (process.env.OPENAI_API_KEY) {
      return await transcribeWithWhisper(wavPath);
    }

    // Opção 3: Placeholder - retorna mensagem indicando que precisa configurar
    console.warn('⚠️ Nenhum serviço de STT configurado!');
    console.warn('Configure GOOGLE_APPLICATION_CREDENTIALS ou OPENAI_API_KEY');
    return '';
  } catch (error) {
    console.error('Erro na transcrição:', error);
    return '';
  }
}

async function transcribeWithGoogle(wavPath: string): Promise<string> {
  // Usando gcloud CLI
  try {
    const { stdout } = await execAsync(
      `gcloud ml speech recognize "${wavPath}" --language-code=pt-BR --format=json`
    );

    const result = JSON.parse(stdout);
    if (result.results && result.results[0]?.alternatives[0]?.transcript) {
      return result.results[0].alternatives[0].transcript;
    }
    return '';
  } catch (error) {
    console.error('Erro no Google Speech:', error);
    return '';
  }
}

async function transcribeWithWhisper(wavPath: string): Promise<string> {
  // Usando a API do OpenAI Whisper via curl
  const apiKey = process.env.OPENAI_API_KEY;

  try {
    const { stdout } = await execAsync(
      `curl -s https://api.openai.com/v1/audio/transcriptions \
        -H "Authorization: Bearer ${apiKey}" \
        -H "Content-Type: multipart/form-data" \
        -F file="@${wavPath}" \
        -F model="whisper-1" \
        -F language="pt"`
    );

    const result = JSON.parse(stdout);
    return result.text || '';
  } catch (error) {
    console.error('Erro no Whisper:', error);
    return '';
  }
}
