export const EASE_SPRING = [0.16, 1, 0.3, 1] as const;
export const EASE_EMPH = [0.32, 0.72, 0, 1] as const;

export const staggerItem = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE_SPRING } },
} as const;
