package vmcapture

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/clario360/platform/internal/datastream/core"
)

// HypervisorBinding abstracts WHERE a VM's disk blocks come from. The real,
// tested binding is FileHypervisorBinding (a disk image FILE); production
// adapters (VMware CBT, libvirt) implement the same interface to open a snapshot
// and expose it as a BlockSource. Putting the hypervisor behind this narrow
// seam is what lets the CBT engine and the VMDiskCapturer be fully exercised
// with real I/O and no hypervisor — mirroring how internal/dr/copilot keeps
// real tools behind a provider interface.
type HypervisorBinding interface {
	// Open prepares a consistent, point-in-time view of the disk and returns a
	// BlockSource to read it block by block, plus a consistency marker string
	// (the snapshot wall-clock / hypervisor change-id) to pin the recovery
	// point. The caller closes the returned BlockSource.
	Open(ctx context.Context) (src BlockSource, marker string, err error)
}

// FileHypervisorBinding is the real binding: it opens a disk IMAGE FILE as a
// BlockSource. The marker is the file's modtime+size, a stable consistency
// anchor for a file-backed disk. This is the fully-real, tested implementation.
type FileHypervisorBinding struct {
	Path      string
	BlockSize int
	// Now overrides the marker clock in tests; nil uses time.Now.
	Now func() time.Time
}

// Open opens the image file as a block source and derives a consistency marker
// from its current size and modtime.
func (b FileHypervisorBinding) Open(ctx context.Context) (BlockSource, string, error) {
	if b.Path == "" {
		return nil, "", fmt.Errorf("%w: file binding requires a path", ErrInvalid)
	}
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	src, err := NewFileBlockSource(b.Path, b.BlockSize)
	if err != nil {
		return nil, "", err
	}
	size, err := src.Size()
	if err != nil {
		_ = src.Close()
		return nil, "", err
	}
	now := b.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	marker := fmt.Sprintf("file-snapshot:size=%d:at=%d", size, now().UnixNano())
	return src, marker, nil
}

// VMStateStore loads and persists the changed-block map for a VM disk source.
// The capturer uses it to fetch the prior epoch's block map (for the diff) and
// to persist the new map + epoch atomically. The service layer supplies a
// DB-backed implementation; tests supply an in-memory one.
type VMStateStore interface {
	// LoadVMState returns the persisted block map for sourceID, or a zero-value
	// VMState (with Epoch 0 and a nil BlockHashes) when none exists yet.
	LoadVMState(ctx context.Context, sourceID string) (VMState, error)
	// SaveEpoch persists the new block map and records the capture epoch. It
	// must be atomic: the state row and the epoch row commit together.
	SaveEpoch(ctx context.Context, in SaveEpochInput) (Epoch, error)
}

// SaveEpochInput carries everything one completed VM capture pass persists.
type SaveEpochInput struct {
	TenantID       string
	SourceID       string
	StreamID       string
	Epoch          int
	EpochKind      string
	FromSeq        int64
	ToSeq          int64
	FrameCount     int
	ChangedUnits   int
	TotalUnits     int
	PayloadBytes   int64
	ContentHash    string
	SourceMarker   string
	BlockSizeBytes int
	ImageBytes     int64
	BlockHashes    []string
}

// VMDiskCapturer is a real core.Capturer: each Start call runs ONE
// changed-block-tracking pass over the bound disk and emits the resulting
// frames on out. The first pass (no prior block map) is a full BASE capture;
// every later pass emits only changed blocks. The capturer persists the new
// block map + epoch through its VMStateStore so the NEXT Start is incremental.
//
// It implements core.Capturer (Start/Kind/Close) so the existing pipeline ships
// its FrameKindFileDelta frames; the core FileApplier reconstructs the disk
// image byte-identically on the recovery target.
type VMDiskCapturer struct {
	tenantID  string
	sourceID  string
	streamID  string
	binding   HypervisorBinding
	state     VMStateStore
	blockSize int

	mu     sync.Mutex
	closed bool
	// lastEpoch is the epoch the most recent Start persisted; exposed via
	// LastEpoch for the service to report the run outcome.
	lastEpoch *Epoch
}

// VMDiskConfig wires a VMDiskCapturer.
type VMDiskConfig struct {
	TenantID  string
	SourceID  string
	StreamID  string
	Binding   HypervisorBinding
	State     VMStateStore
	BlockSize int
}

