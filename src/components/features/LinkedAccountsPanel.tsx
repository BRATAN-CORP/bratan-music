import { useState, useRef, useEffect } from 'react';
import { Mail, Loader2, Link2, Unlink, Send } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useT } from '@/i18n';

interface LinkedAccountsResponse {
  email: string | null;
  username: string | null;
  name: string | null;
}

type Step = 'idle' | 'email' | 'code';

/**
 * Profile-page section that lets a signed-in user attach an email
 * to their account or detach one. Mirrors the unauth EmailLoginCard
 * flow (request code → verify code) but routed through the
 * authenticated `/user/me/email/*` endpoints. Source-of-truth for
 * the linked email is the React-Query cache key `['profile']`,
 * which `<ProfilePage />` already consumes — we re-key off the same
 * query so the page-wide profile stays in sync.
 */
export function LinkedAccountsPanel() {
  const t = useT();
  const queryClient = useQueryClient();
  const patchUser = useAuthStore((s) => s.patchUser);

  const { data: profile, refetch } = useQuery<LinkedAccountsResponse>({
    queryKey: ['profile'],
    queryFn: () => api.get<LinkedAccountsResponse>('/user/me'),
  });

  const [step, setStep] = useState<Step>('idle');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  const linkedEmail = profile?.email ?? null;

  const handleStartLink = () => {
    setStep('email');
    setEmail('');
    setCode('');
    setError(null);
  };

  const handleCancel = () => {
    setStep('idle');
    setEmail('');
    setCode('');
    setError(null);
  };

  const handleRequestCode = async (e: React.FormEvent) => {
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
      await api.post<{ ok: true }>('/user/me/email/request', { email: trimmed });
      setEmail(trimmed);
      setStep('code');
      setCooldown(60);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : t('auth.emailLogin.errorRequest'));
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
      const res = await api.post<{ ok: true; email: string }>('/user/me/email/verify', { email, code: code.trim() });
      patchUser({ email: res.email });
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      await refetch();
      setStep('idle');
      setEmail('');
      setCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : t('auth.emailLogin.errorVerify'));
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
      await api.post<{ ok: true }>('/user/me/email/request', { email });
      setCooldown(60);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : t('auth.emailLogin.errorRequest'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlink = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.post<{ ok: true; email: null }>('/user/me/email/unlink', undefined);
      patchUser({ email: null });
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : t('profile.linkedAccounts.errorUnlink'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-[var(--radius-xl)] border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <Link2 size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium leading-tight">{t('profile.linkedAccounts.title')}</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t('profile.linkedAccounts.hint')}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {/* Telegram row — read-only because Telegram binding is set on
            login and there's no server endpoint to detach it. */}
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-background/40 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <TelegramGlyph />
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {t('profile.linkedAccounts.telegramLabel')}
              </div>
              <div className="mt-0.5 truncate text-sm text-foreground">
                {profile?.username ? `@${profile.username}` : profile?.name ?? t('profile.linkedAccounts.telegramNotLinked')}
              </div>
            </div>
          </div>
          {profile?.username || profile?.name ? (
            <span className="rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-accent)]">
              {t('profile.linkedAccounts.linked')}
            </span>
          ) : null}
        </div>

        {/* Email row — interactive. Three rendering states: linked
            (show address + unlink), idle/unlinked (show "link" CTA),
            in-progress (email or code form). */}
        <div className="rounded-[var(--radius-md)] border border-border bg-background/40 px-4 py-3">
          {linkedEmail && step === 'idle' ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                  <Mail size={14} />
                </span>
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {t('profile.linkedAccounts.emailLabel')}
                  </div>
                  <div className="mt-0.5 truncate text-sm text-foreground" title={linkedEmail}>{linkedEmail}</div>
                </div>
              </div>
              <Button onClick={handleUnlink} disabled={submitting} variant="outline" size="sm">
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />}
                {t('profile.linkedAccounts.unlinkCta')}
              </Button>
            </div>
          ) : step === 'idle' ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                  <Mail size={14} />
                </span>
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {t('profile.linkedAccounts.emailLabel')}
                  </div>
                  <div className="mt-0.5 truncate text-sm text-muted-foreground">
                    {t('profile.linkedAccounts.emailNotLinked')}
                  </div>
                </div>
              </div>
              <Button onClick={handleStartLink} variant="outline" size="sm">
                <Link2 size={14} />
                {t('profile.linkedAccounts.linkCta')}
              </Button>
            </div>
          ) : step === 'email' ? (
            <form onSubmit={handleRequestCode} className="flex flex-col gap-2">
              <label htmlFor="profile-email-link" className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {t('profile.linkedAccounts.formEmailLabel')}
              </label>
              <Input
                id="profile-email-link"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder={t('auth.emailLogin.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              {error && <p role="alert" className="text-xs text-[var(--color-destructive)]">{error}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" size="sm" disabled={submitting || email.trim().length === 0}>
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {submitting ? t('auth.emailLogin.sending') : t('auth.emailLogin.sendCodeCta')}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleVerify} className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                {t('auth.emailLogin.sentTo')} <span className="font-medium text-foreground">{email}</span>
              </p>
              <label htmlFor="profile-email-code" className="sr-only">
                {t('auth.emailLogin.codeLabel')}
              </label>
              <Input
                id="profile-email-code"
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
              {error && <p role="alert" className="text-xs text-[var(--color-destructive)]">{error}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" size="sm" disabled={submitting || code.length !== 6}>
                  {submitting && <Loader2 size={14} className="animate-spin" />}
                  {submitting ? t('auth.emailLogin.verifying') : t('profile.linkedAccounts.confirmCta')}
                </Button>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={cooldown > 0 || submitting}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 disabled:hover:text-muted-foreground"
                >
                  {cooldown > 0 ? t('auth.emailLogin.resendIn', { seconds: cooldown }) : t('auth.emailLogin.resend')}
                </button>
                <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function TelegramGlyph() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-telegram)]/10 text-[var(--color-telegram)]">
      <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M21.94 4.34a1.5 1.5 0 0 0-2.06-1.66L2.5 9.85a1.05 1.05 0 0 0 .07 1.97l4.6 1.55 1.78 5.6a1 1 0 0 0 1.65.4l2.51-2.45 4.7 3.46a1.5 1.5 0 0 0 2.36-.96l1.77-15.08ZM9.7 14.4l-.74 4 1.18-3.36 7.94-7.6L9.7 14.4Z" />
      </svg>
    </span>
  );
}
