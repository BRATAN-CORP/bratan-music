package services

import "time"

// timeNowMs returns the current unix milliseconds. The schema stores
// most timestamps as BIGINT epoch-millis (the D1 carry-over) so we
// pass plain int64 around at the SQL boundary.
func timeNowMs() int64 { return time.Now().UnixMilli() }

// timeNowSec returns unix seconds. The legacy worker stored
// subscription expiries as seconds (not ms) so a couple of services
// still need this resolution to interop with existing rows.
func timeNowSec() int64 { return time.Now().Unix() }
