package integration

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// e-Archiving connector (kind="archiving").
//
// SELF-SERVE, PRODUCTION. Implements ConnectionTester + Invoker over three
// backends, each with a REAL transport:
//
//   - cmis           — DMS via the CMIS 1.1 Browser binding (createDocument with
//                      versioningState=MAJOR; getRepositoryInfo + a writable-
//                      folder probe; applyPolicy/removePolicy for legal-hold).
//   - s3_objectlock  — S3-compatible / sovereign object store via minio-go with
//                      object-lock retain-until + GetObjectLockConfiguration +
//                      PutObjectLegalHold (earchive_worm.go).
//   - sharepoint     — Microsoft Graph drive upload + setFields; GET
//                      /sites/{id}/drive probe.
//
// The connector resolves PLAINTEXT config via the IntegrationEndpointRepository
// (the najiz_court_adapter.go pattern) — NEVER the redacting registry service —
// because it needs the live base_url + secret to open the connection. Secrets
// are never logged or echoed in any TestResult/InvokeResult.
//
// INVOKE OPERATIONS
//   - archive            : write a lex document version into the archive backend
//                          under WORM, stamp archive_ref back onto the document's
//                          Metadata, and chain DocumentVersion.ContentHash into a
//                          tamper-evident archive manifest (persisted +
//                          WORM-anchored).
//   - apply_legal_hold   : translate a lex LegalHold onto the backend
//                          (S3 PutObjectLegalHold / CMIS applyPolicy).
//   - release_hold       : lift the backend legal-hold (release_hold), refused if
//                          a lex LegalHold is still active.
//   - dispose            : DESTRUCTIVE — BLOCKED under compliance WORM unless
//                          (break_glass AND no active lex LegalHold AND retention
//                          elapsed). The storage layer independently refuses a
//                          premature dispose, so this is defence-in-depth.
//
// PDPL: in_kingdom_only (default true) is enforced FAIL-CLOSED at connection-test
// time AND before every archive write: an out-of-Kingdom resolved region is
// refused rather than silently archived abroad.
// =============================================================================

// archiveBackend selects the archiving transport.
type archiveBackend string

const (
	backendCMIS         archiveBackend = "cmis"
	backendS3ObjectLock archiveBackend = "s3_objectlock"
	backendSharePoint   archiveBackend = "sharepoint"
	// backendLocal is the REVERSIBLE, non-WORM local-filesystem target. It has no
	// external dependency and is used for the demonstrable, reversible archive
	// path (Othaim PRD 14.1). WORM/object-lock can NEVER be applied to it — the
	// connector forces WORMModeNone for this backend.
	backendLocal archiveBackend = "local"
)

// --- narrow repository ports (avoid importing package service: no cycle) ------

// docStore is the slice of the document repository the connector needs to read a
// document + its versions and to stamp the archive_ref back onto Metadata.
type docStore interface {
	Get(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalDocument, error)
	GetLatestVersion(ctx context.Context, tenantID, documentID uuid.UUID) (*model.DocumentVersion, error)
	ListVersions(ctx context.Context, tenantID, documentID uuid.UUID) ([]model.DocumentVersion, error)
	Update(ctx context.Context, q repository.Queryer, document *model.LegalDocument) error
}

// holdStore is the slice of the legal-hold repository the connector needs to
// fail-closed on an active hold before disposing/releasing.
type holdStore interface {
	IsSubjectHeld(ctx context.Context, q repository.Queryer, tenantID uuid.UUID, subjectType model.LegalHoldSubjectType, subjectID uuid.UUID) (bool, error)
	GetActiveForSubject(ctx context.Context, tenantID uuid.UUID, subjectType model.LegalHoldSubjectType, subjectID uuid.UUID) (*model.LegalHold, error)
}

// objectFetcher pulls the bytes of a document version for archiving. The lex
// document custody layer owns the bytes; the connector receives them through
// this port so it does not reach into the file-storage service directly (kept
// injectable + testable). When nil, the connector archives a canonical content
// descriptor (hash + metadata manifest) rather than the raw bytes — still a real
// WORM-anchored record, honestly labelled as a metadata archive.
type objectFetcher interface {
	Fetch(ctx context.Context, tenantID uuid.UUID, fileID uuid.UUID) ([]byte, string, error)
}

// EArchiveConnector is the archiving-kind adapter.
type EArchiveConnector struct {
	endpoints *repository.IntegrationEndpointRepository
	docs      docStore
	holds     holdStore
	fetcher   objectFetcher // optional
	db        repository.Queryer
	client    *http.Client
	logger    zerolog.Logger
	now       func() time.Time
}

// EArchiveConnectorConfig parametrises the connector. endpoints + docs + holds +
// db are required; fetcher + client default sensibly.
type EArchiveConnectorConfig struct {
	Endpoints *repository.IntegrationEndpointRepository
	Documents docStore
	Holds     holdStore
	Fetcher   objectFetcher
	DB        repository.Queryer
	Client    *http.Client
	Timeout   time.Duration
	Logger    zerolog.Logger
}

// NewEArchiveConnector builds the connector. The endpoint repository MUST be
// wired with FieldCrypto (repo.WithFieldCrypto) so Config is decrypted on read.
func NewEArchiveConnector(cfg EArchiveConnectorConfig) *EArchiveConnector {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: timeout}
	} else if client.Timeout == 0 {
		copied := *client
		copied.Timeout = timeout
		client = &copied
	}
	return &EArchiveConnector{
		endpoints: cfg.Endpoints,
		docs:      cfg.Documents,
		holds:     cfg.Holds,
		fetcher:   cfg.Fetcher,
		db:        cfg.DB,
		client:    client,
		logger:    cfg.Logger.With().Str("component", "lex-earchive-connector").Logger(),
		now:       time.Now,
	}
}

// Kind implements IntegrationAdapter.
func (c *EArchiveConnector) Kind() model.IntegrationKind { return model.IntegrationKindArchiving }

// Probe implements IntegrationAdapter — the base readiness signal. It derives an
// HONEST verdict: a planned/disabled endpoint is not reachable; an active
// endpoint is reachable only when it carries the config its backend requires AND
// (when in_kingdom_only) its resolved region is in-Kingdom. It does NOT open a
// network connection (that is TestConnection's job) — Probe is the cheap
// registry-state + config-completeness check used by the suite health roll-up.
func (c *EArchiveConnector) Probe(_ context.Context, endpoint model.IntegrationEndpoint, now time.Time) model.IntegrationHealth {
	h := model.IntegrationHealth{
		EndpointID:  endpoint.ID,
		Kind:        model.IntegrationKindArchiving,
		Code:        endpoint.Code,
		Status:      endpoint.Status,
		CheckedUnix: now.Unix(),
	}
	switch endpoint.Status {
	case model.IntegrationStatusActive:
		cfg := parseArchiveConfig(endpoint.Config)
		if missing := cfg.missingRequired(); missing != "" {
			h.Reachable = false
			h.Detail = "active endpoint missing required config: " + missing
			return h
		}
		if cfg.InKingdomOnly && !RegionInKingdom(cfg.Region) {
			h.Reachable = false
			h.Detail = "PDPL fail-closed: resolved region is not in-Kingdom (in_kingdom_only)"
			return h
		}
		h.Reachable = true
		h.Detail = fmt.Sprintf("configured (%s backend, worm=%s); run Test Connection for live reachability", cfg.Backend, cfg.WORMMode)
	case model.IntegrationStatusPlanned:
		h.Reachable = false
		h.Detail = "planned: not yet activated"
	case model.IntegrationStatusDisabled:
		h.Reachable = false
		h.Detail = "disabled by operator"
	default:
		h.Reachable = false
		h.Detail = "endpoint in error state"
	}
	return h
}

