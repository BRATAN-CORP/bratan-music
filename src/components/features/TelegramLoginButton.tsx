import { useState, useRef } from 'react';
import { MessageCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME ?? 'bratan_music_bot';

export function TelegramLoginButton() {
  const { loginWithDeeplink, pollNonce } = useAuth();
  const [polling, setPolling] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

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
          <Loader2 size={20} className="animate-spin" />
          Ожидание входа в Telegram...
        </>
      ) : (
        <>
          <MessageCircle size={20} />
          Войти через Telegram
        </>
      )}
    </Button>
  );
}
