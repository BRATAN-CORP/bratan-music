package routes

import (
	"net/http/httptest"
	"testing"
)

// The audio proxy is unauthenticated, so the host allowlist is the only
// thing standing between it and being an open SSRF relay. Lock the
// matcher behaviour down with a table test.
func TestAudioHostAllowlist(t *testing.T) {
	cases := []struct {
		host string
		want bool
	}{
		{"amz-pr-fa.audio.tidal.com", true},
		{"sp-ad-fa.audio.tidal.com", true},
		{"fa-v1.tidal.com", true},
		{"fa-v42.tidal.com", true},
		{"resources.tidal.com", true},
		{"AUDIO.TIDAL.COM", true}, // case-insensitive
		// Must reject anything that isn't a Tidal CDN host.
		{"evil.com", false},
		{"audio.tidal.com.evil.com", false},
		{"tidal.com", false},                 // bare apex isn't a stream host
		{"notaudio.tidal.com", true},         // matches (.+\.)?audio.tidal.com via "notaudio." ? -> see note
		{"169.254.169.254", false},           // cloud metadata SSRF target
		{"internal.audio.tidal.com.evil", false},
	}
	for _, c := range cases {
		got := false
		for _, re := range audioHostsAllowed {
			if re.MatchString(c.host) {
				got = true
				break
			}
		}
		// "notaudio.tidal.com": "notaudio." is the (.+\.) group + "audio.tidal.com"
		// would require the literal "audio.tidal.com" suffix, which "notaudio.tidal.com"
		// does NOT have (it's notaudio.tidal.com, suffix "tidal.com"). So expect false.
		if c.host == "notaudio.tidal.com" {
			c.want = false
		}
		if got != c.want {
			t.Errorf("host %q: allowed=%v want %v", c.host, got, c.want)
		}
	}
}

func TestProxiedAudioURL(t *testing.T) {
	r := httptest.NewRequest("GET", "https://bratan-music.eu.cc/tracks/123/stream", nil)
	r.Host = "bratan-music.eu.cc"
	r.Header.Set("X-Forwarded-Proto", "https")
	cdn := "https://amz-pr-fa.audio.tidal.com/abc?token=xyz&exp=1"
	got := proxiedAudioURL(r, cdn)
	want := "https://bratan-music.eu.cc/tracks/audio?url=https%3A%2F%2Famz-pr-fa.audio.tidal.com%2Fabc%3Ftoken%3Dxyz%26exp%3D1"
	if got != want {
		t.Errorf("proxiedAudioURL\n got=%s\nwant=%s", got, want)
	}
}
