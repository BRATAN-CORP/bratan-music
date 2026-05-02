import { motion, LayoutGroup } from 'motion/react';
import { Globe } from 'lucide-react';
import { LOCALES, useI18n, type Locale } from '@/i18n';

/**
 * Pill-style segmented language switcher with a motion-driven sliding
 * highlight. Sits inside the existing `<SettingsCard />` so the visual
 * grammar matches the other toggles on the profile page.
 *
 * Why a custom component instead of `<Switch />`: the team uses Switch
 * for binary toggles, and "language" deserves a discoverable label per
 * choice (the flag emoji helps non-readers spot the right option). A
 * segmented pill is also easier to extend when we add a third locale.
 */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Globe size={13} className="text-muted-foreground" />
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
          className="mt-3 inline-flex rounded-full border border-border bg-background p-1"
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
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className="relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
    >
      {active && (
        <motion.span
          layoutId="lang-highlight"
          className="absolute inset-0 rounded-full bg-[var(--color-accent)]"
          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
          aria-hidden
        />
      )}
      <span className={`relative z-10 inline-flex items-center gap-1.5 ${active ? 'text-[var(--color-on-accent,_white)]' : 'text-foreground'}`}>
        <span aria-hidden>{flag}</span>
        {label}
        <span className="sr-only">{code}</span>
      </span>
    </button>
  );
}
