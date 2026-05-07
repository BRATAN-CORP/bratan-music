import { motion, useReducedMotion } from 'motion/react';

interface BrandLogoProps {
  /** Pixel size of the rendered SVG. Defaults to 64. */
  size?: number;
  /** Disable animation regardless of `prefers-reduced-motion`. Used by
   *  the static favicon-driven splash boot SVG that lives in
   *  `index.html` and renders before React mounts. */
  static?: boolean;
  /** When true, the play-triangle pulses (used by the loader to
   *  signal an indeterminate "we're working" state). When false
   *  the logo just sits there at rest — used as a brand mark in
   *  empty states / dialogs. */
  pulse?: boolean;
  className?: string;
}

/**
 * Mirrors `public/favicon.svg` byte-for-byte — same rounded square,
 * same play triangle, same wordmark — but with an optional motion
 * pulse that the page-loader and cold-start splash screen attach to.
 *
 * Keeping the geometry in lock-step with the favicon is intentional:
 * the user's PRD calls out that swapping the favicon should also
 * swap the loader / splash logo. Both surfaces reference this single
 * component, so editing the favicon and editing this file is the
 * one-stop "rebrand" path.
 */
export function BrandLogo({
  size = 64,
  static: isStatic = false,
  pulse = false,
  className = '',
}: BrandLogoProps) {
  const reduce = useReducedMotion();
  const animate = !isStatic && pulse && !reduce;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden
    >
      <defs>
        {/* Subtle inner gradient on the green tile — gives the brand
            mark a modicum of depth even at favicon resolutions. The
            stops use the BRATAN green family so the logo reads as
            the same palette across the favicon, splash and loader. */}
        <linearGradient id="brand-logo-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1ed95f" />
          <stop offset="100%" stopColor="#179645" />
        </linearGradient>
      </defs>
      {animate ? (
        <motion.rect
          width={64}
          height={64}
          rx={14}
          fill="url(#brand-logo-fill)"
          initial={{ scale: 0.94 }}
          animate={{ scale: [0.94, 1, 0.94] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          style={{ originX: 0.5, originY: 0.5, transformBox: 'fill-box' }}
        />
      ) : (
        <rect width={64} height={64} rx={14} fill="url(#brand-logo-fill)" />
      )}
      {animate ? (
        <motion.path
          d="M22 19.5c0-1.1.9-2 2-2 .35 0 .69.09.99.27l16 9.5c1.34.79 1.34 2.67 0 3.46l-16 9.5c-.3.18-.64.27-.99.27-1.1 0-2-.9-2-2v-19z"
          fill="#0f0f0f"
          initial={{ opacity: 0.7 }}
          animate={{ opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : (
        <path
          d="M22 19.5c0-1.1.9-2 2-2 .35 0 .69.09.99.27l16 9.5c1.34.79 1.34 2.67 0 3.46l-16 9.5c-.3.18-.64.27-.99.27-1.1 0-2-.9-2-2v-19z"
          fill="#0f0f0f"
        />
      )}
      <text
        x={32}
        y={56}
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize={9}
        fontWeight={700}
        fill="#0f0f0f"
        letterSpacing={0.5}
      >
        BRATAN
      </text>
    </svg>
  );
}
