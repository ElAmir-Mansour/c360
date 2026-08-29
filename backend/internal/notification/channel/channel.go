package channel

import (
	"context"
	"time"

	"github.com/clario360/platform/internal/notification/model"
)

// Channel is the interface every delivery channel implements.
type Channel interface {
	Name() string
	Send(ctx context.Context, notif *model.Notification) *ChannelResult
}

// ChannelResult describes the outcome of a delivery attempt.
type ChannelResult struct {
	Success  bool
	Error    error
	Metadata map[string]interface{}
	// Retryable, when non-nil, lets a channel classify a failure for the retry
	// worker (#6): true = transient (retry), false = terminal (do not retry).
	// nil means "unspecified" — the worker falls back to its error heuristic.
	Retryable *bool
}

// ChannelDelivery describes a pending delivery to a channel.
type ChannelDelivery struct {
	Channel  string
	Deferred bool // true if quiet hours deferred this channel
	// DeliverAfter, when set on a deferred delivery, is persisted so the
	// quiet-hours flush loop (#10) releases the delivery once now() >= it.
	DeliverAfter *time.Time
}

// EmailTemplateRenderer renders email templates for notifications.
// Implemented by service.TemplateService — defined here to avoid import cycles.
type EmailTemplateRenderer interface {
	RenderEmail(notif *model.Notification) (subject string, body string, err error)
}
