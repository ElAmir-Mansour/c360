package vmcapture_test

import (
	"context"
	"os"
	"sync"
	"testing"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/vmcapture"
)

// memVMState is an in-memory VMStateStore for capturer tests: it keeps the
// latest block map per source and records every saved epoch, so a test can
// assert the base/incremental lineage advances.
type memVMState struct {
	mu     sync.Mutex
	state  map[string]vmcapture.VMState
	epochs []vmcapture.Epoch
}

func newMemVMState() *memVMState {
	return &memVMState{state: map[string]vmcapture.VMState{}}
}

func (m *memVMState) LoadVMState(ctx context.Context, sourceID string) (vmcapture.VMState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state[sourceID], nil
}

func (m *memVMState) SaveEpoch(ctx context.Context, in vmcapture.SaveEpochInput) (vmcapture.Epoch, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state[in.SourceID] = vmcapture.VMState{
		SourceID:       in.SourceID,
		BlockSizeBytes: in.BlockSizeBytes,
		ImageBytes:     in.ImageBytes,
		BlockCount:     len(in.BlockHashes),
		Epoch:          in.Epoch,
		BlockHashes:    in.BlockHashes,
	}
	e := vmcapture.Epoch{
		SourceID:     in.SourceID,
		StreamID:     in.StreamID,
		Epoch:        in.Epoch,
		EpochKind:    in.EpochKind,
		FromSeq:      in.FromSeq,
		ToSeq:        in.ToSeq,
		FrameCount:   in.FrameCount,
		ChangedUnits: in.ChangedUnits,
		TotalUnits:   in.TotalUnits,
		ContentHash:  in.ContentHash,
		SourceMarker: in.SourceMarker,
	}
	m.epochs = append(m.epochs, e)
	return e, nil
}

// drain runs a capturer's Start, collecting every emitted frame.
func drain(t *testing.T, start func(out chan<- core.Frame) error) []core.Frame {
	t.Helper()
	out := make(chan core.Frame, 64)
	var frames []core.Frame
	done := make(chan struct{})
	go func() {
		for f := range out {
			frames = append(frames, f)
		}
		close(done)
	}()
	err := start(out)
	close(out)
	<-done
	if err != nil {
		t.Fatalf("capturer Start: %v", err)
	}
	return frames
}

