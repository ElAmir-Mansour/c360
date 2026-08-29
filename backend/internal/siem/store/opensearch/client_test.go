package opensearch

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

func TestNewClient_Validates(t *testing.T) {
	log := zerolog.Nop()
	if _, err := NewClient(context.Background(), Config{}, &log, nil); err == nil {
		t.Error("expected error on empty addresses")
	}
}

func TestNewClient_AppliesDefaults(t *testing.T) {
	log := zerolog.Nop()
	c, err := NewClient(context.Background(), Config{Addresses: []string{"http://localhost:9210"}}, &log, nil)
	if err != nil {
		t.Fatal(err)
	}
	cc := c.(*client)
	if cc.cfg.HealthMinStatus != "yellow" {
		t.Errorf("health min = %s", cc.cfg.HealthMinStatus)
	}
	if cc.cfg.MaxBulkBytes == 0 {
		t.Errorf("bulk bytes = 0")
	}
	if cc.cfg.RolloverMaxAge == "" {
		t.Errorf("rollover age empty")
	}
}

func TestNewClient_InsecureTransport(t *testing.T) {
	log := zerolog.Nop()
	c, err := NewClient(context.Background(), Config{
		Addresses:   []string{"https://localhost:9210"},
		InsecureTLS: true,
	}, &log, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Close(); err != nil {
		t.Errorf("Close: %v", err)
	}
}

func TestClassifyStatus(t *testing.T) {
	cases := []struct {
		name string
		code int
		body string
		want error
	}{
		{"ok", 200, ``, nil},
		{"created", 201, ``, nil},
		{"not-found", 404, ``, ErrIndexNotFound},
		{"mapping", 400, "mapper_parsing_exception", ErrMappingConflict},
		{"bad-request", 400, "other", ErrBadResponse},
		{"server-error", 500, "internal", ErrBadResponse},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			err := classifyStatus(c.code, []byte(c.body))
			if c.want == nil {
				if err != nil {
					t.Errorf("got %v want nil", err)
				}
				return
			}
			if !errors.Is(err, c.want) {
				t.Errorf("got %v want %v", err, c.want)
			}
		})
	}
}

func TestFirstAddr(t *testing.T) {
	if firstAddr(nil) != "" {
		t.Error("nil addr")
	}
	if firstAddr([]string{"a", "b"}) != "a" {
		t.Error("first addr wrong")
	}
}

func TestSnippet(t *testing.T) {
	short := snippet([]byte("abc"))
	if short != "abc" {
		t.Errorf("got %q", short)
	}
	long := snippet([]byte(strings.Repeat("x", 1000)))
	if !strings.HasSuffix(long, "...") {
		t.Errorf("expected truncation: %q", long[:60])
	}
}

func TestDo_TransportError(t *testing.T) {
	log := zerolog.Nop()
	c, err := NewClient(context.Background(), Config{Addresses: []string{"http://127.0.0.1:1"}}, &log, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = c.(*client).do(context.Background(), http.MethodGet, "/", nil, nil)
	if err == nil {
		t.Fatal("expected unreachable error")
	}
	if !errors.Is(err, ErrClusterUnreachable) {
		t.Errorf("err = %v", err)
	}
}

func TestEnsureIndexTemplate_Success(t *testing.T) {
	c, cleanup := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("method = %s", r.Method)
		}
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"acknowledged":true}`))
	})
	defer cleanup()
	if err := c.EnsureIndexTemplate(context.Background(), uuid.New()); err != nil {
		t.Fatal(err)
	}
}

func TestSearch_InjectsTenantInRequest(t *testing.T) {
	tenant := uuid.New()
	var seen []byte
	c, cleanup := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		seen = make([]byte, r.ContentLength)
		_, _ = r.Body.Read(seen)
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"hits":{"total":{"value":0},"hits":[]}}`))
	})
	defer cleanup()
	_, err := c.Search(context.Background(), tenant, []byte(`{"query":{"match_all":{}}}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(seen), tenant.String()) {
		t.Errorf("tenant not injected: %s", seen)
	}
}
