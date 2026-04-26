import type { Env } from '../types/env';

export class TelegramClient {
  private baseUrl: string;

  constructor(private env: Env) {
    this.baseUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  }

  async sendMessage(chatId: number, text: string, options?: {
    parseMode?: 'HTML' | 'Markdown';
    replyMarkup?: Record<string, unknown>;
  }): Promise<void> {
    await this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: options?.parseMode ?? 'HTML',
      reply_markup: options?.replyMarkup,
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  async answerPreCheckoutQuery(preCheckoutQueryId: string, ok: boolean, errorMessage?: string): Promise<void> {
    await this.call('answerPreCheckoutQuery', {
      pre_checkout_query_id: preCheckoutQueryId,
      ok,
      error_message: errorMessage,
    });
  }

  async sendInvoice(chatId: number, payload: string): Promise<void> {
    await this.call('sendInvoice', {
      chat_id: chatId,
      title: 'BRATAN MUSIC — Подписка',
      description: 'Безлимитный стриминг на 30 дней',
      payload,
      currency: 'XTR',
      prices: [{ label: 'Подписка 30 дней', amount: 99 }],
    });
  }

  async setChatMenuButton(chatId: number, appUrl: string): Promise<void> {
    await this.call('setChatMenuButton', {
      chat_id: chatId,
      menu_button: {
        type: 'web_app',
        text: 'Открыть BRATAN MUSIC',
        web_app: { url: appUrl },
      },
    });
  }

  async setWebhook(url: string, secret: string): Promise<void> {
    await this.call('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
    });
  }

  private async call(method: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Telegram API ${method} error: ${text}`);
    }

    return res.json();
  }
}
