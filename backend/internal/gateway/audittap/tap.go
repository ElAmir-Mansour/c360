package audittap

import "context"

// Event is the gateway contract/audit slice recorded for one proxied request.
// It intentionally carries only route metadata and non-secret request headers.
type Event struct {
	RequestID        string
	Method           string
	Path             string
	RoutePrefix      string
	Service          string
	EndpointGroup    string
	Public           bool
	ContractID       string
	ContractVersion  string
	ContractPhase    string
	APIVersion       string
	RequestedVersion string
	FailClosed       bool
	Outcome          string
	Reason           string
	TenantID         string
	UserID           string
	Headers          map[string]string
}

// Tap records gateway contract/audit events. Runtime wiring starts with NoopTap;
// a durable audit-service publisher can implement this interface later.
type Tap interface {
	Record(ctx context.Context, event Event) error
}

// NoopTap preserves the middleware contract without external dependencies.
type NoopTap struct{}

// Record intentionally drops the event.
func (NoopTap) Record(context.Context, Event) error {
	return nil
}
