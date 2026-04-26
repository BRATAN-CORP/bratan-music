import { useReducedMotion } from 'motion/react';

interface AuroraProps {
  className?: string;
  variant?: 'hero' | 'subtle';
}

export function Aurora({ className = '', variant = 'hero' }: AuroraProps) {
  const reduce = useReducedMotion();

  if (variant === 'subtle') {
    return (
      <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden>
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

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className} ${reduce ? '' : 'aurora'}`}
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
