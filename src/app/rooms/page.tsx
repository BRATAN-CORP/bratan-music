import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Users, LogOut, Copy, Share2,
  Radio, Search, Trash2, Loader2, Play,
} from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { RoomChat } from '@/components/features/RoomChat';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CoverFallback } from '@/components/ui/CoverFallback';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Switch } from '@/components/ui/Switch';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { useRoomConnectionStore } from '@/store/roomConnection';
import { useDeleteRoom, useLeaveRoom, useUpdateRoomSettings } from '@/hooks/useRooms';
import { useSearch } from '@/hooks/useSearch';
import type { RoomDetail, RoomMember, RoomTrackSnapshot } from '@/types/rooms';
import type { Track } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { EASE_SPRING } from '@/lib/motion';

export function RoomPage() {
  return (
    <AuthGuard>
      <RoomPageInner />
    </AuthGuard>
  );
}

function RoomPageInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.user);
  const reduce = useReducedMotion();

  // The bridge owns audio + polling. The page just sets the active
  // connection so the bridge spins up, and reads the mirrored room
  // state out of the connection store for member/controller display.
  const setActiveRoom = useRoomConnectionStore((s) => s.setActive);
  const setHostOnlyControl = useRoomConnectionStore((s) => s.setHostOnlyControl);
  const clearActiveRoom = useRoomConnectionStore((s) => s.clear);
  const remoteState = useRoomConnectionStore((s) => s.state);
  const remoteMembers = useRoomConnectionStore((s) => s.members);
  const hostOnlyControl = useRoomConnectionStore((s) => s.hostOnlyControl);
  const isLive = useRoomConnectionStore((s) => s.isLive);

  // Global player state — what the bridge has written into /
  // what the user is currently hearing across the whole app. We
  // render a read-only "now playing" tile from this; the actual
  // play / pause / seek controls live in the global Player at the
  // bottom of the screen.
  const playerTrack = usePlayerStore((s) => s.currentTrack);
  const playerProgress = usePlayerStore((s) => s.progress);
  const playerIsPlaying = usePlayerStore((s) => s.isPlaying);
  const setTrackLocal = usePlayerStore((s) => s.setTrack);

  const initialQuery = useQuery({
    queryKey: ['rooms', 'detail', id],
    queryFn: async () => {
      if (!id) throw new Error('Room id missing');
      try {
        return await api.get<RoomDetail>(`/rooms/${id}`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          // Not a member yet — redirect to the list page so the user
          // can join via code instead of staring at an opaque error.
          navigate('/rooms', { replace: true });
        }
        throw err;
      }
    },
    enabled: !!id,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const initial = initialQuery.data;
  const leaveMut = useLeaveRoom();
  const deleteMut = useDeleteRoom();
  const settingsMut = useUpdateRoomSettings(id);
  const isHost = !!initial && me?.id === initial.hostId;
  const canSetTrack = isHost || !hostOnlyControl;

  // Promote the room into the global connection store as soon as we
  // know its identity. The bridge will pick this up on the next
  // render and start polling. Note we DO NOT clear on unmount —
  // the user is still "in" the room when they navigate to /search,
  // and clearing here would tear down the bridge prematurely. The
  // explicit Leave / Delete buttons below take care of clearing.
  useEffect(() => {
    if (!initial) return;
    setActiveRoom({
      roomId: initial.id,
      roomCode: initial.code,
      roomName: initial.name,
      hostId: initial.hostId,
      hostOnlyControl: initial.hostOnlyControl,
    });
  }, [initial, setActiveRoom]);

  // Settings mutation returns the updated detail — mirror its
  // hostOnlyControl into the connection store so the bridge's
  // permission gate updates without waiting for the next /state poll.
  useEffect(() => {
    if (!settingsMut.data) return;
    setHostOnlyControl(settingsMut.data.hostOnlyControl);
  }, [settingsMut.data, setHostOnlyControl]);

  const onLeave = async () => {
    if (!id) return;
    await leaveMut.mutateAsync(id);
    clearActiveRoom();
    navigate('/rooms');
  };
  const onDelete = async () => {
    if (!id) return;
    if (!window.confirm('Удалить комнату? Это действие нельзя отменить — все участники потеряют доступ.')) return;
    await deleteMut.mutateAsync(id);
    clearActiveRoom();
    navigate('/rooms');
  };

  // The "set track" picker pushes via the GLOBAL player store. The
  // bridge sees the change and propagates it to the room — same as
  // hitting play on a track from /search would. This is the
  // "seamless player" guarantee: any way the user can start audio
  // anywhere in the app, while in a room it auto-syncs to the room.
  const onPickTrack = (snap: RoomTrackSnapshot) => {
    setTrackLocal({
      id: snap.id,
      title: snap.title,
      artist: snap.artist,
      artistId: snap.artistId ?? undefined,
      artists: snap.artists,
      albumId: snap.albumId ?? undefined,
      coverUrl: snap.coverUrl ?? undefined,
      coverVideoUrl: snap.coverVideoUrl ?? undefined,
      duration: snap.duration ?? 0,
      source: snap.source ?? 'tidal',
    });
  };

  if (!id || initialQuery.isLoading || !initial) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center text-sm text-muted-foreground">
        Загружаем комнату…
      </div>
    );
  }

  const track = remoteState?.track ?? null;
  const duration = track?.duration ?? 0;
  const positionSec = playerTrack && track && playerTrack.id === track.id
    ? playerProgress
    : (remoteState?.positionMs ?? 0) / 1000;
  const liveMembers = remoteMembers.filter((m) => m.isLive);
  const controller = remoteState?.controllerId
    ? remoteMembers.find((m) => m.userId === remoteState?.controllerId)
    : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link
            to="/rooms"
            className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground hover:text-foreground"
          >
            ← Все комнаты
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            <Radio size={20} className="text-[var(--color-accent)]" />
            <span className="truncate">{initial.name}</span>
          </h1>
          <RoomCode code={initial.code} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void onLeave()} disabled={leaveMut.isPending}>
            <LogOut size={14} /> Выйти
          </Button>
          {isHost && (
            <Button
              variant="outline"
              onClick={() => void onDelete()}
              disabled={deleteMut.isPending}
              className="border-destructive/40 text-destructive hover:border-destructive hover:bg-destructive/10"
            >
              {deleteMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Удалить
            </Button>
          )}
        </div>
      </div>

      {/* Now playing — read-only mirror of the global player. The
          actual play / pause / volume / seek controls live in the
          mini-player at the bottom of the screen, so users have
          one consistent control surface across the whole app. */}
      <motion.section
        initial={reduce ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE_SPRING }}
        className="relative overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card p-5 sm:p-7"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background: track?.coverUrl
              ? `radial-gradient(60% 50% at 30% 30%, var(--color-accent-glow), transparent 70%)`
              : 'none',
          }}
        />
        <div className="relative grid gap-5 sm:grid-cols-[160px_1fr] sm:gap-6">
          <motion.div
            animate={
              !remoteState?.isPaused && playerIsPlaying && !reduce
                ? { scale: [1, 1.015, 1] }
                : { scale: 1 }
            }
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            className="aspect-square w-full overflow-hidden rounded-[var(--radius-md)] sm:w-40"
          >
            {track ? (
              <CoverFallback src={track.coverUrl ?? null} name={track.title} className="rounded-[var(--radius-md)]" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-secondary text-xs text-muted-foreground">
                ничего не играет
              </div>
            )}
          </motion.div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Сейчас играет
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 normal-case tracking-normal ${
                isLive
                  ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                  : 'border border-border bg-secondary text-muted-foreground'
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground'}`} />
                {isLive ? 'в эфире' : 'переподключение…'}
              </span>
            </div>
            <div className="mt-2 truncate text-xl font-semibold tracking-tight sm:text-2xl">
              {track?.title || 'Поставь любой трек, чтобы он заиграл у всех в комнате'}
            </div>
            <div className="mt-1 truncate text-sm text-muted-foreground">
              {track?.artist || '—'}
            </div>

            <ProgressBar positionSec={positionSec} durationSec={duration} />

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{formatTime(positionSec)} / {formatTime(duration)}</span>
              {controller && (
                <span className="ml-auto">
                  Последнее действие — <span className="text-foreground">{memberLabel(controller, me?.id)}</span>
                </span>
              )}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Управление воспроизведением — в мини-плеере внизу экрана. Что слушаешь ты — то слышат все.
            </p>
          </div>
        </div>
      </motion.section>

      {/* Members */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
          <Users size={14} /> Слушатели · {liveMembers.length} из {remoteMembers.length}
        </div>
        <ul className="flex flex-wrap gap-3">
          <AnimatePresence>
            {remoteMembers.map((m) => (
              <motion.li
                key={m.userId}
                layout
                initial={reduce ? false : { opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3, ease: EASE_SPRING }}
              >
                <MemberChip member={m} isMe={m.userId === me?.id} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </section>

      {/* Host-only-control toggle (visible only to the host) */}
      {isHost && (
        <section className="mt-8">
          <div className="flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-border bg-card/60 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Только хост ставит треки</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Участники смогут только слушать — переключать музыку сможешь только ты.
              </p>
              {settingsMut.isError && (
                <p className="mt-1 text-xs text-destructive">
                  Не удалось сохранить настройку. Попробуй ещё раз.
                </p>
              )}
            </div>
            <Switch
              checked={hostOnlyControl}
              onCheckedChange={(next) => {
                settingsMut.mutate({ hostOnlyControl: next });
              }}
              disabled={settingsMut.isPending}
              ariaLabel="Только хост ставит треки"
            />
          </div>
        </section>
      )}

      {canSetTrack ? (
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
            <Search size={14} /> Поставить трек
          </div>
          <RoomTrackPicker onPick={onPickTrack} />
        </section>
      ) : (
        <section className="mt-8 rounded-[var(--radius-md)] border border-dashed border-border bg-card/40 px-4 py-6 text-center text-xs text-muted-foreground">
          Хост включил режим «только слушать» — менять треки может только хост.
        </section>
      )}

      <div className="mt-8">
        <RoomChat roomId={id} />
      </div>

      <section className="mt-8 rounded-[var(--radius-md)] border border-dashed border-border bg-card/40 p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="mb-2 font-medium text-foreground">Как это работает</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>Любой участник может управлять воспроизведением{hostOnlyControl ? '' : ' и ставить треки'} — что у тебя играет, то слышат все.</li>
          <li>Громкость и mute — у каждого свои в мини-плеере. Кроссфейд и шафл здесь отключены, чтобы не было рассинхрона.</li>
          <li>Если связь моргнёт — догонит само. Стартовый момент трека хранится у хоста и подтягивается раз в пару секунд.</li>
        </ul>
      </section>
    </div>
  );
}

function ProgressBar({ positionSec, durationSec }: { positionSec: number; durationSec: number }) {
  const ratio = durationSec > 0 ? Math.min(1, Math.max(0, positionSec / durationSec)) : 0;
  return (
    <div className="mt-4 h-1.5 rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={durationSec} aria-valuenow={Math.floor(positionSec)}>
      <div
        className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300 ease-linear"
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

function MemberChip({ member, isMe }: { member: RoomMember; isMe: boolean }) {
  // Display label leans on `name` first per the unified UX spec — username
  // is only shown when there's no real display name.
  const label = member.name?.trim() || (member.username && '@' + member.username) || 'аноним';
  return (
    <div
      className={`flex items-center gap-2 rounded-full border bg-background pl-1 pr-3 py-1 text-xs transition-opacity ${
        member.isLive ? 'border-border opacity-100' : 'border-border opacity-50'
      }`}
      title={member.isLive ? 'Сейчас на связи' : 'Был в комнате'}
    >
      <UserAvatar
        name={member.name}
        username={member.username}
        id={member.userId}
        online={member.isLive}
        className="h-7 w-7 rounded-full"
        initialsClassName="text-xs"
      />
      <span className="truncate font-medium">
        {label}{isMe ? ' · ты' : ''}
      </span>
      {member.role === 'host' && (
        <span className="rounded-full bg-[var(--color-accent)]/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-accent)]">
          хост
        </span>
      )}
    </div>
  );
}

/**
 * Build a one-click invite URL of the form
 * `https://<origin><base>rooms?join=CODE`. Visiting it on /rooms
 * auto-fills the join input, switches to the "По коду" tab and
 * dispatches the join request. We respect Vite's `BASE_URL` so the
 * link works both on GH Pages (`/bratan-music/`) and on local dev.
 */
function buildInviteUrl(code: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  return `${window.location.origin}${base}/rooms?join=${encodeURIComponent(code)}`;
}

function RoomCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const inviteUrl = useMemo(() => buildInviteUrl(code), [code]);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs">
        {code}
      </span>
      <button
        onClick={onCopy}
        title={inviteUrl}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {copied ? 'Скопировано!' : (<><Copy size={12} /> Скопировать ссылку</>)}
      </button>
      <button
        onClick={() => {
          const text = `Слушаем вместе! Открой ссылку — войдёшь автоматически:\n${inviteUrl}`;
          if (navigator.share) {
            void navigator.share({ title: 'Bratan Music — комната', text, url: inviteUrl }).catch(() => undefined);
          } else {
            void navigator.clipboard.writeText(text).catch(() => undefined);
          }
        }}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Share2 size={12} /> Поделиться
      </button>
    </div>
  );
}

function RoomTrackPicker({ onPick }: { onPick: (track: RoomTrackSnapshot) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(id);
  }, [q]);
  const { data, isFetching } = useSearch(debounced, 'tracks');
  const tracks: Track[] = data?.tracks ?? [];

  return (
    <div>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск трека по Tidal-каталогу"
      />
      {debounced.length >= 2 && (
        <div className="mt-3 max-h-80 overflow-y-auto rounded-[var(--radius-md)] border border-border bg-card/60">
          {isFetching && tracks.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">Ищем…</div>
          ) : tracks.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">Ничего не нашли.</div>
          ) : (
            <ul>
              {tracks.slice(0, 12).map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => onPick(trackToSnapshot(t))}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-secondary"
                  >
                    <div className="h-10 w-10 overflow-hidden rounded-[var(--radius-sm)]">
                      <CoverFallback src={t.coverUrl ?? null} name={t.title} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{t.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
                    </div>
                    <Play size={14} className="text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function trackToSnapshot(t: Track): RoomTrackSnapshot {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    artistId: t.artistId ?? null,
    artists: t.artists,
    album: t.album ?? null,
    albumId: t.albumId ?? null,
    coverUrl: t.coverUrl ?? null,
    coverVideoUrl: t.coverVideoUrl ?? null,
    duration: t.duration ?? 0,
    source: t.source ?? 'tidal',
  };
}

function memberLabel(m: RoomMember, meId?: string): string {
  if (m.userId === meId) return 'ты';
  return m.name?.trim() || (m.username && '@' + m.username) || 'аноним';
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
