package integrations

import (
	"context"
	"sync"
)

// connectorRegistry is a goroutine-safe vendor -> Connector map. The cmd/ bridge
// registers connectors at boot via Service.RegisterConnector (single-threaded),
// but TestConnection / ResolveActive read it on the request path, so the mutex
// keeps the race detector quiet if a late registration ever overlaps a request.
type connectorRegistry struct {
	mu sync.RWMutex
	m  map[string]Connector
}

func newConnectorRegistry() *connectorRegistry {
	return &connectorRegistry{m: make(map[string]Connector)}
}

// register stores c under its Vendor key. A nil connector, or one with an empty
// Vendor, is ignored — a misconfigured adapter must not shadow a real one.
func (r *connectorRegistry) register(c Connector) {
	if c == nil || c.Vendor() == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.m[c.Vendor()] = c
}

// lookup returns the connector for vendor, or (nil, false) when none is
// registered.
func (r *connectorRegistry) lookup(vendor string) (Connector, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	c, ok := r.m[vendor]
	return c, ok
}

// StaticConnector is a trivial Connector built from a vendor key and a test
// function. It is handy for the bridge to wrap a closure, and for tests, without
// each adapter declaring a one-off type.
type StaticConnector struct {
	VendorName string
	TestFunc   func(ctx context.Context, cfg Config) error
}

// Vendor implements Connector.
func (s StaticConnector) Vendor() string { return s.VendorName }

// Test implements Connector. A nil TestFunc treats every config as reachable.
func (s StaticConnector) Test(ctx context.Context, cfg Config) error {
	if s.TestFunc == nil {
		return nil
	}
	return s.TestFunc(ctx, cfg)
}

var _ Connector = StaticConnector{}
