package tidal

import "testing"

func TestNormalizeForMatch(t *testing.T) {
	cases := map[string]string{
		"XO Tour Llif3":          "xo tour llif3",
		"Трек (feat. Кто-то)":    "трек",
		"Song [Remastered 2011]": "song",
		"Hello, World!":          "hello world",
		"  double   spaces  ":    "double spaces",
		"Track (Remix)":          "track remix", // version qualifiers stay — a remix is a different recording
	}
	for in, want := range cases {
		if got := NormalizeForMatch(in); got != want {
			t.Errorf("NormalizeForMatch(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRecordingKey(t *testing.T) {
	isrcA := Track{ID: "81198969", Source: "tidal", Title: "XO Tour Llif3", Artist: "Lil Uzi Vert", ISRC: "QM24S1700101"}
	isrcB := Track{ID: "225824679", Source: "tidal", Title: "XO Tour Llif3", Artist: "Lil Uzi Vert", ISRC: "qm24s1700101"}
	if RecordingKey(isrcA) != RecordingKey(isrcB) {
		t.Error("ISRC twins must share a recording key (case-insensitive)")
	}

	metaA := Track{ID: "1", Source: "tidal", Title: "XO Tour Llif3", Artist: "Lil Uzi Vert"}
	metaB := Track{ID: "2", Source: "tidal", Title: "XO Tour Llif3 (feat. Nobody)", Artist: "Lil Uzi Vert"}
	if RecordingKey(metaA) != RecordingKey(metaB) {
		t.Error("metadata twins must share a recording key")
	}

	upload := Track{ID: "1", Source: "upload", Title: "XO Tour Llif3", Artist: "Lil Uzi Vert"}
	if RecordingKey(upload) == RecordingKey(metaA) {
		t.Error("uploads must never collapse into tidal twins")
	}

	empty := Track{ID: "42", Source: "tidal"}
	if RecordingKey(empty) != "id:42" {
		t.Errorf("empty metadata must fall back to the raw id, got %q", RecordingKey(empty))
	}
}

func TestDedupeTracksByRecording(t *testing.T) {
	lossless := Track{ID: "81198969", Source: "tidal", Title: "XO Tour Llif3", Artist: "Lil Uzi Vert", Quality: "LOSSLESS"}
	low := Track{ID: "225824679", Source: "tidal", Title: "XO Tour Llif3", Artist: "Lil Uzi Vert", Quality: "LOW"}
	other := Track{ID: "3", Source: "tidal", Title: "Other Song", Artist: "Lil Uzi Vert", Quality: "LOSSLESS"}

	// Twin later in the list with WORSE quality → dropped, first kept.
	out := DedupeTracksByRecording([]Track{lossless, other, low})
	if len(out) != 2 {
		t.Fatalf("want 2 tracks, got %d", len(out))
	}
	if out[0].ID != "81198969" || out[1].ID != "3" {
		t.Errorf("unexpected order/ids: %q, %q", out[0].ID, out[1].ID)
	}

	// Twin later in the list with BETTER quality → replaces in place.
	out = DedupeTracksByRecording([]Track{low, other, lossless})
	if len(out) != 2 {
		t.Fatalf("want 2 tracks, got %d", len(out))
	}
	if out[0].ID != "81198969" {
		t.Errorf("better-quality twin must replace the kept item in place, got %q", out[0].ID)
	}
	if out[1].ID != "3" {
		t.Errorf("non-duplicate must keep its position, got %q", out[1].ID)
	}

	// Equal quality → explicit edition wins as tie-break.
	clean := Track{ID: "10", Source: "tidal", Title: "Song", Artist: "A", Quality: "LOSSLESS"}
	explicit := Track{ID: "11", Source: "tidal", Title: "Song", Artist: "A", Quality: "LOSSLESS", Explicit: true}
	out = DedupeTracksByRecording([]Track{clean, explicit})
	if len(out) != 1 || out[0].ID != "11" {
		t.Errorf("explicit twin must win at equal quality, got %+v", out)
	}

	// Same id listed twice (the legacy case) still collapses.
	out = DedupeTracksByRecording([]Track{lossless, lossless})
	if len(out) != 1 {
		t.Errorf("identical ids must collapse, got %d", len(out))
	}
}
