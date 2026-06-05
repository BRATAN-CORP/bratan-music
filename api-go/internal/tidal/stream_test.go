package tidal

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"sync"
	"testing"
	"time"
)

// fakeKV is an in-memory KV for exercising the discovery/quality cache
// without Redis. TTLs are recorded but not expired (tests don't need
// real expiry, only that the right TTL was chosen).
type fakeKV struct {
	mu   sync.Mutex
	data map[string]string
	ttls map[string]time.Duration
}

func newFakeKV() *fakeKV {
	return &fakeKV{data: map[string]string{}, ttls: map[string]time.Duration{}}
}

func (k *fakeKV) KVGet(_ context.Context, key string) (string, bool, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	v, ok := k.data[key]
	return v, ok, nil
}

func (k *fakeKV) KVSet(_ context.Context, key, value string, ttl time.Duration) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.data[key] = value
	k.ttls[key] = ttl
	return nil
}

func b64(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

func TestDecodeManifestBTS(t *testing.T) {
	payload := `{"urls":["https://amz-pr-fa.audio.tidal.com/x.flac"],"codecs":"flac","mimeType":"audio/flac","encryptionType":"NONE"}`
	m, err := decodeManifest(b64(payload), "application/vnd.tidal.bts")
	if err != nil {
		t.Fatalf("bts decode: %v", err)
	}
	if len(m.URLs) != 1 || m.URLs[0] != "https://amz-pr-fa.audio.tidal.com/x.flac" {
		t.Fatalf("bad urls: %#v", m.URLs)
	}
	if m.Codecs != "flac" {
		t.Fatalf("bad codec: %q", m.Codecs)
	}
}

func TestDecodeManifestDASHBaseURL(t *testing.T) {
	mpd := `<?xml version="1.0"?><MPD><Period><AdaptationSet><Representation codecs="mp4a.40.2">` +
		`<BaseURL>https://sp-ad-fa.audio.tidal.com/seg.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`
	m, err := decodeManifest(b64(mpd), "application/dash+xml")
	if err != nil {
		t.Fatalf("dash decode: %v", err)
	}
	if len(m.URLs) != 1 || m.URLs[0] != "https://sp-ad-fa.audio.tidal.com/seg.mp4" {
		t.Fatalf("bad dash urls: %#v", m.URLs)
	}
	if m.Codecs != "mp4a.40.2" || m.MimeType != "audio/mp4" {
		t.Fatalf("bad dash meta: codec=%q mime=%q", m.Codecs, m.MimeType)
	}
	if m.EncryptionType != "NONE" {
		t.Fatalf("dash should be NONE, got %q", m.EncryptionType)
	}
}

func TestDecodeManifestDASHTemplate(t *testing.T) {
	mpd := `<MPD><SegmentTemplate initialization="https://fa.audio.tidal.com/$RepresentationID$/init.mp4" ` +
		`codecs="flac"/></MPD>`
	m, err := decodeManifest(b64(mpd), "application/dash+xml")
	if err != nil {
		t.Fatalf("dash template decode: %v", err)
	}
	want := "https://fa.audio.tidal.com/audio/init.mp4"
	if len(m.URLs) != 1 || m.URLs[0] != want {
		t.Fatalf("bad template url: %#v want %q", m.URLs, want)
	}
}

func TestDecodeManifestUnsupported(t *testing.T) {
	if _, err := decodeManifest(b64("whatever"), "application/octet-stream"); err == nil {
		t.Fatal("expected error for unsupported mime")
	}
}

func TestIndexOfQuality(t *testing.T) {
	cases := map[string]int{
		"HI_RES_LOSSLESS": 0,
		"hi_res":          1,
		"LOSSLESS":        2,
		"HIGH":            3,
		"LOW":             4,
		"BOGUS":           -1,
	}
	for q, want := range cases {
		if got := indexOfQuality(q); got != want {
			t.Errorf("indexOfQuality(%q)=%d want %d", q, got, want)
		}
	}
}

func TestDiscoveryCacheRoundTrip(t *testing.T) {
	kv := newFakeKV()
	a := &API{cache: kv}
	ctx := context.Background()

	// Write populated → long TTL.
	a.writeDiscoveryCache(ctx, "123", []string{"LOSSLESS", "HIGH"}, discoveryCacheTTL)
	got, ok := a.readDiscoveryCache(ctx, "123")
	if !ok || len(got) != 2 || got[0] != "LOSSLESS" {
		t.Fatalf("round trip: ok=%v got=%#v", ok, got)
	}
	if kv.ttls[discoveryCacheKey+"123"] != discoveryCacheTTL {
		t.Errorf("populated TTL = %v want %v", kv.ttls[discoveryCacheKey+"123"], discoveryCacheTTL)
	}

	// Empty → short negative TTL (the #488 self-heal cadence).
	a.writeDiscoveryCache(ctx, "404", nil, discoveryNegativeCacheTTL)
	if kv.ttls[discoveryCacheKey+"404"] != discoveryNegativeCacheTTL {
		t.Errorf("negative TTL = %v want %v", kv.ttls[discoveryCacheKey+"404"], discoveryNegativeCacheTTL)
	}
	got, ok = a.readDiscoveryCache(ctx, "404")
	if !ok || len(got) != 0 {
		t.Fatalf("empty cache read: ok=%v got=%#v", ok, got)
	}
}

func TestDiscoveryCacheFiltersBogusQualities(t *testing.T) {
	kv := newFakeKV()
	a := &API{cache: kv}
	ctx := context.Background()
	// Simulate a cache value with a stale/unknown quality name.
	raw, _ := json.Marshal(struct {
		Qualities []string `json:"qualities"`
	}{[]string{"LOSSLESS", "MQA_GARBAGE", "LOW"}})
	kv.KVSet(ctx, discoveryCacheKey+"9", string(raw), discoveryCacheTTL)
	got, ok := a.readDiscoveryCache(ctx, "9")
	if !ok || len(got) != 2 || got[0] != "LOSSLESS" || got[1] != "LOW" {
		t.Fatalf("filter bogus: ok=%v got=%#v", ok, got)
	}
}

func TestQualityMemoRoundTrip(t *testing.T) {
	kv := newFakeKV()
	a := &API{cache: kv}
	ctx := context.Background()
	a.writeCachedQuality(ctx, "55", "LOSSLESS", qualityCacheTTL)
	if got := a.readCachedQuality(ctx, "55"); got != "LOSSLESS" {
		t.Fatalf("memo = %q want LOSSLESS", got)
	}
	// Bogus stored value is rejected on read.
	kv.KVSet(ctx, qualityCacheKey+"66", "NONSENSE", qualityCacheTTL)
	if got := a.readCachedQuality(ctx, "66"); got != "" {
		t.Fatalf("bogus memo should be rejected, got %q", got)
	}
}

func TestDiscoveryBreaker(t *testing.T) {
	kv := newFakeKV()
	a := &API{cache: kv}
	ctx := context.Background()
	if a.isDiscoveryBreakerOpen(ctx) {
		t.Fatal("breaker should start closed")
	}
	a.tripDiscoveryBreaker(ctx)
	if !a.isDiscoveryBreakerOpen(ctx) {
		t.Fatal("breaker should be open after trip")
	}
	if kv.ttls[discoveryBreakerKey] != discoveryBreakerTTL {
		t.Errorf("breaker TTL = %v want %v", kv.ttls[discoveryBreakerKey], discoveryBreakerTTL)
	}
}

func TestNilCacheIsSafe(t *testing.T) {
	a := &API{cache: nil}
	ctx := context.Background()
	// None of these should panic with a nil cache.
	a.writeDiscoveryCache(ctx, "1", []string{"HIGH"}, discoveryCacheTTL)
	if _, ok := a.readDiscoveryCache(ctx, "1"); ok {
		t.Fatal("nil cache should always miss")
	}
	a.writeCachedQuality(ctx, "1", "HIGH", qualityCacheTTL)
	if got := a.readCachedQuality(ctx, "1"); got != "" {
		t.Fatalf("nil cache memo should be empty, got %q", got)
	}
	if a.isDiscoveryBreakerOpen(ctx) {
		t.Fatal("nil cache breaker should be closed")
	}
}
