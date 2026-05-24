package authz

import "encoding/json"

// unmarshal is a tiny indirection over std-json that lets us swap in a
// faster decoder later without touching call-sites.
func unmarshal(data []byte, v any) error { return json.Unmarshal(data, v) }
