// Package fleet implements a cross-service fleet-health aggregator for the
// platform administrative console (gap G1/G1b of docs/platform-admin-console.md).
//
// It carries the canonical §A.3 service host/port table as package config (a Go
// slice), fans out concurrently to each service's admin /health and /readyz
// endpoints, and exposes the result via GET /fleet/health and GET /fleet/summary.
//
// notification-service (main port 8090) and workflow-engine (main port 8083)
// have NO admin port and are special-cased to scrape their MAIN port.
package fleet

import (
	"fmt"
	"os"
)

// Role classifies a service for the console grouping.
type Role string

const (
	RoleSuite    Role = "suite"    // a tenant-facing suite/app service
	RolePlatform Role = "platform" // shared platform/control-plane service
	RoleGateway  Role = "gateway"  // the edge gateway
)

// ServiceDescriptor is the static configuration for one fleet member, mirroring
// the §A.3 table. It is overridable via env (host:port) later; for P0 only the
// base host is configurable (see Config.BaseHost) and the ports are fixed here.
type ServiceDescriptor struct {
	// Name is the service binary name (matches gateway service registry names).
	Name string `json:"name"`
	// Suite is the UI suite label (empty for platform/control-plane services).
	Suite string `json:"suite,omitempty"`
	// Role classifies the service.
	Role Role `json:"role"`
	// MainPort is the main HTTP listen port.
	MainPort int `json:"-"`
	// AdminPort is the admin/metrics port. Zero means "no admin port" — the
	// health scrape falls back to MainPort (notification, workflow).
	AdminPort int `json:"-"`
	// HealthPath is the health endpoint path on whichever port is scraped.
	HealthPath string `json:"-"`
	// ReadyPath is the readiness endpoint path on whichever port is scraped.
	ReadyPath string `json:"-"`
}

// usesMainPort reports whether the service must be scraped on its main port
// because it exposes no separate admin port.
func (d ServiceDescriptor) usesMainPort() bool { return d.AdminPort == 0 }

// scrapePort returns the port the health scraper should hit.
func (d ServiceDescriptor) scrapePort() int {
	if d.usesMainPort() {
		return d.MainPort
	}
	return d.AdminPort
}

// healthURL / readyURL build the absolute scrape URLs against the base host.
func (d ServiceDescriptor) healthURL(baseHost string) string {
	return fmt.Sprintf("http://%s:%d%s", baseHost, d.scrapePort(), d.HealthPath)
}

func (d ServiceDescriptor) readyURL(baseHost string) string {
	return fmt.Sprintf("http://%s:%d%s", baseHost, d.scrapePort(), d.ReadyPath)
}

// httpEndpoint / adminEndpoint are reported back in the response so the console
// can deep-link/diagnose. adminEndpoint is empty when there is no admin port.
func (d ServiceDescriptor) httpEndpoint(baseHost string) string {
	return fmt.Sprintf("http://%s:%d", baseHost, d.MainPort)
}

func (d ServiceDescriptor) adminEndpoint(baseHost string) string {
	if d.usesMainPort() {
		return ""
	}
	return fmt.Sprintf("http://%s:%d", baseHost, d.AdminPort)
}

// DefaultRegistry returns the §A.3 service host/port table as a static slice.
// Hostnames are NOT hard-coded — the base host is supplied via Config.BaseHost
// (default 127.0.0.1). Admin ports default to 90xx; the two services with no
// admin port (notification 8090, workflow 8083) carry AdminPort: 0 so they are
// scraped on their main port.
//
// Special note from §A.3: lex-service's admin port nominally defaults to 9087
// (the same as acta) but lex registers behind the gateway on 8088; its admin
// scrape is best-effort and may report unknown when collocated with acta.
func DefaultRegistry() []ServiceDescriptor {
	const (
		health = "/health"
		ready  = "/readyz"
	)
	return []ServiceDescriptor{
		// Suite / app services
		{Name: "cyber-service", Suite: "Cyber", Role: RoleSuite, MainPort: 8085, AdminPort: 9085, HealthPath: health, ReadyPath: ready},
		{Name: "siem-service", Suite: "SIEM", Role: RoleSuite, MainPort: 8094, AdminPort: 9082, HealthPath: health, ReadyPath: ready},
		{Name: "data-service", Suite: "Data", Role: RoleSuite, MainPort: 8086, AdminPort: 9086, HealthPath: health, ReadyPath: ready},
		{Name: "acta-service", Suite: "Acta", Role: RoleSuite, MainPort: 8087, AdminPort: 9087, HealthPath: health, ReadyPath: ready},
		{Name: "lex-service", Suite: "Watheeq/Lex", Role: RoleSuite, MainPort: 8088, AdminPort: 9087, HealthPath: health, ReadyPath: ready},
		{Name: "visus-service", Suite: "Visus/BOSALAH", Role: RoleSuite, MainPort: 8089, AdminPort: 9089, HealthPath: health, ReadyPath: ready},
		{Name: "clario-dr-service", Suite: "ClarioDR", Role: RoleSuite, MainPort: 8097, AdminPort: 9097, HealthPath: health, ReadyPath: ready},
		{Name: "respond-service", Suite: "Respond", Role: RoleSuite, MainPort: 8099, AdminPort: 9099, HealthPath: health, ReadyPath: ready},
		{Name: "migrate-service", Suite: "Migrate", Role: RoleSuite, MainPort: 8100, AdminPort: 9100, HealthPath: health, ReadyPath: ready},

		// Platform / control-plane services
		{Name: "api-gateway", Role: RoleGateway, MainPort: 8080, AdminPort: 9080, HealthPath: health, ReadyPath: ready},
		{Name: "iam-service", Role: RolePlatform, MainPort: 8081, AdminPort: 9081, HealthPath: health, ReadyPath: ready},
		{Name: "audit-service", Role: RolePlatform, MainPort: 8084, AdminPort: 9084, HealthPath: health, ReadyPath: ready},
		{Name: "license-service", Role: RolePlatform, MainPort: 8096, AdminPort: 9096, HealthPath: health, ReadyPath: ready},
		{Name: "file-service", Role: RolePlatform, MainPort: 8091, AdminPort: 9091, HealthPath: health, ReadyPath: ready},
		{Name: "automation-service", Role: RolePlatform, MainPort: 8098, AdminPort: 9098, HealthPath: health, ReadyPath: ready},

		// Services with NO admin port — scrape MAIN port (special-cased).
		{Name: "workflow-engine", Role: RolePlatform, MainPort: 8083, AdminPort: 0, HealthPath: health, ReadyPath: ready},
		{Name: "notification-service", Role: RolePlatform, MainPort: 8090, AdminPort: 0, HealthPath: health, ReadyPath: ready},
	}
}

// resolveBaseHost picks the base host: explicit Config.BaseHost wins, then the
// PLATFORM_FLEET_BASE_HOST env var, then the 127.0.0.1 default.
func resolveBaseHost(configured string) string {
	if configured != "" {
		return configured
	}
	if v := os.Getenv("PLATFORM_FLEET_BASE_HOST"); v != "" {
		return v
	}
	return "127.0.0.1"
}