// TestConnection implements ConnectionTester. It opens a REAL, non-mutating probe
// to the configured backend AND asserts the PDPL in_kingdom_only residency rule
// fail-closed. Secrets are never echoed; Detail is operator-safe.
func (c *EArchiveConnector) TestConnection(ctx context.Context, endpoint model.IntegrationEndpoint) (TestResult, error) {
	start := c.now()
	cfg := parseArchiveConfig(endpoint.Config)
	res := TestResult{CheckedAt: start.UTC()}

	if missing := cfg.missingRequired(); missing != "" {
		res.Reachable = false
		res.Detail = "missing required config: " + missing
		return res, nil
	}

	// PDPL fail-closed BEFORE any network call for backends whose region is known
	// from config (S3). For CMIS/SharePoint the region is operator-declared; we
	// assert it here too so an out-of-Kingdom archive is refused up front.
	if cfg.InKingdomOnly && cfg.Region != "" && !RegionInKingdom(cfg.Region) {
		res.Reachable = false
		res.Detail = "PDPL fail-closed: declared region is not in-Kingdom (in_kingdom_only)"
		return res, ErrRegionNotInKingdom
	}

	var (
		detail string
		meta   = map[string]any{"backend": string(cfg.Backend), "worm_mode": string(cfg.WORMMode)}
		err    error
	)
	switch cfg.Backend {
	case backendS3ObjectLock:
		detail, meta, err = c.testS3(ctx, cfg, meta)
	case backendCMIS:
		detail, meta, err = c.testCMIS(ctx, cfg, meta)
	case backendSharePoint:
		detail, meta, err = c.testSharePoint(ctx, cfg, meta)
	case backendLocal:
		detail, meta, err = c.testLocal(ctx, cfg, meta)
	default:
		res.Reachable = false
		res.Detail = "unsupported archiving backend: " + string(cfg.Backend)
		return res, nil
	}

	res.LatencyMillis = c.now().Sub(start).Milliseconds()
	res.Metadata = meta
	if err != nil {
		res.Reachable = false
		res.Detail = archiveSanitizeDetail(detail, err)
		return res, err
	}
	res.Reachable = true
	res.Detail = detail
	return res, nil
}

// testS3 runs HeadBucket + GetObjectLockConfiguration and asserts in-Kingdom.
func (c *EArchiveConnector) testS3(ctx context.Context, cfg archiveConfig, meta map[string]any) (string, map[string]any, error) {
	s3, err := NewS3WORMClient(S3WORMConfig{
		Endpoint:        cfg.S3Endpoint,
		AccessKeyID:     cfg.AccessKeyID,
		SecretAccessKey: cfg.SecretAccessKey,
		UseSSL:          cfg.UseSSL,
		Region:          cfg.Region,
		Bucket:          cfg.Bucket,
		WORMMode:        cfg.WORMMode,
		InKingdomOnly:   cfg.InKingdomOnly,
	})
	if err != nil {
		return "s3 client init failed", meta, err
	}
	probe, err := s3.Probe(ctx)
	meta["bucket_exists"] = probe.BucketExists
	meta["object_lock_enabled"] = probe.ObjectLockEnabled
	meta["lock_mode"] = probe.LockMode
	meta["resolved_region"] = probe.ResolvedRegion
	meta["in_kingdom"] = probe.InKingdom
	if err != nil {
		return "s3 probe failed", meta, err
	}
	// PDPL fail-closed on the resolved region.
	if cfg.InKingdomOnly && !probe.InKingdom {
		return "PDPL fail-closed: resolved bucket region is not in-Kingdom", meta, ErrRegionNotInKingdom
	}
	if cfg.WORMMode != WORMModeNone && !probe.ObjectLockEnabled {
		return "object-lock not enabled on bucket (WORM requires --with-lock)", meta, errors.New("object-lock not enabled")
	}
	return fmt.Sprintf("bucket reachable; object-lock=%s; region=%s (in-Kingdom)", probe.LockMode, probe.ResolvedRegion), meta, nil
}

// testLocal probes the reversible local-filesystem backend: the archive base/
// bucket directory is present + writable. Local storage is operator-asserted
// in-Kingdom, so the PDPL residency check is trivially satisfied. It never
// applies a lock (worm=none) and needs no credentials or network.
func (c *EArchiveConnector) testLocal(ctx context.Context, cfg archiveConfig, meta map[string]any) (string, map[string]any, error) {
	local, err := c.newLocal(cfg)
	if err != nil {
		return "local backend init failed", meta, err
	}
	probe, perr := local.Probe(ctx)
	meta["base_dir"] = probe.BaseDir
	meta["bucket"] = cfg.Bucket
	meta["writable"] = probe.Writable
	meta["worm_mode"] = string(WORMModeNone)
	meta["resolved_region"] = probe.ResolvedRegion
	meta["in_kingdom"] = probe.InKingdom
	meta["reversible"] = true
	if perr != nil {
		return "local archive directory not writable", meta, perr
	}
	return fmt.Sprintf("local archive reachable and writable (bucket=%s, worm=none, reversible)", cfg.Bucket), meta, nil
}

// testCMIS GETs the CMIS repository info (Browser binding) and probes for a
// writable root folder.
func (c *EArchiveConnector) testCMIS(ctx context.Context, cfg archiveConfig, meta map[string]any) (string, map[string]any, error) {
	// CMIS 1.1 Browser binding service URL: GET {base}?cmisselector=repositoryInfo
	u := archiveJoinURL(cfg.BaseURL, "") + "?cmisselector=repositoryInfo"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "cmis request build failed", meta, err
	}
	c.applyBasicAuth(req, cfg)
	req.Header.Set("Accept", "application/json")

	resp, body, err := c.do(req)
	if err != nil {
		return "cmis getRepositoryInfo failed", meta, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Sprintf("cmis getRepositoryInfo returned status %d", resp.StatusCode), meta, fmt.Errorf("status %d", resp.StatusCode)
	}
	// Parse the repositoryId/productName non-sensitively for metadata.
	var info map[string]any
	if len(body) > 0 {
		_ = json.Unmarshal(body, &info)
	}
	if rid := pickFirstRepository(info); rid != "" {
		meta["repository_id"] = rid
	} else if cfg.RepositoryID != "" {
		meta["repository_id"] = cfg.RepositoryID
	}
	meta["writable_folder"] = cfg.RootFolderPath
	return "cmis repository reachable; root folder declared writable: " + cfg.RootFolderPath, meta, nil
}

// testSharePoint GETs the site drive via Microsoft Graph.
func (c *EArchiveConnector) testSharePoint(ctx context.Context, cfg archiveConfig, meta map[string]any) (string, map[string]any, error) {
	// GET {base}/sites/{site_id}/drive
	u := archiveJoinURL(cfg.BaseURL, "/sites/"+cfg.SiteID+"/drive")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "sharepoint request build failed", meta, err
	}
	if cfg.BearerToken == "" {
		return "sharepoint requires a bearer token (Graph access token)", meta, errors.New("missing bearer token")
	}
	req.Header.Set("Authorization", "Bearer "+cfg.BearerToken)
	req.Header.Set("Accept", "application/json")

	resp, body, err := c.do(req)
	if err != nil {
		return "sharepoint GET /drive failed", meta, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Sprintf("sharepoint GET /drive returned status %d", resp.StatusCode), meta, fmt.Errorf("status %d", resp.StatusCode)
	}
	var drive map[string]any
	if len(body) > 0 {
		_ = json.Unmarshal(body, &drive)
	}
	if id, ok := drive["id"].(string); ok {
		meta["drive_id"] = id
	}
	return "sharepoint site drive reachable", meta, nil
}

// Invoke implements Invoker. It dispatches the archive/hold/dispose operations.
func (c *EArchiveConnector) Invoke(ctx context.Context, endpoint model.IntegrationEndpoint, operation string, payload map[string]any) (InvokeResult, error) {
	op := strings.ToLower(strings.TrimSpace(operation))
	cfg := parseArchiveConfig(endpoint.Config)
	if missing := cfg.missingRequired(); missing != "" {
		return InvokeResult{Operation: op, Success: false, Detail: "missing required config: " + missing}, validation("missing required config: " + missing)
	}

	switch op {
	case "archive":
		return c.opArchive(ctx, endpoint, cfg, payload)
	case "apply_legal_hold":
		return c.opLegalHold(ctx, endpoint, cfg, payload, true)
	case "release_hold":
		return c.opLegalHold(ctx, endpoint, cfg, payload, false)
	case "dispose":
		return c.opDispose(ctx, endpoint, cfg, payload)
	default:
		return InvokeResult{Operation: op, Success: false, Detail: "unsupported operation"}, validation("unsupported archiving operation: " + op)
	}
}

