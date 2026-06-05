// Package httpx contains tiny HTTP helpers used throughout the API:
// JSON serialisation, error envelopes, request body parsing, and the
// canonical error messages clients expect.
//
// We deliberately keep error responses opaque (never leak internal
// message contents) to mirror the legacy worker's privacy posture —
// detailed errors go to slog, generic ones to the caller.
package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
)

// JSON writes the value as application/json with the given status.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("http json encode", "err", err)
	}
}

// Err writes a generic { error: "message" } envelope.
func Err(w http.ResponseWriter, status int, msg string) {
	JSON(w, status, map[string]string{"error": msg})
}

// Internal writes a generic 500 and logs the original error.
func Internal(w http.ResponseWriter, err error) {
	slog.Error("internal server error", "err", err)
	Err(w, http.StatusInternalServerError, "Внутренняя ошибка сервера")
}

// NotFound writes the canonical 404 envelope used by the legacy worker.
func NotFound(w http.ResponseWriter) {
	Err(w, http.StatusNotFound, "Маршрут не найден")
}

// BindJSON reads and decodes a JSON body. Bodies above maxBytes are
// rejected with 413 to avoid memory blow-ups; an empty body is allowed
// only when the destination is a pointer-to-struct (the field tags
// dictate which keys are required).
func BindJSON(r *http.Request, dst any, maxBytes int64) error {
	if maxBytes <= 0 {
		maxBytes = 1 << 20 // 1 MiB default
	}
	r.Body = http.MaxBytesReader(nil, r.Body, maxBytes)
	defer r.Body.Close()

	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			return errors.New("empty body")
		}
		return err
	}
	return nil
}
