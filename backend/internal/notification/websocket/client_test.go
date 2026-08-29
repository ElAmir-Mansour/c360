package websocket

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog"
)

// defaultClientCfg uses long ping/pong intervals so the pump tests observe only
// the messages they enqueue (no spurious ping frames racing the assertions).
func defaultClientCfg() ClientConfig {
	return ClientConfig{
		PingInterval:   time.Hour,
		PongTimeout:    time.Hour,
		WriteTimeout:   2 * time.Second,
		MaxMessageSize: 1024,
	}
}

// dialTestClient spins up an httptest server that upgrades the connection and
// hands back the server-side *Client plus the peer (client-side) conn and the
// hub. The upgrade handler blocks until cleanup so the test drives the pumps.
func dialTestClient(t *testing.T, cfg ClientConfig) (*Client, *websocket.Conn, *Hub) {
	t.Helper()
	hub := NewHub(10, zerolog.Nop())
	clientCh := make(chan *Client, 1)
	done := make(chan struct{})
	up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		clientCh <- NewClient(hub, conn, "user-1", "tenant-1", "sess-1", cfg, zerolog.Nop())
		<-done
	}))

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	peer, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	t.Cleanup(func() {
		close(done)
		_ = peer.Close()
		srv.Close()
	})

	select {
	case c := <-clientCh:
		return c, peer, hub
	case <-time.After(2 * time.Second):
		t.Fatal("server never produced a client")
		return nil, nil, nil
	}
}

// TestClient_Send_Backpressure asserts Send is non-blocking and drops (returns
// false) once the bounded send buffer is full — the backpressure guarantee that
// keeps a slow consumer from blocking the hub. No conn is needed because Send
// never touches it.
func TestClient_Send_Backpressure(t *testing.T) {
	c := &Client{send: make(chan []byte, 2), logger: zerolog.Nop()}

	if !c.Send([]byte("a")) || !c.Send([]byte("b")) {
		t.Fatal("expected the first two sends (buffer capacity 2) to succeed")
	}
	if c.Send([]byte("c")) {
		t.Fatal("expected the third send to be dropped once the buffer is full")
	}

	// A closed client refuses further sends.
	c.closed.Store(true)
	if c.Send([]byte("d")) {
		t.Fatal("expected Send on a closed client to return false")
	}
}

// TestClient_Close_Idempotent asserts Close can be called repeatedly without
// panicking (double close(send) would panic if not guarded) and that it flips
// the client to closed so subsequent sends are refused.
func TestClient_Close_Idempotent(t *testing.T) {
	c, _, _ := dialTestClient(t, defaultClientCfg())

	c.Close()
	c.Close() // must be a no-op, not a panic

	if !c.closed.Load() {
		t.Fatal("expected client marked closed")
	}
	if c.Send([]byte("x")) {
		t.Fatal("expected Send to fail after Close")
	}
}

// TestClient_WritePump_DeliversThenCloses asserts queued messages are flushed to
// the peer in order and that closing the client sends a WebSocket close frame the
// peer observes.
func TestClient_WritePump_DeliversThenCloses(t *testing.T) {
	c, peer, _ := dialTestClient(t, defaultClientCfg())

	// Enqueue before starting the pump so the drain-batch loop also runs.
	c.Send([]byte("m1"))
	c.Send([]byte("m2"))
	c.Send([]byte("m3"))

	go c.WritePump()

	for _, want := range []string{"m1", "m2", "m3"} {
		_ = peer.SetReadDeadline(time.Now().Add(2 * time.Second))
		typ, data, err := peer.ReadMessage()
		if err != nil {
			t.Fatalf("peer read %q: %v", want, err)
		}
		if typ != websocket.TextMessage || string(data) != want {
			t.Fatalf("expected text %q, got type=%d %q", want, typ, data)
		}
	}

	// Closing the client (closes the send channel) makes WritePump emit a close
	// control frame; the peer's next read returns a close error.
	c.Close()
	_ = peer.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := peer.ReadMessage(); err == nil {
		t.Fatal("expected a close error after the client closed")
	}
}

// TestClient_ReadPump_UnregistersOnPeerClose asserts that when the peer drops the
// connection, ReadPump returns and its deferred cleanup enqueues the client for
// unregistration and marks it closed.
func TestClient_ReadPump_UnregistersOnPeerClose(t *testing.T) {
	c, peer, hub := dialTestClient(t, defaultClientCfg())

	go c.ReadPump()

	// Drop the peer: the server-side ReadMessage errors and ReadPump unwinds.
	_ = peer.Close()

	select {
	case got := <-hub.unregister:
		if got != c {
			t.Fatalf("unregistered the wrong client")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("ReadPump did not unregister the client after peer close")
	}

	// The deferred Close ran (or is about to); poll briefly for it.
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if c.closed.Load() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("expected client to be closed after ReadPump exit")
}
