package tidal

import (
	"regexp"
	"strings"
)

// matchNoiseRe strips feat-credits, bracketed qualifiers and
// punctuation so two spellings of the same recording compare equal.
// Shared by the likes-import matcher and the recording-level dedupe.
var matchNoiseRe = regexp.MustCompile(`\((?:feat|ft|with|prod)[^)]*\)|\[[^\]]*\]|[^\p{L}\p{N} ]+`)

// NormalizeForMatch lowercases, strips feat-credits / bracketed
// qualifiers / punctuation and collapses whitespace, so «Трек (feat. X)»
// and "трек" compare equal. Works for Cyrillic and Latin alike.
func NormalizeForMatch(s string) string {
	s = strings.ToLower(s)
	s = matchNoiseRe.ReplaceAllString(s, " ")
	return strings.Join(strings.Fields(s), " ")
}

// RecordingKey identifies the underlying *recording* behind a track,
// not the catalogue row. Tidal carries the same recording under
// multiple ids (album re-issues, deluxe editions, region variants —
// e.g. "XO Tour Llif3" exists as 81198969 AND 225824679), which is why
// id-keyed dedupe still shows the user "повторы" in waves and recs.
//
// Key precedence:
//  1. non-tidal sources (uploads / overrides) — unique by source:id;
//  2. ISRC — the recording's own identifier, exact;
//  3. normalised artist + title — catches twin editions when the
//     payload omits isrc;
//  4. raw id — last resort when metadata is empty.
func RecordingKey(t Track) string {
	if t.Source != "" && t.Source != "tidal" {
		return t.Source + ":" + t.ID
	}
	if t.ISRC != "" {
		return "isrc:" + strings.ToLower(t.ISRC)
	}
	artist := NormalizeForMatch(t.Artist)
	title := NormalizeForMatch(t.Title)
	if artist == "" || title == "" {
		return "id:" + t.ID
	}
	return "meta:" + artist + "|" + title
}

// qualityRank orders Tidal audio qualities for "keep the best edition"
// decisions. Unknown / empty ranks lowest.
func qualityRank(q string) int {
	switch strings.ToUpper(q) {
	case "HI_RES_LOSSLESS":
		return 4
	case "HI_RES":
		return 3
	case "LOSSLESS":
		return 2
	case "HIGH":
		return 1
	default:
		return 0
	}
}

// DedupeTracksByRecording collapses duplicate editions of the same
// recording while preserving the list's ranking: the first occurrence
// keeps its position, but if a later duplicate carries better audio
// quality (LOSSLESS twin of a LOW re-issue) it replaces the kept item
// in place. Explicit wins as a tie-break at equal quality.
func DedupeTracksByRecording(in []Track) []Track {
	out := make([]Track, 0, len(in))
	pos := make(map[string]int, len(in))
	for _, t := range in {
		k := RecordingKey(t)
		if i, ok := pos[k]; ok {
			kept := out[i]
			if qualityRank(t.Quality) > qualityRank(kept.Quality) ||
				(qualityRank(t.Quality) == qualityRank(kept.Quality) && t.Explicit && !kept.Explicit) {
				out[i] = t
			}
			continue
		}
		pos[k] = len(out)
		out = append(out, t)
	}
	return out
}
