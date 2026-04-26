import { motion } from 'motion/react';
import { useAnalyserData } from '@/hooks/useAudioPlayer';

interface VisualizerProps {
  active: boolean;
  bars?: number;
  className?: string;
  height?: number;
}

export function Visualizer({ active, bars = 32, className = '', height = 80 }: VisualizerProps) {
  const data = useAnalyserData(active, bars);
  const hasSignal = active && Array.from(data).some((v) => v > 0);

  return (
    <div className={`flex items-end gap-1 ${className}`} style={{ height }}>
      {Array.from({ length: bars }).map((_, i) => {
        const v = hasSignal ? (data[i] ?? 0) / 255 : 0;
        const fakeHeight = active && !hasSignal ? 0.18 + 0.55 * Math.sin(i / 1.5 + Date.now() / 500) ** 2 : v;
        return (
          <motion.span
            key={i}
            className="flex-1 rounded-full bg-gradient-to-t from-[var(--color-accent)] to-[var(--color-sub-accent)]"
            animate={{ scaleY: Math.max(0.05, fakeHeight) }}
            transition={{ duration: 0.08, ease: 'linear' }}
            style={{
              transformOrigin: 'bottom',
              height: '100%',
              opacity: active ? 1 : 0.25,
            }}
          />
        );
      })}
    </div>
  );
}
