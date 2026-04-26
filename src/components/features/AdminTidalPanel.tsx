import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2, Copy, ExternalLink, KeyRound, Loader2, LogOut, Music4, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';

interface TidalStatus {
  hasSession: boolean;
  userId: number | null;
  countryCode: string | null;
  expiresAt: number | null;
  accessTokenPreview: string | null;
  refreshTokenPreview: string | null;
}

interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

interface DevicePoll {
  ok: boolean;
  pending?: boolean;
  error?: string;
}

interface RefreshTokenResponse {
  ok: boolean;
  userId?: number;
  countryCode?: string;
  expiresAt?: number;
  accessTokenPreview?: string | null;
  error?: string;
}

function formatDate(unix: number | null) {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleString('ru-RU');
}

export function AdminTidalPanel() {
  const [status, setStatus] = useState<TidalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState('');
  const [busy, setBusy] = useState<'install' | 'logout' | 'device' | null>(null);
  const [device, setDevice] = useState<DeviceStart | null>(null);
  const [devicePending, setDevicePending] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<TidalStatus>('/admin/tidal/status');
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить статус');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  const showToast = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 4000);
  };

  const installRefreshToken = async () => {
    const token = refreshToken.trim();
    if (!token) return;
    setBusy('install');
    try {
      const r = await api.post<RefreshTokenResponse>('/admin/tidal/refresh-token', { refreshToken: token });
      if (r.ok) {
        showToast('ok', `Tidal-аккаунт обновлён (uid ${r.userId})`);
        setRefreshToken('');
        await loadStatus();
      } else {
        showToast('err', r.error || 'Не удалось установить refresh token');
      }
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(null);
    }
  };

  const logoutTidal = async () => {
    if (!confirm('Очистить текущую Tidal-сессию?')) return;
    setBusy('logout');
    try {
      await api.post('/admin/tidal/logout');
      showToast('ok', 'Сессия очищена');
      await loadStatus();
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(null);
    }
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    setDevicePending(false);
  };

  const pollDevice = async (deviceCode: string, intervalSec: number) => {
    setDevicePending(true);
    const tick = async () => {
      try {
        const r = await api.post<DevicePoll>('/admin/tidal/device/poll', { deviceCode });
        if (r.ok) {
          stopPolling();
          setDevice(null);
          showToast('ok', 'Tidal подключён через device-flow');
          await loadStatus();
          return;
        }
        if (r.pending) {
          pollRef.current = setTimeout(tick, intervalSec * 1000);
          return;
        }
        stopPolling();
        showToast('err', r.error || 'Авторизация отменена');
      } catch (err) {
        stopPolling();
        showToast('err', err instanceof Error ? err.message : 'Ошибка опроса');
      }
    };
    pollRef.current = setTimeout(tick, intervalSec * 1000);
  };

  const startDevice = async () => {
    setBusy('device');
    try {
      const r = await api.post<DeviceStart>('/admin/tidal/device/start');
      setDevice(r);
      pollDevice(r.deviceCode, r.interval || 2);
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Не удалось получить device code');
    } finally {
      setBusy(null);
    }
  };

  const cancelDevice = () => {
    stopPolling();
    setDevice(null);
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('ok', `${label} скопирован`);
    } catch {
      showToast('err', 'Не удалось скопировать');
    }
  };

  return (
    <section className="rounded-[var(--radius-md)] border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Music4 size={14} className="text-muted-foreground" />
          Tidal-аккаунт прокси (admin)
        </h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={loadStatus}
          aria-label="Обновить"
          className="h-7 w-7"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Один Tidal-аккаунт обслуживает все стримы. Чтобы сменить, вставь refresh token или авторизуйся через device-flow.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-[var(--radius-sm)] border border-border bg-background p-3 text-xs sm:grid-cols-4">
        <Stat label="Состояние" value={status?.hasSession ? 'активна' : 'нет сессии'} accent={status?.hasSession ? 'ok' : 'warn'} />
        <Stat label="Tidal user id" value={status?.userId ? String(status.userId) : '—'} />
        <Stat label="Регион" value={status?.countryCode ?? '—'} />
        <Stat label="Истекает" value={formatDate(status?.expiresAt ?? null)} />
        <Stat label="Access token" value={status?.accessTokenPreview ?? '—'} mono />
        <Stat label="Refresh token" value={status?.refreshTokenPreview ?? '—'} mono />
      </div>

      {error && <p className="mt-3 text-xs text-[var(--color-danger)]">{error}</p>}

      <div className="mt-5 flex flex-col gap-2">
        <label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Установить refresh token
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={refreshToken}
            onChange={(e) => setRefreshToken(e.target.value)}
            placeholder="eyJraWQiOi…"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 rounded-[var(--radius-sm)] border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-[var(--color-accent)]"
          />
          <Button
            onClick={installRefreshToken}
            disabled={busy === 'install' || !refreshToken.trim()}
            className="sm:w-auto"
          >
            {busy === 'install' ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            Применить
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Worker сам обменяет refresh token на access token. Логин/пароль Tidal больше не принимает у сторонних клиентов — используй device-flow ниже.
        </p>
      </div>

      <div className="mt-5 flex flex-col gap-2 rounded-[var(--radius-sm)] border border-border bg-background p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Device-flow (логин через сайт Tidal)
          </span>
          {!device && (
            <Button onClick={startDevice} disabled={busy === 'device'} variant="ghost" size="sm">
              {busy === 'device' ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
              Запустить
            </Button>
          )}
        </div>
        <AnimatePresence initial={false}>
          {device && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="flex flex-col gap-2 pt-1 text-xs"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-muted-foreground">Введи код на link.tidal.com:</span>
                  <span className="select-all font-mono text-2xl tracking-[0.4em]">{device.userCode}</span>
                </div>
                <Button
                  onClick={() => copy(device.userCode, 'Код')}
                  size="sm"
                  variant="ghost"
                  aria-label="Скопировать код"
                >
                  <Copy size={14} />
                </Button>
              </div>
              <a
                href={device.verificationUriComplete.startsWith('http')
                  ? device.verificationUriComplete
                  : `https://${device.verificationUriComplete}`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 self-start text-[var(--color-accent)] hover:underline"
              >
                <ExternalLink size={12} />
                Открыть {device.verificationUriComplete}
              </a>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  {devicePending && <Loader2 size={12} className="animate-spin" />}
                  Ждём подтверждения…
                </span>
                <button
                  type="button"
                  onClick={cancelDevice}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Отменить
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-5 flex justify-end">
        <Button
          onClick={logoutTidal}
          disabled={busy === 'logout' || !status?.hasSession}
          variant="ghost"
          size="sm"
          className="text-[var(--color-danger)] hover:bg-[var(--color-danger-muted)]"
        >
          {busy === 'logout' ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
          Сбросить сессию
        </Button>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
              toast.kind === 'ok'
                ? 'border-[var(--color-accent-soft)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] text-[var(--color-danger)]'
            }`}
          >
            {toast.kind === 'ok' && <CheckCircle2 size={12} />}
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function Stat({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: 'ok' | 'warn' }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <span
        className={[
          mono ? 'font-mono text-[11px]' : 'text-xs',
          accent === 'ok' ? 'text-[var(--color-accent)]' : '',
          accent === 'warn' ? 'text-[var(--color-danger)]' : '',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
}
