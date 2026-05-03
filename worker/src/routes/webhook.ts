import { Hono } from 'hono';
import type { Env, Variables } from '../types/env';
import type { TelegramUpdate } from '../bot/types';
import { handleBotUpdate } from '../bot/index';

const webhook = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Constant-time string equality. The webhook secret check below runs once
 * per Telegram update and the timing-attack surface over the public
 * internet is genuinely tiny (TLS jitter dominates), but `===` short-
 * circuits on the first mismatched character which lets a determined
 * attacker probe the secret byte-by-byte through statistical analysis.
 * Compare full length under XOR so we always touch every byte.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

webhook.post('/telegram', async (c) => {
  const secret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  if (!secret || !timingSafeEqualString(secret, c.env.TELEGRAM_WEBHOOK_SECRET)) {
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
