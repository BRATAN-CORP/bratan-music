import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronLeft, Library, ListMusic, Loader2, Lock, Play } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { Button } from '@/components/ui/Button';
import { Eyebrow } from '@/components/ui/SectionHeading';
import { TrackItem } from '@/components/features/TrackItem';
import { useSharedPlaylist, useSavePlaylistFromShare } from '@/hooks/useShare';
import { usePlayerStore } from '@/store/player';
import { toPlayerTrack } from '@/lib/playerTrack';
import type { Track } from '@/types';
import { useT } from '@/i18n';

/**
 * Public-share landing page (`/p/:token`). JWT is required at the
 * API level — `AuthGuard` ensures a valid session — so for an
 * unauthenticated visitor the auth modal opens first; once they sign
 * in the playlist resolves automatically.
 *
 * The page is read-only by design: no rename / cover / track-action
 * UI. Owners coming back to their own share link get a banner
 * routing them to the canonical playlist page.
 */
export function SharedPlaylistPage() {
  const t = useT();
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch, isFetching } = useSharedPlaylist(token);
  const save = useSavePlaylistFromShare();
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const setPlaybackContext = usePlayerStore((s) => s.setPlaybackContext);

  const tracks = useMemo(() => data?.tracks ?? [], [data?.tracks]);
  const showLoading = !token || isLoading || (isFetching && !data);

  const handlePlay = (track: Track) => {
    // `toPlayerTrack` carries `explicit` so the badge stays visible
    // when playback starts from a shared-link landing.
    setTrack(toPlayerTrack(track));
    setQueue(tracks.map(toPlayerTrack));
    setPlaybackContext({ type: 'shared' });
  };

  const handleSave = async () => {
    if (!token) return;
    const created = await save.mutateAsync(token);
    if (created?.id) navigate(`/playlist/${created.id}`);
  };

  return (
    <AuthGuard>
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-10">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          className="mb-4 inline-flex h-9 items-center gap-1 rounded-[var(--radius-md)] px-2 -ml-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground active:scale-[0.98] lg:hidden"
          aria-label={t('sharedPage.back')}
        >
          <ChevronLeft size={18} />
          <span>{t('sharedPage.back')}</span>
        </button>

        {showLoading ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:gap-6">
              <div className="h-32 w-32 shrink-0 animate-pulse rounded-[var(--radius-md)] bg-secondary/50 sm:h-40 sm:w-40" />
              <div className="flex flex-1 flex-col gap-3">
                <div className="h-3 w-24 animate-pulse rounded bg-secondary/50" />
                <div className="h-9 w-2/3 animate-pulse rounded bg-secondary/50" />
                <div className="h-3 w-20 animate-pulse rounded bg-secondary/50" />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-[var(--radius-md)] bg-secondary/30" />
              ))}
            </div>
          </div>
        ) : isError || !data ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
              <Lock size={20} />
            </div>
            <h1 className="text-lg font-semibold">{t('sharedPage.unavailableTitle')}</h1>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error
                ? error.message
                : t('sharedPage.unavailableHint')}
            </p>
            <Button onClick={() => refetch()} variant="ghost" size="sm">
              {t('sharedPage.retry')}
            </Button>
          </div>
        ) : (
          <>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className="mb-8 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:gap-6"
            >
              <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-border bg-card text-muted-foreground sm:h-40 sm:w-40">
                {data.coverUrl ? (
                  <img src={data.coverUrl} alt={t('sharedPage.coverAlt', { name: data.name })} className="h-full w-full object-cover" />
                ) : (
                  <ListMusic size={42} />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Eyebrow>{t('sharedPage.eyebrow')}</Eyebrow>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{data.name}</h1>
                <p className="text-xs text-muted-foreground">
                  {data.owner ? <>{t('sharedPage.authorPrefix')} <span className="text-foreground">{data.owner.name}</span> · </> : null}
                  {tracks.length} {tracks.length === 1 ? t('sharedPage.trackOne') : t('sharedPage.trackMany')}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {tracks[0] && (
                    <Button onClick={() => tracks[0] && handlePlay(tracks[0])} size="sm">
                      <Play size={14} fill="currentColor" /> {t('sharedPage.play')}
                    </Button>
                  )}
                  {data.isOwner ? (
                    <Link to={`/playlist/${data.id}`}>
                      <Button variant="ghost" size="sm">
                        <Library size={14} /> {t('sharedPage.ownYours')}
                      </Button>
                    </Link>
                  ) : data.savedPlaylistId ? (
                    <Link to={`/playlist/${data.savedPlaylistId}`}>
                      <Button variant="ghost" size="sm">
                        <Library size={14} /> {t('sharedPage.alreadySaved')}
                      </Button>
                    </Link>
                  ) : (
                    <Button onClick={handleSave} variant="ghost" size="sm" disabled={save.isPending}>
                      {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Library size={14} />}
                      {t('sharedPage.save')}
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>

            {tracks.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {t('sharedPage.empty')}
              </p>
            ) : (
              <div className="overflow-visible rounded-[var(--radius-md)] border border-border">
                {tracks.map((tr, i) => (
                  <TrackItem
                    key={tr.id}
                    track={tr}
                    index={i}
                    onPlay={handlePlay}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AuthGuard>
  );
}
