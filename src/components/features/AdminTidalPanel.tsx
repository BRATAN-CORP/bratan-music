import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import {
  AlertCircle, CheckCircle2, Copy, ExternalLink, KeyRound, Loader2, Plus,
  RefreshCw, Server, ShieldCheck, ShieldOff, Trash2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';

/**
 * Unified Tidal-admin panel.
 *
 * Replaces the previous split between the legacy single-account panel
 * (device-flow + paste refresh token) and the dedicated "pool" panel.
 *
 * Both ways of provisioning a Tidal session — pasting a refresh token
 * and the OAuth device-flow on link.tidal.com — already write to the
 * same `tidal_accounts` pool on the backend (see TidalAuth.cacheSession),
 * so we render them as **two tabs in one "Добавить аккаунт" form** above
 * a single account list. The list itself shows pool stats, per-account
 * status, and the same toggle / refresh-subscription / remove actions
 * that used to live in the dedicated pool panel.
 *
 * Visually: one card, motion-driven tab indicator, account cards with
 * a status pulse and inline label-rename. Mirrors the rest of the
 * admin surface (`AdminHealthPanel`, `LanguageSwitcher`).
 */

interface PoolAccount {
  id: number;
  label: string | null;
  userId: number;
  countryCode: string;
  enabled: boolean;
  subscriptionType: string | null;
  subscriptionValidUntil: number | null;
  expiresAt: number;
  lastUsedAt: number;
  usageCount: number;
  lastError: string | null;
  lastErrorAt: number | null;
  consecutiveErrors: number;
  createdAt: number;
  updatedAt: number;
  accessTokenPreview: string | null;
  refreshTokenPreview: string | null;
}

interface PoolListResponse {
  items: PoolAccount[];
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

type AddTab = 'token' | 'device';

function formatDate(unix: number | null): string {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleString('ru-RU');
}

function relative(unix: number | null): string {
  if (!unix) return 'никогда';
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return `${Math.floor(diff / 86400)} д назад`;
}

export function AdminTidalPanel() {
  const [accounts, setAccounts] = useState<PoolAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addTab, setAddTab] = useState<AddTab>('token');

  // Refresh-token form state.
  const [labelInput, setLabelInput] = useState('');
  const [refreshTokenInput, setRefreshTokenInput] = useState('');
  const [adding, setAdding] = useState(false);

  // Device-flow state.
  const [device, setDevice] = useState<DeviceStart | null>(null);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [devicePolling, setDevicePolling] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-account busy spinner so simultaneous toggles don't race.
  const [busyAccount, setBusyAccount] = useState<number | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<PoolListResponse>('/admin/tidal/accounts');
      setAccounts(data.items);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Не удалось загрузить пул');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const stats = useMemo(() => {
    if (!accounts) return null;
    const enabled = accounts.filter((a) => a.enabled).length;
    const broken = accounts.filter((a) => a.consecutiveErrors > 0).length;
    const totalUsage = accounts.reduce((sum, a) => sum + a.usageCount, 0);
    return { total: accounts.length, enabled, broken, totalUsage };
  }, [accounts]);

  const closeAddForm = () => {
    setShowAdd(false);
    cancelDevice();
    setLabelInput('');
    setRefreshTokenInput('');
  };

  const addByRefreshToken = async () => {
    const refreshToken = refreshTokenInput.trim();
    if (!refreshToken) return;
    setAdding(true);
    try {
      await api.post('/admin/tidal/accounts', {
        refreshToken,
        label: labelInput.trim() || undefined,
      });
      showToast('ok', 'Аккаунт добавлен в пул');
      closeAddForm();
      await load();
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Ошибка добавления');
    } finally {
      setAdding(false);
    }
  };

  // Device-flow: start, poll, and on success the worker upserts the
  // tokens into the same pool table by Tidal user id, so we just refetch.
  const startDevice = async () => {
    setDeviceBusy(true);
    try {
      const r = await api.post<DeviceStart>('/admin/tidal/device/start');
      setDevice(r);
      pollDevice(r.deviceCode, r.interval || 2);
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Не удалось получить device code');
    } finally {
      setDeviceBusy(false);
    }
  };

  const pollDevice = (deviceCode: string, intervalSec: number) => {
    setDevicePolling(true);
    const tick = async () => {
      try {
        const r = await api.post<DevicePoll>('/admin/tidal/device/poll', { deviceCode });
        if (r.ok) {
          stopPolling();
          setDevice(null);
          showToast('ok', 'Tidal подключён через device-flow');
          closeAddForm();
          await load();
          return;
        }
        if (r.pending) {
          pollTimer.current = setTimeout(tick, intervalSec * 1000);
          return;
        }
        stopPolling();
        showToast('err', r.error || 'Авторизация отменена');
      } catch (err) {
        stopPolling();
        showToast('err', err instanceof Error ? err.message : 'Ошибка опроса');
      }
    };
    pollTimer.current = setTimeout(tick, intervalSec * 1000);
  };

  const stopPolling = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    setDevicePolling(false);
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

  const setEnabled = async (id: number, enabled: boolean) => {
    setBusyAccount(id);
    try {
      await api.patch(`/admin/tidal/accounts/${id}`, { enabled });
      showToast('ok', enabled ? 'Аккаунт включён в пул' : 'Аккаунт выключен');
      await load();
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Не удалось изменить статус');
    } finally {
      setBusyAccount(null);
    }
  };

  const renameAccount = async (id: number, label: string | null) => {
    setBusyAccount(id);
    try {
      await api.patch(`/admin/tidal/accounts/${id}`, { label });
      await load();
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Не удалось переименовать');
    } finally {
      setBusyAccount(null);
    }
  };

  const refreshSubscription = async (id: number) => {
    setBusyAccount(id);
    try {
      await api.post(`/admin/tidal/accounts/${id}/refresh`);
      showToast('ok', 'Подписка обновлена');
      await load();
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Не удалось обновить');
    } finally {
      setBusyAccount(null);
    }
  };

  const removeAccount = async (id: number) => {
    if (!confirm('Удалить аккаунт из пула? Действие необратимо.')) return;
    setBusyAccount(id);
    try {
      await api.delete(`/admin/tidal/accounts/${id}`);
      showToast('ok', 'Аккаунт удалён');
      await load();
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Не удалось удалить');
    } finally {
      setBusyAccount(null);
    }
  };

  return (
    <section className="rounded-[var(--radius-md)] border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Server size={14} className="text-muted-foreground" />
            Tidal-аккаунты
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Прокси-пул аккаунтов Tidal. Воркер раздаёт стримы по least-recently-used и сам
            выключает аккаунт после 5 ошибок подряд. Добавь аккаунт через refresh token или
            device-flow на link.tidal.com.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={load} aria-label="Обновить" className="h-8 w-8">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </Button>
          <Button onClick={() => (showAdd ? closeAddForm() : setShowAdd(true))} size="sm">
            {showAdd ? <X size={14} /> : <Plus size={14} />}
            {showAdd ? 'Закрыть' : 'Добавить аккаунт'}
          </Button>
        </div>
      </div>

      {/* Pool-wide stats — same four numbers as before but always
          visible so an admin can spot "0 active" at a glance. */}
      {stats && (
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-[var(--radius-sm)] border border-border bg-background p-3 text-xs sm:grid-cols-4">
          <Stat label="Аккаунтов" value={String(stats.total)} />
          <Stat label="Активных" value={String(stats.enabled)} accent={stats.enabled > 0 ? 'ok' : 'warn'} />
          <Stat label="С ошибками" value={String(stats.broken)} accent={stats.broken > 0 ? 'warn' : undefined} />
          <Stat label="Запросов всего" value={String(stats.totalUsage)} />
        </div>
      )}

      {loadError && (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--color-danger)]">
          <AlertCircle size={12} /> {loadError}
        </p>
      )}

      {/* Add-account drawer with two tabs.
          The motion `LayoutGroup` lets the active-tab pill slide between
          options instead of snapping. */}
      <AnimatePresence initial={false}>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-4 flex flex-col gap-3 rounded-[var(--radius-sm)] border border-border bg-background p-3">
              <LayoutGroup id="tidal-add-tabs">
                <div role="tablist" aria-label="Способ добавления" className="inline-flex rounded-full border border-border bg-card p-0.5 text-xs">
                  <TabButton label="Refresh token" active={addTab === 'token'} onSelect={() => setAddTab('token')} />
                  <TabButton label="Device-flow" active={addTab === 'device'} onSelect={() => setAddTab('device')} />
                </div>
              </LayoutGroup>

              <AnimatePresence mode="wait" initial={false}>
                {addTab === 'token' ? (
                  <motion.div
                    key="token"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.14 }}
                    className="flex flex-col gap-2"
                  >
                    <input
                      value={labelInput}
                      onChange={(e) => setLabelInput(e.target.value)}
                      placeholder="Метка (необязательно): «main», «backup-eu» …"
                      className="rounded-[var(--radius-sm)] border border-border bg-card px-3 py-2 text-xs outline-none focus:border-[var(--color-accent)]"
                    />
                    <input
                      value={refreshTokenInput}
                      onChange={(e) => setRefreshTokenInput(e.target.value)}
                      placeholder="Refresh token: eyJraWQiOi…"
                      spellCheck={false}
                      autoComplete="off"
                      className="rounded-[var(--radius-sm)] border border-border bg-card px-3 py-2 font-mono text-xs outline-none focus:border-[var(--color-accent)]"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-muted-foreground">
                        Worker сам обменяет refresh token на access token и подтянет тип подписки.
                        Аккаунт с тем же Tidal user id обновит токены, не дублируясь.
                      </p>
                      <Button onClick={addByRefreshToken} disabled={adding || !refreshTokenInput.trim()} size="sm">
                        {adding ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                        Применить
                      </Button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="device"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.14 }}
                    className="flex flex-col gap-2"
                  >
                    {!device ? (
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] text-muted-foreground">
                          Логин через сайт Tidal: жмёшь «Запустить», получаешь короткий код,
                          вводишь его на link.tidal.com и подтверждаешь. Worker создаст или
                          обновит запись в пуле автоматически.
                        </p>
                        <Button onClick={startDevice} disabled={deviceBusy} size="sm">
                          {deviceBusy ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                          Запустить
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex flex-col">
                            <span className="text-muted-foreground">Введи код на link.tidal.com:</span>
                            <span className="select-all font-mono text-2xl tracking-[0.4em]">{device.userCode}</span>
                          </div>
                          <Button
                            onClick={() => copy(device.userCode, 'Код')}
                            size="icon"
                            variant="ghost"
                            aria-label="Скопировать код"
                            className="h-7 w-7"
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
                            {devicePolling && <Loader2 size={12} className="animate-spin" />}
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
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!loading && accounts && accounts.length === 0 && (
        <p className="mt-6 rounded-[var(--radius-sm)] border border-dashed border-border bg-background p-6 text-center text-xs text-muted-foreground">
          Пул пуст. Добавь первый аккаунт — refresh token или device-flow.
        </p>
      )}

      {accounts && accounts.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {accounts.map((a) => (
              <motion.li
                key={a.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <AccountCard
                  account={a}
                  busy={busyAccount === a.id}
                  onToggle={(en) => void setEnabled(a.id, en)}
                  onRename={(label) => void renameAccount(a.id, label)}
                  onRefresh={() => void refreshSubscription(a.id)}
                  onRemove={() => void removeAccount(a.id)}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

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
            {toast.kind === 'ok' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

interface TabButtonProps {
  label: string;
  active: boolean;
  onSelect: () => void;
}

function TabButton({ label, active, onSelect }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={`relative isolate inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs transition-colors ${
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {active && (
        <motion.span
          layoutId="tidal-add-tab-pill"
          className="absolute inset-0 -z-10 rounded-full bg-[var(--color-accent-soft)]"
          transition={{ type: 'spring', stiffness: 360, damping: 28 }}
        />
      )}
      {label}
    </button>
  );
}

interface AccountCardProps {
  account: PoolAccount;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onRename: (label: string | null) => void;
  onRefresh: () => void;
  onRemove: () => void;
}

function AccountCard({ account, busy, onToggle, onRename, onRefresh, onRemove }: AccountCardProps) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [draftLabel, setDraftLabel] = useState(account.label ?? '');

  useEffect(() => { setDraftLabel(account.label ?? ''); }, [account.label]);

  const submitLabel = () => {
    const trimmed = draftLabel.trim();
    onRename(trimmed === '' ? null : trimmed);
    setEditingLabel(false);
  };

  const expiresInS = account.expiresAt - Math.floor(Date.now() / 1000);
  const tokenStale = expiresInS < 60;

  return (
    <div className={`rounded-[var(--radius-sm)] border p-3 transition-colors ${
      account.enabled
        ? 'border-border bg-background'
        : 'border-dashed border-border/60 bg-background/40'
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${
              account.enabled
                ? account.consecutiveErrors > 0
                  ? 'bg-[var(--color-danger)] animate-pulse'
                  : 'bg-[var(--color-accent)]'
                : 'bg-muted-foreground/50'
            }`} />
            {editingLabel ? (
              <input
                autoFocus
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                onBlur={submitLabel}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitLabel();
                  if (e.key === 'Escape') { setDraftLabel(account.label ?? ''); setEditingLabel(false); }
                }}
                className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border bg-card px-2 py-0.5 text-sm outline-none focus:border-[var(--color-accent)]"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingLabel(true)}
                className="truncate text-sm font-medium hover:text-[var(--color-accent)]"
              >
                {account.label ?? `Аккаунт #${account.id}`}
              </button>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>uid {account.userId}</span>
            <span>{account.countryCode}</span>
            {account.subscriptionType && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-accent-soft)] bg-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] text-[var(--color-accent)]">
                {account.subscriptionType}
              </span>
            )}
            {account.subscriptionValidUntil && (
              <span>до {formatDate(account.subscriptionValidUntil)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={busy}
            aria-label="Обновить подписку"
            className="h-7 w-7"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onToggle(!account.enabled)}
            disabled={busy}
            aria-label={account.enabled ? 'Выключить' : 'Включить'}
            className="h-7 w-7"
          >
            {account.enabled
              ? <ShieldCheck size={12} className="text-[var(--color-accent)]" />
              : <ShieldOff size={12} className="text-muted-foreground" />
            }
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            disabled={busy}
            aria-label="Удалить"
            className="h-7 w-7 hover:text-[var(--color-danger)]"
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] sm:grid-cols-4">
        <Stat label="Запросов" value={String(account.usageCount)} compact />
        <Stat label="Последний" value={relative(account.lastUsedAt || null)} compact />
        <Stat
          label="Access token"
          value={tokenStale ? 'истёк' : `${Math.floor(expiresInS / 60)} мин`}
          accent={tokenStale ? 'warn' : undefined}
          compact
        />
        <Stat
          label="Подряд ошибок"
          value={String(account.consecutiveErrors)}
          accent={account.consecutiveErrors > 0 ? 'warn' : undefined}
          compact
        />
      </div>

      {account.lastError && (
        <p className="mt-2 truncate rounded-[var(--radius-sm)] border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)]/30 px-2 py-1 text-[11px] text-[var(--color-danger)]">
          {account.lastError}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, accent, compact }: { label: string; value: string; accent?: 'ok' | 'warn'; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`uppercase tracking-[0.16em] text-muted-foreground ${compact ? 'text-[9px]' : 'text-[10px]'}`}>{label}</span>
      <span
        className={[
          compact ? 'text-[11px]' : 'text-xs',
          accent === 'ok' ? 'text-[var(--color-accent)]' : '',
          accent === 'warn' ? 'text-[var(--color-danger)]' : '',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
}
