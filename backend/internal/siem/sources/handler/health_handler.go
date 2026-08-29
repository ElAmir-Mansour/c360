package handler

import (
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/clario360/platform/internal/siem/sources"
)

// HealthHandler serves GET /sources/{id}/health with a 5s cache.
type HealthHandler struct {
	d     Deps
	cache *healthCache
}

// NewHealthHandler constructs a HealthHandler.
func NewHealthHandler(d Deps) *HealthHandler {
	return &HealthHandler{d: d, cache: &healthCache{entries: map[uuid.UUID]healthEntry{}, ttl: 5 * time.Second}}
}

// Health GET /api/v1/siem/sources/{id}/health
func (h *HealthHandler) Health(w http.ResponseWriter, r *http.Request) {
	tenantID, err := tenantUUID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_tenant", err.Error())
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeNotFound(w)
		return
	}
	if got := h.cache.get(id); got != nil {
		writeJSON(w, http.StatusOK, got)
		return
	}
	res, err := h.d.Service.Health(r.Context(), tenantID, id)
	if err != nil {
		writeServiceErr(w, err)
		return
	}
	h.cache.put(id, res)
	writeJSON(w, http.StatusOK, res)
}

type healthEntry struct {
	val    *sources.Health
	expiry time.Time
}

type healthCache struct {
	mu      sync.Mutex
	entries map[uuid.UUID]healthEntry
	ttl     time.Duration
}

func (c *healthCache) get(id uuid.UUID) *sources.Health {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[id]
	if !ok {
		return nil
	}
	if time.Now().After(e.expiry) {
		delete(c.entries, id)
		return nil
	}
	return e.val
}

func (c *healthCache) put(id uuid.UUID, h *sources.Health) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[id] = healthEntry{val: h, expiry: time.Now().Add(c.ttl)}
}
