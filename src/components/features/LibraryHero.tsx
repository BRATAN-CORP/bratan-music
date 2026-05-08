import { motion } from 'motion/react';
import { Plus } from 'lucide-react';
import { Eyebrow } from '@/components/ui/SectionHeading';
import { Button } from '@/components/ui/Button';
import { LiquidGlassPanel, LiquidGlassRoot } from '@/components/ui/liquid-glass';
import { useT } from '@/i18n';

interface LibraryHeroProps {
  /** Pre-formatted summary line (e.g. "12 плейлистов · 24 альбома · 8 артистов"). */
  summary: string;
  /** Show the "+ Playlist" primary action (only on the playlists tab). */
  showCreateAction: boolean;
  onCreatePlaylist: () => void;
}

/**
 * Top-of-library hero: ambient animated gradient backdrop + a single
 * WebGL `LiquidGlassPanel` carrying the page title, summary and the
 * primary action.
 *
 * The hero is intentionally the ONLY surface in the codebase that
 * opts into the WebGL refraction pipeline — see the comments inside
 * `liquid-glass.tsx` for why portal'd content (modals, popovers,
 * toasts) keeps the cheaper CSS recipe. Library is the perfect home
 * for the WebGL effect: a single static panel sitting on top of a
 * rich animated backdrop, exactly the scene the library is designed
 * to showcase.
 */
export function LibraryHero({
  summary,
  showCreateAction,
  onCreatePlaylist,
}: LibraryHeroProps) {
  const t = useT();

  return (
    <LiquidGlassRoot className="-mx-4 -mt-2 overflow-hidden rounded-b-[var(--radius-xl)] sm:-mx-6 lg:-mx-10">
      {/* Ambient backdrop — three softly animated radial gradient
          blobs. Plain CSS `radial-gradient` baked into a `motion.div`
          so the LiquidGlassPanel above has something visually rich
          to refract through. The blobs are absolutely positioned and
          tagged `pointer-events: none` so they never intercept clicks
          on the panel content. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <motion.div
          className="absolute -left-20 -top-32 h-[420px] w-[420px] rounded-full"
          style={{
            background:
              'radial-gradient(circle at center, rgba(126, 137, 232, 0.55) 0%, transparent 65%)',
            filter: 'blur(40px)',
          }}
          animate={{ x: [0, 60, -20, 0], y: [0, 40, 80, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -right-32 -top-12 h-[480px] w-[480px] rounded-full"
          style={{
            background:
              'radial-gradient(circle at center, rgba(244, 114, 182, 0.42) 0%, transparent 70%)',
            filter: 'blur(50px)',
          }}
          animate={{ x: [0, -40, 30, 0], y: [0, 50, 20, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-40 left-1/4 h-[360px] w-[360px] rounded-full"
          style={{
            background:
              'radial-gradient(circle at center, rgba(56, 189, 248, 0.32) 0%, transparent 70%)',
            filter: 'blur(40px)',
          }}
          animate={{ x: [0, 80, -30, 0], y: [0, -30, 40, 0] }}
          transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Soft grid backdrop so the refraction picks up texture. */}
        <div className="grid-bg absolute inset-0 opacity-[0.18]" />
      </div>

      {/* Foreground glass panel. `aggressive` variant gives a denser
          blur + iridescent overlay that reads well over the colourful
          gradient blobs above. */}
      <LiquidGlassPanel
        variant="aggressive"
        className="m-4 rounded-[var(--radius-xl)] p-6 sm:m-6 sm:p-8 lg:m-10 lg:p-12"
      >
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
        >
          <div className="flex flex-col gap-2">
            <Eyebrow>{t('library.collectionLabel')}</Eyebrow>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
              {t('library.title')}
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">{summary}</p>
          </div>
          {showCreateAction && (
            <Button onClick={onCreatePlaylist} variant="primary" size="lg">
              <Plus size={16} />
              {t('library.newPlaylistShort')}
            </Button>
          )}
        </motion.div>
      </LiquidGlassPanel>
    </LiquidGlassRoot>
  );
}
