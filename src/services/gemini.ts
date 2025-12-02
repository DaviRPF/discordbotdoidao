import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConversationMessage } from '../types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const conversationHistory: Map<string, ConversationMessage[]> = new Map();

const SYSTEM_PROMPT = `Você é um assistente de voz divertido e amigável em um servidor Discord.
Seu nome é "Bot Doidão".
- Responda de forma natural e conversacional, como se estivesse falando.
- Mantenha respostas curtas (1-3 frases) para fluir bem na conversa por voz.
- Seja descontraído e use gírias brasileiras quando apropriado.
- Se alguém perguntar quem é você, diga que é o Bot Doidão, o bot mais maluco do Discord.
- Você pode fazer piadas e ser engraçado.`;

export async function chat(userId: string, userMessage: string): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    let history = conversationHistory.get(userId) || [];

    history.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });

    // Manter apenas as últimas 10 mensagens para não sobrecarregar
    if (history.length > 20) {
      history = history.slice(-20);
    }

    const chat = model.startChat({
      history: history.slice(0, -1), // Histórico sem a última mensagem
      generationConfig: {
        maxOutputTokens: 200,
        temperature: 0.9,
      },
    });

    const result = await chat.sendMessage(`${SYSTEM_PROMPT}\n\nUsuário disse: ${userMessage}`);
    const response = result.response.text();

    history.push({
      role: 'model',
      parts: [{ text: response }],
    });

    conversationHistory.set(userId, history);

    return response;
  } catch (error) {
    console.error('Erro ao chamar Gemini:', error);
    return 'Opa, deu um bug aqui na minha cabeça. Tenta de novo aí!';
  }
}

export function clearHistory(userId: string): void {
  conversationHistory.delete(userId);
}
