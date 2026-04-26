import { create } from 'zustand';

export type LikeAction = 'liked' | 'unliked';

export interface LikeBurst {
  id: number;
  x: number;
  y: number;
  action: LikeAction;
}

interface FeedbackState {
  bursts: LikeBurst[];
  toast: { id: number; action: LikeAction } | null;
  trigger: (e: React.MouseEvent | React.PointerEvent | { clientX: number; clientY: number } | null, action: LikeAction) => void;
  remove: (id: number) => void;
  clearToast: (id: number) => void;
}

let nextId = 1;

export const useFeedbackStore = create<FeedbackState>((set) => ({
  bursts: [],
  toast: null,
  trigger: (e, action) => {
    let x: number;
    let y: number;
    if (e && typeof e === 'object' && 'clientX' in e && typeof e.clientX === 'number') {
      x = e.clientX;
      y = e.clientY;
    } else {
      // Fallback: middle of viewport
      x = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
      y = typeof window !== 'undefined' ? window.innerHeight / 2 : 0;
    }
    const id = nextId++;
    set((s) => ({
      bursts: [...s.bursts, { id, x, y, action }],
      toast: { id, action },
    }));
  },
  remove: (id) =>
    set((s) => ({ bursts: s.bursts.filter((b) => b.id !== id) })),
  clearToast: (id) =>
    set((s) => (s.toast?.id === id ? { toast: null } : s)),
}));

export function triggerLikeBurst(
  e: React.MouseEvent | React.PointerEvent | null,
  action: LikeAction
) {
  useFeedbackStore.getState().trigger(e, action);
}