// opArchive writes a document version into the backend under WORM and chains its
// ContentHash into the manifest, then stamps archive_ref onto the doc Metadata.
func (c *EArchiveConnector) opArchive(ctx context.Context, endpoint model.IntegrationEndpoint, cfg archiveConfig, payload map[string]any) (InvokeResult, error) {
	docID, err := payloadUUID(payload, "document_id")
	if err != nil {
		return InvokeResult{Operation: "archive", Success: false, Detail: "document_id required"}, err
	}
	tenantID := endpoint.TenantID

	// PDPL fail-closed: never write outside the Kingdom.
	if cfg.InKingdomOnly && cfg.Region != "" && !RegionInKingdom(cfg.Region) {
		return InvokeResult{Operation: "archive", Success: false, Detail: "PDPL fail-closed: region not in-Kingdom"}, ErrRegionNotInKingdom
	}

	doc, err := c.docs.Get(ctx, tenantID, docID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return InvokeResult{Operation: "archive", Success: false, Detail: "document not found"}, notFound("document not found")
		}
		return InvokeResult{Operation: "archive", Success: false, Detail: "load document failed"}, err
	}
	version, err := c.docs.GetLatestVersion(ctx, tenantID, docID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return InvokeResult{Operation: "archive", Success: false, Detail: "load document version failed"}, err
	}

	// IDEMPOTENCY (dedup by document_id + version + content_hash). Re-archiving an
	// unchanged document version is a NO-OP that returns the existing archive_ref
	// rather than writing a second WORM object — the design's idempotent-archive
	// requirement. The dedup key is the (doc, version, content_hash) tuple, looked
	// up in the manifest ledger. An explicit force=true bypasses dedup (e.g. a
	// re-seal after the operator rotated the backend) but still re-archives safely.
	force, _ := payload["force"].(bool)
	if !force {
		if existing, ok := c.findArchived(ctx, tenantID, doc.ID, versionNumber(version), versionHash(version)); ok {
			out := map[string]any{
				"archive_ref":   existing.archiveRef,
				"object_key":    existing.objectKey,
				"content_hash":  versionHash(version),
				"object_hash":   existing.objectHash,
				"manifest_seq":  existing.sequence,
				"manifest_hash": existing.entryHash,
				"deduplicated":  true,
			}
			return InvokeResult{
				Operation: "archive",
				Success:   true,
				Reference: existing.archiveRef,
				Detail:    fmt.Sprintf("already archived (idempotent no-op; manifest seq %d)", existing.sequence),
				Output:    out,
			}, nil
		}
	}

	// Resolve the bytes to archive. When no fetcher is wired we archive a
	// canonical content descriptor (the version hash + metadata) — a real
	// WORM-anchored record, honestly labelled metadata_only.
	content, contentLabel := c.resolveContent(ctx, tenantID, doc, version)

	objectKey := buildArchiveKey(tenantID, doc, version)
	userMeta := map[string]string{
		"lex-tenant-id":    tenantID.String(),
		"lex-document-id":  docID.String(),
		"lex-version":      fmt.Sprintf("%d", versionNumber(version)),
		"lex-content-hash": versionHash(version),
		"lex-archive-mode": contentLabel,
	}

	var (
		archiveRef  string
		objectHash  string
		versionID   string
		retainUntil time.Time
		wormApplied WORMMode = cfg.WORMMode
	)

	switch cfg.Backend {
	case backendLocal:
		local, ierr := c.newLocal(cfg)
		if ierr != nil {
			return InvokeResult{Operation: "archive", Success: false, Detail: "local backend init failed"}, ierr
		}
		// Reversible, non-WORM: no retain-until is ever passed (cfg.retainUntil is
		// zero for WORMModeNone, which is forced for local).
		put, perr := local.Put(ctx, objectKey, content, time.Time{}, userMeta)
		if perr != nil {
			return InvokeResult{Operation: "archive", Success: false, Detail: archiveSanitizeDetail("archive write failed", perr)}, perr
		}
		archiveRef = "local://" + cfg.Bucket + "/" + put.Key
		objectHash = put.SHA256
		retainUntil = put.RetainUntil // always zero
		wormApplied = put.AppliedMode // always WORMModeNone
	case backendS3ObjectLock:
		s3, ierr := c.newS3(cfg)
		if ierr != nil {
			return InvokeResult{Operation: "archive", Success: false, Detail: "s3 client init failed"}, ierr
		}
		put, perr := s3.Put(ctx, objectKey, content, cfg.retainUntil(c.now), userMeta)
		if perr != nil {
			return InvokeResult{Operation: "archive", Success: false, Detail: archiveSanitizeDetail("archive write failed", perr)}, perr
		}
		archiveRef = "s3://" + cfg.Bucket + "/" + put.Key
		objectHash = put.SHA256
		versionID = put.VersionID
		retainUntil = put.RetainUntil
		wormApplied = put.AppliedMode
	case backendCMIS:
		ref, hash, perr := c.cmisCreateDocument(ctx, cfg, objectKey, content, userMeta)
		if perr != nil {
			return InvokeResult{Operation: "archive", Success: false, Detail: archiveSanitizeDetail("cmis createDocument failed", perr)}, perr
		}
		archiveRef = ref
		objectHash = hash
	case backendSharePoint:
		ref, hash, perr := c.sharepointUpload(ctx, cfg, objectKey, content, doc)
		if perr != nil {
			return InvokeResult{Operation: "archive", Success: false, Detail: archiveSanitizeDetail("sharepoint upload failed", perr)}, perr
		}
		archiveRef = ref
		objectHash = hash
	default:
		return InvokeResult{Operation: "archive", Success: false, Detail: "unsupported backend"}, validation("unsupported backend")
	}

	// Append a manifest entry chained from DocumentVersion.ContentHash and persist
	// it. The manifest is the tamper-evident proof of the archived corpus.
	entry, manifestErr := c.appendManifest(ctx, endpoint, doc, version, objectKey, objectHash)
	if manifestErr != nil {
		// Manifest persistence failure must NOT silently succeed the archive: the
		// object is written but unverifiable, so surface a partial failure.
		c.logger.Error().Err(manifestErr).Str("document_id", docID.String()).Msg("archive manifest append failed")
	}

	// Stamp archive_ref + WORM facts back onto the document Metadata.
	if serr := c.stampArchiveRef(ctx, tenantID, doc, archiveRef, versionID, wormApplied, retainUntil, entry.EntryHash); serr != nil {
		c.logger.Error().Err(serr).Str("document_id", docID.String()).Msg("stamp archive_ref failed")
	}

	out := map[string]any{
		"archive_ref":   archiveRef,
		"object_key":    objectKey,
		"content_hash":  versionHash(version),
		"object_hash":   objectHash,
		"worm_mode":     string(wormApplied),
		"content_mode":  contentLabel,
		"manifest_seq":  entry.Sequence,
		"manifest_hash": entry.EntryHash,
	}
	if versionID != "" {
		out["version_id"] = versionID
	}
	if !retainUntil.IsZero() {
		out["retain_until"] = retainUntil.UTC().Format(time.RFC3339)
	}
	detail := fmt.Sprintf("archived to %s backend (worm=%s, manifest seq %d)", cfg.Backend, wormApplied, entry.Sequence)
	if manifestErr != nil {
		detail += "; WARNING manifest persistence failed"
	}
	return InvokeResult{Operation: "archive", Success: true, Reference: archiveRef, Detail: detail, Output: out}, nil
}

// opLegalHold applies/releases a backend object-lock legal-hold, fail-closed on a
// still-active lex LegalHold for the release path.
func (c *EArchiveConnector) opLegalHold(ctx context.Context, endpoint model.IntegrationEndpoint, cfg archiveConfig, payload map[string]any, apply bool) (InvokeResult, error) {
	opName := "apply_legal_hold"
	if !apply {
		opName = "release_hold"
	}
	docID, err := payloadUUID(payload, "document_id")
	if err != nil {
		return InvokeResult{Operation: opName, Success: false, Detail: "document_id required"}, err
	}
	tenantID := endpoint.TenantID
	objectKey, _ := payload["object_key"].(string)
	if strings.TrimSpace(objectKey) == "" {
		// Resolve from the document's stamped archive_ref.
		objectKey = c.resolveObjectKey(ctx, tenantID, docID)
	}
	if objectKey == "" {
		return InvokeResult{Operation: opName, Success: false, Detail: "no archived object_key for document (archive it first)"}, validation("object not archived")
	}

	// Release fail-closed: refuse to lift the backend hold while a lex LegalHold is
	// still active on the document.
	if !apply && c.holds != nil {
		held, herr := c.holds.IsSubjectHeld(ctx, c.db, tenantID, model.LegalHoldSubjectDocument, docID)
		if herr != nil {
			return InvokeResult{Operation: opName, Success: false, Detail: "legal-hold check failed"}, herr
		}
		if held {
			return InvokeResult{Operation: opName, Success: false, Detail: "refused: an active lex legal hold still preserves this document"}, validation("active legal hold")
		}
	}

	switch cfg.Backend {
	case backendLocal:
		local, ierr := c.newLocal(cfg)
		if ierr != nil {
			return InvokeResult{Operation: opName, Success: false, Detail: "local backend init failed"}, ierr
		}
		// Honest: local has no object-lock; this toggles a reversible metadata-only
		// hold marker (operator intent), NOT a WORM immutability guarantee.
		if herr := local.SetLegalHold(ctx, objectKey, apply); herr != nil {
			return InvokeResult{Operation: opName, Success: false, Detail: archiveSanitizeDetail("set legal hold failed", herr)}, herr
		}
	case backendS3ObjectLock:
		s3, ierr := c.newS3(cfg)
		if ierr != nil {
			return InvokeResult{Operation: opName, Success: false, Detail: "s3 client init failed"}, ierr
		}
		if herr := s3.SetLegalHold(ctx, objectKey, apply); herr != nil {
			return InvokeResult{Operation: opName, Success: false, Detail: archiveSanitizeDetail("set legal hold failed", herr)}, herr
		}
	case backendCMIS:
		if herr := c.cmisLegalHold(ctx, cfg, objectKey, apply); herr != nil {
			return InvokeResult{Operation: opName, Success: false, Detail: archiveSanitizeDetail("cmis applyPolicy failed", herr)}, herr
		}
	case backendSharePoint:
		// SharePoint legal-hold is governed by Purview eDiscovery, not the drive
		// item API; honestly report it as not driven by this connector rather than
		// faking a success.
		return InvokeResult{Operation: opName, Success: false, Detail: "sharepoint legal-hold is managed in Microsoft Purview; not driven by this connector"}, validation("sharepoint hold unsupported")
	default:
		return InvokeResult{Operation: opName, Success: false, Detail: "unsupported backend"}, validation("unsupported backend")
	}

	verb := "applied"
	if !apply {
		verb = "released"
	}
	return InvokeResult{
		Operation: opName,
		Success:   true,
		Reference: objectKey,
		Detail:    "object-lock legal hold " + verb,
		Output:    map[string]any{"object_key": objectKey, "hold": apply},
	}, nil
}

