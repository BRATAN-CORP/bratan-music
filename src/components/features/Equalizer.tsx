import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Sliders, RotateCcw } from 'lucide-react';
import { EQ_BANDS, setEqGain, isEqAvailable } from '@/hooks/useAudioPlayer';
import { useSettingsStore } from '@/store/settings';
import { Button } from '@/components/ui/Button';

const PRESETS: Record<string, number[]> = {
  'Плоский': [0, 0, 0, 0, 0, 0],
  'Бас': [6, 4, 1, 0, -1, -2],
  'Вокал': [-2, -1, 1, 4, 3, 1],
  'Рок': [4, 2, -1, 1, 3, 5],
  'Электро': [5, 3, 0, -1, 2, 4],
  'Классика': [3, 2, 0, 0, 2, 3],
};

function freqLabel(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k` : String(hz);
}

export function Equalizer() {
  // Settings store is the source of truth for EQ gains — they roam
  // across devices via /user/preferences. The local component only
  // mirrors the slice and forwards updates back into the store. The
  // store's setter pushes to the audio graph (when up) and persists.
  const gains = useSettingsStore((s) => s.eqGains);
  const setStoreEqGain = useSettingsStore((s) => s.setEqGain);
  const setStoreEqGains = useSettingsStore((s) => s.setEqGains);

  // Whether the audio graph is up. Re-checked when the user
  // interacts with a slider — the graph is created lazily on first
  // user gesture (Safari requires it for `new AudioContext()`), so
  // the initial mount-time check often returns false even though
  // the very next slider drag would succeed. Re-running the check
  // after each interaction means the warning disappears as soon as
  // the user does anything that actually starts the graph.
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    setAvailable(isEqAvailable());
  }, []);
  const refreshAvailability = () => setAvailable(isEqAvailable());

  const updateBand = (i: number, value: number) => {
    setStoreEqGain(i, value);
    // Live update on the graph — when the graph isn't up yet
    // (first interaction on Safari before any track played) the
    // setter will spin it up, so by the next render `available`
    // flips to true.
    setEqGain(i, value);
    refreshAvailability();
  };

  const applyPreset = (preset: number[]) => {
    setStoreEqGains(preset);
    preset.forEach((g, i) => setEqGain(i, g));
    refreshAvailability();
  };

  const reduce = useReducedMotion();

  const fadeIn = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0 },
          transition: { delay, duration: 0.28, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
        };

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.96 }}
      animate={reduce ? undefined : { opacity: 1, scale: 1 }}
      exit={reduce ? undefined : { opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="liquid-glass flex flex-col gap-5 rounded-[var(--radius-lg)] p-5"
    >
      <motion.div {...fadeIn(0.18)} className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sliders size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Эквалайзер
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => applyPreset([0, 0, 0, 0, 0, 0])}
          aria-label="Сбросить"
        >
          <RotateCcw size={12} /> Сброс
        </Button>
      </motion.div>

      {!available && (
        // Soft-cue for the case where the graph hasn't come up yet
        // (typically because the user is on the settings page and
        // hasn't played anything this session). Sliders still write
        // into the persisted store, so the curve is captured and
        // applied to the graph the moment a track starts.
        <motion.p {...fadeIn(0.22)} className="text-xs text-muted-foreground">
          Запустите любой трек, чтобы регуляторы начали влиять на звук — текущие значения сохранятся и применятся автоматически.
        </motion.p>
      )}

      <motion.div {...fadeIn(0.26)} className="flex flex-wrap gap-1.5">
        {Object.entries(PRESETS).map(([name, values]) => (
          <button
            key={name}
            onClick={() => applyPreset(values)}
            className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-[var(--color-border-strong)] hover:text-foreground"
          >
            {name}
          </button>
        ))}
      </motion.div>

      <motion.div {...fadeIn(0.32)} className="flex h-44 items-end justify-between gap-2">
        {EQ_BANDS.map((freq, i) => (
          <div key={freq} className="flex h-full flex-1 flex-col items-center gap-2">
            <div className="relative flex flex-1 items-center justify-center">
              <input
                type="range"
                min={-12}
                max={12}
                step={0.5}
                value={gains[i] ?? 0}
                onChange={(e) => updateBand(i, Number(e.target.value))}
                className="vertical-slider"
                aria-label={`${freqLabel(freq)} Гц`}
                style={{ writingMode: 'vertical-lr' as never, direction: 'rtl', appearance: 'slider-vertical' as never }}
              />
              <motion.div
                className="pointer-events-none absolute inset-x-2 bottom-0 rounded-t-full bg-gradient-to-t from-[var(--color-accent)] to-[var(--color-sub-accent)] opacity-70"
                animate={{ height: `${(((gains[i] ?? 0) + 12) / 24) * 100}%` }}
                transition={{ type: 'spring', stiffness: 320, damping: 24 }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {freqLabel(freq)}
            </span>
            <span className="text-[10px] font-medium tabular-nums text-foreground">
              {(gains[i] ?? 0) > 0 ? '+' : ''}{(gains[i] ?? 0).toFixed(1)}
            </span>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}
