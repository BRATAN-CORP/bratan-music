import { motion, LayoutGroup } from 'motion/react';
import { Globe, Check } from 'lucide-react';
import { LOCALES, useI18n, type Locale } from '@/i18n';

/**
 * Pill-style segmented language switcher with a motion-driven sliding
 * highlight, tactile press feedback, and a subtle gradient sheen on
 * the active option. Sits inside the existing `<SettingsCard />` so
 * the visual grammar matches the other toggles on the profile page.
 *
 * Why a custom component instead of `<Switch />`:
 *   - Switch is the project idiom for binary toggles; "language"
 *     deserves a discoverable label per choice.
 *   - The sliding highlight gives the user a clear "where I am →
 *     where I'm going" affordance that's easier to read than a
 *     dropdown opening on tap.
 *   - Pill-shaped segmented controls scale gracefully when we add
 *     a third locale (no layout reshuffle needed).
 *
 * Accessibility notes (WCAG AA):
 *   - `role="radiogroup"` + `aria-checked` on each option → screen
 *     readers announce "Russian, radio button, selected".
 *   - Focus is visible via the `:focus-visible` ring; the layout
 *     pill can't eat the ring because it's `aria-hidden` and behind
 *     the foreground content (z-10).
 *   - Motion is short (≤ 350 ms) and purely cosmetic — disabling
 *     animations via OS prefers-reduced-motion still leaves the
 *     control fully usable.
 */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <motion.span
              initial={false}
              animate={{ rotate: locale === 'en' ? 180 : 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 18 }}
              aria-hidden
              className="inline-flex"
            >
              <Globe size={13} className="text-muted-foreground" />
            </motion.span>
            {t('settings.language')}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('settings.languageHint')}
          </p>
        </div>
      </div>
      <LayoutGroup id="lang-switcher">
        <div
          role="radiogroup"
          aria-label={t('settings.language')}
          className="mt-3 inline-flex rounded-full border border-border bg-background p-1 shadow-[0_1px_0_rgba(0,0,0,0.02)]"
        >
          {LOCALES.map((option) => (
            <LocaleButton
              key={option.code}
              code={option.code}
              flag={option.flag}
              label={t(option.nameKey)}
              active={locale === option.code}
              onSelect={() => setLocale(option.code)}
            />
          ))}
        </div>
      </LayoutGroup>
    </div>
  );
}

interface LocaleButtonProps {
  code: Locale;
  flag: string;
  label: string;
  active: boolean;
  onSelect: () => void;
}

function LocaleButton({ code, flag, label, active, onSelect }: LocaleButtonProps) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      whileTap={{ scale: 0.96 }}
      whileHover={active ? undefined : { scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      className="relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {active && (
        <motion.span
          layoutId="lang-highlight"
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'linear-gradient(135deg, var(--color-accent) 0%, color-mix(in oklab, var(--color-accent) 85%, fuchsia) 100%)',
            boxShadow:
              '0 1px 0 rgba(255,255,255,0.18) inset, 0 6px 18px -6px var(--color-accent-glow, rgba(99,102,241,0.45))',
          }}
          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
          aria-hidden
        />
      )}
      <span
        className={`relative z-10 inline-flex items-center gap-1.5 ${
          active ? 'text-[var(--color-on-accent,_white)]' : 'text-foreground'
        }`}
      >
        <span aria-hidden className="text-[13px] leading-none">{flag}</span>
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
