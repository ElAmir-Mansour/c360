package agent

import (
	"context"
	"time"

	"github.com/clario360/platform/internal/datastream/core"
)

// StreamPhase is the runtime's coarse per-stream lifecycle for agent-side
// health reporting. It is intentionally small and stable enough for /healthz
// consumers while avoiding transport-protocol coupling.
type StreamPhase string

const (
	StreamPhaseConfigured   StreamPhase = "configured"
	StreamPhaseStarting     StreamPhase = "starting"
	StreamPhaseShipping     StreamPhase = "shipping"
	StreamPhaseReconnecting StreamPhase = "reconnecting"
	StreamPhaseCompleted    StreamPhase = "completed"
	StreamPhaseStopped      StreamPhase = "stopped"
	StreamPhaseFailed       StreamPhase = "failed"
)

// StreamRuntimeStatus is a point-in-time view of one configured stream.
type StreamRuntimeStatus struct {
	StreamID       string      `json:"stream_id"`
	Kind           SourceKind  `json:"kind"`
	Phase          StreamPhase `json:"phase"`
	Running        bool        `json:"running"`
	LastAckSeq     uint64      `json:"last_ack_seq"`
	LastAckAt      time.Time   `json:"last_ack_at,omitempty"`
	LastFrameSeq   uint64      `json:"last_frame_seq"`
	LastFrameAt    time.Time   `json:"last_frame_at,omitempty"`
	LastSourceLSN  string      `json:"last_source_lsn,omitempty"`
	LastResumeFrom uint64      `json:"last_resume_from"`
	LastSessionAt  time.Time   `json:"last_session_at,omitempty"`
	NextRetryAt    time.Time   `json:"next_retry_at,omitempty"`
	Reconnects     uint64      `json:"reconnects"`
	LastError      string      `json:"last_error,omitempty"`
	UpdatedAt      time.Time   `json:"updated_at"`
}

// RuntimeStatus is an immutable snapshot of all stream statuses.
type RuntimeStatus struct {
	CapturedAt time.Time             `json:"captured_at"`
	Streams    []StreamRuntimeStatus `json:"streams"`
}

// Status returns an immutable point-in-time view of the runtime streams.
func (r *Runtime) Status() RuntimeStatus {
	r.statusMu.RLock()
	defer r.statusMu.RUnlock()

	streams := make([]StreamRuntimeStatus, 0, len(r.streamOrder))
	for _, streamID := range r.streamOrder {
		streams = append(streams, r.streams[streamID])
	}
	return RuntimeStatus{
		CapturedAt: time.Now().UTC(),
		Streams:    streams,
	}
}

func (r *Runtime) markStreamStarting(spec SourceSpec) {
	r.updateStreamStatus(spec.StreamID, func(st *StreamRuntimeStatus, now time.Time) {
		st.Kind = spec.Kind
		st.Phase = StreamPhaseStarting
		st.Running = true
		st.LastError = ""
		st.NextRetryAt = time.Time{}
		if st.LastSessionAt.IsZero() {
			st.LastSessionAt = now
		}
	})
}

func (r *Runtime) markStreamShipping(streamID string, resumeFrom uint64) {
	r.updateStreamStatus(streamID, func(st *StreamRuntimeStatus, now time.Time) {
		st.Phase = StreamPhaseShipping
		st.Running = true
		st.LastResumeFrom = resumeFrom
		st.LastSessionAt = now
		st.LastError = ""
		st.NextRetryAt = time.Time{}
	})
}

func (r *Runtime) markStreamFrame(streamID string, frame core.Frame) {
	if frame.Seq == 0 {
		return
	}
	r.updateStreamStatus(streamID, func(st *StreamRuntimeStatus, now time.Time) {
		st.Phase = StreamPhaseShipping
		st.Running = true
		if frame.Seq > st.LastFrameSeq {
			st.LastFrameSeq = frame.Seq
			st.LastFrameAt = now
			st.LastSourceLSN = frame.SourceLSN
		}
	})
}

func (r *Runtime) markStreamAcked(streamID string, cp Checkpoint) {
	r.updateStreamStatus(streamID, func(st *StreamRuntimeStatus, now time.Time) {
		st.Phase = StreamPhaseShipping
		st.Running = true
		if cp.AckedSeq > st.LastAckSeq {
			st.LastAckSeq = cp.AckedSeq
			if cp.UpdatedAt.IsZero() {
				st.LastAckAt = now
			} else {
				st.LastAckAt = cp.UpdatedAt.UTC()
			}
			st.LastSourceLSN = cp.SourceLSN
		}
	})
}

func (r *Runtime) markStreamReconnecting(streamID string, err error, backoff time.Duration) {
	r.updateStreamStatus(streamID, func(st *StreamRuntimeStatus, now time.Time) {
		st.Phase = StreamPhaseReconnecting
		st.Running = true
		st.Reconnects++
		st.NextRetryAt = now.Add(backoff)
		if err != nil {
			st.LastError = err.Error()
		}
	})
}

func (r *Runtime) markStreamCompleted(streamID string) {
	r.updateStreamStatus(streamID, func(st *StreamRuntimeStatus, _ time.Time) {
		st.Phase = StreamPhaseCompleted
		st.Running = false
		st.NextRetryAt = time.Time{}
		st.LastError = ""
	})
}

func (r *Runtime) markStreamStopped(streamID string) {
	r.updateStreamStatus(streamID, func(st *StreamRuntimeStatus, _ time.Time) {
		st.Phase = StreamPhaseStopped
		st.Running = false
		st.NextRetryAt = time.Time{}
	})
}

func (r *Runtime) markStreamFailed(streamID string, err error) {
	r.updateStreamStatus(streamID, func(st *StreamRuntimeStatus, _ time.Time) {
		st.Phase = StreamPhaseFailed
		st.Running = false
		st.NextRetryAt = time.Time{}
		if err != nil {
			st.LastError = err.Error()
		}
	})
}

func (r *Runtime) observeStreamFrames(ctx context.Context, streamID string, frames <-chan core.Frame) <-chan core.Frame {
	out := make(chan core.Frame)
	go func() {
		defer close(out)
		for {
			select {
			case <-ctx.Done():
				return
			case frame, ok := <-frames:
				if !ok {
					return
				}
				r.markStreamFrame(streamID, frame)
				select {
				case <-ctx.Done():
					return
				case out <- frame:
				}
			}
		}
	}()
	return out
}

func (r *Runtime) updateStreamStatus(streamID string, mutate func(*StreamRuntimeStatus, time.Time)) {
	now := time.Now().UTC()
	r.statusMu.Lock()
	defer r.statusMu.Unlock()

	st := r.streams[streamID]
	if st.StreamID == "" {
		st.StreamID = streamID
		r.streamOrder = append(r.streamOrder, streamID)
	}
	mutate(&st, now)
	st.UpdatedAt = now
	r.streams[streamID] = st
}
