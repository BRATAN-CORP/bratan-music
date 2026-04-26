import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Heart, HeartCrack } from 'lucide-react';
import { useFeedbackStore } from '@/lib/likeFeedback';

const PARTICLES = 8;

function Burst({
  id,
  x,
  y,
  action,
  onDone,
}: {
  id: number;
  x: number;
  y: number;
  action: 'liked' | 'unliked';
  onDone: (id: number) => void;
}) {
  useEffect(() => {
    const t = window.setTimeout(() => onDone(id), 950);
    return () => window.clearTimeout(t);
  }, [id, onDone]);

  const tint =
    action === 'liked'
      ? 'var(--color-sub-accent)'
      : 'var(--color-text-subtle)';

  return (
    <div
      className="pointer-events-none fixed left-0 top-0 z-[100]"
      style={{ transform: `translate(${x}px, ${y}px)` }}
    >
      <motion.div
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: [0.4, 1.7, 1.2], opacity: [0, 1, 0] }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], times: [0, 0.35, 1] }}
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ color: tint }}
      >
        {action === 'liked' ? (
          <Heart size={32} fill="currentColor" strokeWidth={1.5} />
        ) : (
          <HeartCrack size={32} strokeWidth={1.8} />
        )}
      </motion.div>

      {action === 'liked' &&
        Array.from({ length: PARTICLES }).map((_, i) => {
          const angle = (i / PARTICLES) * Math.PI * 2;
          const distance = 36 + Math.random() * 16;
          const dx = Math.cos(angle) * distance;
          const dy = Math.sin(angle) * distance;
          return (
            <motion.div
              key={i}
              initial={{ x: 0, y: 0, scale: 0.6, opacity: 0 }}
              animate={{ x: dx, y: dy, scale: [0.6, 1, 0.4], opacity: [0, 1, 0] }}
              transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1], times: [0, 0.4, 1], delay: 0.05 }}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ color: tint }}
            >
              <Heart size={10} fill="currentColor" strokeWidth={0} />
            </motion.div>
          );
        })}
    </div>
  );
}

export function LikeBurstLayer() {
  const bursts = useFeedbackStore((s) => s.bursts);
  const toast = useFeedbackStore((s) => s.toast);
  const remove = useFeedbackStore((s) => s.remove);
  const clearToast = useFeedbackStore((s) => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const id = toast.id;
    const t = window.setTimeout(() => clearToast(id), 1700);
    return () => window.clearTimeout(t);
  }, [toast, clearToast]);

  return (
    <>
      {bursts.map((b) => (
        <Burst key={b.id} {...b} onDone={remove} />
      ))}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-none fixed inset-x-0 z-[100] flex justify-center px-4"
            style={{ bottom: 'calc(var(--player-height, 72px) + env(safe-area-inset-bottom) + 88px)' }}
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-foreground shadow-[var(--shadow-lg)] backdrop-blur">
              {toast.action === 'liked' ? (
                <>
                  <Heart size={13} className="text-[var(--color-sub-accent)]" fill="currentColor" />
                  Добавлено в Мне нравится
                </>
              ) : (
                <>
                  <HeartCrack size={13} className="text-muted-foreground" />
                  Убрано из Мне нравится
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
