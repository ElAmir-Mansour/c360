package respond

import (
	"context"
	"sync"

	"github.com/google/uuid"
)

type TimelineFeed struct {
	mu         sync.RWMutex
	bufferSize int
	subs       map[uuid.UUID]map[chan TimelineEvent]struct{}
}

func NewTimelineFeed(bufferSize int) *TimelineFeed {
	if bufferSize <= 0 {
		bufferSize = 128
	}
	return &TimelineFeed{
		bufferSize: bufferSize,
		subs:       make(map[uuid.UUID]map[chan TimelineEvent]struct{}),
	}
}

func (f *TimelineFeed) Subscribe(ctx context.Context, incidentID uuid.UUID) <-chan TimelineEvent {
	ch := make(chan TimelineEvent, f.bufferSize)
	f.mu.Lock()
	if f.subs[incidentID] == nil {
		f.subs[incidentID] = make(map[chan TimelineEvent]struct{})
	}
	f.subs[incidentID][ch] = struct{}{}
	f.mu.Unlock()

	go func() {
		<-ctx.Done()
		f.mu.Lock()
		delete(f.subs[incidentID], ch)
		if len(f.subs[incidentID]) == 0 {
			delete(f.subs, incidentID)
		}
		f.mu.Unlock()
		close(ch)
	}()
	return ch
}

func (f *TimelineFeed) Publish(ev TimelineEvent) {
	f.mu.RLock()
	subs := make([]chan TimelineEvent, 0, len(f.subs[ev.IncidentID]))
	for ch := range f.subs[ev.IncidentID] {
		subs = append(subs, ch)
	}
	f.mu.RUnlock()
	for _, ch := range subs {
		select {
		case ch <- ev:
		default:
		}
	}
}
