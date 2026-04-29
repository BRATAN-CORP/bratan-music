import type { Env } from '../../types/env';
import type { TelegramMessage } from '../types';
import { TelegramClient } from '../telegram';
import { UserService } from '../../services/UserService';

const DEFAULT_APP_URL = 'https://bratan-corp.github.io/bratan-music/';

function getAppUrl(env: Env): string {
  return env.APP_URL ?? DEFAULT_APP_URL;
}

/**
 * Default keyboard for /start, /help and other generic replies. Crucially,
 * this *does not* include a "Войти на сайте" deeplink button — that button
 * carried a freshly-minted, single-use auth nonce, and forwarding the
 * whole message to a third party effectively handed them the account.
 *
 * The login flow is now strictly website-initiated: the user opens the
 * site → the site generates a nonce → opens `t.me/<bot>?start=auth_<nonce>`
 * → the bot writes the (nonce, from.id) mapping. Forwarding *that* deep-
 * link still requires the receiver's own Telegram client to interact
 * with the bot, so the nonce ends up bound to the receiver, not the
 * original user.
 */
function buildMainKeyboard(env: Env): Record<string, unknown> {
  const appUrl = getAppUrl(env);
  return {
    inline_keyboard: [
      [{ text: 'Открыть веб-приложение', web_app: { url: appUrl } }],
      [{ text: 'Оформить подписку', callback_data: 'subscribe' }],
    ],
  };
}

async function ensureUser(env: Env, message: TelegramMessage): Promise<void> {
  const userService = new UserService(env);
  const from = message.from;

  await userService.upsert({
    id: String(from.id),
    tgUsername: from.username,
    tgName: [from.first_name, from.last_name].filter(Boolean).join(' ') || undefined,
  });
}

export async function handleStart(env: Env, message: TelegramMessage): Promise<void> {
  const tg = new TelegramClient(env);
  const from = message.from;

  const text = message.text ?? '';
  const args = text.split(' ').slice(1);

  // Fast path for the website-login deeplink: write the auth nonce to KV
  // FIRST, before any other Telegram round-trips. The site is polling
  // for this key and will sign the user in within ~1 s of this write.
  if (args[0]?.startsWith('auth_')) {
    const nonce = args[0].replace('auth_', '');
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    let dbOk = true;
    try {
      await env.DB
        .prepare(
          'INSERT INTO auth_nonces (nonce, user_id, expires_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(nonce) DO UPDATE SET user_id = excluded.user_id, expires_at = excluded.expires_at'
        )
        .bind(nonce, String(from.id), expiresAt)
        .run();
    } catch (err) {
      dbOk = false;
      console.error('[bot] auth nonce DB insert failed:', err instanceof Error ? err.message : err);
    }

    const replyText = dbOk
      ? '<b>BRATAN MUSIC</b>\n\nВход подтверждён. Вернитесь на сайт — авторизация завершится автоматически.'
      : '<b>BRATAN MUSIC</b>\n\nВременная техническая ошибка авторизации. Попробуйте ещё раз через минуту.';

    await Promise.all([
      ensureUser(env, message),
      tg.setChatMenuButton(message.chat.id, getAppUrl(env)),
      tg.sendMessage(message.chat.id, replyText),
    ]);
    return;
  }

  await ensureUser(env, message);
  await tg.setChatMenuButton(message.chat.id, getAppUrl(env));

  await tg.sendMessage(message.chat.id,
    '<b>BRATAN MUSIC</b>\n\n' +
    'Добро пожаловать! Это бот для управления подпиской и аккаунтом.\n\n' +
    'Команды:\n' +
    '/login — Войти на сайте\n' +
    '/app — Открыть веб-приложение\n' +
    '/subscribe — Оформить подписку (99 Stars/мес.)\n' +
    '/status — Статус подписки\n' +
    '/help — Помощь',
    { replyMarkup: buildMainKeyboard(env) }
  );
}

export async function handleLogin(env: Env, message: TelegramMessage): Promise<void> {
  const tg = new TelegramClient(env);
  await ensureUser(env, message);
  await tg.setChatMenuButton(message.chat.id, getAppUrl(env));

  // We deliberately do NOT auto-mint a login nonce in this reply. The
  // login flow is now website-initiated (open the site → the site opens
  // `t.me/<bot>?start=auth_<nonce>` for the user). Embedding a nonce
  // here would mean any forwarded copy of the bot's reply hands the
  // sender's account to the receiver in one click.
  await tg.sendMessage(message.chat.id,
    '<b>Вход в BRATAN MUSIC</b>\n\n' +
    'Откройте веб-приложение внутри Telegram — вход произойдёт автоматически. ' +
    'Для входа в десктоп-браузере откройте сайт и нажмите там «Войти через Telegram».',
    { replyMarkup: buildMainKeyboard(env) }
  );
}
