import type { Env } from '../../types/env';
import type { TelegramMessage } from '../types';
import { TelegramClient } from '../telegram';
import { UserService } from '../../services/UserService';

const DEFAULT_APP_URL = 'https://bratan-corp.github.io/bratan-music/';

function getAppUrl(env: Env): string {
  return env.APP_URL ?? DEFAULT_APP_URL;
}

function createLoginUrl(appUrl: string, nonce: string): string {
  const url = new URL(appUrl);
  url.searchParams.set('auth_nonce', nonce);
  return url.toString();
}

async function createLoginNonce(env: Env, userId: number): Promise<string> {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  await env.SESSIONS.put(`auth_nonce:${nonce}`, String(userId), { expirationTtl: 300 });
  return nonce;
}

async function buildMainKeyboard(env: Env, userId: number): Promise<Record<string, unknown>> {
  const appUrl = getAppUrl(env);
  const nonce = await createLoginNonce(env, userId);

  return {
    inline_keyboard: [
      [{ text: 'Открыть веб-приложение', web_app: { url: appUrl } }],
      [{ text: 'Войти на сайте', url: createLoginUrl(appUrl, nonce) }],
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
  // FIRST, before any other Telegram round-trips. The site is long-polling
  // for this key and will sign the user in within ~300 ms of this write.
  if (args[0]?.startsWith('auth_')) {
    const nonce = args[0].replace('auth_', '');
    await env.SESSIONS.put(`auth_nonce:${nonce}`, String(from.id), { expirationTtl: 300 });

    // Now fan out the slower work in parallel — none of it blocks the
    // website auth confirmation.
    await Promise.all([
      ensureUser(env, message),
      tg.setChatMenuButton(message.chat.id, getAppUrl(env)),
      tg.sendMessage(message.chat.id,
        '<b>BRATAN MUSIC</b>\n\n' +
        'Вход подтверждён. Вернитесь на сайт — авторизация завершится автоматически.'
      ),
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
    { replyMarkup: await buildMainKeyboard(env, from.id) }
  );
}

export async function handleLogin(env: Env, message: TelegramMessage): Promise<void> {
  const tg = new TelegramClient(env);
  await ensureUser(env, message);
  await tg.setChatMenuButton(message.chat.id, getAppUrl(env));

  await tg.sendMessage(message.chat.id,
    '<b>Вход в BRATAN MUSIC</b>\n\n' +
    'Откройте веб-приложение внутри Telegram или нажмите «Войти на сайте» для входа в браузере.',
    { replyMarkup: await buildMainKeyboard(env, message.from.id) }
  );
}
