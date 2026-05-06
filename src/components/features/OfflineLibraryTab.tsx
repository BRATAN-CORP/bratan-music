/**
 * "Загружено" library tab — aggregates all offline-saved content
 * (individual tracks, albums, playlists) into one view.
 *
 * The top-most item is the service playlist "Загруженное" — an
 * auto-generated, read-only list of every saved track (like the
 * "Liked" playlist but for downloads). Below it we show album and
 * playlist cards for each saved collection.
 *
 * Cover art is rendered from the locally-stored `coverBlob` whenever
 * the saved row carries one, falling back to the network `coverUrl`
 * only when the blob wasn't successfully captured at download time.
 * That way the offline tab still paints its tiles with the real
 * artwork even after the device drops the network — exactly what the
 * user reported was missing.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownToLine, Disc3, ListMusic } from 'lucide-react';
import { useOfflineStore } from '@/store/offline';
import { useOfflineHydration } from '@/hooks/useOfflineActions';
import { useBlobObjectUrl } from '@/hooks/useOfflineCoverUrl';
import { listSavedAlbums, listSavedPlaylists, listSavedTracks } from '@/lib/offline/storage';
import type { OfflineAlbum, OfflinePlaylist, OfflineTrack } from '@/lib/offline/types';
import { useT } from '@/i18n';

export function OfflineLibraryTab() {
  const t = useT();
  const hydrated = useOfflineHydration();
  const version = useOfflineStore((s) => s.version);

  const [tracks, setTracks] = useState<OfflineTrack[]>([]);
  const [albums, setAlbums] = useState<OfflineAlbum[]>([]);
  const [playlists, setPlaylists] = useState<OfflinePlaylist[]>([]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void (async () => {
      const [t, a, p] = await Promise.all([
        listSavedTracks(),
        listSavedAlbums(),
        listSavedPlaylists(),
      ]);
      if (!cancelled) {
        setTracks(t);
        setAlbums(a);
        setPlaylists(p);
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, version]);

  if (!hydrated) {
    return <p className="text-sm text-muted-foreground">{t('library.loadingShort')}</p>;
  }

  const isEmpty = tracks.length === 0 && albums.length === 0 && playlists.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-border bg-card py-16 text-center">
        <ArrowDownToLine size={32} className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('library.noDownloadsTitle')}</p>
        <p className="text-xs text-muted-foreground">{t('library.noDownloadsHint')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Service playlist "Загруженное" — all saved tracks in one list */}
      {tracks.length > 0 && (
        <Link
          to="/library/downloaded"
          className="flex items-center gap-4 rounded-[var(--radius-md)] border border-border bg-card px-4 py-3 transition-colors hover:bg-secondary"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-background text-[var(--color-accent)]">
            <ArrowDownToLine size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{t('library.downloadedPlaylist')}</p>
            <p className="text-xs text-muted-foreground">
              {tracks.length} {tracks.length === 1 ? t('library.trackUnit1') : t('library.trackUnit5plus')}
            </p>
          </div>
        </Link>
      )}

      {/* Saved albums */}
      {albums.length > 0 && (
        <>
          <h2 className="text-sm font-medium text-muted-foreground">{t('library.tabAlbums')}</h2>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {albums.map((album) => (
              <SavedAlbumTile key={album.id} album={album} />
            ))}
          </div>
        </>
      )}

      {/* Saved playlists */}
      {playlists.length > 0 && (
        <>
          <h2 className="text-sm font-medium text-muted-foreground">{t('library.tabPlaylists')}</h2>
          <div className="flex flex-col gap-2">
            {playlists.map((pl) => (
              <SavedPlaylistRow key={pl.id} playlist={pl} unitOne={t('library.trackUnit1')} unitMany={t('library.trackUnit5plus')} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Single album tile in the offline library grid. Lifted out of the
 * parent `.map()` so we can call `useBlobObjectUrl` once per tile —
 * hooks can't run inside a loop in the parent.
 */
function SavedAlbumTile({ album }: { album: OfflineAlbum }) {
  const coverUrl = useBlobObjectUrl(album.coverBlob, album.coverUrl);
  return (
    <Link to={`/album/${album.id}`} className="group flex flex-col gap-2">
      <div className="relative aspect-square overflow-hidden rounded-[var(--radius-md)] border border-border bg-secondary/60">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={album.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Disc3 size={28} className="text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{album.title}</p>
        <p className="truncate text-xs text-muted-foreground">{album.artist}</p>
      </div>
    </Link>
  );
}

/**
 * Single playlist row in the offline library list. Same hook-per-row
 * factoring as `SavedAlbumTile`.
 */
function SavedPlaylistRow({
  playlist,
  unitOne,
  unitMany,
}: {
  playlist: OfflinePlaylist;
  unitOne: string;
  unitMany: string;
}) {
  const coverUrl = useBlobObjectUrl(playlist.coverBlob, playlist.coverUrl ?? null);
  return (
    <Link
      to={`/playlist/${playlist.id}`}
      className="flex items-center gap-4 rounded-[var(--radius-md)] border border-border bg-card px-4 py-3 transition-colors hover:bg-secondary"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-border bg-background text-[var(--color-accent)]">
        {coverUrl ? (
          <img src={coverUrl} alt="" aria-hidden className="h-full w-full object-cover" />
        ) : (
          <ListMusic size={18} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{playlist.name}</p>
        <p className="text-xs text-muted-foreground">
          {playlist.trackIds.length} {playlist.trackIds.length === 1 ? unitOne : unitMany}
        </p>
      </div>
    </Link>
  );
}
