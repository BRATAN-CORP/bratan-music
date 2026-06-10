package routes

import (
	"context"
	"testing"

	"github.com/bratan-corp/bratan-music/api-go/internal/tidal"
)

func mkRaw(id int64, title, artist string, dur int, isrc string) tidal.TrackRaw {
	return tidal.TrackRaw{
		ID: id, Title: title, Duration: dur, ISRC: isrc,
		Artists: []tidal.ArtistMin{{ID: 1, Name: artist}},
	}
}

func TestNormalizeForMatch(t *testing.T) {
	cases := map[string]string{
		"Трек (feat. Кто-то)":    "трек",
		"Song [Remastered 2011]": "song",
		"Hello, World!":          "hello world",
		"  Двойные   пробелы  ":  "двойные пробелы",
	}
	for in, want := range cases {
		if got := normalizeForMatch(in); got != want {
			t.Errorf("normalizeForMatch(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMatchImportRowISRC(t *testing.T) {
	search := func(_ context.Context, q string, _ int) ([]tidal.TrackRaw, error) {
		if q == "RUA1D2400001" {
			return []tidal.TrackRaw{
				mkRaw(7, "Совсем другое название", "Другой артист", 200, "RUA1D2400001"),
			}, nil
		}
		return nil, nil
	}
	m, err := matchImportRow(context.Background(), search, importRow{
		Title: "Трек", Artist: "Артист", ISRC: "rua1d2400001",
	})
	if err != nil || m == nil || m.ID != "7" {
		t.Fatalf("ISRC match failed: m=%v err=%v", m, err)
	}
}

func TestMatchImportRowMetadata(t *testing.T) {
	search := func(_ context.Context, _ string, _ int) ([]tidal.TrackRaw, error) {
		return []tidal.TrackRaw{
			mkRaw(1, "Трек (Karaoke Version)", "Karaoke Band", 181, ""),
			mkRaw(2, "Трек", "Артист", 240, ""), // длительность сильно мимо
			mkRaw(3, "Трек", "Артист", 182, ""), // точное совпадение
		}, nil
	}
	m, err := matchImportRow(context.Background(), search, importRow{
		Title: "Трек", Artist: "Артист", Duration: 181,
	})
	if err != nil || m == nil || m.ID != "3" {
		t.Fatalf("metadata match failed: m=%v err=%v", m, err)
	}
}

func TestMatchImportRowNotFound(t *testing.T) {
	search := func(_ context.Context, _ string, _ int) ([]tidal.TrackRaw, error) {
		return []tidal.TrackRaw{
			mkRaw(1, "Совсем не то", "И не тот", 181, ""),
		}, nil
	}
	m, err := matchImportRow(context.Background(), search, importRow{
		Title: "Трек", Artist: "Артист",
	})
	if err != nil || m != nil {
		t.Fatalf("want not-found, got m=%v err=%v", m, err)
	}
}

func TestScoreRejectsWrongArtist(t *testing.T) {
	cand := mkRaw(1, "Трек", "Кавер-группа", 181, "")
	if s := scoreImportCandidate(importRow{Title: "Трек", Artist: "Артист"}, &cand); s != 0 {
		t.Fatalf("wrong artist must score 0, got %d", s)
	}
}
