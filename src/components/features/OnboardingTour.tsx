import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { useT, type TranslationKey } from '@/i18n';

/**
 * Spotlight onboarding tour. Runs once per user; completion is
 * persisted server-side as `users.tour_completed_at` and mirrored on
 * the auth store as `User.tourCompletedAt`. Clearing it (server-side
 * or via the profile "replay" button) replays on next mount.
 *
 * Targets are looked up by `data-tour-id` attributes so the tour
 * survives minor markup churn. The spotlight cutout is a single
 * element with `box-shadow: 0 0 0 9999px rgba(...)` — keeps the
 * backdrop a single GPU layer and animates smoothly between steps.
 */

interface TourStep {
  /** `data-tour-id` value on the element to highlight. */
  targetId: string;
  /** Route to navigate to before measuring `targetId`. */
  route: string;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  /** Where the tooltip sits relative to the target. Defaults to
   *  `bottom`; we override per-step when the natural placement would
   *  collide with the viewport edge or a fixed nav. */
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

const STEPS: TourStep[] = [
  // Home lives at `/` (router.tsx index route). There is no
  // dedicated `/home` path; navigating there hits NotFoundPage.
  {
    targetId: 'tour-wave',
    route: '/',
    titleKey: 'onboarding.tour.wave.title',
    bodyKey: 'onboarding.tour.wave.body',
    placement: 'bottom',
  },
  {
    targetId: 'tour-wave-settings',
    route: '/',
    titleKey: 'onboarding.tour.waveSettings.title',
    bodyKey: 'onboarding.tour.waveSettings.body',
    placement: 'bottom',
  },
  {
    targetId: 'tour-ai',
    route: '/',
    titleKey: 'onboarding.tour.ai.title',
    bodyKey: 'onboarding.tour.ai.body',
    placement: 'bottom',
  },
  {
    targetId: 'tour-daily',
    route: '/',
    titleKey: 'onboarding.tour.daily.title',
    bodyKey: 'onboarding.tour.daily.body',
    placement: 'top',
  },
  {
    targetId: 'tour-recent',
    route: '/',
    titleKey: 'onboarding.tour.recent.title',
    bodyKey: 'onboarding.tour.recent.body',
    placement: 'top',
  },
  {
    targetId: 'tour-search',
    route: '/search',
    titleKey: 'onboarding.tour.search.title',
    bodyKey: 'onboarding.tour.search.body',
    placement: 'bottom',
  },
  {
    targetId: 'tour-library',
    route: '/library',
    titleKey: 'onboarding.tour.library.title',
    bodyKey: 'onboarding.tour.library.body',
    placement: 'bottom',
  },
  {
    targetId: 'tour-subscription',
    route: '/profile',
    titleKey: 'onboarding.tour.subscription.title',
    bodyKey: 'onboarding.tour.subscription.body',
    placement: 'top',
  },
];

const PADDING = 8;

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
  /** Mirror the target's own corner radius so the cutout doesn't have
   *  square corners on a card that's pill-shaped or 24px-rounded. */
  borderRadius: number;
}

function readRect(target: Element): SpotlightRect {
  const r = target.getBoundingClientRect();
  // Pick the largest of the four corners — asymmetric radii are hard
  // to mirror in a single CSS value and the fattest round still
  // reads as the same shape.
  let radius = 12;
  try {
    const cs = getComputedStyle(target);
    const px = (v: string) => parseFloat(v) || 0;
    radius = Math.max(
      px(cs.borderTopLeftRadius),
      px(cs.borderTopRightRadius),
      px(cs.borderBottomLeftRadius),
      px(cs.borderBottomRightRadius),
      12,
    );
  } catch {
    // ignore — fall back to default radius
  }
  return {
    top: r.top - PADDING,
    left: r.left - PADDING,
    width: r.width + PADDING * 2,
    height: r.height + PADDING * 2,
    // Inflate the radius slightly so the visual gap matches PADDING.
    borderRadius: radius + PADDING / 2,
  };
}

