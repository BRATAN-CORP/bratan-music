import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import type { TelegramUpdate } from '../bot/types';
import { handleBotUpdate } from '../bot/index';

const webhook = new Hono<{ Bindings: Env; Variables: Variables }>();

webhook.post('/telegram', async (c) => {
  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (secret !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: 'Неверный секрет' }, 403);
  }

  const update = await c.req.json<TelegramUpdate>();

  // Acknowledge Telegram immediately so it never retries the update,
  // and run the (potentially slow) bot logic in the background. Without
  // this, every Telegram round-trip inside handleBotUpdate (sendMessage,
  // setChatMenuButton, KV writes, …) blocks the webhook response and the
  // user sees the bot lagging by tens of seconds.
  c.executionCtx.waitUntil(
    handleBotUpdate(c.env, update).catch((err) => {
      console.error('Bot error:', err instanceof Error ? err.message : err);
    })
  );

  return c.json({ ok: true });
});

export { webhook };
