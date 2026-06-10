/**
 * Parser for library exports from other music services (Soundiiz,
 * TuneMyMusic, MusConv, …). All of them produce a CSV with some flavour
 * of title/artist/album/ISRC/duration columns — we sniff the header
 * names instead of hardcoding one vendor's layout, so «выгрузка из
 * Яндекс.Музыки через TuneMyMusic» and a Soundiiz Spotify export both
 * land in the same normalized shape.
 */

export interface ImportTrackRow {
  title: string;
  artist: string;
  album?: string;
  isrc?: string;
  /** Seconds. */
  duration?: number;
}

const TITLE_KEYS = ['title', 'track name', 'track', 'song', 'name', 'название', 'трек', 'песня'];
const ARTIST_KEYS = ['artist', 'artist name', 'artists', 'artist(s)', 'исполнитель', 'артист'];
const ALBUM_KEYS = ['album', 'album name', 'альбом'];
const ISRC_KEYS = ['isrc'];
const DURATION_KEYS = ['duration (s)', 'duration_ms', 'duration ms', 'duration', 'time', 'length', 'длительность'];

/** RFC-4180-ish line splitter: quoted fields, `""` escapes. */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function findColumn(headers: string[], keys: string[]): number {
  for (const key of keys) {
    const idx = headers.indexOf(key);
    if (idx >= 0) return idx;
  }
  return -1;
}

/** "3:05" → 185; 185000 (ms) → 185; "185" → 185. */
function parseDuration(raw: string, headerName: string): number | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  if (v.includes(':')) {
    const parts = v.split(':').map((p) => Number(p));
    if (parts.some((n) => !Number.isFinite(n))) return undefined;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // Explicit ms column, or a value far too large to be seconds.
  if (headerName.includes('ms') || n > 30_000) return Math.round(n / 1000);
  return Math.round(n);
}

/**
 * Parse a service-export CSV into normalized rows. Throws (with an
 * i18n-friendly code in `message`) when the file has no recognizable
 * title/artist columns.
 */
export function parseImportCsv(text: string): ImportTrackRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
  if (lines.length < 2) throw new Error('empty');

  // Soundiiz uses `;`, most others `,` — pick whichever splits the
  // header into more recognizable columns.
  const headerLine = lines[0]!;
  const bySemi = splitCsvLine(headerLine, ';');
  const byComma = splitCsvLine(headerLine, ',');
  const sep = bySemi.length > byComma.length ? ';' : ',';
  const headers = (sep === ';' ? bySemi : byComma).map((h) => h.toLowerCase());

  const titleIdx = findColumn(headers, TITLE_KEYS);
  const artistIdx = findColumn(headers, ARTIST_KEYS);
  if (titleIdx < 0 || artistIdx < 0) throw new Error('no_columns');
  const albumIdx = findColumn(headers, ALBUM_KEYS);
  const isrcIdx = findColumn(headers, ISRC_KEYS);
  const durationIdx = findColumn(headers, DURATION_KEYS);
  const durationHeader = durationIdx >= 0 ? headers[durationIdx]! : '';

  const rows: ImportTrackRow[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!, sep);
    const title = cells[titleIdx] ?? '';
    const artist = cells[artistIdx] ?? '';
    if (!title) continue;
    // Dedupe repeated rows (same track in multiple exported playlists).
    const key = `${title.toLowerCase()}|${artist.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      title,
      artist,
      album: albumIdx >= 0 ? cells[albumIdx] || undefined : undefined,
      isrc: isrcIdx >= 0 ? cells[isrcIdx] || undefined : undefined,
      duration: durationIdx >= 0 ? parseDuration(cells[durationIdx] ?? '', durationHeader) : undefined,
    });
  }
  if (rows.length === 0) throw new Error('empty');
  return rows;
}
