import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Radio } from 'lucide-react';
import { useRoomConnectionStore } from '@/store/roomConnection';
import { EASE_SPRING } from '@/lib/motion';

/**
 * Floating "you're connected to a room" pill. Mounted once at the
 * layout level so the indicator persists while the user navigates
 * around the app — it disappears only when the user leaves the room
 * (via Выйти / Удалить on the room page) or refreshes the tab.
 *
 * On the room page itself we hide it: there's already a giant header
 * with the same info, the badge would just be visual noise.
 */
export function RoomConnectedBadge() {
  const reduce = useReducedMotion();
  const { roomId, roomCode, roomName } = useRoomConnectionStore();
  const location = useLocation();

  const onRoomPage = !!roomId && location.pathname.startsWith(`/rooms/${roomId}`);
  const visible = !!roomId && !onRoomPage;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={roomId}
          initial={reduce ? false : { opacity: 0, y: 12, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? undefined : { opacity: 0, y: 12, scale: 0.95 }}
          transition={{ duration: 0.35, ease: EASE_SPRING }}
          className="fixed left-4 z-40 sm:left-6"
          // Sit above the mobile mini-player + bottom dock without
          // covering them. Player is ~144px tall on mobile; 168px keeps
          // the badge clear of the dock+player stack.
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 168px)' }}
        >
          <Link
            to={`/rooms/${roomId}`}
            className="group inline-flex items-center gap-2 rounded-full border border-[var(--color-accent)]/40 bg-card px-3 py-1.5 text-xs shadow-[var(--shadow-md)] backdrop-blur transition-colors hover:border-[var(--color-accent)] hover:bg-card/80"
            title={`Ты в комнате · код ${roomCode ?? ''}`}
          >
            <span
              className="relative inline-flex h-2 w-2 items-center justify-center"
              aria-hidden
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-accent)] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-accent)]" />
            </span>
            <Radio size={12} className="text-[var(--color-accent)]" />
            <span className="font-medium text-foreground">
              В комнате
            </span>
            <span className="hidden max-w-[14ch] truncate text-muted-foreground sm:inline">
              · {roomName || roomCode || ''}
            </span>
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
