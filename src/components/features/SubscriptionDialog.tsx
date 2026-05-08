import { useId, useState } from 'react';
import { Crown, Sparkles, X, ExternalLink, Check } from 'lucide-react';
import { useUiStore } from '@/store/ui';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useT, type TranslationKey } from '@/i18n';

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME ?? 'bratan_music_bot';

const BENEFITS: { icon: typeof Check; key: TranslationKey }[] = [
  { icon: Sparkles, key: 'subscription.benefits.lossless' },
  { icon: Sparkles, key: 'subscription.benefits.noads' },
  { icon: Sparkles, key: 'subscription.benefits.fullCatalog' },
];

/**
 * Global paywall dialog. Mounted once at the app root and toggled via
 * `useUiStore.subscriptionPromptOpen`. Triggered automatically when the
 * stream endpoint returns 402 (free daily limit exhausted) and on demand
 * from the profile page's "Оформить подписку" button.
 *
 * Subscription itself is handled by the Telegram bot — we just open the
 * `?start=subscribe` deeplink, the bot sends the user a Stars invoice
 * (99 ⭐), and once paid the bot grants the subscription on the server.
 * The next `/user/me` query picks up `subscription.status === 'active'`.
 */
export function SubscriptionDialog() {
  const t = useT();
  const titleId = useId();
  const { subscriptionPromptOpen, subscriptionPromptReason, closeSubscriptionPrompt } = useUiStore();
  const [redirecting, setRedirecting] = useState(false);

  const handleSubscribe = () => {
    setRedirecting(true);
    const url = `https://t.me/${BOT_USERNAME}?start=subscribe`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => setRedirecting(false), 4000);
  };

  return (
    <Modal
      open={subscriptionPromptOpen}
      onClose={closeSubscriptionPrompt}
      size="sm"
      labelledBy={titleId}
      panelClassName="relative p-6"
    >
      {/* Decorative gradient halo behind the crown so the dialog
          feels celebratory without resorting to bitmap art. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--color-accent)_0%,transparent_70%)] opacity-25 blur-2xl"
      />

      <div className="mb-1 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent)]/12 px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]">
          <Crown size={12} /> {t('subscription.tag')}
        </span>
        <Button onClick={closeSubscriptionPrompt} variant="ghost" size="icon" className="h-8 w-8" aria-label={t('subscription.closeAria')}>
          <X size={16} />
        </Button>
      </div>

      {subscriptionPromptReason && (
        <p className="mt-3 text-xs text-[var(--color-warn)]">
          {subscriptionPromptReason}
        </p>
      )}

      <h2 id={titleId} className="mt-3 text-xl font-semibold tracking-tight">
        {t('subscription.headline')}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t('subscription.tagline')}
      </p>

      <ul className="mt-5 flex flex-col gap-2.5">
        {BENEFITS.map(({ icon: Icon, key }) => (
          <li key={key} className="flex items-start gap-2.5 text-sm">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
              <Icon size={12} />
            </span>
            <span className="text-foreground/90">{t(key)}</span>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        onClick={handleSubscribe}
        className="mt-6 w-full"
        disabled={redirecting}
      >
        <ExternalLink size={14} />
        {redirecting ? t('subscription.openingBot') : t('subscription.subscribeCta')}
      </Button>

      <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
        {t('subscription.paymentNote')}
      </p>
    </Modal>
  );
}
