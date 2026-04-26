import type { Env } from '../../types/env';
import type { TelegramMessage } from '../types';
import { TelegramClient } from '../telegram';
import { UserService } from '../../services/UserService';
import { SubscriptionService } from '../../services/SubscriptionService';

function isAdmin(env: Env, userId: number): boolean {
  const adminIds = env.TELEGRAM_ADMIN_IDS.split(',').map(id => id.trim());
  return adminIds.includes(String(userId));
}

export async function handleAdmin(env: Env, message: TelegramMessage): Promise<void> {
  const tg = new TelegramClient(env);

  if (!isAdmin(env, message.from.id)) {
    await tg.sendMessage(message.chat.id, 'Доступ запрещён.');
    return;
  }

  const text = message.text ?? '';
  const parts = text.split(' ');
  const command = parts[0];

  switch (command) {
    case '/admin_stats': {
      const users = await env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
      const subs = await env.DB.prepare("SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active'").first<{ count: number }>();

      await tg.sendMessage(message.chat.id,
        `<b>Статистика</b>\n\n` +
        `Пользователей: ${users?.count ?? 0}\n` +
        `Активных подписок: ${subs?.count ?? 0}`
      );
      break;
    }

    case '/admin_grant': {
      const targetId = parts[1];
      const days = parseInt(parts[2] ?? '30', 10);

      if (!targetId) {
        await tg.sendMessage(message.chat.id, 'Использование: /admin_grant {user_id} [дней]');
        return;
      }

      const userService = new UserService(env);
      const user = await userService.findById(targetId);
      if (!user) {
        await tg.sendMessage(message.chat.id, `Пользователь ${targetId} не найден.`);
        return;
      }

      const subService = new SubscriptionService(env);
      const sub = await subService.activateManual(targetId, days);
      const expiresDate = new Date(sub.expires_at * 1000).toLocaleDateString('ru-RU');

      await tg.sendMessage(message.chat.id,
        `Подписка для ${user.tg_username ?? targetId} активирована до ${expiresDate}.`
      );
      break;
    }

    case '/admin_help': {
      await tg.sendMessage(message.chat.id,
        `<b>Админ-команды</b>\n\n` +
        `/admin_stats — Статистика\n` +
        `/admin_grant {user_id} [дней] — Выдать подписку\n` +
        `/admin_help — Эта справка`
      );
      break;
    }

    default:
      await tg.sendMessage(message.chat.id, 'Неизвестная команда. /admin_help');
  }
}
