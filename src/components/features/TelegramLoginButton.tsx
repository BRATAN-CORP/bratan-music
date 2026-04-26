import { useState, useRef } from 'react';
import { MessageCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

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
    <button
      onClick={handleLogin}
      disabled={polling}
      className="flex items-center gap-3 px-6 py-3 rounded-xl font-medium text-white transition-transform active:scale-95"
      style={{ backgroundColor: '#2AABEE' }}
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
    </button>
  );
}
