// Package notification exposes a small set of types that allow sibling
// services (e.g. siem-service) to publish to the notification WS hub without
// importing the full notification/service package. The adapter keeps coupling
// minimal: callers depend on the HubPublisher interface, not the concrete Hub.
package notification

import (
	"github.com/clario360/platform/internal/notification/websocket"
)

// HubPublisher is the minimal write-side surface of the notification hub
// exposed to non-notification services. New publish methods on the Hub should
// be added here when they need to be called externally.
type HubPublisher interface {
	// PublishToTopic broadcasts message to clients in tenantID subscribed to topic.
	// Returns the number of recipients reached.
	PublishToTopic(tenantID, topic string, message []byte) int

	// BroadcastToTenant broadcasts message to all clients in tenantID.
	BroadcastToTenant(tenantID string, message []byte) int
}

// NewHubPublisher returns the HubPublisher view of hub. Returns nil if hub is
// nil so callers can construct sibling services with optional notification
// integration.
func NewHubPublisher(hub *websocket.Hub) HubPublisher {
	if hub == nil {
		return nil
	}
	return hub
}
