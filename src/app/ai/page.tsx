import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Sparkles, Loader2, Wand2, RefreshCw, Save, ArrowRight, ListMusic, Lightbulb,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { AuthGuard } from '@/components/features/AuthGuard';
import { Button } from '@/components/ui/Button';
import { Aurora } from '@/components/ui/Aurora';
import { TiltCard } from '@/components/ui/TiltCard';
import { TrackItem } from '@/components/features/TrackItem';
import { usePlayerStore } from '@/store/player';
import {
  useGenerateAiPlaylist, useSaveAiPlaylist, type AiPlaylistPreview,
} from '@/hooks/useAiPlaylist';
import type { Track } from '@/types';
import { EASE_SPRING } from '@/lib/motion';
import { useT, type TranslationKey } from '@/i18n';

const PROMPT_LIMIT = 200;
const SUGGESTION_KEYS: TranslationKey[] = [
  'ai.suggestionDeepHouse',
  'ai.suggestionSadSynthwave',
  'ai.suggestionRussianRock',
  'ai.suggestionWarmJazz',
  'ai.suggestionFunkDisco',
  'ai.suggestionLofiStudy',
];

export function AiPlaylistPage() {
  return (
    <AuthGuard>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const t = useT();
  const reduce = useReducedMotion();
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<20 | 30 | 40>(20);
  const [preview, setPreview] = useState<AiPlaylistPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const generate = useGenerateAiPlaylist();
  const save = useSaveAiPlaylist();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  // Reset save state when user mutates the preview by re-generating.
  useEffect(() => { setSavedId(null); }, [preview]);

  const handleGenerate = async () => {
    setError(null);
    if (prompt.trim().length < 3) {
      setError(t('ai.errPromptTooShort'));
      return;
    }
    try {
      const res = await generate.mutateAsync({ prompt: prompt.trim(), size });
      setPreview(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ai.errGenerate'));
    }
  };

  const handleSave = async () => {
    if (!preview) return;
    setError(null);
    try {
      const saved = await save.mutateAsync({
        name: preview.name,
        description: preview.description,
        tracks: preview.tracks,
        prompt: preview.prompt,
      });
      setSavedId(saved.id);
      qc.invalidateQueries({ queryKey: ['playlists'] });
      qc.invalidateQueries({ queryKey: ['playlist', saved.id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('ai.errSave'));
    }
  };

  // Plays the track but also seeds the player queue with the rest of
  // the preview so the user can keep listening through the curation
  // before they decide to save it. Same UX as queueing from a search
  // result block.
  const handlePlay = (track: Track) => {
    if (!preview) return;
    setTrack(track);
    setQueue(preview.tracks);
  };

  return (
    <div className="relative w-full">
      {/* Same hero stage as home: Aurora gradient + grid background +
          centered max-w-6xl container with the standard responsive
          padding the rest of the app uses. The card itself is just
          a normal `bg-card` panel — no TiltCard, no extra widths. */}
      <section className="relative overflow-hidden pb-8 pt-12 sm:pt-16 lg:pb-10">
        <Aurora variant="hero" />
        <div className="grid-bg absolute inset-0 opacity-20" aria-hidden />

        <div className="relative mx-auto flex max-w-6xl flex-col gap-8 px-4 sm:px-6 lg:px-10">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE_SPRING }}
            className="flex flex-col gap-2"
          >
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-[var(--color-surface-elevated)] px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
              <Sparkles size={12} className="text-[var(--color-accent)]" />
              {t('ai.eyebrow')}
            </span>
            <h1 className="max-w-3xl text-[clamp(1.8rem,4vw,2.8rem)] font-semibold leading-[1.06] tracking-tight">
              {t('ai.titlePart1')}{' '}<span className="font-serif italic text-muted-foreground">{t('ai.titlePart2')}</span>
              <br className="hidden sm:block" />{t('ai.titlePart3')}
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              {t('ai.subtitle')}
            </p>
          </motion.div>

          {/* Hover treatment matched to the SubscriptionCard reference
              in /profile: subtle tilt via TiltCard (intensity=6,
              hoverScale=1 — keeps the textarea hit-box stable so taps
              land), a static two-corner gradient on idle, plus a
              hover-only halo. The textarea, suggestion chips and the
              segmented "20 / 30 / 40" buttons sit on a relative content
              layer above the `pointer-events-none` decoration, so they
              stay fully interactive throughout. */}
          <TiltCard
            intensity={6}
            hoverScale={1}
            glareStrength={0.45}
            className="rounded-[var(--radius-xl)]"
          >
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE_SPRING, delay: 0.05 }}
            className="group relative overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card p-5 transition-all hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-md)] sm:p-6"
          >
            {/* Static idle gradient — same two-corner signature as the
                SubscriptionCard reference in /profile. */}
            <div
              className="pointer-events-none absolute inset-0"
              aria-hidden
              style={{
                background:
                  'radial-gradient(110% 70% at 100% 0%, var(--color-accent-soft) 0%, transparent 55%), radial-gradient(80% 60% at 0% 100%, color-mix(in oklab, var(--color-sub-accent) 14%, transparent) 0%, transparent 60%)',
              }}
            />
            <div
              className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-90"
              aria-hidden
              style={{
                background: 'radial-gradient(circle, var(--color-accent-glow) 0%, transparent 70%)',
              }}
            />
            <div className="relative flex flex-col gap-4">
              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_LIMIT))}
                  placeholder={t('ai.placeholder')}
                  rows={2}
                  className="w-full resize-none rounded-[var(--radius-md)] border border-border bg-background px-4 py-3 pr-16 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/30"
                />
                <div className="absolute bottom-2 right-3 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  {prompt.length}/{PROMPT_LIMIT}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {SUGGESTION_KEYS.map((sk) => {
                  const label = t(sk);
                  return (
                    <button
                      key={sk}
                      onClick={() => setPrompt(label)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-[var(--color-accent)]/40 hover:text-foreground"
                    >
                      <Lightbulb size={11} />
                      {label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium uppercase tracking-wider text-muted-foreground">{t('ai.tracksLabel')}</span>
                  {[20, 30, 40].map((n) => (
                    <button
                      key={n}
                      onClick={() => setSize(n as 20 | 30 | 40)}
                      className={`rounded-full px-3 py-1 transition-colors ${
                        size === n
                          ? 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]'
                          : 'border border-border bg-background text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <Button onClick={handleGenerate} disabled={generate.isPending} size="lg" className="gap-2">
                  {generate.isPending ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> {t('ai.thinking')}
                    </>
                  ) : (
                    <>
                      <Wand2 size={14} /> {preview ? t('ai.regenerate') : t('ai.generate')}
                    </>
                  )}
                </Button>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="rounded-[var(--radius-md)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
          </TiltCard>
        </div>
      </section>

      {/* Preview — same container width and padding as the rest of
          the app's listing pages (search results, library, playlist
          page) so the AI page doesn't feel like a different surface. */}
      <AnimatePresence mode="wait">
        {preview && (
          <motion.section
            key={preview.prompt}
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.5, ease: EASE_SPRING }}
            className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-10"
          >
            <div className="overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-card">
              <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-[var(--color-accent)] to-fuchsia-500 text-white">
                    <ListMusic size={20} />
                  </div>
                  <div className="min-w-0">
                    <input
                      value={preview.name}
                      onChange={(e) => setPreview({ ...preview, name: e.target.value.slice(0, 80) })}
                      className="w-full bg-transparent text-base font-semibold tracking-tight outline-none placeholder:text-muted-foreground sm:text-lg"
                      placeholder={t('ai.nameField')}
                    />
                    <input
                      value={preview.description}
                      onChange={(e) => setPreview({ ...preview, description: e.target.value.slice(0, 280) })}
                      className="mt-1 w-full bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/60"
                      placeholder={t('ai.descField')}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                    {t('ai.tracksCount', { count: preview.tracks.length })}
                  </span>
                  <Button variant="ghost" size="icon" onClick={handleGenerate} disabled={generate.isPending} title={t('ai.regenerateTitle')}>
                    <RefreshCw size={13} className={generate.isPending ? 'animate-spin' : ''} />
                  </Button>
                  {savedId ? (
                    <Button onClick={() => navigate(`/playlist/${savedId}`)} className="gap-2">
                      <ArrowRight size={13} /> {t('ai.open')}
                    </Button>
                  ) : (
                    <Button onClick={handleSave} disabled={save.isPending || preview.tracks.length === 0} className="gap-2">
                      {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                      {t('ai.save')}
                    </Button>
                  )}
                </div>
              </div>

              {/* Tracks rendered with the same TrackItem component as
                  search results / home recents — keeps row design,
                  hover affordances, and play/like behaviour identical
                  to the rest of the app. */}
              {preview.tracks.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <ListMusic size={28} className="text-muted-foreground" />
                  <p className="text-sm font-medium">{t('ai.emptyTitle')}</p>
                  <p className="text-xs text-muted-foreground">{t('ai.emptyHint')}</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  <AnimatePresence initial={false}>
                    {preview.tracks.map((tr, i) => (
                      <motion.li
                        key={`${tr.source ?? 'tidal'}:${tr.id}`}
                        layout
                        initial={reduce ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0, transition: { duration: 0.3, delay: Math.min(i * 0.02, 0.2) } }}
                        exit={reduce ? undefined : { opacity: 0, x: 12 }}
                      >
                        <TrackItem track={tr} index={i + 1} onPlay={handlePlay} />
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}

              {/* Plan tail — show how the AI broke down the prompt */}
              <details className="border-t border-border bg-secondary/40 px-5 py-3 text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  {t('ai.planSummary', { count: preview.plan.queries.length })}
                </summary>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {preview.plan.queries.map((q, i) => (
                    <span key={i} className="rounded-full bg-background px-2.5 py-0.5 text-muted-foreground">
                      {q.query} <span className="opacity-50">×{q.limit}</span>
                    </span>
                  ))}
                </div>
              </details>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
