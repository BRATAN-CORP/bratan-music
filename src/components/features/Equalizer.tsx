import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Sliders, RotateCcw } from 'lucide-react';
import { EQ_BANDS, setEqGain, isEqAvailable } from '@/hooks/useAudioPlayer';
import { useSettingsStore } from '@/store/settings';
import { Button } from '@/components/ui/Button';
import { useT } from '@/i18n';
import type { TranslationKey } from '@/i18n';

// Preset values are static EQ curves for the 10-band parametric EQ;
// only the display name moves through i18n (keyed by `nameKey`).
// Order matches EQ_BANDS: 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz.
const PRESETS: { nameKey: TranslationKey; values: number[] }[] = [
  { nameKey: 'equalizer.presetFlat',       values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { nameKey: 'equalizer.presetBass',       values: [7, 6, 4, 2, 0, -1, -1, 0, 0, 0] },
  { nameKey: 'equalizer.presetVocal',      values: [-2, -2, -1, 1, 3, 4, 4, 2, 0, -1] },
  { nameKey: 'equalizer.presetRock',       values: [4, 3, 2, -1, -2, 0, 2, 3, 4, 5] },
  { nameKey: 'equalizer.presetElectronic', values: [6, 5, 3, 0, -2, -1, 1, 3, 4, 5] },
  { nameKey: 'equalizer.presetClassical',  values: [3, 2, 1, 0, 0, 0, 1, 2, 3, 3] },
];

const GAIN_MIN = -12;
const GAIN_MAX = 12;

// SVG viewBox dimensions. The component scales to its container width
// via `preserveAspectRatio="none"` on the inner geometry — see render.
const VBW = 600;
const VBH = 240;
const PAD_X = 32;
const PAD_Y_TOP = 16;
const PAD_Y_BOT = 28;

function freqLabel(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k`;
  return String(hz);
}

// Logarithmic mapping of frequency to x-coordinate. EQ curves are
// almost always rendered on a log axis because human pitch perception
// is logarithmic; spacing 31 / 62 / 125 / 250 / ... linearly would
// crush the bass into the leftmost 1% of the graph.
function freqToX(hz: number): number {
  const minLog = Math.log10(20);
  const maxLog = Math.log10(20000);
  const t = (Math.log10(hz) - minLog) / (maxLog - minLog);
  return PAD_X + t * (VBW - 2 * PAD_X);
}

function gainToY(db: number): number {
  const t = (db - GAIN_MIN) / (GAIN_MAX - GAIN_MIN); // 0..1, low at 0
  return VBH - PAD_Y_BOT - t * (VBH - PAD_Y_TOP - PAD_Y_BOT);
}

function yToGain(y: number): number {
  const t = (VBH - PAD_Y_BOT - y) / (VBH - PAD_Y_TOP - PAD_Y_BOT);
  const raw = GAIN_MIN + t * (GAIN_MAX - GAIN_MIN);
  return Math.max(GAIN_MIN, Math.min(GAIN_MAX, raw));
}

/**
 * Build a smooth path through `points` using Catmull-Rom-to-Bezier
 * conversion. Produces a single continuous curve that passes through
 * every band node — visually similar to FL Studio's Parametric EQ 2
 * frequency-response display. We don't render the actual sum of the
 * underlying biquad responses (that would require an off-thread
 * sample of the filter chain) — the cardinal spline tracks the band
 * gains tightly enough for a UI affordance.
 */
function buildCurvePath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  const tension = 0.5;
  const segs: string[] = [`M ${points[0]!.x} ${points[0]!.y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + ((p2.x - p0.x) / 6) * tension;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * tension;
    const c2x = p2.x - ((p3.x - p1.x) / 6) * tension;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * tension;
    segs.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`);
  }
  return segs.join(' ');
}

export function Equalizer() {
  const t = useT();
  const gains = useSettingsStore((s) => s.eqGains);
  const setStoreEqGain = useSettingsStore((s) => s.setEqGain);
  const setStoreEqGains = useSettingsStore((s) => s.setEqGains);

  const [available, setAvailable] = useState(false);
  useEffect(() => {
    setAvailable(isEqAvailable());
  }, []);
  const refreshAvailability = () => setAvailable(isEqAvailable());

  const updateBand = (i: number, value: number) => {
    setStoreEqGain(i, value);
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
          transition: {
            delay,
            duration: 0.28,
            ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
          },
        };

  // Anchor frequencies for the x-axis labels. We don't label every
  // band (10 labels would clutter the strip on mobile) — the chip row
  // below shows the exact value of each band anyway. These ticks are
  // the conventional decade marks an audio engineer expects to see.
  const xTicks = [31, 100, 1000, 10000];
  const yTicks = [-12, -6, 0, 6, 12];

  const points = useMemo(
    () => EQ_BANDS.map((freq, i) => ({ x: freqToX(freq), y: gainToY(gains[i] ?? 0) })),
    [gains],
  );
  const curvePath = useMemo(() => buildCurvePath(points), [points]);
  const fillPath = useMemo(() => {
    if (points.length === 0) return '';
    const zeroY = gainToY(0);
    const left = points[0]!.x;
    const right = points[points.length - 1]!.x;
    return `M ${left} ${zeroY} ` +
      // Walk through the same Catmull-Rom segments…
      buildCurvePath(points).replace(/^M \S+ \S+/, `L ${left} ${points[0]!.y}`) +
      ` L ${right} ${zeroY} Z`;
  }, [points]);

  // ── Pointer drag ───────────────────────────────────────────────
  // Convert any pointer event into the (band, gain) we want to apply.
  // We grab a reference to the SVG so we can use its CTM to translate
  // client coords into viewBox coords accurately even when the SVG is
  // scaled by its container.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingBandRef = useRef<number | null>(null);

  const eventToVB = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };

  const nearestBand = (vbX: number): number => {
    let best = 0;
    let bestDist = Infinity;
    EQ_BANDS.forEach((freq, i) => {
      const dx = Math.abs(freqToX(freq) - vbX);
      if (dx < bestDist) {
        bestDist = dx;
        best = i;
      }
    });
    return best;
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    const vb = eventToVB(e);
    if (!vb) return;
    const band = nearestBand(vb.x);
    draggingBandRef.current = band;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const next = Math.round(yToGain(vb.y) * 2) / 2;
    updateBand(band, next);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const band = draggingBandRef.current;
    if (band === null) return;
    const vb = eventToVB(e);
    if (!vb) return;
    const next = Math.round(yToGain(vb.y) * 2) / 2;
    updateBand(band, next);
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    draggingBandRef.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  };

  // ── Keyboard ───────────────────────────────────────────────────
  // Each band node is focusable. ↑/↓ adjusts gain in 1 dB steps,
  // ⇧+↑/⇧+↓ in 0.5 dB steps. Home/End jump to the rails.
  const handleNodeKey = (e: React.KeyboardEvent, i: number) => {
    const cur = gains[i] ?? 0;
    let next = cur;
    const step = e.shiftKey ? 0.5 : 1;
    if (e.key === 'ArrowUp') next = cur + step;
    else if (e.key === 'ArrowDown') next = cur - step;
    else if (e.key === 'Home') next = GAIN_MAX;
    else if (e.key === 'End') next = GAIN_MIN;
    else if (e.key === 'PageUp') next = cur + 3;
    else if (e.key === 'PageDown') next = cur - 3;
    else return;
    e.preventDefault();
    next = Math.max(GAIN_MIN, Math.min(GAIN_MAX, next));
    updateBand(i, next);
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
            {t('equalizer.title')}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => applyPreset(EQ_BANDS.map(() => 0))}
          aria-label={t('equalizer.resetAria')}
        >
          <RotateCcw size={12} /> {t('equalizer.resetShort')}
        </Button>
      </motion.div>

      {!available && (
        <motion.p {...fadeIn(0.22)} className="text-xs text-muted-foreground">
          {t('equalizer.hint')}
        </motion.p>
      )}

      <motion.div {...fadeIn(0.26)} className="flex flex-wrap gap-1.5">
        {PRESETS.map(({ nameKey, values }) => (
          <button
            key={nameKey}
            onClick={() => applyPreset(values)}
            className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-[var(--color-border-strong)] hover:text-foreground"
          >
            {t(nameKey)}
          </button>
        ))}
      </motion.div>

      {/* Parametric EQ canvas — a single SVG that renders the
          frequency-response curve and exposes one draggable node per
          band. The user can either grab a node directly or click/drag
          anywhere in the canvas: pointerdown finds the nearest band
          (in log-frequency space) and binds the drag to that band's
          gain, so vertical strokes become "tweak this band". This is
          the same input model as FL Studio Parametric EQ 2. */}
      <motion.div
        {...fadeIn(0.3)}
        className="relative overflow-hidden rounded-[var(--radius-md)] border border-border bg-[var(--color-surface-elevated)]"
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VBW} ${VBH}`}
          preserveAspectRatio="none"
          role="application"
          aria-label={t('equalizer.curveAria')}
          className="block h-56 w-full touch-none select-none sm:h-60"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <defs>
            <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.45" />
              <stop offset="55%" stopColor="var(--color-accent)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.04" />
            </linearGradient>
            <linearGradient id="eq-stroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--color-sub-accent)" />
              <stop offset="50%" stopColor="var(--color-accent)" />
              <stop offset="100%" stopColor="var(--color-sub-accent)" />
            </linearGradient>
          </defs>

          {/* Y-axis grid lines + labels (-12, -6, 0, +6, +12 dB) */}
          {yTicks.map((db) => {
            const y = gainToY(db);
            const isZero = db === 0;
            return (
              <g key={db}>
                <line
                  x1={PAD_X}
                  x2={VBW - PAD_X}
                  y1={y}
                  y2={y}
                  stroke="var(--color-border)"
                  strokeWidth={isZero ? 1 : 0.5}
                  strokeDasharray={isZero ? '' : '3 4'}
                  opacity={isZero ? 0.7 : 0.45}
                />
                <text
                  x={PAD_X - 6}
                  y={y + 3}
                  fontSize={9}
                  textAnchor="end"
                  fill="var(--color-muted-foreground)"
                  className="tabular-nums"
                >
                  {db > 0 ? `+${db}` : db}
                </text>
              </g>
            );
          })}

          {/* X-axis frequency ticks */}
          {xTicks.map((hz) => {
            const x = freqToX(hz);
            return (
              <g key={hz}>
                <line
                  x1={x}
                  x2={x}
                  y1={PAD_Y_TOP}
                  y2={VBH - PAD_Y_BOT}
                  stroke="var(--color-border)"
                  strokeWidth={0.5}
                  strokeDasharray="3 4"
                  opacity={0.35}
                />
                <text
                  x={x}
                  y={VBH - PAD_Y_BOT + 14}
                  fontSize={9}
                  textAnchor="middle"
                  fill="var(--color-muted-foreground)"
                  className="tabular-nums"
                >
                  {freqLabel(hz)}
                </text>
              </g>
            );
          })}

          {/* Filled wave under the curve */}
          <motion.path
            d={fillPath}
            fill="url(#eq-fill)"
            stroke="none"
            initial={false}
            animate={{ d: fillPath }}
            transition={{ type: 'spring', stiffness: 220, damping: 26 }}
          />

          {/* Curve outline */}
          <motion.path
            d={curvePath}
            fill="none"
            stroke="url(#eq-stroke)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={{ d: curvePath }}
            transition={{ type: 'spring', stiffness: 220, damping: 26 }}
          />

          {/* Band nodes */}
          {points.map((p, i) => {
            const freq = EQ_BANDS[i]!;
            const dragging = draggingBandRef.current === i;
            return (
              <g key={freq}>
                <motion.circle
                  cx={p.x}
                  cy={p.y}
                  r={dragging ? 8 : 6}
                  fill="var(--color-accent)"
                  stroke="var(--color-card)"
                  strokeWidth={2}
                  tabIndex={0}
                  role="slider"
                  aria-label={t('equalizer.freqHzAria', { label: freqLabel(freq) })}
                  aria-valuemin={GAIN_MIN}
                  aria-valuemax={GAIN_MAX}
                  aria-valuenow={Math.round((gains[i] ?? 0) * 10) / 10}
                  onKeyDown={(e) => handleNodeKey(e, i)}
                  initial={false}
                  animate={{ cx: p.x, cy: p.y }}
                  transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                  className="cursor-grab focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface-elevated)] active:cursor-grabbing"
                />
              </g>
            );
          })}
        </svg>
      </motion.div>

      {/* Per-band readout chips. Echoes the exact frequency + gain for
          each band so the user can confirm the curve at a glance and
          read precise values that the canvas labels (decade ticks
          only) intentionally omit. */}
      <motion.div
        {...fadeIn(0.34)}
        className="grid grid-cols-5 gap-1.5 sm:grid-cols-10"
      >
        {EQ_BANDS.map((freq, i) => {
          const value = gains[i] ?? 0;
          const active = Math.abs(value) >= 0.5;
          return (
            <div
              key={freq}
              className={`flex flex-col items-center gap-0.5 rounded-[var(--radius-sm)] border px-1 py-1.5 text-center ${
                active
                  ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/8'
                  : 'border-border bg-card'
              }`}
            >
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {freqLabel(freq)}
              </span>
              <span className="text-[11px] font-medium tabular-nums text-foreground">
                {value > 0 ? '+' : ''}{value.toFixed(1)}
              </span>
            </div>
          );
        })}
      </motion.div>
    </motion.div>
  );
}
