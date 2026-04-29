import type { Env } from '../../types/env';
import type { TelegramMessage } from '../types';
import { TelegramClient } from '../telegram';
import { UserService } from '../../services/UserService';

const DEFAULT_APP_URL = 'https://bratan-corp.github.io/bratan-music/';

function getAppUrl(env: Env): string {
  return env.APP_URL ?? DEFAULT_APP_URL;
}

/**
 * Default keyboard for /start, /login, /help and other generic replies.
 *
 * Two login surfaces, both forward-safe (no auth payload is embedded
 * in either button):
 *   1. `web_app` button — opens the site as a Telegram WebApp inside
 *      TG; `Telegram.WebApp.initData` is signed by Telegram with the
 *      tapper's user, so `useAutoAuth()` on the site logs them in
 *      immediately. Forwarding doesn't expose the original sender —
 *      Telegram regenerates initData per tapper.
 *   2. `url` button — opens the bare site URL in the user's browser
 *      (useful for desktop / non-TG browsers). The site then shows
 *      its own "Войти через Telegram" button which mints a nonce
 *      *on the user's device* and opens `t.me/<bot>?start=auth_<nonce>`.
 *
 * What we deliberately do NOT do (and what the previous version of
 * this keyboard did): pre-mint a nonce on the bot side and bake it
 * into a button URL like `https://site/?auth_nonce=<N>`. That made
 * the bot's reply forwardable into one-click account takeover —
 * any third party who tapped the forwarded button would land on the
 * site holding a nonce already bound to the original sender's
 * Telegram ID, and the site's polling would sign them in as the
 * sender. Both buttons here carry zero auth state, so forwarding is
 * harmless.
 */
function buildMainKeyboard(env: Env): Record<string, unknown> {
  const appUrl = getAppUrl(env);
  return {
    inline_keyboard: [
      [{ text: 'Войти через Telegram', web_app: { url: appUrl } }],
      [{ text: 'Открыть на сайте', url: appUrl }],
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

  // The login keyboard offers two safe entry points:
  //   • «Войти через Telegram» (web_app) — opens the WebApp inside TG;
  //     `Telegram.WebApp.initData` auto-auths on the site.
  //   • «Открыть на сайте» (url) — opens the bare site URL in a browser;
  //     the site's own «Войти через Telegram» button then runs the
  //     website-initiated nonce flow (`t.me/<bot>?start=auth_<nonce>`).
  //
  // Neither button embeds an auth nonce, so forwarding the bot's reply
  // can NOT be turned into one-click account takeover (the regression
  // that the previous nonce-bearing button had).
  await tg.sendMessage(message.chat.id,
    '<b>Вход в BRATAN MUSIC</b>\n\n' +
    'Нажмите «Войти через Telegram», чтобы открыть веб-приложение и войти автоматически. ' +
    'Если вы хотите войти в десктоп-браузере — нажмите «Открыть на сайте» и используйте кнопку «Войти через Telegram» там.',
    { replyMarkup: buildMainKeyboard(env) }
  );
}
