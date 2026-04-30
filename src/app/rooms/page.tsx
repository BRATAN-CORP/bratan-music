import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Pause, Play, Volume2, VolumeX, Users, LogOut, Copy, Share2, RefreshCw,
  Radio, AlertTriangle, Search,
} from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CoverFallback } from '@/components/ui/CoverFallback';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { useRoomPlayer } from '@/hooks/useRoomPlayer';
import { useLeaveRoom } from '@/hooks/useRooms';
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const reduce = useReducedMotion();

  // Pause the global player while in a room — otherwise we'd be playing
  // two streams at once and the user wouldn't know which one to obey.
  // The room has its own <audio> element below.
  const pauseGlobal = usePlayerStore((s) => s.pause);
  useEffect(() => {
    pauseGlobal();
  }, [pauseGlobal]);

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
  const player = useRoomPlayer({ roomId: id, initial, audioRef });
  const leaveMut = useLeaveRoom();

  const onLeave = async () => {
    if (!id) return;
    await leaveMut.mutateAsync(id);
    navigate('/rooms');
  };

  if (!id || initialQuery.isLoading || !initial) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center text-sm text-muted-foreground">
        Загружаем комнату…
      </div>
    );
  }

  const track = player.state?.track ?? null;
  const duration = track?.duration ?? 0;
  const positionSec = Math.floor(player.positionMs / 1000);
  const liveMembers = player.members.filter((m) => m.isLive);
  const controller = player.state?.controllerId
    ? player.members.find((m) => m.userId === player.state?.controllerId)
    : null;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Hidden audio element driven by useRoomPlayer */}
      <audio ref={audioRef} preload="auto" crossOrigin="anonymous" playsInline />

      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            to="/rooms"
            className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground hover:text-foreground"
          >
            ← Все комнаты
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            <Radio size={20} className="text-[var(--color-accent)]" />
            {initial.name}
          </h1>
          <RoomCode code={initial.code} />
        </div>
        <Button variant="outline" onClick={() => void onLeave()} disabled={leaveMut.isPending}>
          <LogOut size={14} /> Выйти
        </Button>
      </div>

      {/* Now playing */}
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
              !player.state?.isPaused && !reduce
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
            <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Сейчас играет
            </div>
            <div className="mt-2 truncate text-xl font-semibold tracking-tight sm:text-2xl">
              {track?.title || 'Поставь любой трек, чтобы он заиграл у всех в комнате'}
            </div>
            <div className="mt-1 truncate text-sm text-muted-foreground">
              {track?.artist || '—'}
            </div>

            <ProgressBar
              positionMs={player.positionMs}
              durationSec={duration}
              onSeek={(target) => player.seek(target)}
            />

            <div className="mt-3 flex items-center gap-3">
              <Button
                size="lg"
                onClick={() => player.togglePlay()}
                disabled={!track}
                className="!rounded-full !w-12 !h-12 !p-0"
                aria-label={player.state?.isPaused ? 'Play' : 'Pause'}
              >
                {player.state?.isPaused ? <Play size={18} /> : <Pause size={18} />}
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={player.toggleMute} aria-label="Mute">
                  {player.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </Button>
                <input
                  type="range"
                  min={0} max={1} step={0.01}
                  value={player.muted ? 0 : player.volume}
                  onChange={(e) => player.setVolume(parseFloat(e.target.value))}
                  className="h-1 w-24 cursor-pointer accent-[var(--color-accent)]"
                  aria-label="Volume"
                />
              </div>
              <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                {player.outOfSync && (
                  <span className="flex items-center gap-1 rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-1 text-yellow-600">
                    <AlertTriangle size={12} /> синхронизация…
                  </span>
                )}
                <span>{formatTime(positionSec)} / {formatTime(duration)}</span>
                <Button variant="ghost" size="icon" onClick={player.refresh} aria-label="Refresh">
                  <RefreshCw size={14} />
                </Button>
              </div>
            </div>

            {controller && (
              <p className="mt-3 text-xs text-muted-foreground">
                Последнее действие — <span className="text-foreground">{memberLabel(controller, me?.id)}</span>
              </p>
            )}
            {player.error && (
              <p className="mt-2 text-xs text-destructive">{player.error}</p>
            )}
          </div>
        </div>
      </motion.section>

      {/* Members */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
          <Users size={14} /> Слушатели · {liveMembers.length} из {player.members.length}
        </div>
        <ul className="flex flex-wrap gap-3">
          <AnimatePresence>
            {player.members.map((m) => (
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

      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
          <Search size={14} /> Поставить трек
        </div>
        <RoomTrackPicker onPick={(track) => player.setTrack(track)} />
      </section>

      <section className="mt-8 rounded-[var(--radius-md)] border border-dashed border-border bg-card/40 p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="mb-2 font-medium text-foreground">Как это работает</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>Любой участник может ставить треки и управлять воспроизведением. Остальные слышат то же самое в один такт.</li>
          <li>Громкость и mute — у каждого свои. Кроссфейд и шафл здесь отключены, чтобы не было рассинхрона.</li>
          <li>Загруженные треки и перезаливы воспроизводятся через комнату только пока они активны: после смены трека старая ссылка перестаёт работать.</li>
        </ul>
      </section>
    </div>
  );
}

function ProgressBar({ positionMs, durationSec, onSeek }: { positionMs: number; durationSec: number; onSeek: (ms: number) => void }) {
  const ratio = durationSec > 0 ? Math.min(1, positionMs / 1000 / durationSec) : 0;
  return (
    <div
      className="mt-4 h-1.5 cursor-pointer rounded-full bg-secondary"
      role="slider"
      aria-valuemin={0}
      aria-valuemax={durationSec}
      aria-valuenow={Math.floor(positionMs / 1000)}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        onSeek(Math.max(0, Math.min(1, pct)) * durationSec * 1000);
      }}
    >
      <div
        className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-200 ease-linear"
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

function RoomCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      const url = `${window.location.origin}${window.location.pathname.replace(/\/+$/, '')}`;
      await navigator.clipboard.writeText(`${url}\nКод: ${code}`);
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
        className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {copied ? 'Скопировано!' : (<><Copy size={12} /> Скопировать ссылку</>)}
      </button>
      <button
        onClick={() => {
          const text = `Слушаем вместе! Код: ${code}\n${window.location.href}`;
          if (navigator.share) {
            void navigator.share({ title: 'Bratan Music — комната', text }).catch(() => undefined);
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
