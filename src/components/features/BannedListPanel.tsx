import { useState } from 'react';
import { Ban, ChevronRight, Loader2, Music2, UserRound } from 'lucide-react';
import { useDislikesDetails } from '@/hooks/useDislikes';
import { BannedListDialog, type BannedListKind } from '@/components/features/BannedListDialog';
import { useT } from '@/i18n';

/**
 * Profile-page entry point for the banned-list feature. Was a single
 * inline panel with two collapsible sections; now renders as two
 * compact "row cards" (artists + tracks) that each open the
 * `BannedListDialog` widget — same liquid-glass vocabulary as the
 * QueueDialog the user pointed at as the reference.
 *
 * Why two cards instead of one: the user explicitly asked for two
 * separate widgets so that opening the artists list and the tracks
 * list feel like distinct surfaces rather than two collapsible
 * sub-sections of one big block.
 *
 * Empty cards stay visible so the user always knows the entry point
 * exists; the count badge is the at-a-glance signal for "do I have
 * anything in here". When the network call hasn't returned yet the
 * count badge swaps for a spinner.
 *
 * Copy is rewritten from the previous narrative (which read like the
 * agent had pasted the requesting user's instructions verbatim) into
 * a functional one-liner: "Не попадают в волну, дневные плейлисты и
 * AI-подборки." — describes the *effect* of being on the list, which
 * is the only thing the user actually cares about here.
 */
export function BannedListPanel() {
  const t = useT();
  const { data, isLoading, isError } = useDislikesDetails();
  const [openKind, setOpenKind] = useState<BannedListKind | null>(null);

  const artistCount = data?.artists.length ?? 0;
  const trackCount = data?.tracks.length ?? 0;

  return (
    <>
      <section className="rounded-[var(--radius-md)] border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Ban size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-medium">{t('bannedList.title')}</h2>
          {isLoading && <Loader2 size={13} className="animate-spin text-muted-foreground" />}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">{t('bannedList.functionalHint')}</p>

        {isError ? (
          <p className="mt-3 text-xs text-[var(--color-danger)]">{t('bannedList.failed')}</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <TriggerCard
              icon={<UserRound size={16} className="text-[var(--color-accent)]" />}
              label={t('bannedList.artistsCardLabel')}
              count={artistCount}
              loading={isLoading}
              onOpen={() => setOpenKind('artists')}
            />
            <TriggerCard
              icon={<Music2 size={16} className="text-[var(--color-accent)]" />}
              label={t('bannedList.tracksCardLabel')}
              count={trackCount}
              loading={isLoading}
              onOpen={() => setOpenKind('tracks')}
            />
          </div>
        )}
      </section>

      <BannedListDialog
        open={openKind === 'artists'}
        onClose={() => setOpenKind(null)}
        kind="artists"
      />
      <BannedListDialog
        open={openKind === 'tracks'}
        onClose={() => setOpenKind(null)}
        kind="tracks"
      />
    </>
  );
}

interface TriggerCardProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  loading: boolean;
  onOpen: () => void;
}

function TriggerCard({ icon, label, count, loading, onOpen }: TriggerCardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-background px-3 py-3 text-left transition-all hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-sm)]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-accent)]/25 bg-[var(--color-accent-soft)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">
          {loading ? '…' : count}
        </span>
      </span>
      <ChevronRight
        size={14}
        className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      />
    </button>
  );
}
