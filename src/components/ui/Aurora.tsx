import { useReducedMotion } from 'motion/react';

interface AuroraProps {
  className?: string;
  variant?: 'hero' | 'subtle';
}

export function Aurora({ className = '', variant = 'hero' }: AuroraProps) {
  const reduce = useReducedMotion();

  if (variant === 'subtle') {
    return (
      <div className={`pointer-events-none absolute inset-0 ${className}`} aria-hidden>
        <div
          className="absolute -top-40 left-1/2 h-[480px] w-[680px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{
            background:
              'radial-gradient(ellipse, var(--color-accent) 0%, transparent 65%)',
          }}
        />
      </div>
    );
  }

  // Wrapper has no `overflow-hidden`. The actual clip boundary is the
  // parent section — keeping the wrapper free lets pages opt-in to a
  // bleed. The landing/home hero use
  // `[clip-path:inset(0_0_-240px_0)]` on the section: it preserves
  // horizontal clipping (no scrollbars from extra-wide blobs) while
  // letting the bottom blob extend ~240px past the section edge so
  // the hero transitions softly into the next section instead of
  // ending in a hard horizontal cut.
  return (
    <div
      className={`pointer-events-none absolute inset-0 ${className} ${reduce ? '' : 'aurora'}`}
      aria-hidden
    >
      {reduce && (
        <>
          <div
            className="absolute -top-32 -left-32 h-[540px] w-[540px] rounded-full opacity-50 blur-3xl"
            style={{
              background: 'radial-gradient(circle, var(--color-accent) 0%, transparent 70%)',
            }}
          />
          <div
            className="absolute -bottom-40 -right-32 h-[460px] w-[460px] rounded-full opacity-30 blur-3xl"
            style={{
              background: 'radial-gradient(circle, var(--color-sub-accent) 0%, transparent 70%)',
            }}
          />
        </>
      )}
    </div>
  );
}
