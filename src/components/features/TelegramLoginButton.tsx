import { useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { useT } from '@/i18n';

/**
 * Telegram brand mark — solid paper-plane glyph (no outline). Tracks
 * `currentColor` so it inherits the button's text colour. We render
 * this inline rather than pulling another package because lucide's
 * `Send` is stroke-only and we explicitly need the filled brand look.
 */
function TelegramIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M21.94 4.34a1.5 1.5 0 0 0-2.06-1.66L2.5 9.85a1.05 1.05 0 0 0 .07 1.97l4.6 1.55 1.78 5.6a1 1 0 0 0 1.65.4l2.51-2.45 4.7 3.46a1.5 1.5 0 0 0 2.36-.96l1.77-15.08ZM9.7 14.4l-.74 4 1.18-3.36 7.94-7.6L9.7 14.4Z" />
    </svg>
  );
}

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME ?? 'bratan_music_bot';

export function TelegramLoginButton() {
  const { loginWithDeeplink, pollNonce } = useAuth();
  const [polling, setPolling] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const t = useT();

  const handleLogin = async () => {
    const nonce = loginWithDeeplink(BOT_USERNAME);
    setPolling(true);
    abortRef.current = new AbortController();

    const success = await pollNonce(nonce, abortRef.current.signal);
    setPolling(false);

    if (!success) {
      abortRef.current = null;
    }
  };

  return (
    <Button
      onClick={handleLogin}
      disabled={polling}
      className="bg-[var(--color-telegram)] text-[var(--color-telegram-foreground)] hover:bg-[var(--color-telegram-hover)]"
      size="lg"
    >
      {polling ? (
        <>
          <Loader2 size={16} className="animate-spin" />
          {t('auth.waitingForTelegram')}
        </>
      ) : (
        <>
          <TelegramIcon size={16} />
          {t('auth.loginViaTelegram')}
        </>
      )}
    </Button>
  );
}
