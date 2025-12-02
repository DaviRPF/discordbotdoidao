import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

export interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export interface VoiceSession {
  odlUser: string;
  odlHistory: ConversationMessage[];
}

export interface ConversationMessage {
  role: 'user' | 'model';
  parts: [{ text: string }];
}