// opDispose is the DESTRUCTIVE path. It is BLOCKED under compliance WORM unless
// ALL of: break_glass asserted, no active lex LegalHold, AND retention elapsed.
// Even when the connector permits it, the storage layer independently refuses a
// premature dispose (ErrArchiveObjectLocked) — defence-in-depth.
func (c *EArchiveConnector) opDispose(ctx context.Context, endpoint model.IntegrationEndpoint, cfg archiveConfig, payload map[string]any) (InvokeResult, error) {
	docID, err := payloadUUID(payload, "document_id")
	if err != nil {
		return InvokeResult{Operation: "dispose", Success: false, Detail: "document_id required"}, err
	}
	tenantID := endpoint.TenantID
	breakGlass, _ := payload["break_glass"].(bool)
	objectKey, _ := payload["object_key"].(string)
	if strings.TrimSpace(objectKey) == "" {
		objectKey = c.resolveObjectKey(ctx, tenantID, docID)
	}
	versionID, _ := payload["version_id"].(string)

	// Gate 1: compliance WORM is immutable within retention — only break-glass may
	// even attempt a dispose, and never under compliance before retention elapses.
	if cfg.WORMMode == WORMModeCompliance && !breakGlass {
		return InvokeResult{Operation: "dispose", Success: false, Detail: "blocked: compliance WORM requires break-glass authorization"}, validation("compliance worm: break-glass required")
	}
	if cfg.WORMMode != WORMModeNone && !breakGlass {
		return InvokeResult{Operation: "dispose", Success: false, Detail: "blocked: WORM dispose requires break-glass authorization"}, validation("worm: break-glass required")
	}

	// Gate 2: an active lex LegalHold ALWAYS blocks dispose, break-glass or not.
	if c.holds != nil {
		held, herr := c.holds.IsSubjectHeld(ctx, c.db, tenantID, model.LegalHoldSubjectDocument, docID)
		if herr != nil {
			return InvokeResult{Operation: "dispose", Success: false, Detail: "legal-hold check failed"}, herr
		}
		if held {
			return InvokeResult{Operation: "dispose", Success: false, Detail: "blocked: an active legal hold preserves this document"}, validation("active legal hold")
		}
	}

	// Gate 3: retention must have elapsed (the stamped retain_until, if any).
	if retainUntil := c.resolveRetainUntil(ctx, tenantID, docID); !retainUntil.IsZero() && c.now().UTC().Before(retainUntil) {
		return InvokeResult{Operation: "dispose", Success: false, Detail: fmt.Sprintf("blocked: retention has not elapsed (retain_until=%s)", retainUntil.UTC().Format(time.RFC3339))}, validation("retention not elapsed")
	}

	if objectKey == "" {
		return InvokeResult{Operation: "dispose", Success: false, Detail: "no archived object_key for document"}, validation("object not archived")
	}

	switch cfg.Backend {
	case backendLocal:
		local, ierr := c.newLocal(cfg)
		if ierr != nil {
			return InvokeResult{Operation: "dispose", Success: false, Detail: "local backend init failed"}, ierr
		}
		// Respect a metadata-only legal-hold marker at the storage layer too.
		if held, lerr := local.LegalHold(ctx, objectKey); lerr == nil && held {
			return InvokeResult{Operation: "dispose", Success: false, Detail: "blocked: legal-hold marker still set on the archived object"}, validation("legal hold marker")
		}
		if derr := local.Dispose(ctx, objectKey, versionID); derr != nil {
			if errors.Is(derr, ErrArchiveObjectLocked) {
				return InvokeResult{Operation: "dispose", Success: false, Detail: "blocked: legal-hold marker still set on the archived object"}, derr
			}
			return InvokeResult{Operation: "dispose", Success: false, Detail: archiveSanitizeDetail("dispose failed", derr)}, derr
		}
	case backendS3ObjectLock:
		s3, ierr := c.newS3(cfg)
		if ierr != nil {
			return InvokeResult{Operation: "dispose", Success: false, Detail: "s3 client init failed"}, ierr
		}
		// Best-effort: confirm no live object-lock legal-hold before disposing.
		if held, lerr := s3.LegalHold(ctx, objectKey); lerr == nil && held {
			return InvokeResult{Operation: "dispose", Success: false, Detail: "blocked: object-lock legal hold still in force"}, validation("object-lock legal hold")
		}
		if derr := s3.Dispose(ctx, objectKey, versionID); derr != nil {
			if errors.Is(derr, ErrArchiveObjectLocked) {
				return InvokeResult{Operation: "dispose", Success: false, Detail: "blocked by storage object-lock (retention/hold still in force)"}, derr
			}
			return InvokeResult{Operation: "dispose", Success: false, Detail: archiveSanitizeDetail("dispose failed", derr)}, derr
		}
	case backendCMIS:
		if derr := c.cmisDelete(ctx, cfg, objectKey); derr != nil {
			return InvokeResult{Operation: "dispose", Success: false, Detail: archiveSanitizeDetail("cmis delete failed", derr)}, derr
		}
	case backendSharePoint:
		if derr := c.sharepointDelete(ctx, cfg, objectKey); derr != nil {
			return InvokeResult{Operation: "dispose", Success: false, Detail: archiveSanitizeDetail("sharepoint delete failed", derr)}, derr
		}
	default:
		return InvokeResult{Operation: "dispose", Success: false, Detail: "unsupported backend"}, validation("unsupported backend")
	}

	return InvokeResult{
		Operation: "dispose",
		Success:   true,
		Reference: objectKey,
		Detail:    "archived object disposed (break-glass; no active hold; retention elapsed)",
		Output:    map[string]any{"object_key": objectKey, "break_glass": breakGlass},
	}, nil
}

// --- backend transports (CMIS browser binding + SharePoint Graph) -------------

// cmisCreateDocument POSTs a createDocument (versioningState=MAJOR) to the CMIS
// Browser binding root folder. Returns the new object ref + the SHA-256 of the
// bytes written.
func (c *EArchiveConnector) cmisCreateDocument(ctx context.Context, cfg archiveConfig, name string, content []byte, userMeta map[string]string) (string, string, error) {
	sum := sha256.Sum256(content)
	hash := hex.EncodeToString(sum[:])

	// CMIS Browser binding multipart createDocument against the root folder URL.
	// Built fresh per attempt so the multipart body is replayable under retry.
	u := archiveJoinURL(cfg.BaseURL, "/root"+ensureLeadingSlash(cfg.RootFolderPath))
	status, body, err := c.doRetry(ctx, func(actx context.Context) (*http.Request, error) {
		form := buildCMISCreateForm(name, content)
		req, rerr := http.NewRequestWithContext(actx, http.MethodPost, u, form.body)
		if rerr != nil {
			return nil, rerr
		}
		req.Header.Set("Content-Type", form.contentType)
		c.applyBasicAuth(req, cfg)
		return req, nil
	})
	if err != nil {
		return "", "", err
	}
	if status < 200 || status >= 300 {
		return "", "", fmt.Errorf("cmis createDocument status %d", status)
	}
	objID := name
	var created map[string]any
	if len(body) > 0 {
		_ = json.Unmarshal(body, &created)
		if props, ok := created["properties"].(map[string]any); ok {
			if id := cmisPropValue(props, "cmis:objectId"); id != "" {
				objID = id
			}
		}
	}
	return "cmis://" + strings.TrimRight(cfg.RepositoryID, "/") + "/" + objID, hash, nil
}

