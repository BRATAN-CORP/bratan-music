import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Send, MessageSquare, AlertCircle } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useRoomChat, type UiRoomMessage } from '@/hooks/useRoomChat';
import { useAuthStore } from '@/store/auth';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { useT } from '@/i18n';

type Translate = ReturnType<typeof useT>;

const MAX_LEN = 1000;

interface RoomChatProps {
  roomId: string;
}

/**
 * Polling-based chat panel that lives inside the room page. Mirrors
 * the visual language of the existing room body (rounded card on
 * `bg-card/60`, dashed-border meta strips). Transport is handled by
 * `useRoomChat` — this component just renders the rolling list and
 * the composer.
 *
 * UX notes:
 *   - Avatars are circular (`rounded-full`) and slightly larger than
 *     in the previous iteration to read clearly at message density.
 *   - Each row mounts with a spring entrance (motion.dev) so new
 *     messages drift in instead of popping in. The optimistic row
 *     gets a stable `clientKey` from `useRoomChat`, so when the
 *     server echo lands and we replace `id` with the real one the
 *     row keeps its key — no exit-then-enter, no second pop.
 *   - The composer is **not disabled while sending** — the optimistic
 *     row appears in the list instantly and the input clears, so the
 *     user can immediately type the next message. The send button
 *     is intentionally always rendered with the same icon, so there
 *     is no in-flight spinner to flash and feel laggy.
 */
export function RoomChat({ roomId }: RoomChatProps) {
  const t = useT();
  const me = useAuthStore((s) => s.user);
  const { messages, send, error } = useRoomChat(roomId);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState('');
  const reduceMotion = useReducedMotion();

  // Auto-scroll to the bottom when new messages arrive — but only if
  // the user was already pinned to the bottom. If they scrolled up to
  // read history we don't yank them away.
  const wasAtBottomRef = useRef(true);
  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    if (wasAtBottomRef.current) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const node = listRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    wasAtBottomRef.current = distance < 32;
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    // Clear input synchronously *before* awaiting send — the
    // optimistic row is already in the list, so the user gets
    // instant feedback and can keep typing without waiting for the
    // server round-trip.
    setText('');
    wasAtBottomRef.current = true;
    void send(value);
  };

  return (
    <section className="rounded-[var(--radius-md)] border border-border bg-card/60 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
        <MessageSquare size={14} /> {t('rooms.chat.title')}
      </div>

      <div
        ref={listRef}
        onScroll={onScroll}
        className="flex h-72 flex-col gap-3 overflow-y-auto pr-1"
      >
        {messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center text-xs text-muted-foreground">
            {t('rooms.chat.empty')}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <ChatRow
                key={m.clientKey ?? `srv-${m.id}`}
                message={m}
                mine={m.userId === me?.id}
                reduceMotion={!!reduceMotion}
                t={t}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
          placeholder={t('rooms.chat.placeholder')}
          className="h-9 flex-1 rounded-[var(--radius-sm)] border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-[var(--color-accent)]"
          maxLength={MAX_LEN}
          autoComplete="off"
        />
        <motion.button
          type="submit"
          disabled={!text.trim()}
          aria-label={t('rooms.chat.send')}
          whileTap={reduceMotion ? undefined : { scale: 0.92 }}
          whileHover={reduceMotion ? undefined : { scale: 1.04 }}
          transition={{ type: 'spring', stiffness: 520, damping: 28 }}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white shadow-sm transition-opacity disabled:opacity-50"
        >
          <Send size={14} />
        </motion.button>
      </form>

      {error && (
        <p className="mt-2 text-xs text-red-400">{error}</p>
      )}
    </section>
  );
}

interface ChatRowProps {
  message: UiRoomMessage;
  mine: boolean;
  reduceMotion: boolean;
  t: Translate;
}

function ChatRow({ message, mine, reduceMotion, t }: ChatRowProps) {
  const display = message.name?.trim() || message.username?.trim() || t('rooms.chat.guest');
  const bubbleTone = mine
    ? 'bg-[var(--color-accent)]/15 text-foreground'
    : 'bg-secondary text-foreground';
  const failed = !!message.failed;

  return (
    <motion.div
      layout
      initial={
        reduceMotion
          ? { opacity: 0 }
          : { opacity: 0, y: 12, scale: 0.96 }
      }
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 520, damping: 32, mass: 0.6 }}
      className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}
    >
      <UserAvatar
        className="h-8 w-8 shrink-0 rounded-full"
        initialsClassName="text-[11px]"
        name={message.name}
        username={message.username}
        id={message.userId}
      />
      <div className={`flex max-w-[75%] flex-col gap-1 ${mine ? 'items-end' : ''}`}>
        <div className={`flex items-baseline gap-2 text-[11px] ${mine ? 'flex-row-reverse' : ''}`}>
          <span className="font-medium text-foreground/80">{display}</span>
          <span className="text-muted-foreground">{formatTime(message.createdAtMs)}</span>
          {failed && (
            <span className="inline-flex items-center gap-1 text-red-400">
              <AlertCircle size={11} /> {t('rooms.chat.failed')}
            </span>
          )}
        </div>
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-sm leading-snug ${bubbleTone} ${
            failed ? 'border border-red-400/40' : ''
          }`}
        >
          {message.body}
        </div>
      </div>
    </motion.div>
  );
}

function formatTime(ms: number): string {
  try {
    const d = new Date(ms);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
