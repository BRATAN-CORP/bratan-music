import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Sun, Moon } from 'lucide-react';
import { useUiStore } from '@/store/ui';
import { usePlayerStore } from '@/store/player';
import { LOCALES, useI18n } from '@/i18n';

/**
 * Small floating preferences bar — pinned to the top-right of the
 * viewport on every route. Carries the theme toggle and language
 * picker so unauthenticated visitors can flip between Russian /
 * English and dark / light without ever touching the auth-gated
 * profile page.
 *
 * Why a separate component instead of dropping it into the sidebar:
 *   - The sidebar is `lg:flex` only, so on phones the toggles would
 *     be hidden behind a hamburger that doesn't exist.
 *   - Anonymous visitors land on the marketing landing page, which
 *     sits inside the same layout — putting the bar at the layout
 *     level guarantees they see the controls before they sign in.
 *
 * Layout choices:
 *   - `fixed top-right` with a safe-area-aware top inset, mirroring
 *     the iOS notch handling already used by `<RoomConnectedBadge />`.
 *   - Z-index 40 sits above page content but below modal scrims (50)
 *     and the fullscreen player (50).
 *   - Hidden when the fullscreen player is open — it claims the whole
 *     viewport and a stray pill in the corner reads as a layout glitch.
 *
 * Two locales fit naturally in a 2-segment pill; if we add a third
 * we'll switch to a popover. Click a locale that's already active
 * is a no-op (the setter checks). The theme button toggles in place
 * with a sun/moon cross-fade so the choice is unambiguous.
 */
export function QuickPrefsBar() {
  const { theme, toggleTheme } = useUiStore();
  const fullscreen = usePlayerStore((s) => s.fullscreen);
  const { locale, setLocale, t } = useI18n();
  const reduce = useReducedMotion();

  if (fullscreen) return null;

  return (
    <div
      className="pointer-events-none fixed right-3 z-40 flex items-center gap-2 sm:right-5"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
    >
      {/* Theme toggle — circular ghost button with cross-faded
          sun/moon. Sized down on phones so it sits beside the
          locale pill without crowding the hero. */}
      <motion.button
        type="button"
        onClick={toggleTheme}
        whileTap={reduce ? undefined : { scale: 0.92 }}
        whileHover={reduce ? undefined : { scale: 1.05 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        aria-label={t('profile.themeToggleAria')}
        title={theme === 'dark' ? t('settings.themeLight') : t('settings.themeDark')}
        className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-[0_4px_12px_-6px_rgba(0,0,0,0.35)] backdrop-blur transition-colors hover:border-[var(--color-border-strong)] hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:h-10 sm:w-10"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={theme}
            initial={reduce ? false : { rotate: -45, opacity: 0, scale: 0.6 }}
            animate={reduce ? undefined : { rotate: 0, opacity: 1, scale: 1 }}
            exit={reduce ? undefined : { rotate: 45, opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="inline-flex"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      {/* Locale segmented pill — two flag buttons sharing a frame.
          The active option carries the accent gradient, the other
          stays a plain ghost. Tapping the inactive flag flips the
          locale immediately; there's no menu to traverse. */}
      <div
        role="radiogroup"
        aria-label={t('settings.language')}
        className="pointer-events-auto inline-flex items-center rounded-full border border-border bg-card/90 p-0.5 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.35)] backdrop-blur"
      >
        {LOCALES.map((option) => {
          const active = locale === option.code;
          return (
            <motion.button
              key={option.code}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setLocale(option.code)}
              whileTap={reduce ? undefined : { scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 600, damping: 30 }}
              className={`relative inline-flex h-8 min-w-[2.25rem] items-center justify-center rounded-full px-2 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 sm:h-9 sm:min-w-[2.5rem] ${
                active ? 'text-[var(--color-on-accent,_white)]' : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-label={t(option.nameKey)}
            >
              {active && (
                <motion.span
                  layoutId="quick-prefs-locale-pill"
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      'linear-gradient(135deg, var(--color-accent) 0%, color-mix(in oklab, var(--color-accent) 85%, fuchsia) 100%)',
                    boxShadow:
                      '0 1px 0 rgba(255,255,255,0.18) inset, 0 4px 14px -6px var(--color-accent-glow, rgba(99,102,241,0.45))',
                  }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  aria-hidden
                />
              )}
              <span className="relative z-10 inline-flex items-center gap-1">
                <span aria-hidden className="text-[12px] leading-none">{option.flag}</span>
                <span>{option.code}</span>
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
