// Package config loads, validates and exposes the siem-service runtime
// configuration. All environment variables are prefixed SIEM_. The Load
// function fails fast on missing required values, returning a single
// error that enumerates every missing key so operators can fix the
// environment in one pass instead of cycling.
//
// Public types:
//
//   - Config       — fully resolved, typed config struct.
//   - LoadOptions  — injection point used in tests to override os.Getenv.
package config
