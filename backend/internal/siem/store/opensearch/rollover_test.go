package opensearch

import (
	"context"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
)

func TestRolloverHot_Success(t *testing.T) {
	tenant := uuid.New()
	c, cleanup := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/_rollover") {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"old_index":"siem-` + tenant.String() + `-000001","new_index":"siem-` + tenant.String() + `-000002","rolled_over":true}`))
	})
	defer cleanup()
	res, err := c.RolloverHot(context.Background(), tenant)
	if err != nil {
		t.Fatal(err)
	}
	if !res.RolledOver {
		t.Errorf("not rolled over")
	}
}

func TestFreezeWarm_Success(t *testing.T) {
	tenant := uuid.New()
	var forcemerge, settings int32
	c, cleanup := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/_forcemerge") {
			atomic.AddInt32(&forcemerge, 1)
		}
		if strings.HasSuffix(r.URL.Path, "/_settings") {
			atomic.AddInt32(&settings, 1)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	})
	defer cleanup()
	if err := c.FreezeWarm(context.Background(), tenant, "siem-idx"); err != nil {
		t.Fatal(err)
	}
	if forcemerge != 1 || settings != 1 {
		t.Errorf("forcemerge=%d settings=%d", forcemerge, settings)
	}
}

func TestRolloverHot_PublishesEvent(t *testing.T) {
	tenant := uuid.New()
	pub := &capturingPublisher{}
	c, cleanup := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"old_index":"a","new_index":"b","rolled_over":true}`))
	})
	defer cleanup()
	c.cfg.EventPublisher = pub
	if _, err := c.RolloverHot(context.Background(), tenant); err != nil {
		t.Fatal(err)
	}
	if pub.events != 1 {
		t.Errorf("events = %d", pub.events)
	}
	if pub.lastType != "siem.opensearch.rollover" {
		t.Errorf("type = %s", pub.lastType)
	}
}

type capturingPublisher struct {
	events   int
	lastType string
}

func (p *capturingPublisher) Publish(ctx context.Context, eventType, subject string, data any) error {
	p.events++
	p.lastType = eventType
	return nil
}
