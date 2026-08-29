package connector

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"github.com/clario360/platform/internal/events"
)

// ErrUnregisteredType is returned by the registry dispatchers when no connector
// is registered for the requested type.
type ErrUnregisteredType struct {
	Type string
}

func (e *ErrUnregisteredType) Error() string {
	return fmt.Sprintf("no connector registered for type %q", e.Type)
}

// ErrCapabilityUnsupported is returned when a connector exists but does not
// implement the requested optional capability (ticket creation or test).
type ErrCapabilityUnsupported struct {
	Type       string
	Capability string
}

func (e *ErrCapabilityUnsupported) Error() string {
	return fmt.Sprintf("connector %q does not support %s", e.Type, e.Capability)
}

// EventTransform optionally rewrites an outbound event before it is dispatched
// to a connector's Send. It is the hook the integration engine uses to apply
// source-specific rendering (notably DataStream/DR rendering) uniformly across
// every connector without modifying any connector or client. A transform MUST be
// pure with respect to events it does not handle: it returns the event unchanged
// (or a behavior-equivalent copy) for types it does not recognise, so non-target
// deliveries are byte-for-byte identical to the untransformed path.
type EventTransform func(*events.Event) *events.Event

// Registry is a concurrency-safe, O(1)-lookup store of connectors keyed by
// their manifest Type. It is the single dispatch point that replaces the three
// type-switches in the integration service (delivery Process, Test, and config
// validation).
type Registry struct {
	mu         sync.RWMutex
	connectors map[string]Connector
	// sendTransform, when non-nil, is applied to every event in Send before it
	// reaches a connector. It is set once at wiring time (see SetSendTransform)
	// and read under the same lock, so concurrent Send/SetSendTransform are safe.
	sendTransform EventTransform
}

// NewRegistry returns an empty, ready-to-use Registry.
func NewRegistry() *Registry {
	return &Registry{
		connectors: make(map[string]Connector),
	}
}

// SetSendTransform installs a pre-dispatch event transform applied by Send to
// every outbound event. Passing nil clears it. It is intended to be called once
// during service wiring (e.g. to install DR rendering); it is safe to call
// concurrently with Send.
func (r *Registry) SetSendTransform(t EventTransform) {
	r.mu.Lock()
	r.sendTransform = t
	r.mu.Unlock()
}

// sendTransformFn returns the currently installed transform (or nil) under the
// read lock.
func (r *Registry) sendTransformFn() EventTransform {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.sendTransform
}

// Register adds c to the registry keyed by its manifest Type. It returns an
// error if the manifest is invalid, if the type is empty, or if a connector is
// already registered for that type (no silent overwrite).
func (r *Registry) Register(c Connector) error {
	if c == nil {
		return fmt.Errorf("cannot register nil connector")
	}
	m := c.Manifest()
	if err := m.Validate(); err != nil {
		return fmt.Errorf("register connector: invalid manifest: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.connectors[m.Type]; exists {
		return fmt.Errorf("register connector: type %q already registered", m.Type)
	}
	r.connectors[m.Type] = c
	return nil
}

// MustRegister is like Register but panics on error. It is intended for
// package-init wiring where a registration failure is a programming error, not
// a runtime condition.
func (r *Registry) MustRegister(c Connector) {
	if err := r.Register(c); err != nil {
		panic(err)
	}
}

// Get returns the connector registered for typ and whether it was found. Lookup
// is O(1).
func (r *Registry) Get(typ string) (Connector, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	c, ok := r.connectors[typ]
	return c, ok
}

// List returns every registered connector's manifest, sorted by Type for
// deterministic output (useful for admin listings and tests).
func (r *Registry) List() []Manifest {
	r.mu.RLock()
	manifests := make([]Manifest, 0, len(r.connectors))
	for _, c := range r.connectors {
		manifests = append(manifests, c.Manifest())
	}
	r.mu.RUnlock()

	sort.Slice(manifests, func(i, j int) bool {
		return manifests[i].Type < manifests[j].Type
	})
	return manifests
}

// Types returns the registered type keys, sorted.
func (r *Registry) Types() []string {
	r.mu.RLock()
	types := make([]string, 0, len(r.connectors))
	for t := range r.connectors {
		types = append(types, t)
	}
	r.mu.RUnlock()
	sort.Strings(types)
	return types
}

// Len returns the number of registered connectors.
func (r *Registry) Len() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.connectors)
}

// ValidateConfig looks up the connector for typ and delegates to its
// ValidateConfig. It returns an *ErrUnregisteredType for an unknown type.
func (r *Registry) ValidateConfig(typ string, cfg map[string]any) error {
	c, ok := r.Get(typ)
	if !ok {
		return &ErrUnregisteredType{Type: typ}
	}
	return c.ValidateConfig(cfg)
}

// Send looks up the connector for typ and delegates to its Send. It returns an
// *ErrUnregisteredType for an unknown type.
//
// When a send transform is installed (SetSendTransform), it is applied to event
// before dispatch. The transform is responsible for being a no-op on events it
// does not target, so connectors that receive a non-targeted event behave
// exactly as if no transform were installed.
func (r *Registry) Send(ctx context.Context, typ string, cfg map[string]any, event *events.Event) (Result, error) {
	c, ok := r.Get(typ)
	if !ok {
		return Result{}, &ErrUnregisteredType{Type: typ}
	}
	if transform := r.sendTransformFn(); transform != nil && event != nil {
		event = transform(event)
	}
	return c.Send(ctx, cfg, event)
}

// Test looks up the connector for typ and, if it implements Tester, delegates
// to its Test. It returns an *ErrUnregisteredType for an unknown type and an
// *ErrCapabilityUnsupported if the connector cannot self-test.
func (r *Registry) Test(ctx context.Context, typ string, cfg map[string]any) (Result, error) {
	c, ok := r.Get(typ)
	if !ok {
		return Result{}, &ErrUnregisteredType{Type: typ}
	}
	tester, ok := c.(Tester)
	if !ok {
		return Result{}, &ErrCapabilityUnsupported{Type: typ, Capability: "test"}
	}
	return tester.Test(ctx, cfg)
}

// CreateFromEntity looks up the connector for typ and, if it implements
// TicketConnector, delegates to its CreateFromEntity. It returns an
// *ErrUnregisteredType for an unknown type and an *ErrCapabilityUnsupported if
// the connector cannot create tickets.
func (r *Registry) CreateFromEntity(ctx context.Context, typ string, cfg map[string]any, bearerToken, entityType, entityID string) (Result, error) {
	c, ok := r.Get(typ)
	if !ok {
		return Result{}, &ErrUnregisteredType{Type: typ}
	}
	tc, ok := c.(TicketConnector)
	if !ok {
		return Result{}, &ErrCapabilityUnsupported{Type: typ, Capability: "ticket"}
	}
	return tc.CreateFromEntity(ctx, cfg, bearerToken, entityType, entityID)
}

// Manifest returns the manifest for typ and whether it was found.
func (r *Registry) Manifest(typ string) (Manifest, bool) {
	c, ok := r.Get(typ)
	if !ok {
		return Manifest{}, false
	}
	return c.Manifest(), true
}
