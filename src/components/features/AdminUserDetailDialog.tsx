import {
  X, Loader2, Crown, Star, Ban, Shield, ShieldOff, Undo2, Database, ListMusic,
  Heart, Disc, Music2, ThumbsDown, History, Clock, Layers, KeyRound, AlertOctagon,
  CheckCircle2, Smartphone, Info,
} from 'lucide-react';
import { useI18n, useT } from '@/i18n';
import {
  useAdminUserStats, useBanUser, useUnbanUser, useToggleAdmin, useGrantSub,
} from '@/hooks/useAdminUsers';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { UserAvatar } from '@/components/ui/UserAvatar';
import type { AdminUserStats } from '@/types/admin';

interface AdminUserDetailDialogProps {
  userId: string | null;
  meId: string;
  onClose: () => void;
}

function intlLocale(locale: string): string {
  return locale === 'en' ? 'en' : 'ru-RU';
}

/**
 * Admin drill-down. Opened by clicking a row in the user grid; pulls
 * the heavy /admin/users/:id endpoint on demand and renders every
 * statistic an operator might care about (subscription history, R2
 * storage breakdown, library counts, listening aggregates, sessions,
 * preferences). Bottom-sheet on mobile, centered modal on md+ via
 * the shared `Sheet` primitive at `layer="elevated"` so it can
 * paint above standard-layer dialogs from elsewhere in the app.
 */
export function AdminUserDetailDialog({ userId, meId, onClose }: AdminUserDetailDialogProps) {
  const { t, locale } = useI18n();
  const intl = intlLocale(locale);
  const open = !!userId;

  const { data, isLoading, isFetching, error } = useAdminUserStats(userId);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      layer="elevated"
      ariaLabel={t('admin.detail.title')}
      panelClassName="flex w-[min(720px,calc(100vw-24px))] flex-col border border-border bg-card max-h-[calc(100dvh-7rem-env(safe-area-inset-bottom,0px))]"
    >
      <DetailHeader
        title={t('admin.detail.title')}
        onClose={onClose}
        isFetching={isFetching && !!data}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {isLoading && !data ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            <Loader2 size={14} className="mr-2 animate-spin" /> {t('admin.detail.loading')}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <AlertOctagon size={28} className="text-destructive" />
            <p className="text-sm font-medium">{t('admin.detail.error')}</p>
            <p className="text-xs text-muted-foreground">
              {error instanceof Error ? error.message : String(error)}
            </p>
          </div>
        ) : data ? (
          <DetailBody data={data} meId={meId} t={t} intl={intl} onClose={onClose} />
        ) : null}
      </div>
    </Sheet>
  );
}

