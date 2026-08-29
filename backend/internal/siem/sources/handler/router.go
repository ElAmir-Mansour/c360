package handler

import (
	"time"

	"github.com/go-chi/chi/v5"

	siemmw "github.com/clario360/platform/internal/siem/sources/middleware"
)

// NewRouter assembles the /sources sub-router. Mount under
// /api/v1/siem in main.go.
func NewRouter(d Deps) chi.Router {
	r := chi.NewRouter()

	sh := NewSourcesHandler(d)
	eh := NewEnrollHandler(d)
	hh := NewHealthHandler(d)

	// Read routes — siem:read
	r.Group(func(r chi.Router) {
		if d.ReadRequired != nil {
			r.Use(d.ReadRequired)
		}
		r.Get("/", sh.List)
		r.Get("/{id}", sh.Get)
		r.Get("/{id}/health", hh.Health)
	})

	// Admin write routes — siem:admin
	r.Group(func(r chi.Router) {
		if d.AdminRequired != nil {
			r.Use(d.AdminRequired)
		}
		// POST /sources — Idempotency-Key supported.
		if d.Redis != nil {
			idem := siemmw.NewIdempotency(d.Redis, 24*time.Hour)
			r.With(idem.Middleware).Post("/", sh.Create)
		} else {
			r.Post("/", sh.Create)
		}
		r.With(siemmw.IfMatchRequired).Patch("/{id}", sh.Update)
		r.With(siemmw.IfMatchRequired).Delete("/{id}", sh.Delete)
		r.With(siemmw.IfMatchRequired).Post("/{id}/disable", sh.Disable)
		r.With(siemmw.IfMatchRequired).Post("/{id}/enable", sh.Enable)
		r.Post("/{id}/rotate-cert", sh.RotateCert)
	})

	// Enrollment routes — authenticated by enrollment-token JWT
	// (NOT user JWT). The token *is* the authorization, so we attach
	// no extra middleware here; the handler unmarshals and verifies.
	r.Post("/{id}/enroll", eh.Enroll)
	r.Post("/{id}/rotate-cert/exchange", eh.RotateExchange)

	return r
}