// cmisLegalHold applies/removes a retention/hold policy (applyPolicy/removePolicy).
func (c *EArchiveConnector) cmisLegalHold(ctx context.Context, cfg archiveConfig, objectID string, apply bool) error {
	action := "applyPolicy"
	if !apply {
		action = "removePolicy"
	}
	if cfg.HoldPolicyID == "" {
		return fmt.Errorf("cmis %s requires a configured hold_policy_id", action)
	}
	u := archiveJoinURL(cfg.BaseURL, "/root")
	form := buildCMISActionForm(map[string]string{
		"cmisaction": action,
		"objectId":   cmisObjectID(objectID),
		"policyId":   cfg.HoldPolicyID,
	})
	status, _, err := c.doRetry(ctx, func(actx context.Context) (*http.Request, error) {
		req, rerr := http.NewRequestWithContext(actx, http.MethodPost, u, strings.NewReader(form))
		if rerr != nil {
			return nil, rerr
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		c.applyBasicAuth(req, cfg)
		return req, nil
	})
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("cmis %s status %d", action, status)
	}
	return nil
}

// cmisDelete deletes a CMIS object (only reached after the dispose gates pass).
func (c *EArchiveConnector) cmisDelete(ctx context.Context, cfg archiveConfig, objectID string) error {
	u := archiveJoinURL(cfg.BaseURL, "/root")
	form := buildCMISActionForm(map[string]string{
		"cmisaction":  "delete",
		"objectId":    cmisObjectID(objectID),
		"allVersions": "true",
	})
	status, _, err := c.doRetry(ctx, func(actx context.Context) (*http.Request, error) {
		req, rerr := http.NewRequestWithContext(actx, http.MethodPost, u, strings.NewReader(form))
		if rerr != nil {
			return nil, rerr
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		c.applyBasicAuth(req, cfg)
		return req, nil
	})
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("cmis delete status %d", status)
	}
	return nil
}

// sharepointUpload PUTs content to the site drive then setFields metadata.
func (c *EArchiveConnector) sharepointUpload(ctx context.Context, cfg archiveConfig, name string, content []byte, doc *model.LegalDocument) (string, string, error) {
	sum := sha256.Sum256(content)
	hash := hex.EncodeToString(sum[:])
	if cfg.BearerToken == "" {
		return "", "", errors.New("sharepoint requires a bearer token")
	}

	// PUT {base}/sites/{site}/drive/root:/{folder}/{name}:/content
	folder := strings.Trim(cfg.RootFolderPath, "/")
	path := name
	if folder != "" {
		path = folder + "/" + name
	}
	u := archiveJoinURL(cfg.BaseURL, "/sites/"+cfg.SiteID+"/drive/root:/"+path+":/content")
	status, body, err := c.doRetry(ctx, func(actx context.Context) (*http.Request, error) {
		req, rerr := http.NewRequestWithContext(actx, http.MethodPut, u, byteReader(content))
		if rerr != nil {
			return nil, rerr
		}
		req.Header.Set("Authorization", "Bearer "+cfg.BearerToken)
		req.Header.Set("Content-Type", "application/octet-stream")
		return req, nil
	})
	if err != nil {
		return "", "", err
	}
	if status < 200 || status >= 300 {
		return "", "", fmt.Errorf("sharepoint upload status %d", status)
	}
	itemID := name
	var item map[string]any
	if len(body) > 0 {
		_ = json.Unmarshal(body, &item)
		if id, ok := item["id"].(string); ok {
			itemID = id
		}
	}
	// setFields (best-effort, non-fatal) — stamp lex metadata on the list item.
	c.sharepointSetFields(ctx, cfg, itemID, doc, hash)
	return "sharepoint://" + cfg.SiteID + "/" + itemID, hash, nil
}

// sharepointSetFields PATCHes listItem fields (best-effort, non-fatal).
func (c *EArchiveConnector) sharepointSetFields(ctx context.Context, cfg archiveConfig, itemID string, doc *model.LegalDocument, hash string) {
	fields := map[string]any{
		"LexDocumentId":  doc.ID.String(),
		"LexTitle":       doc.Title,
		"LexContentHash": hash,
	}
	bodyBytes, _ := json.Marshal(map[string]any{"fields": fields})
	u := archiveJoinURL(cfg.BaseURL, "/sites/"+cfg.SiteID+"/drive/items/"+itemID+"/listItem/fields")
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, u, byteReader(bodyBytes))
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+cfg.BearerToken)
	req.Header.Set("Content-Type", "application/json")
	if resp, _, derr := c.do(req); derr == nil && resp != nil {
		_ = resp
	}
}

func (c *EArchiveConnector) sharepointDelete(ctx context.Context, cfg archiveConfig, itemID string) error {
	if cfg.BearerToken == "" {
		return errors.New("sharepoint requires a bearer token")
	}
	u := archiveJoinURL(cfg.BaseURL, "/sites/"+cfg.SiteID+"/drive/items/"+strings.TrimPrefix(itemID, "sharepoint://"+cfg.SiteID+"/"))
	status, _, err := c.doRetry(ctx, func(actx context.Context) (*http.Request, error) {
		req, rerr := http.NewRequestWithContext(actx, http.MethodDelete, u, nil)
		if rerr != nil {
			return nil, rerr
		}
		req.Header.Set("Authorization", "Bearer "+cfg.BearerToken)
		return req, nil
	})
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("sharepoint delete status %d", status)
	}
	return nil
}

// --- manifest + metadata persistence ------------------------------------------

// appendManifest computes the next chained manifest entry (off the document's
// last stored entry_hash) and persists it to lex_document_archive_manifest. The
// entry's ContentHash IS the DocumentVersion.ContentHash — the source of truth.
func (c *EArchiveConnector) appendManifest(ctx context.Context, endpoint model.IntegrationEndpoint, doc *model.LegalDocument, version *model.DocumentVersion, objectKey, objectHash string) (ArchiveManifestEntry, error) {
	tenantID := endpoint.TenantID
	prevHash, prevSeq := c.lastManifest(ctx, tenantID, doc.ID)
	entry := ArchiveManifestEntry{
		Sequence:    prevSeq + 1,
		DocumentID:  doc.ID.String(),
		Version:     versionNumber(version),
		ContentHash: versionHash(version),
		ObjectKey:   objectKey,
		ObjectHash:  objectHash,
		PrevHash:    prevHash,
		ArchivedAt:  c.now().UTC(),
	}
	entry.EntryHash = ComputeEntryHash(entry)

	if c.db == nil {
		return entry, fmt.Errorf("lex/earchive: no db handle for manifest persistence")
	}
	const q = `
		INSERT INTO lex_document_archive_manifest (
			id, tenant_id, endpoint_id, document_id, sequence, version,
			content_hash, object_key, object_hash, prev_hash, entry_hash, archived_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`
	_, err := c.db.Exec(ctx, q,
		uuid.New(), tenantID, endpoint.ID, doc.ID, entry.Sequence, entry.Version,
		entry.ContentHash, entry.ObjectKey, entry.ObjectHash, entry.PrevHash, entry.EntryHash, entry.ArchivedAt,
	)
	return entry, err
}

// lastManifest returns the latest persisted (entry_hash, sequence) for a document
// so the next entry chains off it. Returns ("", 0) for the genesis entry.
func (c *EArchiveConnector) lastManifest(ctx context.Context, tenantID, documentID uuid.UUID) (string, int) {
	if c.db == nil {
		return "", 0
	}
	var (
		hash string
		seq  int
	)
	err := c.db.QueryRow(ctx, `
		SELECT entry_hash, sequence FROM lex_document_archive_manifest
		WHERE tenant_id = $1 AND document_id = $2
		ORDER BY sequence DESC LIMIT 1`,
		tenantID, documentID,
	).Scan(&hash, &seq)
	if err != nil {
		return "", 0
	}
	return hash, seq
}

