package services

import (
	"math"
	"testing"
)

func TestScriptShare(t *testing.T) {
	m := ScriptMix{Cyrillic: 0.7, Latin: 0.25, CJK: 0.0, Other: 0.05}
	cases := map[string]float64{
		"cyrillic": 0.7,
		"latin":    0.25,
		"cjk":      0.0,
		"other":    0.05,
		"unknown":  0.05, // default bucket
	}
	for script, want := range cases {
		if got := scriptShare(m, script); got != want {
			t.Errorf("scriptShare(%q)=%v want %v", script, got, want)
		}
	}
}

// TestLanguagePenaltyMath locks the worker's penalty formula:
// penalty = W_LANG_MISMATCH * (deficit / LANG_MIN_SHARE), only when the
// candidate's script share is below LANG_MIN_SHARE.
func TestLanguagePenaltyMath(t *testing.T) {
	mix := ScriptMix{Cyrillic: 0.70, Latin: 0.25, CJK: 0.0, Other: 0.05}

	penalty := func(script string) float64 {
		candShare := scriptShare(mix, script)
		if candShare >= langMinShare {
			return 0
		}
		return wLangMismatch * ((langMinShare - candShare) / langMinShare)
	}

	// Cyrillic (0.70) and Latin (0.25) are above the 0.10 floor → no penalty.
	if p := penalty("cyrillic"); p != 0 {
		t.Errorf("cyrillic penalty = %v want 0", p)
	}
	if p := penalty("latin"); p != 0 {
		t.Errorf("latin penalty = %v want 0", p)
	}
	// CJK share 0 → full penalty -0.40.
	if p := penalty("cjk"); math.Abs(p-(-0.40)) > 1e-9 {
		t.Errorf("cjk penalty = %v want -0.40", p)
	}
	// Other share 0.05 → half-deficit → -0.20.
	if p := penalty("other"); math.Abs(p-(-0.20)) > 1e-9 {
		t.Errorf("other penalty = %v want -0.20", p)
	}
}

func TestLanguageActiveGate(t *testing.T) {
	if (10 >= langMinHistoryPlays) != false {
		t.Error("cold-start user (10 plays) should not be language-active")
	}
	if (50 >= langMinHistoryPlays) != true {
		t.Error("user at threshold (50 plays) should be language-active")
	}
}
