// AES-GCM encryption used to protect Tidal session tokens at rest.
//
// We keep the same algorithm and serialisation format as the legacy
// worker (sessionCrypto.ts) so re-encryption-on-rotation is a plain
// re-encrypt rather than a key migration: `<base64(nonce)>:<base64(ct)>`.
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

// deriveAESKey takes the configured SESSION_ENCRYPTION_KEY and turns it
// into a 32-byte AES-256 key via SHA-256. This matches the worker's
// behaviour: humans can rotate the env-var to any printable string and
// the runtime derives a stable key from it.
func deriveAESKey(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}

// EncryptSession seals plaintext with AES-GCM. The output format is
// `<base64(nonce)>:<base64(ciphertext+tag)>` so it round-trips through
// JSON fields and Redis values unchanged.
func EncryptSession(secret, plaintext string) (string, error) {
	block, err := aes.NewCipher(deriveAESKey(secret))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(nonce) + ":" + base64.StdEncoding.EncodeToString(ct), nil
}

// DecryptSession reverses EncryptSession.
func DecryptSession(secret, encoded string) (string, error) {
	parts := strings.SplitN(encoded, ":", 2)
	if len(parts) != 2 {
		return "", errors.New("authz: bad session ciphertext format")
	}
	nonce, err := base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		return "", err
	}
	ct, err := base64.StdEncoding.DecodeString(parts[1])
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
