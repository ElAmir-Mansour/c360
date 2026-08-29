// Package buildinfo exposes build-time identifiers for siem-service.
//
// Values are injected via -ldflags "-X
// github.com/clario360/platform/internal/siem/internal/buildinfo.Version=..."
// at build time. They are read once and never mutated.
package buildinfo

import "runtime"

// Compile-time variables. Defaults are intentionally "dev" so a `go run`
// without ldflags still yields a usable value for /_meta and metrics.
var (
	// Version is the SemVer release tag (e.g. "1.4.0").
	Version = "dev"
	// Commit is the short git SHA at build time.
	Commit = "unknown"
	// BuildTime is an RFC3339 timestamp injected at build time.
	BuildTime = "unknown"
)

// GoVersion returns the Go runtime version embedded in the binary.
func GoVersion() string {
	return runtime.Version()
}