function fallbackRect(): SpotlightRect {
  // Centred when no target is found (e.g. mid-route). Tooltip
  // falls back to `placement: 'center'` automatically.
  const w = Math.min(window.innerWidth, 480);
  const h = 80;
  return {
    top: window.innerHeight / 2 - h / 2,
    left: window.innerWidth / 2 - w / 2,
    width: w,
    height: h,
    borderRadius: 16,
  };
}

interface TourCardProps {
  step: TourStep;
  index: number;
  total: number;
  rect: SpotlightRect;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

function TourCard({ step, index, total, rect, onNext, onBack, onSkip }: TourCardProps) {
  const t = useT();
  const isLast = index === total - 1;
  const isFirst = index === 0;
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Initial guess (200) so the first frame doesn't jump from 0
  // to the post-layout height.
  const [cardHeight, setCardHeight] = useState(200);
  // Re-measure on viewport changes (rotation / resize).
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1024));
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 768));

  useLayoutEffect(() => {
    if (!cardRef.current) return;
    setCardHeight(cardRef.current.offsetHeight);
  }, [step.targetId, vw, vh]);

  useEffect(() => {
    const onResize = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  // Narrow viewports use a bottom sheet — a floating tooltip on a
  // 360px-wide phone always overlaps the spotlight or runs off the
  // edge.
  const isMobile = vw < 640;
  const cardWidth = isMobile ? Math.min(vw - 24, 480) : 360;

  let top = 0;
  let left = 0;

  if (isMobile) {
    left = (vw - cardWidth) / 2;
    top = vh - cardHeight - 16;
  } else {
    const desired = step.placement ?? 'bottom';
    let placement = desired;
    if (desired === 'bottom' && rect.top + rect.height + cardHeight + 16 > vh) {
      placement = 'top';
    } else if (desired === 'top' && rect.top - cardHeight - 16 < 0) {
      placement = 'bottom';
    }

    if (placement === 'bottom') {
      top = rect.top + rect.height + 12;
      left = rect.left + rect.width / 2 - cardWidth / 2;
    } else if (placement === 'top') {
      top = rect.top - cardHeight - 12;
      left = rect.left + rect.width / 2 - cardWidth / 2;
    } else if (placement === 'left') {
      top = rect.top + rect.height / 2 - cardHeight / 2;
      left = rect.left - cardWidth - 12;
    } else if (placement === 'right') {
      top = rect.top + rect.height / 2 - cardHeight / 2;
      left = rect.left + rect.width + 12;
    } else {
      top = vh / 2 - cardHeight / 2;
      left = vw / 2 - cardWidth / 2;
    }

    // Clamp inside viewport with a 16px gutter.
    left = Math.max(16, Math.min(vw - cardWidth - 16, left));
    top = Math.max(16, Math.min(vh - cardHeight - 16, top));
  }

  return (
    <motion.div
      ref={cardRef}
      key={step.targetId}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      style={{
        position: 'fixed',
        top,
        left,
        width: cardWidth,
        zIndex: 10001,
        // Portal wrapper is `pointer-events-none` (so the spotlight
        // backdrop doesn't swallow chrome clicks); the card opts
        // back in so its buttons fire onClick.
        pointerEvents: 'auto',
      }}
      className="liquid-glass overflow-hidden rounded-[var(--radius-lg)] border border-border bg-[var(--color-surface-elevated)] p-5 shadow-2xl"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {index + 1} / {total}
        </span>
        <button
          type="button"
          onClick={onSkip}
          className="-m-1 rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label={t('onboarding.skipAria')}
        >
          <X size={14} />
        </button>
      </div>
      <h3 id="tour-title" className="text-base font-semibold leading-tight">
        {t(step.titleKey)}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(step.bodyKey)}</p>
      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onSkip}
          className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('onboarding.skip')}
        </button>
        <div className="flex items-center gap-2">
          {!isFirst && (
            <Button size="sm" variant="outline" onClick={onBack} className="gap-1.5">
              <ArrowLeft size={14} />
              {t('onboarding.back')}
            </Button>
          )}
          <Button size="sm" onClick={onNext} className="gap-1.5">
            {isLast ? t('onboarding.done') : t('onboarding.next')}
            {!isLast && <ArrowRight size={14} />}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

