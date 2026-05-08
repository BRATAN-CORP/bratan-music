import { motion, useReducedMotion } from 'motion/react';

interface BrandLogoProps {
  /** Pixel size of the rendered SVG. Defaults to 64. */
  size?: number;
  /** Disable animation regardless of `prefers-reduced-motion`. Used by
   *  the static favicon-driven splash boot SVG that lives in
   *  `index.html` and renders before React mounts. */
  static?: boolean;
  /** When true, the brand mark pulses (used by the loader to signal
   *  an indeterminate "we're working" state). When false the logo
   *  just sits there at rest — used as a brand mark in empty states
   *  / dialogs. */
  pulse?: boolean;
  className?: string;
}

/**
 * Mirrors `public/favicon.svg` byte-for-byte — same accent square,
 * same white "B" glyph (the user's canonical brand mark) — but with
 * an optional motion pulse that the page-loader and cold-start
 * splash screen attach to.
 *
 * Keeping the geometry in lock-step with the favicon is intentional:
 * the user's brief is "удали все другие вариации, используй строго
 * акцентный цвет как фон. лого белый должен быть." — there is one
 * canonical mark and every in-app surface (loader, splash, empty
 * states) must mirror it exactly. The favicon and the BrandLogo
 * component therefore carry identical path data; touching one
 * without touching the other re-introduces the "multiple
 * variations" problem the brief explicitly forbids.
 */
export function BrandLogo({
  size = 64,
  static: isStatic = false,
  pulse = false,
  className = '',
}: BrandLogoProps) {
  const reduce = useReducedMotion();
  const animate = !isStatic && pulse && !reduce;

  // Path data lifted straight from the user's "logo (with borders)"
  // SVG (viewBox 0 0 3000 3000). The designer baked the visual
  // padding into the source; using the with-borders variant means we
  // get correct centering for free without re-computing transforms.
  const outerPath =
    'M2110.9,1507.6c-22.1-15.5-89.8-39.2-59.7-71.4,522.2-314.3,261.7-999-310-1027.2l-1050.5,2.5c-28.3,8.7-50.9,34.6-52.7,65l1.8,2031.3c16.2,62.8,93.5-34.2,108.5-54.4,37.4-50.5,60.9-110.6,69.5-173l.3-1589.2c3.8-47.8,30.2-87.8,78.9-97.7,294.9.5,590.7-5.6,885.1,3.1,372.1,65.7,498.3,479.6,171.6,710.7-13.6,9.6-81.3,47.3-84.4,54.1-1.4,2.9-2.1,5.3-2.1,8.6,0,6.9,24.7,44.8,29.7,57.2,14.6,35.9,19.4,73.6,15.6,112.5-1.3,13.3-13.5,40.6-8.8,50.2,62.2,34,121.7,68.2,169.9,121.2,146.9,161.4,138.4,401.6-13.4,556.4-79.1,80.6-202.4,136.8-315.5,143.4-221.7,12.9-457.5-13.5-679.1-.3-78.9,4.7-168.1,39.4-228.3,90.3-21.7,18.4-75.3,64.1-36.7,88.4,0,0,964.8,1.7,964.8,1.7,555.5-33.4,831.7-741.3,345.5-1083.4Z';
  const innerPath =
    'M1183.8,2061.1c1.5-.6,3-1.3,4.3-2.3,0,0,617.4-409.2,617.4-409.2,85.6-70.5,83.6-202.9-3.1-271.5-4.4-3-592.6-373.1-597.3-375.7-63-31.8-143.9-26.5-195.3,24.4-27.4,27.4-44.5,64.6-49.7,103,0,0,.4,796.1.4,796.1,11.5,111.5,119,175.3,223.3,135.2ZM1080.2,1150.9c2.1-22.1,23-37.6,45-37.5,7.3,0,15.2,2.6,21.9,5.7,3.4,1.2,566.5,353,570.4,354.7,27.3,18.2,29.9,60.4,7.1,83.1-2.2,2.9-564.3,374.7-567.4,377.4-33.2,25-74,7.6-79.2-32.9-.5-3.7,2.4-746,2.2-750.5Z';

  // Plate radius matches the favicon (rx ≈ 22% of the side, the same
  // iOS-app icon proportion). 657 / 3000 == 14 / 64.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 3000 3000"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      {animate ? (
        <motion.rect
          width={3000}
          height={3000}
          rx={657}
          fill="#5E6AD2"
          initial={{ scale: 0.94 }}
          animate={{ scale: [0.94, 1, 0.94] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          style={{ originX: 0.5, originY: 0.5, transformBox: 'fill-box' }}
        />
      ) : (
        <rect width={3000} height={3000} rx={657} fill="#5E6AD2" />
      )}
      {animate ? (
        <>
          <motion.path
            d={outerPath}
            fill="#ffffff"
            initial={{ opacity: 0.85 }}
            animate={{ opacity: [0.85, 1, 0.85] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.path
            d={innerPath}
            fill="#ffffff"
            initial={{ opacity: 0.85 }}
            animate={{ opacity: [0.85, 1, 0.85] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        </>
      ) : (
        <>
          <path d={outerPath} fill="#ffffff" />
          <path d={innerPath} fill="#ffffff" />
        </>
      )}
    </svg>
  );
}
