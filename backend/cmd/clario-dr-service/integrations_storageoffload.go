package main

// integrations_storageoffload.go closes the loop between the integrations catalog
// and the storage-offload array providers: when an operator has registered (and
// tested) a NetApp ONTAP integration, the array provider for "netapp_ontap" is
// driven by a client built from those LIVE, decrypted credentials instead of (or
// in addition to) the env-configured DR_STORAGE_NETAPP_ONTAP_* gateway.
//
// The seam is storageoffload.ArrayClient (a single Do call). The arrayProvider
// drives Do both on the request path and on the storage-offload background loop.
// The loop claims snapshots across tenants on the system path, but DriveSnapshot
// pins each snapshot's OWN tenant into the ctx before any provider I/O, so a
// per-call tenant is ALWAYS present here (request path or loop). The
// resolverArrayClient resolves the active ONTAP integration strictly for that
// ctx tenant and caches the resulting *ONTAPClient per tenant so repeated polls
// do not re-resolve+re-decrypt. This is correct for a multi-tenant / multi-array
// deployment: each snapshot is driven against its own tenant's array. If a call
// ever arrives with NO tenant in ctx, the client FAILS CLOSED — it never falls
// back to another tenant's credentials. When no ONTAP integration is active for
// the tenant the client returns the integrations ErrNotFound, which the
// orchestrator records as a snapshot failure with a clear "configure the array
// client" cause — exactly the behavior of an unconfigured array provider.

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/integrations"
	"github.com/clario360/platform/internal/dr/storageoffload"
)

// resolverArrayClient is a storageoffload.ArrayClient that builds the concrete
// ONTAPClient from a registered, active integration resolved per-tenant at
// request time. It is safe for concurrent use.
type resolverArrayClient struct {
	resolver integrations.Resolver
	vendor   string

	mu      sync.Mutex
	clients map[uuid.UUID]*storageoffload.ONTAPClient // by tenant
}

// newResolverArrayClient builds a resolver-backed ArrayClient for a vendor
// (here, storageoffload.ProviderNetAppONTAP).
func newResolverArrayClient(resolver integrations.Resolver, vendor string) *resolverArrayClient {
	return &resolverArrayClient{
		resolver: resolver,
		vendor:   vendor,
		clients:  make(map[uuid.UUID]*storageoffload.ONTAPClient),
	}
}

// Do resolves (and caches) the per-tenant ONTAPClient and delegates the generic
// array call to it. The ONTAPClient translates the generic (method, path, body)
// into the real ONTAP REST sequence.
func (c *resolverArrayClient) Do(ctx context.Context, method, path string, body, out any) error {
	client, err := c.clientFor(ctx)
	if err != nil {
		return err
	}
	return client.Do(ctx, method, path, body, out)
}

// clientFor returns the ONTAPClient for the tenant in ctx, building it from the
// active integration on first use and caching it per tenant. A call with no
// tenant in ctx FAILS CLOSED rather than reusing another tenant's client — every
// real drive path (request handlers and the background loop via DriveSnapshot)
// carries the snapshot's own tenant, so a missing tenant is a programming error,
// never a normal steady state.
func (c *resolverArrayClient) clientFor(ctx context.Context) (*storageoffload.ONTAPClient, error) {
	tenantID, ok := tenantFromContext(ctx)
	if !ok {
		return nil, fmt.Errorf("storageoffload %s: no tenant in context — refusing to resolve array credentials (this call must run tenant-scoped)", c.vendor)
	}

	c.mu.Lock()
	if cached, has := c.clients[tenantID]; has {
		c.mu.Unlock()
		return cached, nil
	}
	c.mu.Unlock()

	_, cfg, err := c.resolver.ResolveActive(ctx, tenantID, c.vendor)
	if err != nil {
		if errors.Is(err, integrations.ErrNotFound) {
			return nil, fmt.Errorf("storageoffload %s: %w (register and TEST a %s integration to activate it)", c.vendor, err, c.vendor)
		}
		return nil, err
	}
	client, err := storageoffload.NewONTAPClientFromConfig(cfg.Endpoint, cfg.Username, cfg.Token, cfg.CACertPEM)
	if err != nil {
		return nil, fmt.Errorf("storageoffload %s: building client from integration: %w", c.vendor, err)
	}

	c.mu.Lock()
	c.clients[tenantID] = client
	c.mu.Unlock()
	return client, nil
}

// tenantFromContext extracts a parsed tenant UUID from the request context, if
// the Auth+Tenant middleware (request path) or DriveSnapshot (loop path) put one
// there. Returns ok=false only when no tenant is present at all.
func tenantFromContext(ctx context.Context) (uuid.UUID, bool) {
	raw := auth.TenantFromContext(ctx)
	if raw == "" {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}

// Compile-time assertion that the resolver-backed client satisfies ArrayClient.
var _ storageoffload.ArrayClient = (*resolverArrayClient)(nil)
