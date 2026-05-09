import type { Env } from '../../types/env';
import type { TelegramMessage } from '../types';
import { TelegramClient } from '../telegram';
import { UserService } from '../../services/UserService';

const DEFAULT_APP_URL = 'https://bratan-corp.github.io/bratan-music/';

/** TTL for the bot-minted login nonces, in seconds. The same value is used
 *  by the /auth/nonce/:nonce polling endpoint when filtering expired rows. */
const LOGIN_NONCE_TTL_SECONDS = 300; // 5 minutes

function getAppUrl(env: Env): string {
  return env.APP_URL ?? DEFAULT_APP_URL;
}

function createLoginUrl(appUrl: string, nonce: string): string {
  const url = new URL(appUrl);
  url.searchParams.set('auth_nonce', nonce);
  return url.toString();
}

/**
 * Mint a single-use, time-limited auth nonce bound to `userId` and persist
 * it to the `auth_nonces` table. The site polls `/auth/nonce/:nonce` and
 * deletes the row on the first successful claim, so the nonce is strictly
 * one-shot — replays are rejected. Expired rows are filtered out by the
 * `expires_at` check on the polling endpoint.
 *
 * Note on threat model: a nonce embedded in a forwardable bot reply is
 * exploitable by social-engineering — if the recipient taps the button
 * within 5 minutes, they sign in as the original sender. The user has
 * explicitly chosen this trade-off (direct deep-link UX > forwarding
 * attack surface). For a forward-safe alternative, see Telegram's
 * `login_url` button or the `web_app` button in `buildMainKeyboard`.
 */
async function createLoginNonce(env: Env, userId: number): Promise<string | null> {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const expiresAt = Math.floor(Date.now() / 1000) + LOGIN_NONCE_TTL_SECONDS;
  try {
    await env.DB
      .prepare('INSERT INTO auth_nonces (nonce, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(nonce, String(userId), expiresAt)
      .run();
    return nonce;
  } catch (err) {
    console.error('[bot] createLoginNonce failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Default keyboard for /start, /login, /help and other generic replies.
 * Three rows:
 *   1. `web_app`  — opens the site as a Telegram WebApp; auto-auth via
 *      `Telegram.WebApp.initData`. Forward-safe (initData is signed for
 *      the tapper).
 *   2. `url`      — direct login link `https://site/?auth_nonce=<N>`
 *      where N is single-use, 5-minute-TTL, and pre-bound to the
 *      requester's Telegram user. The site picks N up from the query
 *      string, polls `/auth/nonce/:nonce`, and signs the user in.
 *   3. `callback` — opens the subscription flow.
 *
 * The url-button rows are skipped when nonce minting fails (e.g. D1
 * write outage) so the keyboard still renders the WebApp + Subscribe
 * options.
 */
async function buildMainKeyboard(env: Env, userId: number): Promise<Record<string, unknown>> {
  const appUrl = getAppUrl(env);
  const nonce = await createLoginNonce(env, userId);

  const rows: Array<Array<Record<string, unknown>>> = [
    [{ text: 'Открыть веб-приложение', web_app: { url: appUrl } }],
  ];
  if (nonce) {
    rows.push([{ text: 'Войти на сайте', url: createLoginUrl(appUrl, nonce) }]);
  }
  rows.push([{ text: 'Оформить подписку', callback_data: 'subscribe' }]);

  return { inline_keyboard: rows };
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

  // Fast path for the website-login deeplink: write the auth nonce to D1
  // FIRST, before any other Telegram round-trips. The site is polling
  // for this key and will sign the user in within ~1 s of this write.
  if (args[0]?.startsWith('auth_')) {
    const nonce = args[0].replace('auth_', '');
    const expiresAt = Math.floor(Date.now() / 1000) + LOGIN_NONCE_TTL_SECONDS;
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

  // Telegram-link deeplink: an email-first user is binding their
  // Telegram identity to an existing site account. The frontend
  // already pre-stamped a row in `tg_link_requests` keyed to the
  // requester's user id; here we fill in the tg_id / username / name
  // that the requester didn't have at start-time. The site polls
  // `/user/me/telegram/link/status/:nonce` and finalises the link
  // once `tg_id` is non-NULL. Crucially we do NOT call `ensureUser`
  // here — that would mint a fresh tg-keyed row for an account
  // that's about to be merged into the existing email-keyed one,
  // and the merge endpoint would then refuse on the UNIQUE tg_id
  // index.
  if (args[0]?.startsWith('link_')) {
    const nonce = args[0].replace('link_', '');
    const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ') || null;

    let dbOk = true;
    try {
      const result = await env.DB
        .prepare(
          'UPDATE tg_link_requests SET tg_id = ?, tg_username = ?, tg_name = ? ' +
          'WHERE nonce = ? AND tg_id IS NULL AND expires_at > ?',
        )
        .bind(
          String(from.id),
          from.username ?? null,
          fullName,
          nonce,
          Math.floor(Date.now() / 1000),
        )
        .run();
      // `meta.changes` is 0 when the nonce doesn't match (typo in URL)
      // or the row already had tg_id set / has expired. We surface
      // that as a soft error so the user knows to retry.
      if (!result.meta?.changes) dbOk = false;
    } catch (err) {
      dbOk = false;
      console.error('[bot] tg link nonce DB write failed:', err instanceof Error ? err.message : err);
    }

    const replyText = dbOk
      ? '<b>BRATAN MUSIC</b>\n\nTelegram привязан. Вернитесь на сайт — карточка аккаунта обновится автоматически.'
      : '<b>BRATAN MUSIC</b>\n\nСсылка для привязки Telegram устарела или некорректна. Откройте сайт и нажмите «Привязать Telegram» ещё раз.';

    await tg.sendMessage(message.chat.id, replyText);
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
    'Нажмите «Войти на сайте» — ссылка действует 5 минут и сгорает после первого входа. ' +
    'Внутри Telegram можно также открыть «Веб-приложение» — вход произойдёт автоматически.',
    { replyMarkup: await buildMainKeyboard(env, message.from.id) }
  );
}
