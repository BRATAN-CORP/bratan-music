import { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { LOCALES, useI18n, type Locale } from '@/i18n';

/**
 * Pill-style segmented language switcher with a sliding active highlight.
 *
 * Design:
 *   - Single, always-mounted highlight `<motion.span>` positioned by
 *     measuring the active button's rect in a `useLayoutEffect` and
 *     feeding `{ x, width, height }` into `motion`'s `animate` prop.
 *   - `initial={false}` on the highlight → the very first paint sits
 *     the pill at the right place with no transition. Subsequent
 *     locale flips animate the spring from previous to next rect.
 *
 * Why this and not `LayoutGroup` + `layoutId`:
 *   The previous version put a `<motion.span layoutId="lang-highlight">`
 *   inside `{active && …}` so the element re-mounted in a different
 *   button each time the locale changed. `layoutId` then morphed it
 *   across the position delta — desired for user clicks, broken for
 *   silent re-mounts. Silent re-mounts happen because the settings
 *   store hydrates the locale in two passes:
 *     1. synchronous from `localStorage` (zustand persist) on mount,
 *     2. asynchronous from `/user/preferences` via `useSettingsSync`
 *        once the network resolves.
 *   If pass (2) returns a different locale than pass (1), the active
 *   button flips post-paint and the layoutId morph fires, producing
 *   the "highlight pill flies in from somewhere" glitch the user hit
 *   on profile entry. `initial={false}` doesn't help because
 *   layoutId's whole purpose IS the cross-mount transition.
 *
 *   With a single always-mounted highlight whose `animate` prop is
 *   driven by measured rects, a silent active-button flip simply
 *   re-runs the layout effect, the highlight slides smoothly to its
 *   correct spot — and `initial={false}` ensures the very first
 *   paint is static.
 *
 * Accessibility (WCAG AA):
 *   - `role="radiogroup"` + `aria-checked` on each option.
 *   - Highlight is `aria-hidden` and sits behind the foreground
 *     content (`z-10` on the buttons), so the focus ring is never
 *     eaten.
 *   - Reduced-motion: the spring still resolves to its end state in
 *     one frame because motion's `useReducedMotion` shortcut applies
 *     to the same `animate` path.
 */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<Partial<Record<Locale, HTMLButtonElement | null>>>({});
  const [highlight, setHighlight] = useState<{
    x: number;
    width: number;
    height: number;
  } | null>(null);

  // Measure the active button after every layout pass and feed the
  // result into `motion`. `useLayoutEffect` runs synchronously before
  // the browser paints, so the user never sees the highlight at the
  // wrong position — the very first paint already has the right
  // `x`/`width`. A `ResizeObserver` keeps the highlight in sync if
  // the container's box ever changes (font load, parent layout shift).
  useLayoutEffect(() => {
    const measure = () => {
      const btn = buttonRefs.current[locale];
      const container = containerRef.current;
      if (!btn || !container) return;
      const btnRect = btn.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      setHighlight({
        x: btnRect.left - containerRect.left,
        width: btnRect.width,
        height: btnRect.height,
      });
    };
    measure();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [locale]);

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={t('settings.language')}
      // `self-start` keeps the pill at content width inside the
      // surrounding `flex flex-col` SettingsCard body. Without it
      // the column's default `align-items: stretch` overrides the
      // `inline-flex` and makes the pill span the full card.
      className="relative inline-flex self-start rounded-full border border-border bg-background p-1 shadow-[0_1px_0_rgba(0,0,0,0.02)]"
    >
      {highlight && (
        <motion.span
          aria-hidden
          initial={false}
          animate={{ x: highlight.x, width: highlight.width, height: highlight.height }}
          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
          className="absolute left-0 top-1 rounded-full"
          style={{
            background: 'var(--color-accent)',
            boxShadow:
              '0 1px 0 rgba(255,255,255,0.18) inset, 0 6px 18px -6px var(--color-accent-glow)',
          }}
        />
      )}
      {LOCALES.map((option) => {
        const active = locale === option.code;
        return (
          <LocaleButton
            key={option.code}
            buttonRef={(el) => {
              buttonRefs.current[option.code] = el;
            }}
            label={t(option.nameKey)}
            code={option.code}
            active={active}
            onSelect={() => setLocale(option.code)}
          />
        );
      })}
    </div>
  );
}

interface LocaleButtonProps {
  buttonRef: (el: HTMLButtonElement | null) => void;
  code: Locale;
  label: string;
  active: boolean;
  onSelect: () => void;
}

function LocaleButton({ buttonRef, code, label, active, onSelect }: LocaleButtonProps) {
  return (
    <motion.button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      whileTap={{ scale: 0.96 }}
      whileHover={active ? undefined : { scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      className="relative z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span
        className={`inline-flex items-center gap-1.5 transition-colors ${
          active ? 'text-[var(--color-text-on-accent)]' : 'text-foreground'
        }`}
      >
        {label}
        {active && (
          <motion.span
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 600, damping: 22, delay: 0.05 }}
            aria-hidden
            className="-mr-0.5 inline-flex"
          >
            <Check size={12} strokeWidth={3} />
          </motion.span>
        )}
        <span className="sr-only">{code}</span>
      </span>
    </motion.button>
  );
}
