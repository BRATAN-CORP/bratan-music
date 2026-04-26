import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Loader2, Mic2, X } from 'lucide-react';
import { useLyrics, parseLrc, type LyricLine } from '@/hooks/useLyrics';
import { usePlayerStore } from '@/store/player';

interface LyricsPanelProps {
  trackId: string;
  open: boolean;
  onClose: () => void;
}

export function LyricsPanel({ trackId, open, onClose }: LyricsPanelProps) {
  const { data, isLoading, isError } = useLyrics(open ? trackId : undefined);
  const reduce = useReducedMotion();
  const progress = usePlayerStore((s) => s.progress);

  const lines: LyricLine[] = useMemo(() => {
    if (!data?.subtitles) return [];
    return parseLrc(data.subtitles);
  }, [data?.subtitles]);

  const activeIndex = useMemo(() => {
    if (!lines.length) return -1;
    let lo = 0;
    let hi = lines.length - 1;
    let result = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = lines[mid]?.time ?? Infinity;
      if (t <= progress) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }, [lines, progress]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="absolute inset-0 z-30 flex flex-col bg-background/95 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label="Текст песни"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-medium tracking-tight">
              <Mic2 size={16} className="text-[var(--color-accent)]" />
              <span>Текст песни</span>
              {data?.provider && (
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  {data.provider}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="Закрыть текст"
            >
              <X size={16} />
            </button>
          </div>

          <LyricsBody
            isLoading={isLoading}
            isError={isError}
            data={data}
            lines={lines}
            activeIndex={activeIndex}
            isRtl={Boolean(data?.isRightToLeft)}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface LyricsBodyProps {
  isLoading: boolean;
  isError: boolean;
  data: ReturnType<typeof useLyrics>['data'];
  lines: LyricLine[];
  activeIndex: number;
  isRtl: boolean;
}

function LyricsBody({ isLoading, isError, data, lines, activeIndex, isRtl }: LyricsBodyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!autoScroll) return;
    if (activeIndex < 0) return;
    const el = lineRefs.current[activeIndex];
    if (!el) return;
    el.scrollIntoView({
      behavior: reduce ? 'auto' : 'smooth',
      block: 'center',
    });
  }, [activeIndex, autoScroll, reduce]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" />
        Загружаем текст…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Не удалось загрузить текст. Попробуйте позже.
      </div>
    );
  }
  if (!data?.available) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Для этого трека текст недоступен.
      </div>
    );
  }

  const synced = lines.length > 0;
  const plain = data.lyrics?.split(/\r?\n/).map((l) => l.trim()) ?? [];

  return (
    <div
      ref={containerRef}
      onWheel={() => setAutoScroll(false)}
      onTouchMove={() => setAutoScroll(false)}
      className="flex-1 overflow-y-auto px-6 py-8"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-3 text-center text-lg leading-relaxed sm:text-xl">
        {synced ? (
          lines.map((l, i) => {
            const isActive = i === activeIndex;
            const isPast = i < activeIndex;
            return (
              <motion.p
                key={i}
                ref={(el) => { lineRefs.current[i] = el; }}
                animate={{
                  opacity: isActive ? 1 : isPast ? 0.4 : 0.55,
                  scale: isActive ? 1.04 : 1,
                  filter: isActive ? 'blur(0px)' : 'blur(0.3px)',
                }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className={
                  isActive
                    ? 'font-semibold text-foreground'
                    : 'font-medium text-muted-foreground'
                }
              >
                {l.text || '\u00a0'}
              </motion.p>
            );
          })
        ) : (
          plain.map((line, i) => (
            <p key={i} className="font-medium text-foreground/80">
              {line || '\u00a0'}
            </p>
          ))
        )}
      </div>
      {synced && !autoScroll && (
        <button
          type="button"
          onClick={() => setAutoScroll(true)}
          className="fixed bottom-24 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-card px-4 py-2 text-xs font-medium shadow-[var(--shadow-md)]"
        >
          Прокручивать вместе с песней
        </button>
      )}
    </div>
  );
}
