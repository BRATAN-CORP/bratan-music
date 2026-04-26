import type { Env } from '../../types/env';
import type { TelegramMessage, TelegramPreCheckoutQuery, TelegramSuccessfulPayment } from '../types';
import { TelegramClient } from '../telegram';
import { SubscriptionService } from '../../services/SubscriptionService';

export async function handleSubscribe(env: Env, message: TelegramMessage): Promise<void> {
  const tg = new TelegramClient(env);
  const subService = new SubscriptionService(env);
  const userId = String(message.from.id);

  const active = await subService.getActive(userId);
  if (active) {
    const expiresDate = new Date(active.expires_at * 1000).toLocaleDateString('ru-RU');
    await tg.sendMessage(message.chat.id,
      `У вас уже есть активная подписка до <b>${expiresDate}</b>.`
    );
    return;
  }

  const payload = `sub_${userId}_${Date.now()}`;
  await tg.sendInvoice(message.chat.id, payload);
}

export async function handlePreCheckout(env: Env, query: TelegramPreCheckoutQuery): Promise<void> {
  const tg = new TelegramClient(env);
  await tg.answerPreCheckoutQuery(query.id, true);
}

export async function handleSuccessfulPayment(env: Env, message: TelegramMessage, payment: TelegramSuccessfulPayment): Promise<void> {
  const tg = new TelegramClient(env);
  const subService = new SubscriptionService(env);
  const userId = String(message.from.id);

  await subService.activate(userId, 'telegram_stars', payment.telegram_payment_charge_id);

  await tg.sendMessage(message.chat.id,
    '<b>Подписка активирована!</b>\n\n' +
    'Безлимитный стриминг на 30 дней. Наслаждайтесь музыкой!'
  );
}