// TestVMDiskCapturer_BaseThenIncremental drives the VMDiskCapturer through two
// passes against a real image file: the base epoch ships every block; after
// modifying one block, the incremental epoch ships only that block. The epoch
// lineage (base -> incremental) and the persisted block map advance.
func TestVMDiskCapturer_BaseThenIncremental(t *testing.T) {
	t.Parallel()
	const blocks = 4
	data := randomImage(t, blocks)
	path := writeImage(t, data)

	state := newMemVMState()
	binding := vmcapture.FileHypervisorBinding{Path: path, BlockSize: testBlockSize}

	cap1, err := vmcapture.NewVMDiskCapturer(vmcapture.VMDiskConfig{
		TenantID: "t1", SourceID: "s1", StreamID: "stream-1",
		Binding: binding, State: state, BlockSize: testBlockSize,
	})
	if err != nil {
		t.Fatalf("NewVMDiskCapturer: %v", err)
	}
	baseFrames := drain(t, func(out chan<- core.Frame) error {
		return cap1.Start(context.Background(), 0, out)
	})
	baseEpoch := cap1.LastEpoch()
	if baseEpoch == nil || baseEpoch.EpochKind != vmcapture.EpochBase {
		t.Fatalf("base epoch kind = %v, want base", baseEpoch)
	}
	if baseEpoch.ChangedUnits != blocks {
		t.Fatalf("base changed units = %d, want %d", baseEpoch.ChangedUnits, blocks)
	}
	// base: 4 blocks + manifest + marker = 6 frames.
	if len(baseFrames) != blocks+2 {
		t.Fatalf("base frames = %d, want %d", len(baseFrames), blocks+2)
	}

	// Modify block 2 and re-capture from the durable last seq.
	modified := append([]byte(nil), data...)
	overwriteBlock(modified, 2)
	if err := os.WriteFile(path, modified, 0o600); err != nil {
		t.Fatalf("rewrite: %v", err)
	}

	cap2, err := vmcapture.NewVMDiskCapturer(vmcapture.VMDiskConfig{
		TenantID: "t1", SourceID: "s1", StreamID: "stream-1",
		Binding: binding, State: state, BlockSize: testBlockSize,
	})
	if err != nil {
		t.Fatalf("NewVMDiskCapturer 2: %v", err)
	}
	resumeFrom := baseEpoch.ToSeq
	incFrames := drain(t, func(out chan<- core.Frame) error {
		return cap2.Start(context.Background(), uint64(resumeFrom), out)
	})
	incEpoch := cap2.LastEpoch()
	if incEpoch == nil || incEpoch.EpochKind != vmcapture.EpochIncremental {
		t.Fatalf("inc epoch kind = %v, want incremental", incEpoch)
	}
	if incEpoch.Epoch != 2 {
		t.Fatalf("inc epoch number = %d, want 2", incEpoch.Epoch)
	}
	if incEpoch.ChangedUnits != 1 {
		t.Fatalf("inc changed units = %d, want 1", incEpoch.ChangedUnits)
	}
	// inc: 1 block + manifest + marker = 3 frames.
	if len(incFrames) != 3 {
		t.Fatalf("inc frames = %d, want 3", len(incFrames))
	}
	if incFrames[0].Seq != uint64(resumeFrom)+1 {
		t.Fatalf("inc first seq = %d, want %d", incFrames[0].Seq, resumeFrom+1)
	}

	// The two epochs are recorded in lineage order.
	if len(state.epochs) != 2 {
		t.Fatalf("recorded epochs = %d, want 2", len(state.epochs))
	}

	// Reconstruct the modified disk from base+incremental frames via the REAL
	// core FileApplier.
	all := append(append([]core.Frame(nil), baseFrames...), incFrames...)
	assertReconstructs(t, all, modified)
}

// TestVMDiskCapturer_NoChangeEpoch proves a re-capture with no disk change still
// records an epoch (the consistency marker advances) but ships zero blocks.
func TestVMDiskCapturer_NoChangeEpoch(t *testing.T) {
	t.Parallel()
	data := randomImage(t, 3)
	path := writeImage(t, data)
	state := newMemVMState()
	binding := vmcapture.FileHypervisorBinding{Path: path, BlockSize: testBlockSize}

	c1, _ := vmcapture.NewVMDiskCapturer(vmcapture.VMDiskConfig{
		TenantID: "t1", SourceID: "s1", StreamID: "stream-1", Binding: binding, State: state, BlockSize: testBlockSize,
	})
	_ = drain(t, func(out chan<- core.Frame) error { return c1.Start(context.Background(), 0, out) })
	resume := c1.LastEpoch().ToSeq

	c2, _ := vmcapture.NewVMDiskCapturer(vmcapture.VMDiskConfig{
		TenantID: "t1", SourceID: "s1", StreamID: "stream-1", Binding: binding, State: state, BlockSize: testBlockSize,
	})
	frames := drain(t, func(out chan<- core.Frame) error { return c2.Start(context.Background(), uint64(resume), out) })
	if c2.LastEpoch().ChangedUnits != 0 {
		t.Fatalf("no-change epoch changed units = %d, want 0", c2.LastEpoch().ChangedUnits)
	}
	if len(frames) != 1 || frames[0].Kind != core.FrameKindMarker {
		t.Fatalf("no-change pass frames = %v, want a single MARKER", frames)
	}
}

// --- K8s capturer over an in-memory state store -----------------------------

type memK8sState struct {
	mu     sync.Mutex
	prior  *vmcapture.K8sManifestSet
	epoch  int
	epochs []vmcapture.Epoch
}

func (m *memK8sState) LoadK8sState(ctx context.Context, sourceID string) (*vmcapture.K8sManifestSet, int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.prior, m.epoch, nil
}

