import { ArrowLeft, ShieldOff } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { useAuthStore } from '@/store/auth';
import { useAutoAuth } from '@/hooks/useAuth';
import { EmailLoginCard } from '@/components/features/EmailLoginCard';
import { TelegramLoginButton } from '@/components/features/TelegramLoginButton';
import { Aurora } from '@/components/ui/Aurora';
import { MetaChip } from '@/components/ui/MetaChip';
import { Eyebrow } from '@/components/ui/SectionHeading';
import { EASE_SPRING as EASE } from '@/lib/motion';
import { useT } from '@/i18n';

/**
 * Dedicated email-OTP authentication surface, accessed via the
 * "Sign in with email" button on the marketing landing and the
 * AuthGuard. Lives at `/auth/email` so it's deep-linkable, can carry
 * its own page state in the URL, and stays out of the landing's hero
 * (the user explicitly asked to stop showing the OTP form inline on
 * the marketing page).
 *
 * If the user is already signed in we hard-redirect to `/` so a stale
 * deep link doesn't park them on a useless login screen — the auth
 * store is the single source of truth and we mirror what the
 * landing's auth-conditional CTA does.
 */
export function EmailAuthPage() {
  const t = useT();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  // Pulls the JWT out of the persisted store on first render — same
  // hook the rest of the app uses to bootstrap from Telegram WebApp.
  // Calling it here means a returning email-OTP user with a still-
  // valid token gets bounced past this page on cold-load, no flicker.
  useAutoAuth();
  const user = useAuthStore((s) => s.user);

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleBack = () => {
    // Prefer history.back() so users coming from /search → AuthGuard
    // → /auth/email return to the gated page they wanted, not the
    // landing. Falls back to /` when the page is opened directly.
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/', { replace: true });
    }
  };

  return (
    <div className="relative min-h-[calc(100dvh-12rem)] w-full">
      {/*
       * Same hero clip-path trick the landing uses — bottom Aurora
       * blob bleeds 240px past the section to avoid a hard cut, while
       * horizontal clipping is preserved so wide gradient blobs don't
       * spawn a horizontal scrollbar on mobile.
       */}
      <section className="relative px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:px-10 lg:pt-20 [clip-path:inset(0_0_-240px_0)]">
        <Aurora />
        <div className="grid-bg absolute inset-0 opacity-30" aria-hidden />

        <div className="relative mx-auto flex max-w-md flex-col items-stretch gap-6">
          <button
            type="button"
            onClick={handleBack}
            className="-ml-2 inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            <ArrowLeft size={12} />
            {t('auth.emailPage.back')}
          </button>

          <motion.div
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: EASE }}
            className="rounded-[var(--radius-lg)] border border-border bg-card/80 p-6 backdrop-blur-sm sm:p-8"
          >
            <div className="flex flex-col gap-3">
              <MetaChip size="sm">
                <ShieldOff size={11} className="text-[var(--color-accent)]" />
                {t('auth.emailPage.eyebrow')}
              </MetaChip>
              <Eyebrow className="sr-only">{t('auth.emailPage.eyebrow')}</Eyebrow>
              <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
                {t('auth.emailPage.title')}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t('auth.emailPage.subtitle')}
              </p>
            </div>

            <div className="mt-6">
              <EmailLoginCard />
            </div>

            <div className="mt-7 flex flex-col gap-2 border-t border-border pt-5">
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                {t('auth.emailPage.altLoginHint')}
              </p>
              <TelegramLoginButton />
              <Link
                to="/"
                className="text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('auth.emailPage.altLoginCta')}
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