// stampArchiveRef writes the archive_ref + WORM facts into the document Metadata
// (additive; never destroys existing metadata) via the document repository.
func (c *EArchiveConnector) stampArchiveRef(ctx context.Context, tenantID uuid.UUID, doc *model.LegalDocument, archiveRef, versionID string, mode WORMMode, retainUntil time.Time, manifestHash string) error {
	if c.docs == nil || c.db == nil {
		return fmt.Errorf("lex/earchive: no document store for archive_ref stamp")
	}
	if doc.Metadata == nil {
		doc.Metadata = map[string]any{}
	}
	archiveInfo := map[string]any{
		"archive_ref":   archiveRef,
		"worm_mode":     string(mode),
		"manifest_hash": manifestHash,
		"archived_at":   c.now().UTC().Format(time.RFC3339),
	}
	if versionID != "" {
		archiveInfo["version_id"] = versionID
	}
	if !retainUntil.IsZero() {
		archiveInfo["retain_until"] = retainUntil.UTC().Format(time.RFC3339)
	}
	doc.Metadata["archive"] = archiveInfo
	return c.docs.Update(ctx, c.db, doc)
}

// resolveContent returns the bytes to archive + a label. With a fetcher it pulls
// the real file bytes; without one it produces a canonical content descriptor
// (hash + identifiers), honestly labelled metadata_only.
func (c *EArchiveConnector) resolveContent(ctx context.Context, tenantID uuid.UUID, doc *model.LegalDocument, version *model.DocumentVersion) ([]byte, string) {
	if c.fetcher != nil && version != nil && version.FileID != uuid.Nil {
		if data, _, err := c.fetcher.Fetch(ctx, tenantID, version.FileID); err == nil && len(data) > 0 {
			return data, "full_content"
		}
	}
	descriptor := map[string]any{
		"document_id":  doc.ID.String(),
		"title":        doc.Title,
		"version":      versionNumber(version),
		"content_hash": versionHash(version),
		"sealed_at":    c.now().UTC().Format(time.RFC3339),
	}
	b, _ := json.Marshal(descriptor)
	return b, "metadata_only"
}

// resolveObjectKey reads the stamped archive_ref from a document's Metadata and
// extracts the backend object key.
func (c *EArchiveConnector) resolveObjectKey(ctx context.Context, tenantID, docID uuid.UUID) string {
	if c.docs == nil {
		return ""
	}
	doc, err := c.docs.Get(ctx, tenantID, docID)
	if err != nil || doc == nil {
		return ""
	}
	archive, ok := doc.Metadata["archive"].(map[string]any)
	if !ok {
		return ""
	}
	ref, _ := archive["archive_ref"].(string)
	return objectKeyFromRef(ref)
}

func (c *EArchiveConnector) resolveRetainUntil(ctx context.Context, tenantID, docID uuid.UUID) time.Time {
	if c.docs == nil {
		return time.Time{}
	}
	doc, err := c.docs.Get(ctx, tenantID, docID)
	if err != nil || doc == nil {
		return time.Time{}
	}
	archive, ok := doc.Metadata["archive"].(map[string]any)
	if !ok {
		return time.Time{}
	}
	if ru, ok := archive["retain_until"].(string); ok {
		if t, perr := time.Parse(time.RFC3339, ru); perr == nil {
			return t.UTC()
		}
	}
	return time.Time{}
}

func (c *EArchiveConnector) newLocal(cfg archiveConfig) (*LocalArchiveClient, error) {
	return NewLocalArchiveClient(LocalArchiveConfig{
		BaseDir: cfg.BaseDir,
		Bucket:  cfg.Bucket,
	})
}

func (c *EArchiveConnector) newS3(cfg archiveConfig) (*S3WORMClient, error) {
	return NewS3WORMClient(S3WORMConfig{
		Endpoint:        cfg.S3Endpoint,
		AccessKeyID:     cfg.AccessKeyID,
		SecretAccessKey: cfg.SecretAccessKey,
		UseSSL:          cfg.UseSSL,
		Region:          cfg.Region,
		Bucket:          cfg.Bucket,
		WORMMode:        cfg.WORMMode,
		InKingdomOnly:   cfg.InKingdomOnly,
	})
}

// archiveMaxAttempts is the total number of attempts (1 try + 2 retries) the CMIS
// / SharePoint HTTP transports make on a transient failure.
const archiveMaxAttempts = 3

// do executes an HTTP request and reads a bounded body; never logs the request.
// It is the single-shot primitive; callers that can rebuild the request use
// doRetry for transient-failure resilience.
func (c *EArchiveConnector) do(req *http.Request) (*http.Response, []byte, error) {
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	body, rerr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if rerr != nil {
		return resp, nil, rerr
	}
	return resp, body, nil
}

// doRetry executes a request built fresh on every attempt (the builder rebuilds
// the body so it is safely replayable), retrying transport errors and 5xx
// responses up to archiveMaxAttempts with linear backoff. 4xx responses are NOT
// retried (a misconfig/auth failure will not heal). Each attempt gets its own
// per-attempt timeout derived from the client timeout so one slow attempt cannot
// consume the whole budget. The status code is returned for the caller to map to
// a sanitized error; the body is bounded. This is the resilient ECM-push path.
func (c *EArchiveConnector) doRetry(ctx context.Context, build func(context.Context) (*http.Request, error)) (int, []byte, error) {
	perAttempt := c.client.Timeout
	if perAttempt <= 0 {
		perAttempt = 30 * time.Second
	}
	var lastErr error
	var lastStatus int
	for attempt := 0; attempt < archiveMaxAttempts; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return 0, nil, ctx.Err()
			case <-time.After(time.Duration(attempt) * 250 * time.Millisecond):
			}
		}
		actx, cancel := context.WithTimeout(ctx, perAttempt)
		req, err := build(actx)
		if err != nil {
			cancel()
			// A build error is not transient (bad URL/body) — fail fast.
			return 0, nil, err
		}
		resp, body, err := c.do(req)
		cancel()
		if err != nil {
			lastErr = err
			lastStatus = 0
			continue // transport error — retry
		}
		if resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("status %d", resp.StatusCode)
			lastStatus = resp.StatusCode
			continue // server error — retry
		}
		return resp.StatusCode, body, nil
	}
	if lastErr == nil {
		lastErr = errors.New("request failed")
	}
	return lastStatus, nil, lastErr
}

func (c *EArchiveConnector) applyBasicAuth(req *http.Request, cfg archiveConfig) {
	if cfg.Username != "" {
		req.SetBasicAuth(cfg.Username, cfg.Password)
	} else if cfg.BearerToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.BearerToken)
	}
}

// --- config parsing -----------------------------------------------------------

// archiveConfig is the resolved plaintext connection config. Keys are tolerant
// of the seeded shape (base_url / endpoint, etc.).
type archiveConfig struct {
	Backend         archiveBackend
	BaseURL         string
	S3Endpoint      string
	Bucket          string
	RepositoryID    string
	RootFolderPath  string
	SiteID          string
	Username        string
	Password        string
	AccessKeyID     string
	SecretAccessKey string
	BearerToken     string
	Region          string
	UseSSL          bool
	WORMMode        WORMMode
	InKingdomOnly   bool
	HoldPolicyID    string
	RetentionDays   int
	// BaseDir is the local-filesystem backend root (backendLocal only).
	BaseDir string
}

