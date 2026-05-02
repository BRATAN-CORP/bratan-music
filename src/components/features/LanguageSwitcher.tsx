import { motion, LayoutGroup, AnimatePresence } from 'motion/react';
import { Globe, Check } from 'lucide-react';
import { LOCALES, useI18n, type Locale } from '@/i18n';

/**
 * Pill-style segmented language switcher with a motion-driven sliding
 * highlight, soft gradient fill, and a spring-popped check on the
 * active option. Sits inside the existing `<SettingsCard />` so the
 * visual grammar matches the other toggles on the profile page.
 *
 * Why a custom component instead of `<Switch />`: the team uses Switch
 * for binary toggles, and "language" deserves a discoverable label per
 * choice (the flag emoji helps non-readers spot the right option). A
 * segmented pill is also easier to extend when we add a third locale.
 *
 * Interaction polish:
 *   - The highlight is a `<motion.span layoutId="lang-highlight" />`
 *     so toggling springs the gradient from one pill to the other in
 *     a single shared element. Nothing fades in/out.
 *   - `whileTap` scales the button down by 4 % for haptic feedback,
 *     `whileHover` lifts inactive options very slightly so it's clear
 *     which pill is the current selection vs. a target.
 *   - The Globe icon rotates 180° between RU and EN — a tiny visual
 *     cue that the switch did something even when the page below
 *     hasn't re-rendered yet.
 *   - Focus rings hit WCAG AA on both light and dark surfaces and
 *     sit above the highlight so keyboard navigation is never
 *     occluded by the pill fill.
 */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <motion.span
              animate={{ rotate: locale === 'en' ? 180 : 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className="inline-flex"
              aria-hidden
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
          className="mt-3 inline-flex rounded-full border border-border bg-background p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
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
          // Gradient + soft inner highlight + accent glow.
          // The inset highlight gives the pill a subtle convex feel
          // even on flat themes; the glow shadow signals action.
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
      <span className={`relative z-10 inline-flex items-center gap-1.5 ${active ? 'text-[var(--color-on-accent,_white)]' : 'text-foreground'}`}>
        <span aria-hidden>{flag}</span>
        {label}
        <AnimatePresence initial={false}>
          {active && (
            <motion.span
              key="check"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 22 }}
              aria-hidden
              className="ml-0.5 inline-flex"
            >
              <Check size={12} />
            </motion.span>
          )}
        </AnimatePresence>
        <span className="sr-only">{code}</span>
      </span>
    </motion.button>
  );
}
