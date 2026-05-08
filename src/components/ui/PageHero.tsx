import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Eyebrow } from '@/components/ui/SectionHeading';

interface PageHeroProps {
  /**
   * Ambient background painted behind the hero. Optional. Album /
   * playlist pages pass a heavily-blurred copy of the cover; the
   * artist page passes a `<motion>` crossfade between sequential
   * photos. When omitted, the hero falls back to a soft accent
   * radial so it doesn't read as flat.
   */
  ambience?: ReactNode;

  /**
   * Foreground cover element. Caller renders it (image, fallback
   * avatar, motion crossfade, …) so each page keeps its own
   * art-direction. Square covers (album / playlist) and round
   * covers (artist) coexist via the consumer's classes.
   */
  cover?: ReactNode;

  /** Small uppercase tag above the title — "ALBUM", "ARTIST", … */
  eyebrow?: ReactNode;
  /** Primary heading. Rendered as `<h1>`. */
  title: ReactNode;
  /** Optional secondary line — usually an artist link or short summary. */
  subtitle?: ReactNode;
  /** Optional meta line — usually release date / track count. */
  meta?: ReactNode;
  /** Optional row of actions (Play / Like / Share / …). */
  actions?: ReactNode;

  /**
   * When true, breaks the hero out of the page's horizontal padding so
   * the ambience layer reaches all the way to the viewport edges. The
   * existing album / artist / playlist pages all do this with
   * `-mx-4 sm:-mx-6 lg:-mx-10`.
   */
  bleedHorizontal?: boolean;

  /** Extra classes on the root element. */
  className?: string;
}

/**
 * Shared hero shell for the album / artist / playlist pages.
 *
 * Pulls the structural concerns (vignette gradient, accent radial,
 * stack-on-mobile / row-on-desktop layout, content alignment) into
 * one place so each page can focus on what's actually different
 * (cover element, action buttons, metadata).
 *
 * The hero is intentionally agnostic about its parent's `max-width`:
 * the consumer's page wrapper controls horizontal centring; this
 * component just handles the visual treatment.
 */
export function PageHero({
  ambience,
  cover,
  eyebrow,
  title,
  subtitle,
  meta,
  actions,
  bleedHorizontal = true,
  className,
}: PageHeroProps) {
  return (
    <section
      className={cn(
        // Top padding bumped from `pt-6 sm:pt-10` so the hero doesn't
        // feel cropped against the desktop / non-PWA viewport edge,
        // where there's no system status-bar inset stacking on top of
        // it. PWA mobile picks up `var(--pwa-safe-top)` from the
        // app-shell wrapper above, so the new base just gives the
        // browser case the breathing room it was missing.
        //
        // Bottom padding bumped + the vertical vignette below now does
        // the soft fade, so the previous hard `border-b border-border`
        // is gone — it cut the blurred ambience cleanly which read as
        // "the blur is cropped". Pages that still want a divider can
        // pass one via `className`.
        'relative isolate mb-8 overflow-hidden px-4 pb-14 pt-10 sm:px-6 sm:pb-16 sm:pt-14 lg:px-10 lg:pt-16',
        bleedHorizontal && '-mx-4 sm:-mx-6 lg:-mx-10',
        className,
      )}
    >
      {ambience ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          {ambience}
        </div>
      ) : (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(80%_120%_at_30%_0%,var(--color-accent-glow),transparent_70%)] opacity-40"
        />
      )}

      {/* Vertical fade — pushes the ambience (cover blur, artist
          portrait crossfade, accent radial) into the plain page bg
          over the bottom ~40% of the hero. Replaces the previous
          hard `border-b` with a smooth dissolve so the hero blends
          into the page instead of getting clipped. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-black/10 from-0% via-[var(--color-bg)]/35 via-55% to-[var(--color-bg)] to-100%"
      />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_25%_15%,var(--color-accent-glow),transparent_75%)] opacity-25"
      />

      <div className="flex flex-col gap-6 sm:flex-row">
        {cover ? <div className="shrink-0">{cover}</div> : null}
        <div className="flex min-w-0 flex-col justify-end gap-3">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
          {subtitle ? <div className="text-sm text-muted-foreground">{subtitle}</div> : null}
          {meta ? <div className="text-xs text-muted-foreground">{meta}</div> : null}
          {actions ? (
            <div className="flex flex-wrap items-center gap-2 pt-2">{actions}</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
