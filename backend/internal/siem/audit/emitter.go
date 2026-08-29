package audit

import (
	"context"
	"sync"
	"time"

	auditmodel "github.com/clario360/platform/internal/audit/model"
	"github.com/clario360/platform/internal/events"
)

// Emitter records an audit entry. It MUST be non-blocking from the
// caller's perspective: implementations may buffer, fire-and-forget,
// or persist synchronously, but they may not return slow errors that
// would tie up a request handler.
type Emitter interface {
	// Emit fires the entry. ctx is used for cancellation and trace
	// propagation only; the implementation may outlive ctx.
	// Returns an error only if the entry is malformed.
	Emit(ctx context.Context, entry auditmodel.AuditEntry) error
}

// NewSyntheticBootstrapEntry returns the canonical audit entry the
// service emits at startup to prove the wiring works end-to-end.
// Callers can override TenantID and UserEmail; everything else is set
// to safe defaults.
func NewSyntheticBootstrapEntry(tenantID, userEmail string) auditmodel.AuditEntry {
	now := time.Now().UTC()
	if tenantID == "" {
		tenantID = "system"
	}
	if userEmail == "" {
		userEmail = "system@clario360.local"
	}
	return auditmodel.AuditEntry{
		ID:           events.GenerateUUID(),
		TenantID:     tenantID,
		UserEmail:    userEmail,
		Service:      "siem-service",
		Action:       "siem.bootstrap",
		Severity:     auditmodel.SeverityInfo,
		ResourceType: "service",
		ResourceID:   "siem-service",
		CreatedAt:    now,
		EventID:      events.GenerateUUID(),
	}
}

// NoOp is an Emitter that silently accepts every entry. It is the
// production default until SIEM-04 introduces a Kafka producer that
// hands entries off to audit-service.
type NoOp struct{}

// NewNoOp returns a no-op emitter.
func NewNoOp() *NoOp { return &NoOp{} }

// Emit always returns nil.
func (n *NoOp) Emit(_ context.Context, _ auditmodel.AuditEntry) error { return nil }

// InMemory captures emitted entries in a slice. Suitable for tests
// only; never wire this into a real binary.
type InMemory struct {
	mu      sync.Mutex
	entries []auditmodel.AuditEntry
}

// NewInMemory returns a new in-memory emitter.
func NewInMemory() *InMemory {
	return &InMemory{}
}

// Emit appends entry to the captured list.
func (i *InMemory) Emit(_ context.Context, entry auditmodel.AuditEntry) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.entries = append(i.entries, entry)
	return nil
}

// Entries returns a defensive copy of every captured entry.
func (i *InMemory) Entries() []auditmodel.AuditEntry {
	i.mu.Lock()
	defer i.mu.Unlock()
	out := make([]auditmodel.AuditEntry, len(i.entries))
	copy(out, i.entries)
	return out
}

// Len returns the number of captured entries.
func (i *InMemory) Len() int {
	i.mu.Lock()
	defer i.mu.Unlock()
	return len(i.entries)
}
