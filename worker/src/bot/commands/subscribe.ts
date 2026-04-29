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

const SUB_PAYLOAD_RE = /^sub_(\d+)_\d+$/;
const EXPECTED_AMOUNT = 99;
const EXPECTED_CURRENCY = 'XTR';

/**
 * Validate the pre_checkout payload before approving. Telegram itself
 * authenticates the webhook (via X-Telegram-Bot-Api-Secret-Token), but
 * blindly acking every pre_checkout means any forged invoice that
 * somehow reached the bot would activate a subscription. We strictly
 * require:
 *   - payload format `sub_<userId>_<ts>`
 *   - userId in payload matches the paying user
 *   - total amount + currency match what /subscribe issues
 */
export async function handlePreCheckout(env: Env, query: TelegramPreCheckoutQuery): Promise<void> {
  const tg = new TelegramClient(env);
  const fromId = String(query.from.id);
  const match = SUB_PAYLOAD_RE.exec(query.invoice_payload ?? '');
  const payloadUserId = match?.[1];

  if (
    !match ||
    payloadUserId !== fromId ||
    query.currency !== EXPECTED_CURRENCY ||
    query.total_amount !== EXPECTED_AMOUNT
  ) {
    console.error('[bot] rejecting pre_checkout', {
      payload: query.invoice_payload,
      fromId,
      currency: query.currency,
      amount: query.total_amount,
    });
    await tg.answerPreCheckoutQuery(query.id, false, 'Неверный счёт');
    return;
  }

  await tg.answerPreCheckoutQuery(query.id, true);
}

export async function handleSuccessfulPayment(env: Env, message: TelegramMessage, payment: TelegramSuccessfulPayment): Promise<void> {
  const tg = new TelegramClient(env);
  const subService = new SubscriptionService(env);
  const userId = String(message.from.id);
  const txId = payment.telegram_payment_charge_id;

  // Idempotency: Telegram retries successful_payment webhooks on
  // timeout/network errors. Without this guard each retry would create a
  // *new* 30-day subscription row, so a single payment could grant 60+
  // days. Match by the unique Telegram charge id and bail if we already
  // saw it.
  if (txId) {
    const existing = await env.DB
      .prepare('SELECT id FROM subscriptions WHERE stars_tx_id = ? LIMIT 1')
      .bind(txId)
      .first<{ id: string }>();
    if (existing) {
      await tg.sendMessage(message.chat.id,
        '<b>Подписка уже активирована.</b>\n\n' +
        'Если вы только что заплатили — спасибо! Подписка действует 30 дней.'
      );
      return;
    }
  }

  await subService.activate(userId, 'telegram_stars', txId);

  await tg.sendMessage(message.chat.id,
    '<b>Подписка активирована!</b>\n\n' +
    'Безлимитный стриминг на 30 дней. Наслаждайтесь музыкой!'
  );
}
