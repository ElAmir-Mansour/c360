package authz

import "time"

// timeNow is indirected so tests can pin the clock if needed.
var timeNow = time.Now
