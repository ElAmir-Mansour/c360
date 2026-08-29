package handler

import (
	"context"
	"net/http"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/siem/sources/enroll"
	"github.com/clario360/platform/internal/siem/sources/mtls"
	"github.com/clario360/platform/internal/siem/sources/service"
)

// HubPublisher is the small interface a handler/router needs to push
// directly to a notification WS hub when the service is embedded with one.
// The standalone siem-service normally leaves this nil and emits Kafka
// lifecycle events through the sources service instead.
type HubPublisher interface {
	Publish(tenantID, topic string, message []byte)
}

// Deps bundles the handler dependencies that don't depend on a
// per-request context.
type Deps struct {
	Service       service.Service
	Enroller      *enroll.Service
	MTLS          *mtls.Middleware
	Hub           HubPublisher
	Redis         *redis.Client
	Logger        zerolog.Logger
	JWTRequired   func(http.Handler) http.Handler
	AdminRequired func(http.Handler) http.Handler
	ReadRequired  func(http.Handler) http.Handler
}

// ctxKey is the context-key type for handler-only values.
type ctxKey string

// CompileGuard is a no-op consumer that prevents the linter from
// flagging an unused symbol if no handler imports context in this
// file. Cheap and keeps the package warning-clean.
var _ = context.Background