function DetailHeader({
  title, onClose, isFetching,
}: { title: string; onClose: () => void; isFetching: boolean }) {
  const t = useT();
  return (
    <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <Info size={15} className="text-muted-foreground" />
        <span className="truncate text-sm font-medium">{title}</span>
        {isFetching && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        aria-label={t('common.close')}
      >
        <X size={14} />
      </button>
    </div>
  );
}

type Translate = ReturnType<typeof useT>;

function DetailBody({
  data, meId, t, intl, onClose,
}: {
  data: AdminUserStats; meId: string; t: Translate; intl: string; onClose: () => void;
}) {
  const u = data.user;
  const banMut = useBanUser();
  const unbanMut = useUnbanUser();
  const adminMut = useToggleAdmin();
  const grantMut = useGrantSub();

  const isMe = u.id === meId;
  const label = u.name?.trim() || (u.username && '@' + u.username) || u.id;

  return (
    <div className="flex flex-col gap-5 pb-8">
      {/* Identity */}
      <section className="flex items-start gap-4">
        <div className="relative shrink-0">
          <UserAvatar
            name={u.name}
            username={u.username}
            id={u.id}
            className="h-16 w-16 rounded-full"
            initialsClassName="text-base"
          />
          {u.isBanned && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-destructive/85">
              <Ban size={20} className="text-destructive-foreground" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold">{label}{isMe && ` · ${t('admin.you')}`}</h2>
            {u.isAdmin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--color-accent)]">
                <Crown size={11} /> {t('admin.role.admin')}
              </span>
            )}
            {data.subscription.current ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500">
                <Star size={11} /> {t('admin.detail.subActive')}
              </span>
            ) : null}
            {u.isBanned && (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                <Ban size={11} /> {t('admin.detail.banned')}
              </span>
            )}
          </div>
          <div className="mt-1 grid grid-cols-1 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
            <KV k={t('admin.detail.id')} v={<code className="text-foreground">{u.id}</code>} />
            <KV k={t('admin.detail.username')} v={u.username ? '@' + u.username : '—'} />
            <KV k={t('admin.detail.joined')} v={formatAbsolute(u.createdAt, intl)} />
            <KV k={t('admin.detail.updated')} v={formatAbsolute(u.updatedAt, intl)} />
            <KV
              k={t('admin.detail.lastPlayed')}
              v={data.playHistory.lastPlayedAt
                ? `${formatAbsolute(data.playHistory.lastPlayedAt, intl)} · ${formatRelative(data.playHistory.lastPlayedAt, t)}`
                : '—'}
            />
            <KV
              k={t('admin.detail.lastSession')}
              v={data.sessions.lastCreatedAt ? formatAbsolute(data.sessions.lastCreatedAt, intl) : '—'}
            />
            <KV k={t('admin.detail.tour')} v={u.tourCompletedAt ? formatAbsolute(u.tourCompletedAt, intl) : t('admin.detail.no')} />
            {u.isBanned && (
              <KV
                k={t('admin.detail.banDetails')}
                v={
                  <span>
                    {u.bannedAt ? formatAbsolute(u.bannedAt, intl) : '—'}
                    {u.bannedReason ? ` · ${u.bannedReason}` : ''}
                  </span>
                }
              />
            )}
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <section className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          onClick={() => grantMut.mutate({ userId: u.id, days: 30 })}
          disabled={grantMut.isPending}
        >
          {grantMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Star size={12} />}
          {t('admin.action.grantSub')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => adminMut.mutate({ userId: u.id, isAdmin: !u.isAdmin })}
          disabled={(isMe && u.isAdmin) || adminMut.isPending}
        >
          {adminMut.isPending ? <Loader2 size={12} className="animate-spin" /> : (u.isAdmin ? <ShieldOff size={12} /> : <Shield size={12} />)}
          {u.isAdmin ? t('admin.action.removeAdmin') : t('admin.action.makeAdmin')}
        </Button>
        {u.isBanned ? (
          <Button
            variant="ghost"
            onClick={() => unbanMut.mutate(u.id)}
            disabled={unbanMut.isPending}
          >
            {unbanMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
            {t('admin.action.unban')}
          </Button>
        ) : (
          <Button
            variant="danger"
            onClick={async () => {
              const reason = window.prompt(t('admin.action.banPlaceholder'), '') ?? '';
              if (reason === null) return;
              await banMut.mutateAsync({ id: u.id, reason: reason.trim() || undefined });
            }}
            disabled={isMe || banMut.isPending}
          >
            {banMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
            {t('admin.action.ban')}
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>{t('admin.action.cancel')}</Button>
      </section>

      {/* Storage */}
      <Section icon={<Database size={14} />} title={t('admin.detail.section.storage')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label={t('admin.detail.storage.uploads')}
            value={data.storage.uploads.count.toLocaleString(intl)}
            sub={formatBytes(data.storage.uploads.bytes)}
          />
          <Stat
            label={t('admin.detail.storage.overrides')}
            value={data.storage.overrides.count.toLocaleString(intl)}
            sub={formatBytes(data.storage.overrides.bytes)}
          />
          <Stat
            label={t('admin.detail.storage.total')}
            value={formatBytes(data.storage.totalBytes)}
            sub={t('admin.detail.storage.totalSub')}
            tone="accent"
          />
        </div>
      </Section>

      {/* Library */}
      <Section icon={<ListMusic size={14} />} title={t('admin.detail.section.library')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat
            label={t('admin.detail.library.playlists')}
            value={data.library.playlists.total.toLocaleString(intl)}
            sub={t('admin.detail.library.playlistsSub', {
              created: data.library.playlists.created,
              liked: data.library.playlists.liked,
            })}
            icon={<ListMusic size={11} />}
          />
          <Stat
            label={t('admin.detail.library.tracksInPlaylists')}
            value={data.library.playlistTracks.toLocaleString(intl)}
            icon={<Music2 size={11} />}
          />
          <Stat
            label={t('admin.detail.library.albums')}
            value={data.library.libraryAlbums.toLocaleString(intl)}
            icon={<Disc size={11} />}
          />
          <Stat
            label={t('admin.detail.library.artists')}
            value={data.library.libraryArtists.toLocaleString(intl)}
            icon={<Heart size={11} />}
          />
          <Stat
            label={t('admin.detail.library.dislikes')}
            value={data.library.dislikes.toLocaleString(intl)}
            icon={<ThumbsDown size={11} />}
          />
        </div>
      </Section>

      {/* Listening */}
      <Section icon={<History size={14} />} title={t('admin.detail.section.listening')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label={t('admin.detail.listen.total')} value={data.playHistory.total.toLocaleString(intl)} />
          <Stat label={t('admin.detail.listen.last7d')} value={data.playHistory.last7d.toLocaleString(intl)} />
          <Stat label={t('admin.detail.listen.last30d')} value={data.playHistory.last30d.toLocaleString(intl)} />
        </div>

        {data.playHistory.bySource.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <Layers size={11} className="mr-1 inline" /> {t('admin.detail.listen.bySource')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.playHistory.bySource.map((b) => (
                <span
                  key={b.source}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/40 px-2 py-0.5 text-[11px]"
                >
                  <span className="font-medium">{b.source || 'unknown'}</span>
                  <span className="text-muted-foreground">· {b.count.toLocaleString(intl)}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {data.playHistory.recent.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <Clock size={11} className="mr-1 inline" /> {t('admin.detail.listen.recent')}
            </div>
            <ul className="divide-y divide-border/60 rounded-[var(--radius-md)] border border-border/60">
              {data.playHistory.recent.map((p, i) => (
                <li key={`${p.trackId}-${p.playedAt}-${i}`} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{p.title || p.trackId}</span>
                      {p.completed && <CheckCircle2 size={11} className="shrink-0 text-emerald-500" />}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.artistName || '—'} · {p.source} · {Math.floor(p.listenedSeconds / 60)}:{String(p.listenedSeconds % 60).padStart(2, '0')} / {Math.floor(p.duration / 60)}:{String(p.duration % 60).padStart(2, '0')}
                    </div>
                  </div>
                  <time
                    className="shrink-0 text-[11px] text-muted-foreground"
                    title={formatAbsolute(p.playedAt, intl)}
                    dateTime={new Date(p.playedAt * 1000).toISOString()}
                  >
                    {formatAbsolute(p.playedAt, intl)}
                  </time>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* Subscription history */}
      <Section icon={<Star size={14} />} title={t('admin.detail.section.subscription')}>
        {data.subscription.current ? (
          <div className="mb-3 rounded-[var(--radius-md)] border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs">
            <div className="font-medium text-emerald-500">{t('admin.detail.sub.current')}</div>
            <div className="mt-1 text-muted-foreground">
              {t('admin.detail.sub.expiresAt')}: <span className="text-foreground">{formatAbsolute(data.subscription.current.expiresAt, intl)}</span>
              {data.subscription.current.paymentMethod && <> · {data.subscription.current.paymentMethod}</>}
            </div>
          </div>
        ) : (
          <p className="mb-3 text-xs text-muted-foreground">{t('admin.detail.sub.none')}</p>
        )}
        {data.subscription.history.length > 0 ? (
          <ul className="divide-y divide-border/60 rounded-[var(--radius-md)] border border-border/60 text-xs">
            {data.subscription.history.map((s) => (
              <li key={s.id} className="grid grid-cols-1 gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[100px_1fr_140px]">
                <span className={`font-medium ${s.status === 'active' ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                  {s.status}
                </span>
                <span className="text-muted-foreground">
                  {t('admin.detail.sub.expiresAt')}: <span className="text-foreground">{formatAbsolute(s.expiresAt, intl)}</span>
                  {s.paymentMethod && <> · {s.paymentMethod}</>}
                  {s.starsTxId && <> · tx <code className="text-foreground">{s.starsTxId}</code></>}
                </span>
                <span className="text-muted-foreground">{formatAbsolute(s.createdAt, intl)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{t('admin.detail.sub.empty')}</p>
        )}
      </Section>

      {/* Sessions */}
      <Section icon={<Smartphone size={14} />} title={t('admin.detail.section.sessions')}>
        <div className="grid grid-cols-2 gap-3">
          <Stat label={t('admin.detail.sessions.active')} value={data.sessions.active.toLocaleString(intl)} />
          <Stat
            label={t('admin.detail.sessions.lastCreated')}
            value={data.sessions.lastCreatedAt ? formatAbsolute(data.sessions.lastCreatedAt, intl) : '—'}
          />
        </div>
      </Section>

      {/* Preferences */}
      <Section icon={<KeyRound size={14} />} title={t('admin.detail.section.preferences')}>
        {data.preferences == null ? (
          <p className="text-xs text-muted-foreground">{t('admin.detail.prefs.empty')}</p>
        ) : (
          <pre className="max-h-[280px] overflow-auto rounded-[var(--radius-md)] border border-border/60 bg-secondary/30 p-3 text-[11px] leading-relaxed">
            {JSON.stringify(data.preferences, null, 2)}
          </pre>
        )}
      </Section>
    </div>
  );
}

function Section({
  icon, title, children,
}: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}

function Stat({
  label, value, sub, icon, tone,
}: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: React.ReactNode;
  tone?: 'accent';
}) {
  const valueCls = tone === 'accent' ? 'text-[var(--color-accent)]' : 'text-foreground';
  return (
    <div className="rounded-[var(--radius-md)] border border-border/60 bg-secondary/30 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <div className={`mt-1 text-base font-semibold ${valueCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 text-muted-foreground">{k}:</span>
      <span className="min-w-0 truncate text-foreground">{v}</span>
    </div>
  );
}

function formatAbsolute(epochSec: number, intl: string): string {
  return new Date(epochSec * 1000).toLocaleString(intl, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatRelative(epochSec: number, t: Translate): string {
  const diff = Math.floor(Date.now() / 1000) - epochSec;
  if (diff < 60) return t('admin.relative.justNow');
  if (diff < 3600) return t('admin.relative.minutes', { n: Math.floor(diff / 60) });
  if (diff < 86400) return t('admin.relative.hours', { n: Math.floor(diff / 3600) });
  return t('admin.relative.days', { n: Math.floor(diff / 86400) });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