export function OnboardingTour() {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const user = useAuthStore((s) => s.user);
  const patchUser = useAuthStore((s) => s.patchUser);
  const accessToken = useAuthStore((s) => s.accessToken);

  // Tour eligibility: authed + never finished/skipped. The local
  // `startedRef` guards against running twice in the same session
  // before the auth payload round-trips.
  const eligible = useMemo(() => {
    if (!user || !accessToken) return false;
    return user.tourCompletedAt == null;
  }, [user, accessToken]);

  const [running, setRunning] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const startedRef = useRef(false);

  // Delay the first step so the hero animations don't fight with
  // the overlay mounting.
  useEffect(() => {
    if (!eligible || startedRef.current) return;
    startedRef.current = true;
    const id = window.setTimeout(() => setRunning(true), 600);
    return () => window.clearTimeout(id);
  }, [eligible]);

  // On step transition: navigate to the step's route, scroll the
  // target into view, poll for it (~3s before bailing to a centred
  // fallback). Explicit scrollIntoView prevents the spotlight
  // landing on an off-screen element.
  useLayoutEffect(() => {
    if (!running) return;
    const step = STEPS[stepIndex];
    if (!step) return;
    if (window.location.pathname !== step.route) {
      navigate(step.route);
    }

    let cancelled = false;
    let frames = 0;
    let scrolled = false;
    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector(`[data-tour-id="${step.targetId}"]`);
      if (el && el.getBoundingClientRect().width > 0) {
        if (!scrolled) {
          scrolled = true;
          // `block: 'center'` is friendlier than `'start'` for short
          // targets like the WaveHero — leaves room above and below
          // for the floating tooltip.
          el.scrollIntoView({
            block: 'center',
            inline: 'nearest',
            behavior: reduce ? 'auto' : 'smooth',
          });
          // 380ms covers the default smooth-scroll duration on every
          // engine; reduce-motion users skip the wait.
          window.setTimeout(() => {
            if (cancelled) return;
            const after = document.querySelector(`[data-tour-id="${step.targetId}"]`);
            if (after && after.getBoundingClientRect().width > 0) {
              setRect(readRect(after));
            } else {
              setRect(fallbackRect());
            }
          }, reduce ? 0 : 380);
          return;
        }
        setRect(readRect(el));
        return;
      }
      frames += 1;
      if (frames > 180) {
        setRect(fallbackRect());
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [running, stepIndex, navigate, reduce]);

  // Keep the spotlight glued to the target on resize/scroll.
  useEffect(() => {
    if (!running) return;
    const step = STEPS[stepIndex];
    if (!step) return;
    const onChange = () => {
      const el = document.querySelector(`[data-tour-id="${step.targetId}"]`);
      if (el) setRect(readRect(el));
    };
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  }, [running, stepIndex]);

  const finish = async () => {
    setRunning(false);
    setRect(null);
    // Optimistically flip the local flag — server is source of
    // truth on next refresh, this just avoids a flicker.
    patchUser({ tourCompletedAt: Math.floor(Date.now() / 1000) });
    try {
      await api.post('/user/me/tour/complete', {});
    } catch (err) {
      console.error('[tour] failed to persist completion', err);
    }
  };

  const handleNext = () => {
    if (stepIndex >= STEPS.length - 1) {
      void finish();
      return;
    }
    setStepIndex((i) => i + 1);
  };

  const handleBack = () => {
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const handleSkip = () => {
    void finish();
  };

  if (!running || !rect) return null;
  const step = STEPS[stepIndex];
  if (!step) return null;

  return createPortal(
    <AnimatePresence>
      {running && (
        <motion.div
          key="tour-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-none fixed inset-0 z-[10000]"
        >
          <motion.div
            // Spotlight: transparent rect whose 9999px box-shadow
            // paints the rest of the viewport black. Animating
            // top/left/width/height/borderRadius drives the cutout
            // between steps.
            initial={false}
            animate={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              borderRadius: rect.borderRadius,
            }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 28 }}
            style={{
              position: 'fixed',
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.72)',
              pointerEvents: 'auto',
            }}
            onClick={handleNext}
          />
          <TourCard
            step={step}
            index={stepIndex}
            total={STEPS.length}
            rect={rect}
            onNext={handleNext}
            onBack={handleBack}
            onSkip={handleSkip}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
