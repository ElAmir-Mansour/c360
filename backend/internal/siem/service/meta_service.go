package service

import (
	"sync/atomic"
	"time"

	"github.com/clario360/platform/internal/siem/internal/buildinfo"
	"github.com/clario360/platform/internal/siem/model"
)

// (no extra imports — buildinfo is re-exported via Build() below).

// MetaService reports static build info and dynamic uptime. It is the
// only service constructed in SIEM-01.
type MetaService struct {
	startedAt atomic.Int64 // unix nanoseconds
	clock     func() time.Time
}

// NewMetaService captures the boot time and returns a ready-to-use
// service. The clock argument is exposed so tests can fake time
// without sleeping.
func NewMetaService(clock func() time.Time) *MetaService {
	if clock == nil {
		clock = func() time.Time { return time.Now().UTC() }
	}
	s := &MetaService{clock: clock}
	s.startedAt.Store(clock().UnixNano())
	return s
}

// MetaFor returns the meta payload for the given tenant id. The
// tenant id is captured so consumers (the gateway, the smoke test)
// can sanity-check that the request's tenant context made it through.
func (s *MetaService) MetaFor(tenantID model.TenantID) model.MetaInfo {
	started := time.Unix(0, s.startedAt.Load()).UTC()
	uptime := s.clock().UTC().Sub(started)
	if uptime < 0 {
		uptime = 0
	}
	return model.MetaInfo{
		Service:       "siem-service",
		Version:       buildinfo.Version,
		Commit:        buildinfo.Commit,
		BuildTime:     buildinfo.BuildTime,
		GoVersion:     buildinfo.GoVersion(),
		UptimeSeconds: int64(uptime.Seconds()),
		TenantID:      tenantID,
	}
}

// UptimeSeconds returns the integer uptime in seconds. Convenience
// helper for /readyz and metrics labels.
func (s *MetaService) UptimeSeconds() int64 {
	started := time.Unix(0, s.startedAt.Load()).UTC()
	return int64(s.clock().UTC().Sub(started).Seconds())
}

// BuildInfo returns the compile-time identifiers (re-exported through
// the service package because `internal/buildinfo` is not visible to
// code outside `internal/siem/`).
type BuildInfo struct {
	Version   string
	Commit    string
	BuildTime string
	GoVersion string
}

// Build returns the static build info.
func Build() BuildInfo {
	return BuildInfo{
		Version:   buildinfo.Version,
		Commit:    buildinfo.Commit,
		BuildTime: buildinfo.BuildTime,
		GoVersion: buildinfo.GoVersion(),
	}
}
