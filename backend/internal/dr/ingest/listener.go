package ingest

import (
	"net/http"

	"github.com/rs/zerolog"

	siemmtls "github.com/clario360/platform/internal/siem/sources/mtls"
)

// ListenerConfig reuses the SIEM sources mTLS listener configuration.
type ListenerConfig = siemmtls.ListenerConfig

// Listener reuses the SIEM sources mTLS listener implementation.
type Listener = siemmtls.Listener

// NewListener constructs the dedicated DR mTLS ingest listener. The router
// should already include the DR ingest Middleware.
func NewListener(cfg ListenerConfig, router http.Handler, logger zerolog.Logger) *Listener {
	return siemmtls.New(cfg, router, logger)
}
