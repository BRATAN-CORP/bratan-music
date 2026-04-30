import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Headphones, Plus, ArrowRight, Sparkles, Users, KeyRound, Loader2 } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useCreateRoom, useJoinRoom, useRoomsList } from '@/hooks/useRooms';
import { EASE_SPRING } from '@/lib/motion';

export function RoomsListPage() {
  return (
    <AuthGuard>
      <RoomsListInner />
    </AuthGuard>
  );
}

function RoomsListInner() {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { data: rooms, isLoading } = useRoomsList();
  const createMut = useCreateRoom();
  const joinMut = useJoinRoom();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [tab, setTab] = useState<'create' | 'join'>('create');

  const onCreate = async () => {
    const res = await createMut.mutateAsync(name.trim() || undefined);
    navigate(`/rooms/${res.id}`);
  };
  const onJoin = async () => {
    const cleaned = code.trim().toUpperCase();
    if (!cleaned) return;
    const res = await joinMut.mutateAsync(cleaned);
    navigate(`/rooms/${res.id}`);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Hero with subtle gradient + animated waveform */}
      <motion.section
        initial={reduce ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: EASE_SPRING }}
        className="relative overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card p-8 sm:p-10"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              'radial-gradient(80% 60% at 80% 0%, var(--color-accent-glow), transparent 70%), radial-gradient(60% 40% at 0% 100%, color-mix(in oklch, var(--color-accent) 22%, transparent), transparent 70%)',
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
            <Headphones size={14} className="text-[var(--color-accent)]" />
            Совместное прослушивание
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Комнаты на двоих и больше
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Создай комнату и слушай в одном такте с друзьями. Любой участник может ставить треки и управлять плеером, кроссфейд и шафл здесь не работают — это страхует от рассинхрона.
          </p>

          <div className="mt-6 inline-flex rounded-full border border-border bg-background/60 p-0.5 backdrop-blur">
            <SegButton active={tab === 'create'} onClick={() => setTab('create')}>
              <Sparkles size={14} /> Создать
            </SegButton>
            <SegButton active={tab === 'join'} onClick={() => setTab('join')}>
              <KeyRound size={14} /> По коду
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
                    placeholder="Название (необязательно)"
                    onKeyDown={(e) => e.key === 'Enter' && void onCreate()}
                  />
                  <Button onClick={() => void onCreate()} disabled={createMut.isPending}>
                    {createMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    Создать
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
                    placeholder="Код комнаты, напр. K7QX2H"
                    maxLength={12}
                    onKeyDown={(e) => e.key === 'Enter' && void onJoin()}
                  />
                  <Button onClick={() => void onJoin()} disabled={joinMut.isPending || !code.trim()}>
                    {joinMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                    Войти
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
            {(createMut.error || joinMut.error) && (
              <p className="text-xs text-destructive">
                {String((createMut.error ?? joinMut.error) as Error)?.toString().replace('Error: ', '')}
              </p>
            )}
          </div>
        </div>
      </motion.section>

      <section className="mt-10">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
          <Users size={14} /> Мои комнаты
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
              >
                <Link
                  to={`/rooms/${r.id}`}
                  className="group flex h-full flex-col justify-between rounded-[var(--radius-md)] border border-border bg-card p-4 transition-colors hover:border-[var(--color-border-strong)]"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{r.name}</span>
                      {r.isHost && (
                        <span className="rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-accent)]">
                          Хост
                        </span>
                      )}
                    </div>
                    <div className="mt-2 font-mono text-xs text-muted-foreground">
                      Код · {r.code}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-end text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                    Открыть <ArrowRight size={12} className="ml-1" />
                  </div>
                </Link>
              </motion.li>
            ))}
          </motion.ul>
        ) : (
          <div className="rounded-[var(--radius-md)] border border-dashed border-border bg-card/40 px-6 py-10 text-center text-sm text-muted-foreground">
            Пока нет ни одной комнаты. Создай новую или войди по коду от друга.
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
