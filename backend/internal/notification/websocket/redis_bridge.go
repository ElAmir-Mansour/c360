package websocket

import (
	"context"
	"encoding/json"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
)

// DefaultFanoutChannel is the Redis pub/sub channel used to broadcast a
// real-time notification push to every notification-service replica so the
// replica that actually holds the target user's WebSocket connection delivers
// it, regardless of which replica consumed the originating Kafka event.
const DefaultFanoutChannel = "notif:ws:fanout"

// fanoutEnvelope is the wire format published on the fan-out channel. Payload is
// the already-encoded WSMessage bytes so subscribers deliver it verbatim.
type fanoutEnvelope struct {
	TenantID string          `json:"tenant_id"`
	UserID   string          `json:"user_id"`
	Payload  json.RawMessage `json:"payload"`
}

// FanoutPublisher publishes a per-user WebSocket push onto the Redis fan-out
// channel. Every replica (including the origin) delivers to its LOCAL hub via a
// FanoutSubscriber, so publishing is the ONLY thing the origin does — this
// avoids double-delivery on the origin node while ensuring the push reaches the
// replica that owns the connection.
type FanoutPublisher struct {
	rdb     *redis.Client
	channel string
	logger  zerolog.Logger
}

// NewFanoutPublisher constructs a FanoutPublisher. channel defaults to
// DefaultFanoutChannel when empty.
func NewFanoutPublisher(rdb *redis.Client, channel string, logger zerolog.Logger) *FanoutPublisher {
	if channel == "" {
		channel = DefaultFanoutChannel
	}
	return &FanoutPublisher{
		rdb:     rdb,
		channel: channel,
		logger:  logger.With().Str("component", "ws_fanout_publisher").Logger(),
	}
}

// Publish broadcasts the encoded WSMessage for (tenantID,userID) to all
// replicas. It returns an error when Redis is unreachable so the caller can
// fall back to local-hub delivery.
func (p *FanoutPublisher) Publish(ctx context.Context, tenantID, userID string, payload []byte) error {
	env := fanoutEnvelope{TenantID: tenantID, UserID: userID, Payload: json.RawMessage(payload)}
	encoded, err := json.Marshal(env)
	if err != nil {
		return err
	}
	return p.rdb.Publish(ctx, p.channel, encoded).Err()
}

// FanoutSubscriber subscribes to the Redis fan-out channel and delivers each
// received push to the LOCAL hub. It runs on every replica so a push published
// by any replica reaches the connection wherever it lives. Redis outages are
// handled by go-redis' auto-reconnecting pub/sub; while Redis is down publishes
// fail and the publisher falls back to local delivery.
type FanoutSubscriber struct {
	rdb     *redis.Client
	channel string
	hub     *Hub
	logger  zerolog.Logger
}

// NewFanoutSubscriber constructs a FanoutSubscriber. channel defaults to
// DefaultFanoutChannel when empty.
func NewFanoutSubscriber(rdb *redis.Client, channel string, hub *Hub, logger zerolog.Logger) *FanoutSubscriber {
	if channel == "" {
		channel = DefaultFanoutChannel
	}
	return &FanoutSubscriber{
		rdb:     rdb,
		channel: channel,
		hub:     hub,
		logger:  logger.With().Str("component", "ws_fanout_subscriber").Logger(),
	}
}

// Run subscribes and delivers fan-out messages to the local hub until ctx is
// cancelled. It returns nil on graceful shutdown. Must run as a goroutine.
func (s *FanoutSubscriber) Run(ctx context.Context) error {
	pubsub := s.rdb.Subscribe(ctx, s.channel)
	defer func() { _ = pubsub.Close() }()

	ch := pubsub.Channel()
	s.logger.Info().Str("channel", s.channel).Msg("ws fanout subscriber started")

	for {
		select {
		case <-ctx.Done():
			s.logger.Info().Msg("ws fanout subscriber stopped")
			return nil
		case msg, ok := <-ch:
			if !ok {
				// Channel closed by pubsub.Close() during shutdown.
				return nil
			}
			var env fanoutEnvelope
			if err := json.Unmarshal([]byte(msg.Payload), &env); err != nil {
				s.logger.Warn().Err(err).Msg("malformed ws fanout message; dropping")
				continue
			}
			if env.TenantID == "" || env.UserID == "" || len(env.Payload) == 0 {
				continue
			}
			// Deliver to LOCAL connections only; other replicas do the same for
			// the connections they hold.
			s.hub.SendToUser(env.TenantID, env.UserID, env.Payload)
		}
	}
}
