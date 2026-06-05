package routes

import "time"

// nowMs returns the current unix milliseconds. Most timestamp columns
// are BIGINT epoch-millis carried over from the original D1 (SQLite)
// schema.
func nowMs() int64 { return time.Now().UnixMilli() }

// nowSec returns unix seconds — used for `min_token_iat` which is
// compared against JWT `iat` (seconds) by the auth middleware.
func nowSec() int64 { return time.Now().Unix() }
