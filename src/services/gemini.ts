import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConversationMessage } from '../types';

// Lazy initialization para garantir que o dotenv já carregou
let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    console.log(`🔑 [GEMINI] API Key presente: ${apiKey ? 'SIM (' + apiKey.substring(0, 10) + '...)' : 'NÃO!'}`);
    genAI = new GoogleGenerativeAI(apiKey || '');
  }
  return genAI;
}

const conversationHistory: Map<string, ConversationMessage[]> = new Map();

const SYSTEM_PROMPT = `Você é o Bot Doidão, um assistente de voz divertido em um servidor Discord.
Regras:
- Responda de forma natural e conversacional
- Respostas curtas (1-3 frases) para fluir bem por voz
- Seja descontraído, use gírias brasileiras
- Sempre complete suas frases, nunca pare no meio
- Responda a pergunta de forma direta e completa`;

export async function chat(userId: string, userMessage: string): Promise<string> {
  console.log('🧠 [GEMINI] Iniciando chat...');
  console.log(`👤 [GEMINI] User ID: ${userId}`);
  console.log(`💬 [GEMINI] Mensagem: "${userMessage}"`);

  try {
    const ai = getGenAI();
    const model = ai.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: SYSTEM_PROMPT,
    });
    console.log('✅ [GEMINI] Modelo carregado: gemini-2.0-flash');

    let history = conversationHistory.get(userId) || [];
    console.log(`📚 [GEMINI] Histórico: ${history.length} mensagens`);

    // Manter apenas as últimas 20 mensagens para não sobrecarregar
    if (history.length > 20) {
      history = history.slice(-20);
    }

    console.log('⏳ [GEMINI] Enviando mensagem...');

    const chatSession = model.startChat({
      history: history,
      generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.8,
      },
    });

    const result = await chatSession.sendMessage(userMessage);
    const response = result.response.text();

    console.log(`✅ [GEMINI] Resposta recebida: "${response}"`);

    // Adicionar ao histórico
    history.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });
    history.push({
      role: 'model',
      parts: [{ text: response }],
    });

    conversationHistory.set(userId, history);

    return response;
  } catch (error: any) {
    console.error('❌ [GEMINI] Erro:', error?.message || error);
    if (error?.response) {
      console.error('❌ [GEMINI] Response:', error.response);
    }
    return 'Opa, deu um bug aqui na minha cabeça. Tenta de novo aí!';
  }
}

export function clearHistory(userId: string): void {
  conversationHistory.delete(userId);
  console.log(`🧹 [GEMINI] Histórico limpo para ${userId}`);
}
