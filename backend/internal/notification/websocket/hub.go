package websocket

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/metrics"
)

// Hub manages all active WebSocket connections.
type Hub struct {
	// clients: tenantID → userID → []*Client
	clients    map[string]map[string][]*Client
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
	maxPerUser int
	logger     zerolog.Logger
}

// NewHub creates a new WebSocket hub.
func NewHub(maxPerUser int, logger zerolog.Logger) *Hub {
	return &Hub{
		clients:    make(map[string]map[string][]*Client),
		register:   make(chan *Client, 64),
		unregister: make(chan *Client, 64),
		maxPerUser: maxPerUser,
		logger:     logger.With().Str("component", "ws_hub").Logger(),
	}
}

// Run processes register and unregister events. Must run as a goroutine.
func (h *Hub) Run(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			h.closeAll()
			return nil

		case client := <-h.register:
			h.addClient(client)

		case client := <-h.unregister:
			h.removeClient(client)
		}
	}
}

// Register queues a client for registration.
func (h *Hub) Register(client *Client) {
	h.register <- client
}

func (h *Hub) addClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	tenantClients, ok := h.clients[client.tenantID]
	if !ok {
		tenantClients = make(map[string][]*Client)
		h.clients[client.tenantID] = tenantClients
	}

	userClients := tenantClients[client.userID]
	userClients = append(userClients, client)

	// Evict oldest connections if over limit.
	for len(userClients) > h.maxPerUser {
		oldest := userClients[0]
		h.logger.Info().Str("user_id", oldest.userID).Msg("evicting oldest ws connection")
		oldest.Close()
		userClients = userClients[1:]
	}

	tenantClients[client.userID] = userClients

	metrics.WSConnectionsActive.WithLabelValues(client.tenantID).Inc()
	metrics.WSConnectionsTotal.Inc()

	h.logger.Debug().
		Str("user_id", client.userID).
		Str("tenant_id", client.tenantID).
		Int("active", len(userClients)).
		Msg("ws client registered")
}

func (h *Hub) removeClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	tenantClients, ok := h.clients[client.tenantID]
	if !ok {
		return
	}

	userClients := tenantClients[client.userID]
	for i, c := range userClients {
		if c == client {
			userClients = append(userClients[:i], userClients[i+1:]...)
			break
		}
	}

	if len(userClients) == 0 {
		delete(tenantClients, client.userID)
	} else {
		tenantClients[client.userID] = userClients
	}

	if len(tenantClients) == 0 {
		delete(h.clients, client.tenantID)
	}

	metrics.WSConnectionsActive.WithLabelValues(client.tenantID).Dec()

	client.Close()
}

// SendToUser sends a message to all connected sessions for a user. Returns sessions sent to.
func (h *Hub) SendToUser(tenantID, userID string, message []byte) int {
	h.mu.RLock()
	defer h.mu.RUnlock()

	tenantClients, ok := h.clients[tenantID]
	if !ok {
		return 0
	}

	userClients := tenantClients[userID]
	sent := 0
	for _, c := range userClients {
		if c.Send(message) {
			sent++
			metrics.WSMessagesSent.Inc()
		}
	}
	return sent
}

// PublishToTopic broadcasts a message to all WebSocket clients in the given
// tenant who are interested in the given topic. Topic is a free-form string
// (e.g. "siem.source.silent.{tenant_id}"). Returns the number of recipients.
//
// This is the public publish API used by sibling services (e.g. siem-service)
// to push events to the SOC console. The current Hub implementation does not
// track per-client topic subscriptions, so this method envelopes the topic
// inside a small JSON wrapper and broadcasts to the tenant; clients filter on
// their side. Internal channels (in_app dispatch, etc.) should continue using
// SendToUser / BroadcastToTenant directly.
//
// PublishToTopic is non-blocking: per-client Send is dropped if the send
// buffer is full (same semantics as BroadcastToTenant).
func (h *Hub) PublishToTopic(tenantID, topic string, message []byte) int {
	// Build the envelope: {"topic":"<topic>","data":<message>}.
	// If message is already valid JSON we forward it as-is; otherwise we
	// encode it as a JSON string so the consumer always gets parseable JSON.
	var dataField json.RawMessage
	if json.Valid(message) {
		dataField = json.RawMessage(message)
	} else {
		encoded, _ := json.Marshal(string(message))
		dataField = json.RawMessage(encoded)
	}
	envelope := struct {
		Topic string          `json:"topic"`
		Data  json.RawMessage `json:"data"`
	}{Topic: topic, Data: dataField}
	payload, err := json.Marshal(envelope)
	if err != nil {
		// Fall back to raw message if marshalling somehow fails — never block.
		payload = message
	}
	return h.BroadcastToTenant(tenantID, payload)
}

// BroadcastToTenant sends a message to all users in a tenant. Returns total sessions sent to.
func (h *Hub) BroadcastToTenant(tenantID string, message []byte) int {
	h.mu.RLock()
	defer h.mu.RUnlock()

	tenantClients, ok := h.clients[tenantID]
	if !ok {
		return 0
	}

	sent := 0
	for _, userClients := range tenantClients {
		for _, c := range userClients {
			if c.Send(message) {
				sent++
				metrics.WSMessagesSent.Inc()
			}
		}
	}
	return sent
}

// ActiveConnections returns total active connections for a tenant.
func (h *Hub) ActiveConnections(tenantID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()

	total := 0
	if tenantClients, ok := h.clients[tenantID]; ok {
		for _, userClients := range tenantClients {
			total += len(userClients)
		}
	}
	return total
}

// ActiveUserConnections returns the number of active connections for a specific user.
func (h *Hub) ActiveUserConnections(tenantID, userID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if tenantClients, ok := h.clients[tenantID]; ok {
		return len(tenantClients[userID])
	}
	return 0
}

func (h *Hub) closeAll() {
	h.mu.Lock()
	defer h.mu.Unlock()

	for tenantID, tenantClients := range h.clients {
		for _, userClients := range tenantClients {
			for _, c := range userClients {
				c.Close()
			}
		}
		delete(h.clients, tenantID)
	}
}
