/**
 * Shared helpers for visually-rich fallback art when no real avatar /
 * cover URL is available. The previous behaviour was to drop a generic
 * lucide icon (User / Music / Disc3) onto a flat secondary background
 * — which read as "broken" instead of "stylised placeholder", and
 * looked inconsistent across surfaces (different icons in different
 * places for the same missing-art case).
 *
 * Two pieces:
 *   - `nameInitials`: takes a human name (artist, track title, album
 *     name) and returns 1–2 uppercase letters suitable for a tile.
 *   - `fallbackHue`: hashes the input to a stable hue in 0–359 so the
 *     same name always renders the same colour. Lets a long list of
 *     fallback tiles read as a colourful grid instead of a wall of
 *     identical grey rectangles.
 */

export function nameInitials(name: string): string {
  const cleaned = name.replace(/[\u2018\u2019\u201C\u201D"'`]/g, '').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const [first, second] = words;
  if (!first) return '?';
  if (!second) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? '') + (second[0] ?? '')).toUpperCase();
}

export function fallbackHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

/**
 * CSS gradient string ready to drop onto a `style.background`. The
 * geometry is identical to the one in ArtistCard so artist-shape and
 * track-shape tiles feel like the same family.
 */
export function fallbackGradient(seed: string): string {
  const h = fallbackHue(seed);
  return `radial-gradient(120% 120% at 30% 25%, hsl(${h} 65% 45% / 0.95), hsl(${(h + 40) % 360} 55% 22%))`;
}
