package service

import (
	"bytes"
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/audit/dto"
	"github.com/clario360/platform/internal/audit/model"
)

// ExportJobStore is a minimal in-process store + worker for async audit log
// exports (G16). A POST enqueues a job and returns immediately with a job_id;
// a single background worker drains the queue, runs the export to an in-memory
// buffer, and records the result so the client can poll and then download.
//
// This is deliberately in-process: it keeps the audit service free of an
// external queue dependency for what is a low-volume operator workflow. The
// trade-off is that jobs do not survive a restart — acceptable because the
// caller can simply re-submit, and the source data (the hash chain) is durable.
// A bounded janitor evicts finished jobs after a TTL so the buffer cannot grow
// without limit.
type ExportJobStore struct {
	exportSvc *ExportService
	logger    zerolog.Logger

	mu   sync.RWMutex
	jobs map[string]*exportJobState

	queue   chan string
	ttl     time.Duration
	maxJobs int
}

// exportJobState holds the metadata plus the rendered output for a job. The
// payload is kept only after the job completes and is dropped by the janitor.
type exportJobState struct {
	job         model.ExportJob
	cfg         *dto.ExportConfig
	roles       []string
	payload     []byte
	contentType string
	filename    string
}

// NewExportJobStore creates a store with a single background worker. Call Start
// to launch the worker bound to a context; it stops when the context is done.
func NewExportJobStore(exportSvc *ExportService, logger zerolog.Logger) *ExportJobStore {
	return &ExportJobStore{
		exportSvc: exportSvc,
		logger:    logger.With().Str("component", "audit-export-jobs").Logger(),
		jobs:      make(map[string]*exportJobState),
		queue:     make(chan string, 256),
		ttl:       1 * time.Hour,
		maxJobs:   512,
	}
}

// Start launches the worker and a periodic janitor. Both return when ctx is done.
func (s *ExportJobStore) Start(ctx context.Context) {
	go s.worker(ctx)
	go s.janitor(ctx)
}

// Enqueue registers a new export job and schedules it for background processing.
// It returns the job_id. The caller has already validated cfg and resolved roles.
func (s *ExportJobStore) Enqueue(cfg *dto.ExportConfig, roles []string) string {
	jobID := uuid.NewString()
	now := time.Now().UTC()

	s.mu.Lock()
	// Evict the oldest finished job if we are at capacity.
	if len(s.jobs) >= s.maxJobs {
		s.evictOldestLocked()
	}
	s.jobs[jobID] = &exportJobState{
		job: model.ExportJob{
			JobID:     jobID,
			TenantID:  cfg.TenantID,
			Status:    "processing",
			Format:    string(cfg.Format),
			CreatedAt: now,
		},
		cfg:   cfg,
		roles: roles,
	}
	s.mu.Unlock()

	// Non-blocking enqueue: the buffered channel absorbs bursts; if it is full
	// the job is marked failed rather than blocking the request goroutine.
	select {
	case s.queue <- jobID:
	default:
		s.fail(jobID, fmt.Errorf("export queue is full, retry shortly"))
	}
	return jobID
}

// Status returns a snapshot of the job for the given id scoped to tenantID, or
// (nil,false) if it does not exist / belongs to another tenant. Tenant scoping
// here is a defense-in-depth check on top of the route's RBAC gate so one
// operator cannot poll another tenant's export by guessing a job_id.
func (s *ExportJobStore) Status(jobID, tenantID string) (model.ExportJob, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	st, ok := s.jobs[jobID]
	if !ok || st.job.TenantID != tenantID {
		return model.ExportJob{}, false
	}
	return st.job, true
}

// Download returns the rendered payload for a completed job scoped to tenantID.
// It returns (nil,"","",false) when the job is missing, not yet complete, or
// belongs to another tenant.
func (s *ExportJobStore) Download(jobID, tenantID string) (payload []byte, contentType, filename string, ok bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	st, exists := s.jobs[jobID]
	if !exists || st.job.TenantID != tenantID || st.job.Status != "completed" {
		return nil, "", "", false
	}
	return st.payload, st.contentType, st.filename, true
}

func (s *ExportJobStore) worker(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case jobID := <-s.queue:
			s.process(ctx, jobID)
		}
	}
}

func (s *ExportJobStore) process(ctx context.Context, jobID string) {
	s.mu.RLock()
	st, ok := s.jobs[jobID]
	s.mu.RUnlock()
	if !ok {
		return
	}

	var buf bytes.Buffer
	var count int64
	var err error
	var contentType, filename string
	now := time.Now().UTC().Format("2006-01-02")

	switch st.cfg.Format {
	case dto.ExportFormatNDJSON:
		count, err = s.exportSvc.ExportNDJSON(ctx, &buf, st.cfg, st.roles)
		contentType = "application/x-ndjson"
		filename = fmt.Sprintf("audit_export_%s.ndjson", now)
	default:
		count, err = s.exportSvc.ExportCSV(ctx, &buf, st.cfg, st.roles)
		contentType = "text/csv"
		filename = fmt.Sprintf("audit_export_%s.csv", now)
	}

	if err != nil {
		s.fail(jobID, err)
		return
	}

	// Publish result under the lock so Download never races the worker.
	s.mu.Lock()
	if cur, exists := s.jobs[jobID]; exists {
		cur.payload = buf.Bytes()
		cur.contentType = contentType
		cur.filename = filename
		cur.job.RecordCount = count
		cur.job.Status = "completed"
		cur.job.CompletedAt = time.Now().UTC()
		cur.job.DownloadURL = fmt.Sprintf("/api/v1/audit/exports/%s/download", jobID)
	}
	s.mu.Unlock()

	s.logger.Info().Str("job_id", jobID).Int64("records", count).Msg("async export completed")
}

func (s *ExportJobStore) fail(jobID string, err error) {
	s.mu.Lock()
	if cur, exists := s.jobs[jobID]; exists {
		cur.job.Status = "failed"
		cur.job.Error = err.Error()
		cur.job.CompletedAt = time.Now().UTC()
	}
	s.mu.Unlock()
	s.logger.Error().Err(err).Str("job_id", jobID).Msg("async export failed")
}

func (s *ExportJobStore) janitor(ctx context.Context) {
	t := time.NewTicker(5 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			cutoff := time.Now().UTC().Add(-s.ttl)
			s.mu.Lock()
			for id, st := range s.jobs {
				if st.job.Status != "processing" && !st.job.CompletedAt.IsZero() && st.job.CompletedAt.Before(cutoff) {
					delete(s.jobs, id)
				}
			}
			s.mu.Unlock()
		}
	}
}

// evictOldestLocked removes the oldest finished job. Caller must hold s.mu.
func (s *ExportJobStore) evictOldestLocked() {
	var oldestID string
	var oldest time.Time
	for id, st := range s.jobs {
		if st.job.Status == "processing" {
			continue
		}
		if oldestID == "" || st.job.CreatedAt.Before(oldest) {
			oldestID = id
			oldest = st.job.CreatedAt
		}
	}
	if oldestID != "" {
		delete(s.jobs, oldestID)
	}
}
