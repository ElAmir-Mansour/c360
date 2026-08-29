package audittap

import (
	"context"
	"testing"
)

func TestNoopTap_RecordDropsEvent(t *testing.T) {
	if err := (NoopTap{}).Record(context.Background(), Event{RequestID: "req-1"}); err != nil {
		t.Fatalf("Record() error = %v, want nil", err)
	}
}
