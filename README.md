# Bot Doidão - Discord Voice Bot com IA

Bot Discord que entra em canais de voz e conversa com os usuários usando IA (Google Gemini).

## Funcionalidades

- Entra em canais de voz com comando `/entrar`
- Escuta os usuários falando (Speech-to-Text)
- Responde quando chamam "Bot" ou "Bot Doidão"
- Usa Google Gemini para gerar respostas inteligentes
- Fala a resposta no canal de voz (Text-to-Speech)

## Requisitos

- Node.js 18+
- FFmpeg instalado no sistema
- Conta no Discord Developer Portal
- API Key do Google Gemini
- (Opcional) API Key da OpenAI para Speech-to-Text

## Instalação

1. Clone o repositório:
```bash
git clone <repo-url>
cd discordbotdoidao
```

2. Instale as dependências:
```bash
npm install
```

3. Instale o FFmpeg (se não tiver):
```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg

# Windows
# Baixe de https://ffmpeg.org/download.html
```

4. Instale o gtts-cli para Text-to-Speech:
```bash
pip install gTTS
```

5. Configure as variáveis de ambiente:
```bash
cp .env.example .env
# Edite o .env com suas credenciais
```

## Configuração do Discord

1. Acesse [Discord Developer Portal](https://discord.com/developers/applications)
2. Crie uma nova aplicação
3. Vá em "Bot" e crie um bot
4. Copie o token e coloque no `.env`
5. Em "OAuth2 > URL Generator":
   - Selecione: `bot`, `applications.commands`
   - Permissões: `Connect`, `Speak`, `Use Voice Activity`
6. Use a URL gerada para adicionar o bot ao seu servidor

## Uso

1. Registre os comandos slash:
```bash
npm run deploy-commands
```

2. Inicie o bot:
```bash
npm run dev
```

3. No Discord:
   - Entre em um canal de voz
   - Use `/entrar` para chamar o bot
   - Fale "Bot, [sua pergunta]" ou "Bot Doidão, [sua pergunta]"
   - O bot vai responder por voz!
   - Use `/sair` para o bot sair

## Comandos

| Comando | Descrição |
|---------|-----------|
| `/entrar` | Bot entra no seu canal de voz |
| `/sair` | Bot sai do canal de voz |

## Tecnologias

- **Discord.js** - Biblioteca principal do Discord
- **@discordjs/voice** - Funcionalidades de voz
- **Google Gemini** - IA para gerar respostas
- **gTTS** - Text-to-Speech (Google)
- **OpenAI Whisper** - Speech-to-Text (opcional)

## Estrutura do Projeto

```
src/
├── index.ts              # Entrada principal
├── types.ts              # Tipos TypeScript
├── deploy-commands.ts    # Script para registrar comandos
├── commands/
│   ├── join.ts          # Comando /entrar
│   └── leave.ts         # Comando /sair
└── services/
    ├── gemini.ts        # Integração com Gemini
    ├── tts.ts           # Text-to-Speech
    ├── stt.ts           # Speech-to-Text
    └── voiceHandler.ts  # Gerenciamento de voz
```

## Licença

MIT
