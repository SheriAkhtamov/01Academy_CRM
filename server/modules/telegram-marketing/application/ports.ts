import type { MarketingBotState } from '@shared/contracts/telegram-marketing';
import type { MarketingLeadFact } from '../domain/report';

export type MarketingBotConfig = {
  botToken: string;
  webhookSecret: string;
  passwordHash: string;
};
export type MarketingBotSession = { state: unknown };
export interface MarketingBotAccess {
  get(botId: string, userId: string, passwordHash: string): Promise<MarketingBotSession | null>;
  authenticate(botId: string, userId: string, password: string, passwordHash: string): Promise<'ok' | 'denied' | 'locked'>;
  saveState(botId: string, userId: string, passwordHash: string, state: MarketingBotState): Promise<void>;
  logout(botId: string, userId: string): Promise<void>;
}
export type TelegramMethod = { method: string; [key: string]: unknown };
export type MarketingBotEvent = {
  userId: string;
  chatId: number;
  text: string;
  callbackId?: string;
  messageId?: number;
};
export interface MarketingBotPorts {
  access: MarketingBotAccess;
  facts(state: MarketingBotState, asOf: Date): Promise<MarketingLeadFact[]>;
  telegram(botToken: string, method: string, body: Record<string, unknown>): Promise<unknown>;
  now(): Date;
}
