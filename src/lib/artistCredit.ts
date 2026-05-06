import type { ArtistRef } from '@/types';

/**
 * Match every separator that visually splits a multi-credit string.
 * Includes the obvious ", " plus the long tail of upstream variants
 * we've seen on Tidal: "&", " / ", " feat.", " ft.", " vs.", " x ",
 * " · ", " — ". The regex is intentionally case-insensitive and
 * permissive — we'd rather mark a borderline single-artist name like
 * "Tyler, The Creator" as multi-credit and render it as plain text
 * than wrap the whole string in ONE link to a wrong-artist page.
 *
 * The negative-lookbehind on " - " is omitted — matching " - " in a
 * track-credit string is rare enough that the noise it'd cause on
 * single-artist names like "Beyoncé - I Care" outweighs the benefit.
 *
 * Lives outside `ArtistLinks.tsx` so non-component callers (the
 * mini-player, fullscreen, mobile dock) can import the predicates
 * without tripping the `react-refresh/only-export-components` lint.
 */
export const CREDIT_SEPARATOR_RE = /(\s*,\s*|\s*;\s*|\s*&\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s+vs\.?\s+|\s+\/\s+|\s+x\s+|\s+·\s+|\s+—\s+)/i;

/**
 * Does this single string look like it lists more than one
 * contributor? Tidal sometimes underreports collaborators on `search`
 * rows so the joined `artist` field is the only signal that a credit
 * is actually multi-credit.
 */
export function looksMultiCreditName(name: string | undefined): boolean {
  if (typeof name !== 'string' || name.length === 0) return false;
  return CREDIT_SEPARATOR_RE.test(name);
}

/**
 * Player-surface predicate: render through `ArtistLinks` whenever
 * EITHER the structured contributor list has ≥2 entries OR the joined
 * display name itself contains separators that suggest multiple
 * credits. Returns `false` only for clean single-artist tracks where
 * one Marquee-wrapped link to the primary id is the right behaviour.
 *
 * The single-entry-with-multi-credit-name branch matters in practice:
 * Tidal `search` rows for tracks like "Daft Punk, Julian Casablancas"
 * occasionally come back with `artists: [{ name: 'Daft Punk' }]` only
 * but `artist: 'Daft Punk, Julian Casablancas'`. Without this
 * predicate, the player wraps the whole joined string in a single
 * `<button>` linking to Daft Punk's id — every visible name silently
 * resolves to the primary artist. Routing through `ArtistLinks` lets
 * its multi-credit fallback split the joined name into plain-text
 * chunks instead, so no name links to a wrong artist page.
 *
 * Caveat: a borderline case is a SINGLE artist whose stage name itself
 * contains a separator — "Tyler, the Creator", "Earth, Wind & Fire",
 * "Crosby, Stills, Nash & Young". Tidal returns these as
 * `artists: [{ name: 'Tyler, the Creator' }]` AND `artist: 'Tyler, the
 * Creator'`. We detect that by checking equality between the joined
 * string and the single entry's name — when they match exactly the
 * commas are part of the name, not credit separators, so we keep the
 * Marquee-wrapped single-link rendering and the user can still click
 * through to the artist's page.
 */
export function hasMultiCredit(
  artists: ArtistRef[] | null | undefined,
  joinedName: string | undefined,
): boolean {
  if (artists && artists.length > 1) return true;
  if (
    artists &&
    artists.length === 1 &&
    typeof joinedName === 'string' &&
    artists[0]?.name === joinedName
  ) {
    return false;
  }
  return looksMultiCreditName(joinedName);
}

/**
 * Visible chunk of a joined credit string — used when we need to
 * render every name with the upstream's exact separator preserved.
 */
export interface CreditChunk {
  text: string;
  /** Trailing separator (visible spacing/punctuation), empty for the last chunk. */
  sep: string;
}

/**
 * Split a joined credit string ("A, B feat. C") into renderable
 * chunks preserving the original separators so the visual rendering
 * matches what the upstream emitted (no normalisation / re-formatting).
 */
export function splitCredits(joined: string): CreditChunk[] {
  // Use a global match to preserve the matched separators alongside
  // the text fragments. `String.split` with a captured group does
  // exactly that: returns alternating [text, sep, text, sep, ...].
  const re = new RegExp(CREDIT_SEPARATOR_RE.source, 'gi');
  const parts = joined.split(re);
  const chunks: CreditChunk[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const text = (parts[i] ?? '').trim();
    if (!text) continue;
    const sep = (parts[i + 1] ?? '').trimStart();
    chunks.push({ text, sep: sep || '' });
  }
  return chunks;
}
