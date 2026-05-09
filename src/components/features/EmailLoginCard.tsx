import { useState, useRef, useEffect } from 'react';
import { Loader2, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { motion, AnimatePresence } from 'motion/react';

type Step = 'email' | 'code';

/**
 * Two-step passwordless login below the Telegram CTA. Step 1 collects
 * the email address and posts to `/auth/email/request`; step 2 collects
 * the 6-digit code and posts to `/auth/email/verify`. Errors render
 * inline (under the input) and the "wrong code" path stays on step 2
 * so the user can retype without losing the email they entered.
 *
 * The card mirrors the `<TelegramLoginButton />` visual rhythm — same
 * `<Button size="lg">`, same outer flow — so the two login affordances
 * read as siblings in the auth stack rather than two unrelated UIs.
 */
export function EmailLoginCard() {
  const t = useT();
  const { requestEmailCode, verifyEmailCode } = useAuth();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Resend cooldown mirrors the server-side OTP cooldown (60s) so we
   *  don't let the user fire a second /request that the server would
   *  silently swallow with a generic "ok". Counts down to 0 before the
   *  button re-enables. */
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement | null>(null);

  // Tick cooldown down to 0 once per second. Skipped when the cooldown
  // is already zero so we don't churn render cycles for nothing.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  // Auto-focus the code input when we transition into step 2.
  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      setError(t('auth.emailLogin.errorInvalidEmail'));
      return;
    }
    setSubmitting(true);
    try {
      await requestEmailCode(trimmed);
      setEmail(trimmed);
      setStep('code');
      setCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.emailLogin.errorRequest'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError(t('auth.emailLogin.errorCodeFormat'));
      return;
    }
    setSubmitting(true);
    try {
      await verifyEmailCode(email, code.trim());
      // On success the auth-store flips and the surrounding view (e.g.
      // Landing's gate) unmounts the card. Nothing to do here.
    } catch (err) {
      // 400 from the server lands here as ApiError. The user stays on
      // step 2 so they can retry the code without retyping the email.
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : t('auth.emailLogin.errorVerify'));
      }
      setCode('');
      setTimeout(() => codeRef.current?.focus(), 0);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (submitting || cooldown > 0) return;
    setError(null);
    setSubmitting(true);
    try {
      await requestEmailCode(email);
      setCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.emailLogin.errorRequest'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    setStep('email');
    setCode('');
    setError(null);
  };

  return (
    <div className="w-full max-w-sm">
      <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
        <span className="h-px flex-1 bg-border" aria-hidden />
        <span>{t('auth.emailLogin.dividerLabel')}</span>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {step === 'email' ? (
          <motion.form
            key="email"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            onSubmit={handleSendCode}
            className="flex flex-col gap-2"
          >
            <label htmlFor="email-login-email" className="sr-only">
              {t('auth.emailLogin.emailLabel')}
            </label>
            <Input
              id="email-login-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder={t('auth.emailLogin.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            {error && (
              <p role="alert" className="text-xs text-[var(--color-destructive)]">{error}</p>
            )}
            <Button
              type="submit"
              size="lg"
              variant="outline"
              disabled={submitting || email.trim().length === 0}
              className="w-full"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
              {submitting ? t('auth.emailLogin.sending') : t('auth.emailLogin.sendCodeCta')}
            </Button>
          </motion.form>
        ) : (
          <motion.form
            key="code"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            onSubmit={handleVerify}
            className="flex flex-col gap-2"
          >
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
              <span>
                {t('auth.emailLogin.sentTo')} <span className="font-medium text-foreground">{email}</span>
              </span>
            </p>
            <label htmlFor="email-login-code" className="sr-only">
              {t('auth.emailLogin.codeLabel')}
            </label>
            <Input
              id="email-login-code"
              ref={codeRef}
              type="text"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="text-center text-lg tracking-[0.5em]"
              required
            />
            {error && (
              <p role="alert" className="text-xs text-[var(--color-destructive)]">{error}</p>
            )}
            <Button
              type="submit"
              size="lg"
              disabled={submitting || code.length !== 6}
              className="w-full"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {submitting ? t('auth.emailLogin.verifying') : t('auth.emailLogin.verifyCta')}
            </Button>
            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={handleBack}
                className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft size={12} />
                {t('auth.emailLogin.changeEmail')}
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={cooldown > 0 || submitting}
                className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 disabled:hover:text-muted-foreground"
              >
                {cooldown > 0
                  ? t('auth.emailLogin.resendIn', { seconds: cooldown })
                  : t('auth.emailLogin.resend')}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
