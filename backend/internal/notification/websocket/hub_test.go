package websocket

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

func newTestHub() *Hub {
	logger := zerolog.Nop()
	return NewHub(3, logger)
}

type mockConn struct{}

func TestHub_RegisterAndUnregister(t *testing.T) {
	hub := newTestHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go hub.Run(ctx)
	time.Sleep(10 * time.Millisecond)

	if hub.ActiveConnections("tenant-1") != 0 {
		t.Error("expected 0 connections initially")
	}
}

func TestHub_ActiveConnections(t *testing.T) {
	hub := newTestHub()

	hub.mu.Lock()
	hub.clients["tenant-1"] = map[string][]*Client{
		"user-1": {
			{userID: "user-1", tenantID: "tenant-1"},
			{userID: "user-1", tenantID: "tenant-1"},
		},
		"user-2": {
			{userID: "user-2", tenantID: "tenant-1"},
		},
	}
	hub.mu.Unlock()

	if hub.ActiveConnections("tenant-1") != 3 {
		t.Errorf("expected 3 connections, got %d", hub.ActiveConnections("tenant-1"))
	}
	if hub.ActiveUserConnections("tenant-1", "user-1") != 2 {
		t.Errorf("expected 2 connections for user-1, got %d", hub.ActiveUserConnections("tenant-1", "user-1"))
	}
	if hub.ActiveConnections("tenant-2") != 0 {
		t.Errorf("expected 0 connections for tenant-2")
	}
}

func TestHub_SendToUser_NoClients(t *testing.T) {
	hub := newTestHub()
	sent := hub.SendToUser("tenant-1", "user-1", []byte("test"))
	if sent != 0 {
		t.Errorf("expected 0 sent for non-existent user, got %d", sent)
	}
}

func TestHub_BroadcastToTenant_NoClients(t *testing.T) {
	hub := newTestHub()
	sent := hub.BroadcastToTenant("tenant-1", []byte("test"))
	if sent != 0 {
		t.Errorf("expected 0 sent for non-existent tenant, got %d", sent)
	}
}

// fakeClient is a wire-level capturing Client used only to test PublishToTopic.
// We construct it without a real *websocket.Conn so we can intercept Send.
type captureClient struct {
	*Client
	got [][]byte
}

func TestHub_PublishToTopic_EnvelopesAndBroadcasts(t *testing.T) {
	hub := newTestHub()

	// Inject a client whose send channel we can drain.
	c := &Client{
		userID:   "user-1",
		tenantID: "tenant-1",
		send:     make(chan []byte, 8),
	}
	hub.mu.Lock()
	hub.clients["tenant-1"] = map[string][]*Client{"user-1": {c}}
	hub.mu.Unlock()

	// JSON payload — must be embedded raw, not double-encoded.
	jsonPayload := []byte(`{"source_id":"abc","status":"silent"}`)
	sent := hub.PublishToTopic("tenant-1", "siem.source.silent.tenant-1", jsonPayload)
	if sent != 1 {
		t.Fatalf("expected 1 recipient, got %d", sent)
	}
	received := <-c.send
	var env struct {
		Topic string          `json:"topic"`
		Data  json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(received, &env); err != nil {
		t.Fatalf("envelope unmarshal: %v", err)
	}
	if env.Topic != "siem.source.silent.tenant-1" {
		t.Errorf("expected topic preserved, got %q", env.Topic)
	}
	var inner map[string]string
	if err := json.Unmarshal(env.Data, &inner); err != nil {
		t.Fatalf("inner payload unmarshal: %v", err)
	}
	if inner["source_id"] != "abc" {
		t.Errorf("inner data did not round-trip: %+v", inner)
	}

	// Non-JSON payload is wrapped as a JSON string.
	hub.PublishToTopic("tenant-1", "raw-topic", []byte("hello"))
	received = <-c.send
	if err := json.Unmarshal(received, &env); err != nil {
		t.Fatalf("envelope unmarshal raw: %v", err)
	}
	var s string
	if err := json.Unmarshal(env.Data, &s); err != nil {
		t.Fatalf("raw inner unmarshal: %v", err)
	}
	if s != "hello" {
		t.Errorf("expected hello, got %q", s)
	}
}

func TestHub_PublishToTopic_NoSubscribers(t *testing.T) {
	hub := newTestHub()
	sent := hub.PublishToTopic("nobody", "any.topic", []byte(`{}`))
	if sent != 0 {
		t.Errorf("expected 0 sent, got %d", sent)
	}
}
