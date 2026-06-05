// AES-GCM encryption used to protect Tidal session tokens at rest.
//
// This MUST stay byte-compatible with the legacy worker
// (worker/src/services/tidal/sessionCrypto.ts) because both backends
// read and write the same `tidal_session` row. The on-disk format is:
//
//	enc:v1:<base64url-iv>:<base64url-ciphertext+tag>
//
//   - prefix `enc:v1:` marks an encrypted blob
//   - base64 is URL-safe WITHOUT padding (matches the worker's btoa()
//     + `+/`→`-_` + strip `=`)
//   - the IV/nonce is 12 bytes (AES-GCM standard)
//   - the AES-256 key is SHA-256(SESSION_ENCRYPTION_KEY)
//
// Rows without the prefix are treated as legacy plaintext (the worker
// did the same during its own encryption rollout) so we never lose an
// existing session over a deploy boundary.
package authz

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
)

// encPrefix marks an encrypted blob. Matches sessionCrypto.ts ENC_PREFIX.
const encPrefix = "enc:v1:"

// b64url is URL-safe base64 without padding, matching the worker's
// base64UrlEncode/Decode helpers.
var b64url = base64.RawURLEncoding

// deriveAESKey turns the configured SESSION_ENCRYPTION_KEY into a
// 32-byte AES-256 key via SHA-256. Matches the worker's deriveKey.
func deriveAESKey(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}

// EncryptSession seals plaintext with AES-GCM and serialises it in the
// worker-compatible `enc:v1:<iv>:<ct>` format (URL-safe base64, 12-byte
// IV). An empty plaintext is returned unchanged, mirroring the worker.
func EncryptSession(secret, plaintext string) (string, error) {
	if plaintext == "" {
		return plaintext, nil
	}
	block, err := aes.NewCipher(deriveAESKey(secret))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block) // NonceSize() == 12
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	return encPrefix + b64url.EncodeToString(nonce) + ":" + b64url.EncodeToString(ct), nil
}

// DecryptSession reverses EncryptSession. Values that don't carry the
// `enc:v1:` prefix are returned verbatim as legacy plaintext (matching
// the worker's transparent fallback for pre-encryption rows).
func DecryptSession(secret, encoded string) (string, error) {
	if encoded == "" {
		return "", nil
	}
	if !strings.HasPrefix(encoded, encPrefix) {
		// Legacy plaintext row written before encryption was wired up.
		return encoded, nil
	}
	rest := encoded[len(encPrefix):]
	sep := strings.IndexByte(rest, ':')
	if sep <= 0 || sep >= len(rest)-1 {
		return "", errors.New("authz: malformed encrypted session blob")
	}
	nonce, err := b64url.DecodeString(rest[:sep])
	if err != nil {
		return "", err
	}
	ct, err := b64url.DecodeString(rest[sep+1:])
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(deriveAESKey(secret))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}