func (m *memK8sState) SaveK8sEpoch(ctx context.Context, in vmcapture.SaveK8sEpochInput) (vmcapture.Epoch, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prior = in.Set
	m.epoch = in.Epoch
	e := vmcapture.Epoch{
		SourceID: in.SourceID, StreamID: in.StreamID, Epoch: in.Epoch, EpochKind: in.EpochKind,
		FromSeq: in.FromSeq, ToSeq: in.ToSeq, FrameCount: in.FrameCount,
		ChangedUnits: in.ChangedUnits, TotalUnits: in.TotalUnits, ContentHash: in.ContentHash,
		SourceMarker: in.SourceMarker, SetSummary: in.Set.Headers(),
	}
	m.epochs = append(m.epochs, e)
	return e, nil
}

// TestK8sWorkloadCapturer_BaseThenChangedConfigMap runs the capturer twice over
// a fixture source. The base captures the whole set; after one ConfigMap
// changes, the incremental epoch reports exactly one changed resource while
// still shipping the consistent whole set.
func TestK8sWorkloadCapturer_BaseThenChangedConfigMap(t *testing.T) {
	t.Parallel()

	fixture := &vmcapture.FixtureResourceSource{Resources: fixtureSet(t)}
	state := &memK8sState{}

	c1, err := vmcapture.NewK8sWorkloadCapturer(vmcapture.K8sWorkloadConfig{
		TenantID: "t1", SourceID: "s1", StreamID: "stream-k8s", Source: fixture, State: state,
	})
	if err != nil {
		t.Fatalf("NewK8sWorkloadCapturer: %v", err)
	}
	baseFrames := drain(t, func(out chan<- core.Frame) error { return c1.Start(context.Background(), 0, out) })
	base := c1.LastEpoch()
	if base.EpochKind != vmcapture.EpochBase {
		t.Fatalf("base epoch kind = %s, want base", base.EpochKind)
	}
	if base.TotalUnits != 6 {
		t.Fatalf("base total units = %d, want 6", base.TotalUnits)
	}
	// 6 resources + 1 PVC link + 1 marker = 8.
	if len(baseFrames) != 8 {
		t.Fatalf("base frames = %d, want 8", len(baseFrames))
	}

	// Change one ConfigMap's data, keep everything else identical.
	next := fixtureSet(t)
	for i, r := range next {
		if r.Kind == "ConfigMap" && r.Namespace == "prod" {
			next[i] = rawResource(t, "ConfigMap", "prod", "app-config", `{"kind":"ConfigMap","metadata":{"name":"app-config","namespace":"prod"},"data":{"k":"DIFFERENT"}}`)
		}
	}
	fixture.Resources = next

	c2, err := vmcapture.NewK8sWorkloadCapturer(vmcapture.K8sWorkloadConfig{
		TenantID: "t1", SourceID: "s1", StreamID: "stream-k8s", Source: fixture, State: state,
	})
	if err != nil {
		t.Fatalf("NewK8sWorkloadCapturer 2: %v", err)
	}
	resume := base.ToSeq
	_ = drain(t, func(out chan<- core.Frame) error { return c2.Start(context.Background(), uint64(resume), out) })
	inc := c2.LastEpoch()
	if inc.EpochKind != vmcapture.EpochIncremental || inc.Epoch != 2 {
		t.Fatalf("inc epoch = %+v, want incremental #2", inc)
	}
	if inc.ChangedUnits != 1 {
		t.Fatalf("inc changed units = %d, want 1 (one ConfigMap modified)", inc.ChangedUnits)
	}
	if inc.ContentHash == base.ContentHash {
		t.Fatal("set hash did not change after a ConfigMap modification")
	}

	// A THIRD pass with no change reports zero changed resources and the same
	// content hash — the no-change proof.
	c3, _ := vmcapture.NewK8sWorkloadCapturer(vmcapture.K8sWorkloadConfig{
		TenantID: "t1", SourceID: "s1", StreamID: "stream-k8s", Source: fixture, State: state,
	})
	_ = drain(t, func(out chan<- core.Frame) error { return c3.Start(context.Background(), uint64(inc.ToSeq), out) })
	noop := c3.LastEpoch()
	if noop.ChangedUnits != 0 {
		t.Fatalf("no-change pass changed units = %d, want 0", noop.ChangedUnits)
	}
	if noop.ContentHash != inc.ContentHash {
		t.Fatal("content hash changed across a no-change pass")
	}
}
