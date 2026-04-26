import type { Env } from '../types/env';
import type { TelegramUpdate } from './types';
import { TelegramClient } from './telegram';
import { handleLogin, handleStart } from './commands/start';
import { handleSubscribe, handlePreCheckout, handleSuccessfulPayment } from './commands/subscribe';
import { handleAdmin } from './commands/admin';
import { SubscriptionService } from '../services/SubscriptionService';

export async function handleBotUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  if (update.pre_checkout_query) {
    await handlePreCheckout(env, update.pre_checkout_query);
    return;
  }

  if (update.message?.successful_payment) {
    await handleSuccessfulPayment(env, update.message, update.message.successful_payment);
    return;
  }

  if (update.callback_query) {
    const tg = new TelegramClient(env);
    await tg.answerCallbackQuery(update.callback_query.id);
    if (update.callback_query.data === 'subscribe' && update.callback_query.message) {
      await handleSubscribe(env, {
        ...update.callback_query.message,
        from: update.callback_query.from,
        text: '/subscribe',
      });
    }
    return;
  }

  if (update.message?.text) {
    const text = update.message.text;
    const command = text.split(' ')[0].split('@')[0];

    switch (command) {
      case '/start':
        await handleStart(env, update.message);
        break;

      case '/login':
      case '/app':
        await handleLogin(env, update.message);
        break;

      case '/subscribe':
        await handleSubscribe(env, update.message);
        break;

      case '/status': {
        const tg = new TelegramClient(env);
        const subService = new SubscriptionService(env);
        const userId = String(update.message.from.id);
        const sub = await subService.getActive(userId);

        if (sub) {
          const expiresDate = new Date(sub.expires_at * 1000).toLocaleDateString('ru-RU');
          await tg.sendMessage(update.message.chat.id,
            `<b>Подписка активна</b>\nДействует до: ${expiresDate}`
          );
        } else {
          await tg.sendMessage(update.message.chat.id,
            'Подписка не активна. Используйте /subscribe для оформления.'
          );
        }
        break;
      }

      case '/help': {
        const tg = new TelegramClient(env);
        await tg.sendMessage(update.message.chat.id,
          '<b>BRATAN MUSIC</b>\n\n' +
          '/start — Начало\n' +
          '/login — Войти на сайте\n' +
          '/app — Открыть веб-приложение\n' +
          '/subscribe — Оформить подписку (99 Stars/мес.)\n' +
          '/status — Статус подписки\n' +
          '/help — Помощь'
        );
        break;
      }

      case '/admin_stats':
      case '/admin_grant':
      case '/admin_help':
        await handleAdmin(env, update.message);
        break;

      default:
        break;
    }
  }
}
