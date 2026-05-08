import { Link } from 'react-router-dom';
import { Ban, Loader2, RotateCcw, X } from 'lucide-react';
import { CoverFallback } from '@/components/ui/CoverFallback';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import {
  useDislikesDetails,
  useToggleDislike,
  type BannedTrackDetail,
  type BannedArtistDetail,
} from '@/hooks/useDislikes';
import { toast } from '@/store/toast';
import { useT, type TranslationKey } from '@/i18n';

export type BannedListKind = 'artists' | 'tracks';

interface Props {
  open: boolean;
  onClose: () => void;
  kind: BannedListKind;
}

/**
 * Centered popup widget listing every artist (or track) the user has
 * banned via the kebab/artist-page dislike buttons. Renders as a
 * bottom-sheet on mobile and a centered modal on md+ via the shared
 * `Sheet` primitive.
 *
 * Renders a single kind per instance (artists OR tracks).
 *
 * Each row carries one "restore" affordance which runs
 * `useToggleDislike` in the `unbanned` direction.
 */
export function BannedListDialog({ open, onClose, kind }: Props) {
  const t = useT();
  const { data, isLoading, isError } = useDislikesDetails();
  const restore = useToggleDislike();

  const artists = data?.artists ?? [];
  const tracks = data?.tracks ?? [];
  const count = kind === 'artists' ? artists.length : tracks.length;

  const handleRestoreArtist = (a: BannedArtistDetail) => {
    restore.mutate(
      { kind: 'artist', id: a.id, source: 'tidal', nextState: 'unbanned' },
      {
        onSuccess: () => toast.info(t('dislike.artistRestored')),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : t('dislike.failed')),
      },
    );
  };

  const handleRestoreTrack = (tr: BannedTrackDetail) => {
    restore.mutate(
      { kind: 'track', id: tr.id, source: 'tidal', nextState: 'unbanned' },
      {
        onSuccess: () => toast.info(t('dislike.trackRestored')),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : t('dislike.failed')),
      },
    );
  };

  const titleKey: TranslationKey =
    kind === 'artists' ? 'bannedList.artistsTitle' : 'bannedList.tracksTitle';
  const emptyKey: TranslationKey =
    kind === 'artists' ? 'bannedList.emptyArtists' : 'bannedList.emptyTracks';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      ariaLabel={t(titleKey)}
      panelClassName="flex w-[min(560px,calc(100vw-24px))] flex-col max-h-[calc(100dvh-7rem-var(--pwa-safe-bottom))]"
    >
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Ban size={15} className="text-muted-foreground" />
          <span className="truncate text-sm font-medium">{t(titleKey)}</span>
          <span className="text-xs text-muted-foreground">· {count}</span>
          {isLoading && (
            <Loader2 size={13} className="animate-spin text-muted-foreground" />
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label={t('common.close')}
        >
          <X size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isError ? (
          <p className="px-4 py-10 text-center text-xs text-[var(--color-danger)]">
            {t('bannedList.failed')}
          </p>
        ) : count === 0 ? (
          <p className="px-6 py-12 text-center text-xs text-muted-foreground">
            {t(emptyKey)}
          </p>
        ) : kind === 'artists' ? (
          <ul className="flex flex-col divide-y divide-border/60">
            {artists.map((a) => (
              <ArtistRow
                key={a.id}
                artist={a}
                disabled={restore.isPending}
                onRestore={() => handleRestoreArtist(a)}
                onNavigate={onClose}
              />
            ))}
          </ul>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {tracks.map((tr) => (
              <TrackRow
                key={tr.id}
                track={tr}
                disabled={restore.isPending}
                onRestore={() => handleRestoreTrack(tr)}
                onNavigate={onClose}
              />
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

function ArtistRow({
  artist,
  disabled,
  onRestore,
  onNavigate,
}: {
  artist: BannedArtistDetail;
  disabled: boolean;
  onRestore: () => void;
  onNavigate: () => void;
}) {
  const t = useT();
  const unavailable = artist.unavailable;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Link
        to={unavailable ? '#' : `/artist/${artist.id}`}
        onClick={unavailable ? undefined : onNavigate}
        className={[
          'flex h-11 w-11 shrink-0 overflow-hidden rounded-full',
          unavailable ? 'pointer-events-none opacity-60' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <CoverFallback
          src={artist.imageUrl}
          name={artist.name}
          className="rounded-full"
          initialsClassName="text-xs"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          to={unavailable ? '#' : `/artist/${artist.id}`}
          onClick={unavailable ? undefined : onNavigate}
          className={[
            'block truncate text-sm font-medium',
            unavailable ? 'pointer-events-none text-muted-foreground' : 'hover:underline',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {unavailable ? t('bannedList.unavailableArtist') : artist.name}
        </Link>
        {artist.addedAt && (
          <p className="truncate text-[11px] text-muted-foreground">
            {t('bannedList.addedAt', { date: formatDate(artist.addedAt) })}
          </p>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRestore}
        disabled={disabled}
        aria-label={t('bannedList.restoreArtistAria', { name: artist.name })}
      >
        <RotateCcw size={12} />
        {t('bannedList.restore')}
      </Button>
    </li>
  );
}

function TrackRow({
  track,
  disabled,
  onRestore,
  onNavigate,
}: {
  track: BannedTrackDetail;
  disabled: boolean;
  onRestore: () => void;
  onNavigate: () => void;
}) {
  const t = useT();
  const unavailable = track.unavailable;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Link
        to={unavailable ? '#' : `/track/${track.id}`}
        onClick={unavailable ? undefined : onNavigate}
        className={[
          'flex h-11 w-11 shrink-0 overflow-hidden rounded-md',
          unavailable ? 'pointer-events-none opacity-60' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <CoverFallback
          src={track.coverUrl}
          name={track.title || track.id}
          className="rounded-md"
          initialsClassName="text-xs"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          to={unavailable ? '#' : `/track/${track.id}`}
          onClick={unavailable ? undefined : onNavigate}
          className={[
            'block truncate text-sm font-medium',
            unavailable ? 'pointer-events-none text-muted-foreground' : 'hover:underline',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {unavailable ? t('bannedList.unavailableTrack') : track.title}
        </Link>
        <p className="truncate text-[11px] text-muted-foreground">
          {unavailable ? '' : track.artist}
          {track.addedAt
            ? ` · ${t('bannedList.addedAt', { date: formatDate(track.addedAt) })}`
            : ''}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRestore}
        disabled={disabled}
        aria-label={t('bannedList.restoreTrackAria', { title: track.title })}
      >
        <RotateCcw size={12} />
        {t('bannedList.restore')}
      </Button>
    </li>
  );
}

function formatDate(unix: number): string {
  // Stored as unix seconds in `user_dislikes.created_at`. Format as
  // a short locale date (no time) — exact second-level precision
  // doesn't help anyone here.
  const ms = unix < 1e12 ? unix * 1000 : unix;
  try {
    return new Date(ms).toLocaleDateString();
  } catch {
    return '';
  }
}
