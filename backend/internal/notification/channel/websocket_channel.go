package channel

import (
	"context"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/model"
	"github.com/clario360/platform/internal/notification/websocket"
)

// fanoutPublisher publishes an encoded WSMessage for a user to every replica so
// the replica holding the connection delivers it (cross-instance fan-out, #7).
// *websocket.FanoutPublisher satisfies it.
type fanoutPublisher interface {
	Publish(ctx context.Context, tenantID, userID string, payload []byte) error
}

// WebSocketChannel pushes real-time notifications to connected WebSocket clients.
type WebSocketChannel struct {
	hub    *websocket.Hub
	fanout fanoutPublisher
	logger zerolog.Logger
}

// NewWebSocketChannel creates a new WebSocketChannel.
func NewWebSocketChannel(hub *websocket.Hub, logger zerolog.Logger) *WebSocketChannel {
	return &WebSocketChannel{hub: hub, logger: logger.With().Str("channel", "websocket").Logger()}
}

// SetFanout wires the cross-instance Redis fan-out publisher (#7). When set,
// Send publishes to Redis (publish-only) and every replica's FanoutSubscriber
// delivers to its local hub, so a push reaches the connection regardless of
// which replica consumed the event. Additive: with no fanout set the channel
// keeps its original local-only behaviour.
func (c *WebSocketChannel) SetFanout(p fanoutPublisher) { c.fanout = p }

// Name returns the channel name.
func (c *WebSocketChannel) Name() string { return model.ChannelWebSocket }

// Send pushes a notification message to all connected sessions for the user.
// WebSocket delivery is best-effort — if the user is not connected, it's not a failure.
func (c *WebSocketChannel) Send(ctx context.Context, notif *model.Notification) *ChannelResult {
	msg, err := websocket.NewWSMessage(websocket.MsgTypeNotificationNew, notif)
	if err != nil {
		c.logger.Warn().Err(err).Str("notification_id", notif.ID).Msg("failed to marshal ws message")
		return &ChannelResult{Success: true, Metadata: map[string]interface{}{"ws_push": false}}
	}

	// Cross-instance fan-out (#7): publish-only, the subscriber (on every node,
	// including this one) does the local delivery — this avoids double-delivery
	// on the origin node. If Redis is unreachable, fall back to the local hub so
	// a single-replica or Redis-down deployment still delivers.
	if c.fanout != nil {
		if perr := c.fanout.Publish(ctx, notif.TenantID, notif.UserID, msg); perr == nil {
			return &ChannelResult{Success: true, Metadata: map[string]interface{}{"ws_fanout": true}}
		} else {
			c.logger.Warn().Err(perr).Str("notification_id", notif.ID).Msg("ws fanout publish failed; falling back to local hub")
		}
	}

	sent := c.hub.SendToUser(notif.TenantID, notif.UserID, msg)

	return &ChannelResult{
		Success:  true,
		Metadata: map[string]interface{}{"sessions_sent": sent, "ws_fanout": false},
	}
}
