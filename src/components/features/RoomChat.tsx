import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import { useRoomChat } from '@/hooks/useRoomChat';
import { useAuthStore } from '@/store/auth';
import { UserAvatar } from '@/components/ui/UserAvatar';
import type { RoomMessage } from '@/types/rooms';

const MAX_LEN = 1000;

interface RoomChatProps {
  roomId: string;
}

/**
 * Polling-based chat panel that lives inside the room page. Mirrors
 * the visual language of the existing room body (rounded card on
 * `bg-card/60`, dashed-border meta strips). The actual transport is
 * handled by `useRoomChat` — here we just render the rolling list and
 * the composer.
 */
export function RoomChat({ roomId }: RoomChatProps) {
  const me = useAuthStore((s) => s.user);
  const { messages, send, sending, error } = useRoomChat(roomId);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState('');

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

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText('');
    wasAtBottomRef.current = true;
    await send(value);
  };

  return (
    <section className="rounded-[var(--radius-md)] border border-border bg-card/60 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
        <MessageSquare size={14} /> Чат комнаты
      </div>

      <div
        ref={listRef}
        onScroll={onScroll}
        className="flex h-72 flex-col gap-3 overflow-y-auto pr-1"
      >
        {messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center text-xs text-muted-foreground">
            Пока тишина. Напиши что-нибудь — все увидят.
          </div>
        ) : (
          messages.map((m) => (
            <ChatRow key={m.id} message={m} mine={m.userId === me?.id} />
          ))
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
          placeholder="Сообщение"
          className="h-9 flex-1 rounded-[var(--radius-sm)] border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-[var(--color-accent)]"
          maxLength={MAX_LEN}
          disabled={sending}
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          aria-label="Отправить"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white transition-opacity disabled:opacity-50"
        >
          <Send size={14} />
        </button>
      </form>

      {error && (
        <p className="mt-2 text-xs text-red-400">{error}</p>
      )}
    </section>
  );
}

function ChatRow({ message, mine }: { message: RoomMessage; mine: boolean }) {
  const display = message.name?.trim() || message.username?.trim() || 'Гость';
  return (
    <div className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
      <UserAvatar
        className="h-7 w-7 shrink-0"
        initialsClassName="text-[10px]"
        name={message.name}
        username={message.username}
        id={message.userId}
      />
      <div className={`flex max-w-[75%] flex-col gap-1 ${mine ? 'items-end' : ''}`}>
        <div className={`flex items-baseline gap-2 text-[11px] ${mine ? 'flex-row-reverse' : ''}`}>
          <span className="font-medium text-foreground/80">{display}</span>
          <span className="text-muted-foreground">{formatTime(message.createdAtMs)}</span>
        </div>
        <div
          className={`whitespace-pre-wrap break-words rounded-[var(--radius-sm)] px-3 py-1.5 text-sm leading-snug ${
            mine
              ? 'bg-[var(--color-accent)]/15 text-foreground'
              : 'bg-secondary text-foreground'
          }`}
        >
          {message.body}
        </div>
      </div>
    </div>
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
