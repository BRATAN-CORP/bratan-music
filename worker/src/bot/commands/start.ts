import type { Env } from '../../types/env';
import type { TelegramMessage } from '../types';
import { TelegramClient } from '../telegram';
import { UserService } from '../../services/UserService';

export async function handleStart(env: Env, message: TelegramMessage): Promise<void> {
  const tg = new TelegramClient(env);
  const userService = new UserService(env);
  const from = message.from;

  await userService.upsert({
    id: String(from.id),
    tgUsername: from.username,
    tgName: [from.first_name, from.last_name].filter(Boolean).join(' ') || undefined,
  });

  const text = message.text ?? '';
  const args = text.split(' ').slice(1);

  if (args[0]?.startsWith('auth_')) {
    const nonce = args[0].replace('auth_', '');
    await env.SESSIONS.put(`auth_nonce:${nonce}`, String(from.id), { expirationTtl: 300 });

    await tg.sendMessage(message.chat.id,
      '🎵 <b>BRATAN MUSIC</b>\n\n' +
      'Вход подтверждён. Вернитесь на сайт — авторизация завершится автоматически.',
    );
    return;
  }

  await tg.sendMessage(message.chat.id,
    '🎵 <b>BRATAN MUSIC</b>\n\n' +
    'Добро пожаловать! Это бот для управления подпиской и аккаунтом.\n\n' +
    'Команды:\n' +
    '/subscribe — Оформить подписку (99 Stars/мес.)\n' +
    '/status — Статус подписки\n' +
    '/help — Помощь',
  );
}
