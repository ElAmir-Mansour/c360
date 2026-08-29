package channel

import (
	"context"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/model"
	"github.com/clario360/platform/internal/notification/websocket"
)

// InAppChannel delivers notifications via in-app storage + WebSocket push.
type InAppChannel struct {
	hub    *websocket.Hub
	fanout fanoutPublisher
	logger zerolog.Logger
}

// NewInAppChannel creates a new InAppChannel.
func NewInAppChannel(hub *websocket.Hub, logger zerolog.Logger) *InAppChannel {
	return &InAppChannel{hub: hub, logger: logger.With().Str("channel", "in_app").Logger()}
}

// SetFanout wires the cross-instance Redis fan-out publisher (#7). The in-app
// channel pushes the same real-time WSMessage as the websocket channel, so it
// shares the fan-out path to reach connections held by other replicas.
// Additive: with no fanout set the channel keeps its original local-only push.
func (c *InAppChannel) SetFanout(p fanoutPublisher) { c.fanout = p }

// Name returns the channel name.
func (c *InAppChannel) Name() string { return model.ChannelInApp }

// Send pushes a real-time notification to the user via WebSocket.
// The notification is already persisted in DB by the notification service.
// In-app delivery cannot fail — the record is already in DB.
func (c *InAppChannel) Send(ctx context.Context, notif *model.Notification) *ChannelResult {
	msg, err := websocket.NewWSMessage(websocket.MsgTypeNotificationNew, notif)
	if err != nil {
		c.logger.Warn().Err(err).Str("notification_id", notif.ID).Msg("failed to marshal ws message")
		return &ChannelResult{Success: true, Metadata: map[string]interface{}{"ws_push": false}}
	}

	// Cross-instance fan-out (#7): publish-only with local-hub fallback when
	// Redis is unreachable (see WebSocketChannel.Send).
	if c.fanout != nil {
		if perr := c.fanout.Publish(ctx, notif.TenantID, notif.UserID, msg); perr == nil {
			return &ChannelResult{Success: true, Metadata: map[string]interface{}{"ws_fanout": true}}
		} else {
			c.logger.Warn().Err(perr).Str("notification_id", notif.ID).Msg("in_app fanout publish failed; falling back to local hub")
		}
	}

	sent := c.hub.SendToUser(notif.TenantID, notif.UserID, msg)

	return &ChannelResult{
		Success:  true,
		Metadata: map[string]interface{}{"ws_sessions_sent": sent, "ws_fanout": false},
	}
}
