import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, X } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { useT, type TranslationKey } from '@/i18n';

/**
 * Spotlight onboarding tour — runs once per user on the first dashboard
 * visit after a successful login. The completion timestamp is persisted
 * server-side as `users.tour_completed_at`, mirrored on the auth store
 * via `User.tourCompletedAt`. Clearing the timestamp (server-side) or
 * pressing the "replay" button in the profile page replays the tour on the
 * next mount.
 *
 * Design choices:
 *   - The component navigates the user across routes itself, so each
 *     step can highlight an element that lives on its own page. The
 *     alternative — a tour that only fires on `/home` — would either
 *     leave most of the product unexplained or require a separate
 *     "feature reveal" pattern per page; one self-driving tour is
 *     simpler.
 *   - Targets are addressed by `data-tour-id="..."` attributes on the
 *     real UI rather than by ref/className probing, so the tour can
 *     survive minor markup churn without becoming a flake.
 *   - The spotlight cutout is a single absolutely-positioned element
 *     with `box-shadow: 0 0 0 9999px rgba(...)`. That keeps the
 *     backdrop a single GPU layer (no SVG mask) and animates smoothly
 *     when the target moves between steps.
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
  {
    targetId: 'tour-wave',
    // Home is the index route mounted at "/" (see router.tsx —
    // `{ index: true, element: <HomeOrLanding /> }`). There is no
    // dedicated `/home` path; navigating there hits NotFoundPage.
    route: '/',
    titleKey: 'onboarding.tour.wave.title',
    bodyKey: 'onboarding.tour.wave.body',
    placement: 'bottom',
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
    targetId: 'tour-profile',
    route: '/profile',
    titleKey: 'onboarding.tour.profile.title',
    bodyKey: 'onboarding.tour.profile.body',
    placement: 'bottom',
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
  // Read the target's computed border-radius so the cutout matches.
  // We pick the largest of the four corners since asymmetric radii
  // would be hard to mirror in a single CSS value, and the fattest
  // round still reads as "the same shape".
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
  // Centre the spotlight when no target is found (e.g. mid-route
  // transition). The tooltip falls back to `placement: 'center'`
  // automatically when the spot is the viewport itself.
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
  onSkip: () => void;
}

function TourCard({ step, index, total, rect, onNext, onSkip }: TourCardProps) {
  const t = useT();
  const isLast = index === total - 1;
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Real card height after layout. We keep a sensible initial guess
  // (200) so the first frame doesn't jump from 0 → measured height.
  const [cardHeight, setCardHeight] = useState(200);
  // Re-measure on viewport changes so rotating phones / resizing
  // browser windows still places the card correctly.
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

  // On narrow viewports we ditch the floating-tooltip pattern entirely
  // and pin the card to the bottom of the screen as a sheet. The
  // floating tooltip on a 360px-wide phone never has good placement —
  // it either overlaps the spotlight or runs off the edge.
  const isMobile = vw < 640;
  const cardWidth = isMobile ? Math.min(vw - 24, 480) : 360;

  let top = 0;
  let left = 0;

  if (isMobile) {
    // Bottom-sheet style: hugs the bottom of the screen, full width
    // minus 12px gutter on each side. Above the player bar (~80px)
    // when present — we add a 16px breathing-room margin below.
    left = (vw - cardWidth) / 2;
    top = vh - cardHeight - 16;
  } else {
    // Desktop: float adjacent to the spotlight with smart placement.
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

    // Clamp inside viewport with a 16px gutter so the card never runs
    // off-screen, even for very tall steps.
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
        // The portal wrapper carries `pointer-events-none` so the dim
        // backdrop from the spotlight box-shadow doesn't swallow clicks
        // on app chrome. The card itself has to opt back in, otherwise
        // its buttons inherit the disabled
        // state and never fire onClick.
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
        <Button size="sm" onClick={onNext} className="gap-1.5">
          {isLast ? t('onboarding.done') : t('onboarding.next')}
          {!isLast && <ArrowRight size={14} />}
        </Button>
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

  // Tour eligibility: authed + has never finished/skipped before. The
  // optional `tourCompletedAt` comes from `/auth/telegram` /
  // `/auth/nonce` payloads and is `null` for fresh accounts. We also
  // guard against running twice in the same session via the local
  // `dismissed` ref so that finishing the tour doesn't immediately
  // re-open it before the auth payload round-trips.
  const eligible = useMemo(() => {
    if (!user || !accessToken) return false;
    return user.tourCompletedAt == null;
  }, [user, accessToken]);

  const [running, setRunning] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const startedRef = useRef(false);

  // Kick the tour off once after login. We delay the first step a hair
  // so the first route's hero animations don't visually fight with the
  // tour overlay mounting.
  useEffect(() => {
    if (!eligible || startedRef.current) return;
    startedRef.current = true;
    const id = window.setTimeout(() => setRunning(true), 600);
    return () => window.clearTimeout(id);
  }, [eligible]);

  // On every step transition: navigate to the route that owns the
  // step's target, then poll for the target element until it appears
  // (give it ~3s, then bail to a centre-screen fallback).
  useLayoutEffect(() => {
    if (!running) return;
    const step = STEPS[stepIndex];
    if (!step) return;
    if (window.location.pathname !== step.route) {
      navigate(step.route);
    }

    let cancelled = false;
    let frames = 0;
    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector(`[data-tour-id="${step.targetId}"]`);
      if (el && el.getBoundingClientRect().width > 0) {
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
  }, [running, stepIndex, navigate]);

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
    // Optimistically flip the local flag so the tour doesn't replay
    // before the API confirms — the server is the source of truth on
    // next refresh, but the user shouldn't see a flicker.
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
            // Spotlight: a transparent rectangle whose 9999px box-shadow
            // paints the rest of the viewport black. Animating top/left
            // /width/height/borderRadius drives the cutout between steps
            // — borderRadius mirrors the target element's own radius so
            // the cutout matches a 24px-rounded card cleanly.
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
            onSkip={handleSkip}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