// NewVMDiskCapturer constructs a VMDiskCapturer. Binding and State are required.
func NewVMDiskCapturer(cfg VMDiskConfig) (*VMDiskCapturer, error) {
	if cfg.StreamID == "" {
		return nil, fmt.Errorf("%w: stream id is required", ErrInvalid)
	}
	if cfg.SourceID == "" {
		return nil, fmt.Errorf("%w: source id is required", ErrInvalid)
	}
	if cfg.TenantID == "" {
		return nil, fmt.Errorf("%w: tenant id is required", ErrInvalid)
	}
	if cfg.Binding == nil {
		return nil, fmt.Errorf("%w: hypervisor binding is required", ErrNotConfigured)
	}
	if cfg.State == nil {
		return nil, fmt.Errorf("%w: vm state store is required", ErrNotConfigured)
	}
	bs := cfg.BlockSize
	if bs <= 0 {
		bs = DefaultBlockSize
	}
	return &VMDiskCapturer{
		tenantID:  cfg.TenantID,
		sourceID:  cfg.SourceID,
		streamID:  cfg.StreamID,
		binding:   cfg.Binding,
		state:     cfg.State,
		blockSize: bs,
	}, nil
}

// Kind reports the frame kind this capturer produces (file-delta blocks).
func (c *VMDiskCapturer) Kind() core.FrameKind { return core.FrameKindFileDelta }

// Close marks the capturer closed; it holds no long-lived handles between Start
// calls (the binding is opened per pass), so this is a latch for the interface.
func (c *VMDiskCapturer) Close() error {
	c.mu.Lock()
	c.closed = true
	c.mu.Unlock()
	return nil
}

// LastEpoch returns the epoch the most recent successful Start persisted, or nil
// if Start has not completed a pass.
func (c *VMDiskCapturer) LastEpoch() *Epoch {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lastEpoch
}

// Start runs one CBT pass and emits its frames on out, assigning Seq strictly
// above resumeFrom. It loads the prior block map, opens a consistent disk view
// through the binding, runs RunCBT, ships the frames, then persists the new
// block map + epoch. resumeFrom (the last durably-applied Seq) is honored so a
// resumed pass re-ships only the un-acked tail of the SAME pass; a fresh pass
// passes the source's last_seq.
func (c *VMDiskCapturer) Start(ctx context.Context, resumeFrom uint64, out chan<- core.Frame) error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return fmt.Errorf("%w: capturer is closed", ErrInvalid)
	}
	c.mu.Unlock()

	prior, err := c.state.LoadVMState(ctx, c.sourceID)
	if err != nil {
		return fmt.Errorf("vmcapture: load prior block map: %w", err)
	}

	src, marker, err := c.binding.Open(ctx)
	if err != nil {
		return fmt.Errorf("vmcapture: open disk binding: %w", err)
	}
	defer func() { _ = src.Close() }()

	// A geometry change (block size differs) invalidates the prior map: force a
	// full re-base by discarding the prior hashes.
	priorHashes := prior.BlockHashes
	if prior.BlockSizeBytes != 0 && prior.BlockSizeBytes != src.BlockSize() {
		priorHashes = nil
	}

	result, err := RunCBT(ctx, src, c.streamID, resumeFrom, priorHashes, marker)
	if err != nil {
		return err
	}

	// Ship the frames. Respect cancellation between frames.
	for _, f := range result.Frames {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case out <- f:
		}
	}

	epochNum := prior.Epoch + 1
	epochKind := EpochIncremental
	if prior.Epoch == 0 || len(priorHashes) == 0 {
		epochKind = EpochBase
	}
	fromSeq := int64(resumeFrom) + 1
	toSeq := int64(resumeFrom) + int64(len(result.Frames))

	epoch, err := c.state.SaveEpoch(ctx, SaveEpochInput{
		TenantID:       c.tenantID,
		SourceID:       c.sourceID,
		StreamID:       c.streamID,
		Epoch:          epochNum,
		EpochKind:      epochKind,
		FromSeq:        fromSeq,
		ToSeq:          toSeq,
		FrameCount:     len(result.Frames),
		ChangedUnits:   result.ChangedBlocks,
		TotalUnits:     result.TotalBlocks,
		PayloadBytes:   result.PayloadBytes,
		ContentHash:    EpochContentHash(result.BlockHashes),
		SourceMarker:   result.SourceMarker,
		BlockSizeBytes: src.BlockSize(),
		ImageBytes:     result.ImageBytes,
		BlockHashes:    result.BlockHashes,
	})
	if err != nil {
		return fmt.Errorf("vmcapture: persist epoch: %w", err)
	}

	c.mu.Lock()
	c.lastEpoch = &epoch
	c.mu.Unlock()
	return nil
}
