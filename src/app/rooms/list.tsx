import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Headphones, Plus, ArrowRight, Sparkles, Users, KeyRound, Loader2, Trash2 } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TiltCard } from '@/components/ui/TiltCard';
import { useCreateRoom, useDeleteRoom, useJoinRoom, useRoomsList } from '@/hooks/useRooms';
import { ApiError } from '@/lib/api';
import { EASE_SPRING } from '@/lib/motion';
import { useT } from '@/i18n';

export function RoomsListPage() {
  return (
    <AuthGuard>
      <RoomsListInner />
    </AuthGuard>
  );
}

function RoomsListInner() {
  const t = useT();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { data: rooms, isLoading } = useRoomsList();
  const createMut = useCreateRoom();
  const joinMut = useJoinRoom();
  const deleteMut = useDeleteRoom();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // Track auto-join attempt in a ref so we don't loop on a code that
  // failed once (e.g. invalid / expired). The `?join=CODE` query stays
  // in the URL only long enough for us to consume it.
  const autoJoinedFor = useRef<string | null>(null);

  const onCreate = async () => {
    setError(null);
    try {
      // The backend used to default empty submissions to a hard-coded
      // Russian phrase ("Комната совместного прослушивания"), which
      // leaked into the room title for English users. We now hand it
      // the locale-aware copy from the dictionary so the room name
      // matches whatever language the creator was using.
      const trimmed = name.trim();
      const res = await createMut.mutateAsync(trimmed || t('rooms.list.defaultName'));
      navigate(`/rooms/${res.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rooms.list.errorCreate'));
    }
  };
  const onJoin = async (codeOverride?: string) => {
    setError(null);
    const cleaned = (codeOverride ?? code).trim().toUpperCase();
    if (!cleaned) return;
    try {
      const res = await joinMut.mutateAsync(cleaned);
      navigate(`/rooms/${res.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message :
        err instanceof Error ? err.message : t('rooms.list.errorJoin'),
      );
    }
  };

  const onDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(t('rooms.list.confirmDelete'))) return;
    setError(null);
    try {
      await deleteMut.mutateAsync(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rooms.list.errorDelete'));
    }
  };

  // One-click invite: when the user lands on `/rooms?join=CODE`, prefill
  // the join input, switch to the "По коду" tab and auto-join. This is
  // what the share button on a room produces.
  useEffect(() => {
    const incoming = (searchParams.get('join') ?? '').trim().toUpperCase();
    if (!incoming) return;
    if (autoJoinedFor.current === incoming) return;
    autoJoinedFor.current = incoming;
    setCode(incoming);
    setTab('join');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('join');
      return next;
    }, { replace: true });
    void onJoin(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10">
      {/* Premium-hover hero: TiltCard provides the 3D parallax. It
          snaps flat on press over interactive children, so the Create/
          Join input + buttons + segmented tabs all stay on a stable
          hit-grid. On top of TiltCard we keep the two-corner static
          idle gradient + hover-only halo signature shared with
          WaveHero, AiPlaylistPromo, AI prompt, and SubscriptionCard so
          the high-value entry surfaces all read as one premium
          family. */}
      <TiltCard
        intensity={6}
        hoverScale={1}
        glareStrength={0.45}
        className="rounded-[var(--radius-xl)]"
      >
      <motion.section
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.45, ease: EASE_SPRING }}
        className="group relative overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card p-8 transition-all hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-md)] sm:p-10"
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
        {/* Existing hover-only accent halo, kept as-is so the lift
            still reads stronger than the idle baseline. */}
        <div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-90"
          aria-hidden
          style={{
            background:
              'radial-gradient(80% 60% at 80% 0%, var(--color-accent-glow), transparent 70%), radial-gradient(60% 40% at 0% 100%, color-mix(in oklch, var(--color-accent) 22%, transparent), transparent 70%)',
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-[var(--color-accent)] to-fuchsia-500 text-white shadow-[0_4px_20px_-4px_var(--color-accent-glow)] transition-transform duration-700 group-hover:scale-105">
              <Headphones size={14} />
            </span>
            {t('rooms.list.eyebrow')}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('rooms.list.heroTitle')}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {t('rooms.list.heroDescription')}
          </p>

          <div className="mt-6 inline-flex rounded-full border border-border bg-background/60 p-0.5 backdrop-blur">
            <SegButton active={tab === 'create'} onClick={() => setTab('create')}>
              <Sparkles size={14} /> {t('rooms.list.tabCreate')}
            </SegButton>
            <SegButton active={tab === 'join'} onClick={() => setTab('join')}>
              <KeyRound size={14} /> {t('rooms.list.tabJoin')}
            </SegButton>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:max-w-md">
            <AnimatePresence mode="wait" initial={false}>
              {tab === 'create' ? (
                <motion.div
                  key="create"
                  initial={reduce ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? undefined : { opacity: 0, x: 8 }}
                  transition={{ duration: 0.25 }}
                  className="flex flex-col gap-2 sm:flex-row"
                >
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('rooms.list.namePlaceholder')}
                    onKeyDown={(e) => e.key === 'Enter' && void onCreate()}
                  />
                  <Button onClick={() => void onCreate()} disabled={createMut.isPending}>
                    {createMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    {t('rooms.list.createCta')}
                  </Button>
                </motion.div>
              ) : (
                <motion.div
                  key="join"
                  initial={reduce ? false : { opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? undefined : { opacity: 0, x: -8 }}
                  transition={{ duration: 0.25 }}
                  className="flex flex-col gap-2 sm:flex-row"
                >
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder={t('rooms.list.codePlaceholder')}
                    maxLength={12}
                    onKeyDown={(e) => e.key === 'Enter' && void onJoin()}
                  />
                  <Button onClick={() => void onJoin()} disabled={joinMut.isPending || !code.trim()}>
                    {joinMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                    {t('rooms.list.joinCta')}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
            {(error || createMut.error || joinMut.error) && (
              <p className="text-xs text-destructive">
                {error ?? String((createMut.error ?? joinMut.error) as Error)?.toString().replace('Error: ', '')}
              </p>
            )}
          </div>
        </div>
      </motion.section>
      </TiltCard>

      <section className="mt-10">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
          <Users size={14} /> {t('rooms.list.myRooms')}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-[var(--radius-md)] border border-border bg-card/60" />
            ))}
          </div>
        ) : rooms && rooms.length > 0 ? (
          <motion.ul
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
          >
            {rooms.map((r) => (
              <motion.li
                key={r.id}
                variants={{
                  hidden: { opacity: 0, y: 12 },
                  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_SPRING } },
                }}
                className="relative"
              >
                <Link
                  to={`/rooms/${r.id}`}
                  className="group flex h-full flex-col justify-between rounded-[var(--radius-md)] border border-border bg-card p-4 transition-colors hover:border-[var(--color-border-strong)]"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{r.name}</span>
                      {r.isHost && (
                        <span className="shrink-0 rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-accent)]">
                          {t('rooms.list.hostBadge')}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 font-mono text-xs text-muted-foreground">
                      {t('rooms.list.codeLabel', { code: r.code })}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-end text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                    {t('rooms.list.openCta')} <ArrowRight size={12} className="ml-1" />
                  </div>
                </Link>
                {r.isHost && (
                  <button
                    type="button"
                    onClick={(e) => void onDelete(e, r.id)}
                    aria-label={t('rooms.list.deleteAria')}
                    title={t('rooms.list.deleteAria')}
                    disabled={deleteMut.isPending}
                    className="absolute bottom-3 left-3 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 transition-all hover:border-destructive hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                  >
                    {deleteMut.isPending && deleteMut.variables === r.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Trash2 size={12} />
                    )}
                  </button>
                )}
              </motion.li>
            ))}
          </motion.ul>
        ) : (
          <div className="rounded-[var(--radius-md)] border border-dashed border-border bg-card/40 px-6 py-10 text-center text-sm text-muted-foreground">
            {t('rooms.list.empty')}
          </div>
        )}
      </section>
    </div>
  );
}

function SegButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {active && (
        <motion.span
          layoutId="rooms-tab-indicator"
          className="absolute inset-0 rounded-full bg-secondary"
          transition={{ type: 'spring', stiffness: 360, damping: 32 }}
        />
      )}
      <span className="relative z-10 flex items-center gap-1.5">{children}</span>
    </button>
  );
}