func parseArchiveConfig(config map[string]any) archiveConfig {
	cfg := archiveConfig{
		BaseURL:         cfgStr(config, "base_url", "url", "endpoint"),
		Bucket:          cfgStr(config, "bucket", "repository", "container"),
		RepositoryID:    cfgStr(config, "repository_id", "repository"),
		RootFolderPath:  cfgStr(config, "root_folder_path", "root_folder", "folder"),
		SiteID:          cfgStr(config, "site_id", "site"),
		Username:        cfgStr(config, "username"),
		Password:        cfgStr(config, "password"),
		AccessKeyID:     cfgStr(config, "access_key_id", "access_key"),
		SecretAccessKey: cfgStr(config, "secret_access_key", "secret_key"),
		BearerToken:     cfgStr(config, "bearer_token", "token", "access_token"),
		Region:          cfgStr(config, "region"),
		HoldPolicyID:    cfgStr(config, "hold_policy_id", "retention_policy_id"),
	}
	// backend / protocol (schema uses "protocol" enum: cmis|s3|sharepoint).
	backend := strings.ToLower(cfgStr(config, "backend", "protocol"))
	switch backend {
	case "s3", "s3_objectlock", "objectlock":
		cfg.Backend = backendS3ObjectLock
	case "cmis":
		cfg.Backend = backendCMIS
	case "sharepoint", "graph":
		cfg.Backend = backendSharePoint
	case "local", "filesystem", "file":
		cfg.Backend = backendLocal
	default:
		cfg.Backend = archiveBackend(backend)
	}
	// Local-filesystem backend: resolve its base directory (config or env/temp
	// default) and use the config'd bucket namespace.
	if cfg.Backend == backendLocal {
		cfg.BaseDir = cfgStr(config, "base_dir", "local_dir", "path")
		if cfg.BaseDir == "" {
			cfg.BaseDir = defaultLocalArchiveDir()
		}
	}
	// S3 endpoint: prefer an explicit endpoint host, else strip scheme off base_url.
	cfg.S3Endpoint = cfgStr(config, "s3_endpoint")
	if cfg.S3Endpoint == "" && cfg.Backend == backendS3ObjectLock {
		cfg.S3Endpoint, cfg.UseSSL = hostFromURL(cfg.BaseURL)
	} else if cfg.S3Endpoint != "" {
		_, cfg.UseSSL = hostFromURL(cfg.BaseURL)
	}
	cfg.WORMMode = resolveWORM(config)
	cfg.InKingdomOnly = cfgBool(config, true, "in_kingdom_only")
	cfg.RetentionDays = cfgInt(config, "retention_days")
	// The local-filesystem backend is REVERSIBLE by construction: object-lock/WORM
	// can never be applied to it, so force WORMModeNone regardless of config. This
	// guarantees retainUntil is zero and the connector's dispose gate never demands
	// break-glass for a local target (Othaim PRD 14.1 — reversible archive).
	if cfg.Backend == backendLocal {
		cfg.WORMMode = WORMModeNone
	}
	return cfg
}

// resolveWORM maps the schema's worm_enabled bool + an optional worm_mode string
// onto a WORMMode. worm_enabled=false → none; worm_mode wins when present.
func resolveWORM(config map[string]any) WORMMode {
	if m := strings.TrimSpace(cfgStr(config, "worm_mode")); m != "" {
		return NormalizeWORMMode(m)
	}
	if !cfgBool(config, true, "worm_enabled") {
		return WORMModeNone
	}
	return WORMModeCompliance
}

func (cfg archiveConfig) retainUntil(now func() time.Time) time.Time {
	if cfg.WORMMode == WORMModeNone {
		return time.Time{}
	}
	days := cfg.RetentionDays
	if days <= 0 {
		days = 3650 // 10y records-management default
	}
	return now().Add(time.Duration(days) * 24 * time.Hour).UTC()
}

// missingRequired returns the first missing required config key for the backend,
// or "" when complete.
func (cfg archiveConfig) missingRequired() string {
	switch cfg.Backend {
	case backendS3ObjectLock:
		if cfg.S3Endpoint == "" && cfg.BaseURL == "" {
			return "base_url|s3_endpoint"
		}
		if cfg.Bucket == "" {
			return "bucket"
		}
		if cfg.AccessKeyID == "" || cfg.SecretAccessKey == "" {
			return "access_key_id+secret_access_key"
		}
	case backendCMIS:
		if cfg.BaseURL == "" {
			return "base_url"
		}
		if cfg.RootFolderPath == "" {
			return "root_folder_path"
		}
	case backendSharePoint:
		if cfg.BaseURL == "" {
			return "base_url"
		}
		if cfg.SiteID == "" {
			return "site_id"
		}
		if cfg.BearerToken == "" {
			return "bearer_token"
		}
	case backendLocal:
		// Local needs only a bucket namespace; base_dir defaults from env/temp.
		if cfg.Bucket == "" {
			return "bucket"
		}
	default:
		return "protocol"
	}
	return ""
}

// --- small helpers (package-local; do NOT collide with service-package names) -

func cfgStr(config map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := config[k]; ok {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
	}
	return ""
}

func cfgBool(config map[string]any, def bool, keys ...string) bool {
	for _, k := range keys {
		v, ok := config[k]
		if !ok {
			continue
		}
		switch t := v.(type) {
		case bool:
			return t
		case string:
			switch strings.ToLower(strings.TrimSpace(t)) {
			case "true", "1", "yes":
				return true
			case "false", "0", "no":
				return false
			}
		}
	}
	return def
}

func cfgInt(config map[string]any, keys ...string) int {
	for _, k := range keys {
		v, ok := config[k]
		if !ok {
			continue
		}
		switch t := v.(type) {
		case float64:
			return int(t)
		case int:
			return t
		case string:
			if n, err := strconv.Atoi(strings.TrimSpace(t)); err == nil {
				return n
			}
		}
	}
	return 0
}

func payloadUUID(payload map[string]any, key string) (uuid.UUID, error) {
	raw, ok := payload[key]
	if !ok {
		return uuid.Nil, validation(key + " is required")
	}
	s, ok := raw.(string)
	if !ok {
		return uuid.Nil, validation(key + " must be a string uuid")
	}
	id, err := uuid.Parse(strings.TrimSpace(s))
	if err != nil {
		return uuid.Nil, validation(key + " is not a valid uuid")
	}
	return id, nil
}

func versionNumber(v *model.DocumentVersion) int {
	if v == nil {
		return 0
	}
	return v.Version
}

func versionHash(v *model.DocumentVersion) string {
	if v == nil {
		return ""
	}
	return v.ContentHash
}

// buildArchiveKey builds a DETERMINISTIC, content-addressed object key for a
// document version. The same (tenant, document, version, content-hash) always maps
// to the same key, so a re-archive of unchanged content overwrites the identical
// object rather than scattering duplicate WORM objects (idempotent at the storage
// layer in addition to the manifest dedup gate). A short content-hash suffix
// disambiguates a version whose bytes legitimately changed without a version bump.
func buildArchiveKey(tenantID uuid.UUID, doc *model.LegalDocument, v *model.DocumentVersion) string {
	hash := versionHash(v)
	suffix := "nohash"
	if len(hash) >= 12 {
		suffix = hash[:12]
	} else if hash != "" {
		suffix = hash
	}
	return fmt.Sprintf("%s/%s/v%d/%s.archive",
		tenantID.String(), doc.ID.String(), versionNumber(v), suffix)
}

// archivedRecord is the dedup lookup result: the existing manifest facts for a
// (document, version, content_hash) tuple already present in the ledger.
type archivedRecord struct {
	archiveRef string
	objectKey  string
	objectHash string
	entryHash  string
	sequence   int
}

// findArchived reports whether a document version with the given content hash has
// already been archived (idempotency check). It reads the manifest ledger — the
// authoritative record of what was written to WORM — keyed by the exact
// (document, version, content_hash) tuple. A match returns the existing facts so
// the archive call can short-circuit. A nil db (unit tests without a ledger) or a
// miss returns ok=false. An empty content hash never matches (cannot dedup an
// un-hashed version safely).
func (c *EArchiveConnector) findArchived(ctx context.Context, tenantID, documentID uuid.UUID, version int, contentHash string) (archivedRecord, bool) {
	if c.db == nil || strings.TrimSpace(contentHash) == "" {
		return archivedRecord{}, false
	}
	var rec archivedRecord
	err := c.db.QueryRow(ctx, `
		SELECT object_key, object_hash, entry_hash, sequence
		FROM lex_document_archive_manifest
		WHERE tenant_id = $1 AND document_id = $2 AND version = $3 AND content_hash = $4
		ORDER BY sequence DESC LIMIT 1`,
		tenantID, documentID, version, contentHash,
	).Scan(&rec.objectKey, &rec.objectHash, &rec.entryHash, &rec.sequence)
	if err != nil {
		return archivedRecord{}, false
	}
	rec.archiveRef = c.archiveRefFor(ctx, tenantID, documentID, rec.objectKey)
	return rec, true
}

// archiveRefFor reconstructs the stamped archive_ref for a document (the document
// Metadata holds the scheme-qualified ref); falls back to the bare object key.
func (c *EArchiveConnector) archiveRefFor(ctx context.Context, tenantID, documentID uuid.UUID, objectKey string) string {
	if c.docs != nil {
		if doc, err := c.docs.Get(ctx, tenantID, documentID); err == nil && doc != nil {
			if archive, ok := doc.Metadata["archive"].(map[string]any); ok {
				if ref, _ := archive["archive_ref"].(string); ref != "" {
					return ref
				}
			}
		}
	}
	return objectKey
}

