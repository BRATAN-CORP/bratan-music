import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Search, Shield, ShieldOff, Ban, Undo2, Star, Crown, Loader2, ChevronLeft,
  ChevronRight, Users as UsersIcon, AlertOctagon, ArrowUpDown, X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AuthGuard } from '@/components/features/AuthGuard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CoverFallback } from '@/components/ui/CoverFallback';
import { api } from '@/lib/api';
import {
  useAdminUsers, useBanUser, useUnbanUser, useToggleAdmin, useGrantSub,
  type AdminUsersFilters,
} from '@/hooks/useAdminUsers';
import type { AdminUser } from '@/types/admin';
import { EASE_SPRING } from '@/lib/motion';

const PAGE_SIZE = 25;

export function AdminPage() {
  return (
    <AuthGuard>
      <AdminGate />
    </AuthGuard>
  );
}

function AdminGate() {
  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<{ id: string; isAdmin: boolean }>('/user/me'),
  });
  if (isLoading) {
    return <div className="flex min-h-[40dvh] items-center justify-center text-sm text-muted-foreground">Загружаем…</div>;
  }
  if (!profile?.isAdmin) {
    return <Navigate to="/" replace />;
  }
  return <AdminDashboard meId={profile.id} />;
}

function AdminDashboard({ meId }: { meId: string }) {
  const reduce = useReducedMotion();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [role, setRole] = useState<AdminUsersFilters['role']>('');
  const [banned, setBanned] = useState<AdminUsersFilters['banned']>('');
  const [sub, setSub] = useState<AdminUsersFilters['sub']>('');
  const [sort, setSort] = useState<AdminUsersFilters['sort']>('created_at');
  const [page, setPage] = useState(0);
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => window.clearTimeout(id);
  }, [q]);
  useEffect(() => { setPage(0); }, [debouncedQ, role, banned, sub, sort]);

  const filters: AdminUsersFilters = useMemo(() => ({
    q: debouncedQ || undefined,
    role, banned, sub, sort,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [debouncedQ, role, banned, sub, sort, page]);

  const { data, isLoading, isFetching, isPlaceholderData } = useAdminUsers(filters);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE_SPRING }}
        className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
            <Crown size={14} className="text-[var(--color-accent)]" /> Администрирование
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Пользователи · {total.toLocaleString('ru-RU')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Поиск, фильтры, выдача подписки, баны и роли.
          </p>
        </div>
      </motion.div>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по @username, имени или ID"
            className="pl-9"
          />
          {q && (
            <button
              onClick={() => setQ('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground"
              aria-label="Очистить"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            label="Роль"
            options={[
              { v: '', label: 'Все' },
              { v: 'admin', label: 'Админы' },
              { v: 'user', label: 'Юзеры' },
            ]}
            value={role ?? ''}
            onChange={(v) => setRole(v as AdminUsersFilters['role'])}
          />
          <FilterChip
            label="Бан"
            options={[
              { v: '', label: 'Все' },
              { v: '1', label: 'Забанены' },
              { v: '0', label: 'Активны' },
            ]}
            value={banned ?? ''}
            onChange={(v) => setBanned(v as AdminUsersFilters['banned'])}
          />
          <FilterChip
            label="Подписка"
            options={[
              { v: '', label: 'Все' },
              { v: 'active', label: 'Активна' },
              { v: 'none', label: 'Нет' },
            ]}
            value={sub ?? ''}
            onChange={(v) => setSub(v as AdminUsersFilters['sub'])}
          />
          <SortChip
            value={sort ?? 'created_at'}
            onChange={(v) => setSort(v)}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
        <div className="hidden grid-cols-[1fr_120px_120px_120px_120px_140px] gap-4 border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground lg:grid">
          <div>Пользователь</div>
          <div>Роль</div>
          <div>Подписка</div>
          <div>Прослушано</div>
          <div>Зарегистрирован</div>
          <div>Действия</div>
        </div>

        {isLoading && !data ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 size={14} className="mr-2 animate-spin" /> Загружаем
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <UsersIcon size={32} className="text-muted-foreground" />
            <p className="text-sm font-medium">Никого не нашли</p>
            <p className="text-xs text-muted-foreground">Сбрось фильтры или измени поисковый запрос.</p>
          </div>
        ) : (
          <ul className={`divide-y divide-border ${isPlaceholderData && isFetching ? 'opacity-70' : ''}`}>
            <AnimatePresence initial={false}>
              {items.map((u, i) => (
                <motion.li
                  key={u.id}
                  layout
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: 0.3, delay: Math.min(i * 0.015, 0.15), ease: EASE_SPRING } }}
                  exit={reduce ? undefined : { opacity: 0, y: -6 }}
                >
                  <UserRow user={u} meId={meId} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {total > 0
            ? `${page * PAGE_SIZE + 1}–${Math.min(total, (page + 1) * PAGE_SIZE)} из ${total}`
            : '—'}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
            <ChevronLeft size={14} />
          </Button>
          <span className="px-2">Стр {page + 1} / {totalPages}</span>
          <Button variant="ghost" size="icon" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page + 1 >= totalPages}>
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function UserRow({ user, meId }: { user: AdminUser; meId: string }) {
  const banMut = useBanUser();
  const unbanMut = useUnbanUser();
  const adminMut = useToggleAdmin();
  const grantMut = useGrantSub();
  const [banDraft, setBanDraft] = useState<{ open: boolean; reason: string }>({ open: false, reason: '' });

  const isMe = user.id === meId;
  const label = (user.username && '@' + user.username) || user.name || user.id;
  const subActive = !!user.subscription;
  const subDays = user.subscription
    ? Math.max(0, Math.ceil((user.subscription.expiresAt - Date.now() / 1000) / 86400))
    : 0;

  return (
    <div className="grid grid-cols-1 gap-3 px-4 py-4 lg:grid-cols-[1fr_120px_120px_120px_120px_140px] lg:items-center">
      {/* Identity */}
      <div className="flex items-center gap-3">
        <div className="relative h-10 w-10 overflow-hidden rounded-full">
          <CoverFallback src={null} name={label} className="rounded-full" initialsClassName="text-xs" />
          {user.isBanned && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-destructive/85">
              <Ban size={14} className="text-destructive-foreground" />
            </span>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{label}{isMe && ' · ты'}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {user.name || '—'} · ID {user.id}
          </div>
          {user.isBanned && user.bannedReason && (
            <div className="mt-1 truncate text-xs text-destructive">
              <AlertOctagon size={10} className="mr-1 inline" /> {user.bannedReason}
            </div>
          )}
        </div>
      </div>

      {/* Role */}
      <div>
        {user.isAdmin ? (
          <Pill tone="accent"><Crown size={11} /> Админ</Pill>
        ) : (
          <Pill tone="muted">Юзер</Pill>
        )}
      </div>

      {/* Subscription */}
      <div>
        {subActive ? (
          <Pill tone="success">
            <Star size={11} /> {subDays}д осталось
          </Pill>
        ) : (
          <Pill tone="muted">Бесплатно</Pill>
        )}
      </div>

      {/* Listened */}
      <div className="text-xs text-muted-foreground">
        {user.playCount.toLocaleString('ru-RU')} ·{' '}
        {user.lastPlayedAt ? formatRelative(user.lastPlayedAt) : '—'}
      </div>

      {/* Created */}
      <div className="text-xs text-muted-foreground">{formatDate(user.createdAt)}</div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <ActionIcon
          title={`Дать подписку на 30 дней`}
          onClick={() => grantMut.mutate({ userId: user.id, days: 30 })}
          loading={grantMut.isPending && grantMut.variables?.userId === user.id}
          icon={<Star size={13} />}
        />
        <ActionIcon
          title={user.isAdmin ? 'Снять админа' : 'Сделать админом'}
          onClick={() => adminMut.mutate({ userId: user.id, isAdmin: !user.isAdmin })}
          disabled={isMe && user.isAdmin}
          loading={adminMut.isPending && adminMut.variables?.userId === user.id}
          icon={user.isAdmin ? <ShieldOff size={13} /> : <Shield size={13} />}
        />
        {user.isBanned ? (
          <ActionIcon
            title="Снять бан"
            onClick={() => unbanMut.mutate(user.id)}
            loading={unbanMut.isPending && unbanMut.variables === user.id}
            icon={<Undo2 size={13} />}
            tone="success"
          />
        ) : (
          <ActionIcon
            title="Забанить"
            onClick={() => setBanDraft({ open: true, reason: '' })}
            disabled={isMe}
            icon={<Ban size={13} />}
            tone="danger"
          />
        )}
      </div>

      <AnimatePresence>
        {banDraft.open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="lg:col-span-6"
          >
            <div className="mt-3 flex flex-col gap-2 rounded-[var(--radius-md)] border border-destructive/40 bg-destructive/5 p-3 sm:flex-row sm:items-center">
              <Input
                value={banDraft.reason}
                onChange={(e) => setBanDraft((d) => ({ ...d, reason: e.target.value }))}
                placeholder="Причина бана (необязательно, до 280 символов)"
                maxLength={280}
                autoFocus
              />
              <div className="flex gap-2 sm:shrink-0">
                <Button
                  variant="danger"
                  onClick={async () => {
                    await banMut.mutateAsync({ id: user.id, reason: banDraft.reason || undefined });
                    setBanDraft({ open: false, reason: '' });
                  }}
                  disabled={banMut.isPending}
                >
                  {banMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                  Забанить
                </Button>
                <Button variant="ghost" onClick={() => setBanDraft({ open: false, reason: '' })}>Отмена</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Pill({ tone, children }: { tone: 'accent' | 'muted' | 'success' | 'danger'; children: React.ReactNode }) {
  const cls = {
    accent: 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]',
    muted: 'bg-secondary text-muted-foreground',
    success: 'bg-emerald-500/10 text-emerald-500',
    danger: 'bg-destructive/10 text-destructive',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

function ActionIcon({
  title, onClick, icon, disabled, loading, tone,
}: {
  title: string; onClick: () => void; icon: React.ReactNode;
  disabled?: boolean; loading?: boolean; tone?: 'danger' | 'success';
}) {
  const toneCls = tone === 'danger'
    ? 'hover:bg-destructive/10 hover:text-destructive'
    : tone === 'success'
    ? 'hover:bg-emerald-500/10 hover:text-emerald-500'
    : 'hover:bg-secondary hover:text-foreground';
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors disabled:opacity-40 ${toneCls}`}
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : icon}
    </button>
  );
}

function FilterChip<T extends string>({
  label, options, value, onChange,
}: {
  label: string;
  options: Array<{ v: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
      <span className="font-medium uppercase tracking-wider">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="bg-transparent text-foreground outline-none"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v} className="bg-background">{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function SortChip({ value, onChange }: { value: NonNullable<AdminUsersFilters['sort']>; onChange: (v: NonNullable<AdminUsersFilters['sort']>) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
      <ArrowUpDown size={11} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as NonNullable<AdminUsersFilters['sort']>)}
        className="bg-transparent text-foreground outline-none"
      >
        <option value="created_at" className="bg-background">Сначала новые</option>
        <option value="last_played_at" className="bg-background">По активности</option>
        <option value="tg_username" className="bg-background">По имени</option>
      </select>
    </label>
  );
}

function formatDate(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit' });
}

function formatRelative(epochSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - epochSec;
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)}м назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч назад`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}д назад`;
  return formatDate(epochSec);
}
