import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, ChevronDown, Loader2, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CoverFallback } from '@/components/ui/CoverFallback';
import { Button } from '@/components/ui/Button';
import {
  useDislikesDetails,
  useToggleDislike,
  type BannedTrackDetail,
  type BannedArtistDetail,
} from '@/hooks/useDislikes';
import { toast } from '@/store/toast';
import { useT } from '@/i18n';

/**
 * Profile-page panel listing every artist + track the user has banned
 * via the kebab/artist-page dislike buttons. Each row has a single
 * "restore" button that runs the same `useToggleDislike` mutation in
 * the `unbanned` direction; on success the row disappears (because
 * the mutation invalidates `DISLIKES_DETAILS_QUERY_KEY`).
 *
 * Two collapsible sections so the page doesn't get steamrolled when
 * the user has banned dozens of items. Section header shows the
 * count and toggles open/closed with a rotating chevron.
 *
 * Empty state is rendered as a small muted line — by far the common
 * case for new users — and we don't bother re-fetching the heavy
 * `/dislikes/details` endpoint until the user expands the section
 * (the lightweight `/dislikes` query already fired at app boot via
 * `<DislikesBootstrap />`, so we know whether the lists are empty).
 */
export function BannedListPanel() {
  const t = useT();
  const { data, isLoading, isError } = useDislikesDetails();
  const restore = useToggleDislike();
  const [expandedArtists, setExpandedArtists] = useState(true);
  const [expandedTracks, setExpandedTracks] = useState(true);

  const artists = data?.artists ?? [];
  const tracks = data?.tracks ?? [];
  const isEmpty = !isLoading && artists.length === 0 && tracks.length === 0;

  const handleRestoreArtist = (a: BannedArtistDetail) => {
    restore.mutate(
      { kind: 'artist', id: a.id, source: 'tidal', nextState: 'unbanned' },
      {
        onSuccess: () => toast.info(t('dislike.artistRestored')),
        onError: (err) => toast.error(err instanceof Error ? err.message : t('dislike.failed')),
      },
    );
  };

  const handleRestoreTrack = (tr: BannedTrackDetail) => {
    restore.mutate(
      { kind: 'track', id: tr.id, source: 'tidal', nextState: 'unbanned' },
      {
        onSuccess: () => toast.info(t('dislike.trackRestored')),
        onError: (err) => toast.error(err instanceof Error ? err.message : t('dislike.failed')),
      },
    );
  };

  return (
    <section className="rounded-[var(--radius-md)] border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Ban size={14} className="text-muted-foreground" />
          {t('bannedList.title')}
        </h2>
        {isLoading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t('bannedList.hint')}
      </p>

      {isError && (
        <p className="mt-3 text-xs text-[var(--color-danger)]">{t('bannedList.failed')}</p>
      )}

      {isEmpty ? (
        <p className="mt-4 text-xs text-muted-foreground">{t('bannedList.empty')}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <Section
            label={t('bannedList.artistsSection', { count: artists.length })}
            expanded={expandedArtists}
            onToggle={() => setExpandedArtists((v) => !v)}
            count={artists.length}
          >
            <ul className="flex flex-col divide-y divide-border">
              {artists.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  <Link
                    to={a.unavailable ? '#' : `/artist/${a.id}`}
                    className={[
                      'flex shrink-0 overflow-hidden',
                      'h-10 w-10 rounded-full',
                      a.unavailable ? 'pointer-events-none opacity-60' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <CoverFallback
                      src={a.imageUrl}
                      name={a.name}
                      className="rounded-full"
                      initialsClassName="text-xs"
                    />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={a.unavailable ? '#' : `/artist/${a.id}`}
                      className={[
                        'block truncate text-sm font-medium',
                        a.unavailable ? 'text-muted-foreground pointer-events-none' : 'hover:underline',
                      ].filter(Boolean).join(' ')}
                    >
                      {a.unavailable ? t('bannedList.unavailableArtist') : a.name}
                    </Link>
                    {a.addedAt && (
                      <p className="truncate text-[11px] text-muted-foreground">
                        {t('bannedList.addedAt', { date: formatDate(a.addedAt) })}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRestoreArtist(a)}
                    disabled={restore.isPending}
                  >
                    <RotateCcw size={12} />
                    {t('bannedList.restore')}
                  </Button>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            label={t('bannedList.tracksSection', { count: tracks.length })}
            expanded={expandedTracks}
            onToggle={() => setExpandedTracks((v) => !v)}
            count={tracks.length}
          >
            <ul className="flex flex-col divide-y divide-border">
              {tracks.map((tr) => (
                <li key={tr.id} className="flex items-center gap-3 py-2">
                  <Link
                    to={tr.unavailable ? '#' : `/track/${tr.id}`}
                    className={[
                      'flex shrink-0 overflow-hidden',
                      'h-10 w-10 rounded-md',
                      tr.unavailable ? 'pointer-events-none opacity-60' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <CoverFallback
                      src={tr.coverUrl}
                      name={tr.title || tr.id}
                      className="rounded-md"
                      initialsClassName="text-xs"
                    />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={tr.unavailable ? '#' : `/track/${tr.id}`}
                      className={[
                        'block truncate text-sm font-medium',
                        tr.unavailable ? 'text-muted-foreground pointer-events-none' : 'hover:underline',
                      ].filter(Boolean).join(' ')}
                    >
                      {tr.unavailable ? t('bannedList.unavailableTrack') : tr.title}
                    </Link>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {tr.unavailable ? '' : tr.artist}
                      {tr.addedAt ? ` · ${t('bannedList.addedAt', { date: formatDate(tr.addedAt) })}` : ''}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRestoreTrack(tr)}
                    disabled={restore.isPending}
                  >
                    <RotateCcw size={12} />
                    {t('bannedList.restore')}
                  </Button>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </section>
  );
}

interface SectionProps {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  count: number;
  children: React.ReactNode;
}

function Section({ label, expanded, onToggle, count, children }: SectionProps) {
  if (count === 0) return null;
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between rounded-md py-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>{label}</span>
        <ChevronDown
          size={14}
          className={`transition-transform ${expanded ? 'rotate-180' : 'rotate-0'}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