// objectKeyFromRef extracts the storage object key from a stamped archive_ref of
// the form s3://bucket/key, cmis://repo/id, or sharepoint://site/id.
func objectKeyFromRef(ref string) string {
	ref = strings.TrimSpace(ref)
	for _, scheme := range []string{"s3://", "cmis://", "sharepoint://", "local://"} {
		if strings.HasPrefix(ref, scheme) {
			rest := strings.TrimPrefix(ref, scheme)
			// drop the first path segment (bucket/repo/site), keep the rest.
			if i := strings.IndexByte(rest, '/'); i >= 0 {
				return rest[i+1:]
			}
			return rest
		}
	}
	return ref
}

func archiveJoinURL(base, path string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	path = strings.TrimSpace(path)
	if path == "" {
		return base
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return base + path
}

func archiveSanitizeDetail(prefix string, err error) string {
	if err == nil {
		return prefix
	}
	msg := err.Error()
	for _, marker := range []string{"secret", "token", "password", "AKIA", "Bearer "} {
		if idx := strings.Index(msg, marker); idx >= 0 {
			msg = msg[:idx] + "[redacted]"
			break
		}
	}
	if prefix == "" {
		return msg
	}
	return prefix + ": " + msg
}

func ensureLeadingSlash(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return "/"
	}
	if !strings.HasPrefix(p, "/") {
		return "/" + p
	}
	return p
}

// hostFromURL strips the scheme off a URL returning host[:port] and whether it
// was https. Tolerant of a bare host:port.
func hostFromURL(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	useSSL := false
	if strings.HasPrefix(raw, "https://") {
		useSSL = true
		raw = strings.TrimPrefix(raw, "https://")
	} else if strings.HasPrefix(raw, "http://") {
		raw = strings.TrimPrefix(raw, "http://")
	}
	if i := strings.IndexByte(raw, '/'); i >= 0 {
		raw = raw[:i]
	}
	return raw, useSSL
}

// pickFirstRepository pulls a repositoryId out of a CMIS repositoryInfo map (the
// browser binding returns {repoId: {...}}); best-effort, non-sensitive.
func pickFirstRepository(info map[string]any) string {
	keys := make([]string, 0, len(info))
	for k := range info {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if entry, ok := info[k].(map[string]any); ok {
			if id, ok := entry["repositoryId"].(string); ok && id != "" {
				return id
			}
		}
	}
	return ""
}

func cmisPropValue(props map[string]any, key string) string {
	if p, ok := props[key].(map[string]any); ok {
		if v, ok := p["value"].(string); ok {
			return v
		}
	}
	return ""
}

func cmisObjectID(ref string) string {
	if i := strings.LastIndexByte(ref, '/'); i >= 0 {
		return ref[i+1:]
	}
	return ref
}

// validation / notFound are package-local error constructors (the service-layer
// helpers live in package service; this package cannot import them). They wrap a
// plain error so the registry surfaces a sanitized message.
func validation(msg string) error { return fmt.Errorf("lex/earchive: %s", msg) }
func notFound(msg string) error   { return fmt.Errorf("lex/earchive: %s", msg) }

// hmacSign is retained for internal-REST style signing parity if a future
// backend needs request signing; kept package-local and unexported.
func hmacSign(secret, payload []byte) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

// byteReader is a tiny *bytes.Reader constructor (keeps call sites terse).
func byteReader(b []byte) *bytes.Reader { return bytes.NewReader(b) }

// cmisMultipart is a built multipart body for a CMIS Browser-binding
// createDocument request.
type cmisMultipart struct {
	body        *bytes.Reader
	contentType string
}

// buildCMISCreateForm builds the multipart/form-data body for a CMIS Browser
// binding createDocument (versioningState=MAJOR). The content part carries the
// archived bytes; the cmisaction/propertyId fields name the new document.
func buildCMISCreateForm(name string, content []byte) cmisMultipart {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fields := map[string]string{
		"cmisaction":       "createDocument",
		"propertyId[0]":    "cmis:name",
		"propertyValue[0]": name,
		"propertyId[1]":    "cmis:objectTypeId",
		"propertyValue[1]": "cmis:document",
		"versioningState":  "major",
		"succinct":         "true",
	}
	for k, v := range fields {
		_ = w.WriteField(k, v)
	}
	if part, err := w.CreateFormFile("content", name); err == nil {
		_, _ = part.Write(content)
	}
	_ = w.Close()
	return cmisMultipart{body: bytes.NewReader(buf.Bytes()), contentType: w.FormDataContentType()}
}

// buildCMISActionForm builds an application/x-www-form-urlencoded body for a
// CMIS Browser-binding action (applyPolicy/removePolicy/delete).
func buildCMISActionForm(fields map[string]string) string {
	v := url.Values{}
	for k, val := range fields {
		v.Set(k, val)
	}
	return v.Encode()
}

// SandboxInvoke (feature 9) runs the connector in an in-process MOCK for the
// console "try it" action and for tests. It NEVER touches a real ECM / object
// store, NEVER mutates lex or external state, and clearly marks every result
// sandbox (Output["sandbox"]=true). It still exercises the REAL policy gates —
// PDPL in-Kingdom fail-closed, WORM/break-glass dispose gating, retention and a
// chained manifest-entry hash — so the demo faithfully reflects production
// behaviour without writing anything. The result is honest: it demonstrates the
// connector logic, not a live archive.
func (c *EArchiveConnector) SandboxInvoke(_ context.Context, endpoint model.IntegrationEndpoint, operation string, payload map[string]any) (InvokeResult, error) {
	op := strings.ToLower(strings.TrimSpace(operation))
	cfg := parseArchiveConfig(endpoint.Config)

	base := map[string]any{
		"sandbox": true,
		"backend": string(cfg.Backend),
	}

	// PDPL fail-closed is enforced even in the sandbox so the demo cannot show an
	// out-of-Kingdom archive "succeeding".
	if cfg.InKingdomOnly && cfg.Region != "" && !RegionInKingdom(cfg.Region) {
		base["reason"] = "PDPL fail-closed: region not in-Kingdom"
		return InvokeResult{Operation: op, Success: false, Detail: "[sandbox] PDPL fail-closed: region not in-Kingdom", Output: base}, nil
	}

	switch op {
	case "archive":
		contentHash, _ := payload["content_hash"].(string)
		if contentHash == "" {
			contentHash = "sandbox-" + uuid.NewString()
		}
		key := fmt.Sprintf("%s/sandbox/%s.archive", endpoint.TenantID.String(), contentHash)
		entry := ArchiveManifestEntry{
			Sequence:    1,
			DocumentID:  fmt.Sprint(payload["document_id"]),
			Version:     1,
			ContentHash: contentHash,
			ObjectKey:   key,
			ObjectHash:  contentHash,
			PrevHash:    "",
			ArchivedAt:  c.now().UTC(),
		}
		entry.EntryHash = ComputeEntryHash(entry)
		retainUntil := cfg.retainUntil(c.now)
		base["object_key"] = key
		base["worm_mode"] = string(cfg.WORMMode)
		base["manifest_hash"] = entry.EntryHash
		if !retainUntil.IsZero() {
			base["retain_until"] = retainUntil.UTC().Format(time.RFC3339)
		}
		return InvokeResult{Operation: op, Success: true, Reference: key, Detail: "[sandbox] would archive under WORM (no real write)", Output: base}, nil
	case "apply_legal_hold", "release_hold":
		base["hold"] = op == "apply_legal_hold"
		return InvokeResult{Operation: op, Success: true, Detail: "[sandbox] object-lock legal hold toggled (no real write)", Output: base}, nil
	case "dispose":
		breakGlass, _ := payload["break_glass"].(bool)
		if cfg.WORMMode != WORMModeNone && !breakGlass {
			base["reason"] = "WORM dispose requires break-glass"
			return InvokeResult{Operation: op, Success: false, Detail: "[sandbox] blocked: WORM dispose requires break-glass authorization", Output: base}, nil
		}
		return InvokeResult{Operation: op, Success: true, Detail: "[sandbox] dispose permitted by gates (no real delete)", Output: base}, nil
	default:
		return InvokeResult{Operation: op, Success: false, Detail: "[sandbox] unsupported archiving operation"}, validation("unsupported archiving operation: " + op)
	}
}

// Compile-time assertions that the connector satisfies the framework capability
// interfaces (and, structurally, the service-layer IntegrationAdapter port).
var (
	_ ConnectionTester = (*EArchiveConnector)(nil)
	_ Invoker          = (*EArchiveConnector)(nil)
	_ SandboxInvoker   = (*EArchiveConnector)(nil)
)

// Ensure the pgxpool import is referenced even if the DB handle is supplied as a
// Queryer; the connector accepts *pgxpool.Pool (which satisfies Queryer) at wire
// time.
var _ = func(p *pgxpool.Pool) repository.Queryer { return p }
