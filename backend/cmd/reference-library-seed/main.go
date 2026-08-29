// reference-library-seed is the one-shot, idempotent ingestion job for the GLOBAL
// WatheeqTech reference library (WatheeqTech_Library_Design.md §2.5 / §5.4). It is
// NOT the per-tenant demo seeder and does NOT run on service boot: a 95 MB corpus
// must never make the FATAL startup path flaky.
//
// It reads the committed manifest (docs/ClarioWatheeq/reference_library_manifest.json)
// and, for each of the 33 PDFs, provisions BOTH the bytes and the catalog row:
//
//   - --byte-source=volume (default, dev-runnable §2.4): computes each PDF's
//     SHA-256 + size + page-count from the mounted corpus directory, sets
//     storage_key = source_filename + byte_source = "volume".
//   - --byte-source=file-service (production §2.3 Option A): uploads each PDF to
//     the platform file-service (suite=lex, dedup-by-checksum) AS the canonical
//     library tenant using a short-lived JWT minted from the shared RS256 key,
//     captures the returned file_id + checksum + size, and sets byte_source =
//     "file-service" + file_id + library_tenant_id.
//
// It then UPSERTs the catalog row by content_hash (the partial unique index makes
// re-runs no-ops) and, when --reindex + an AI URL are supplied, POSTs the corpus
// to {AI}/ingest so the Second-Brain index is refreshed. The PDF bytes are
// gitignored and never committed — this job reads them from disk / the object store.
//
// Usage:
//
//	GOWORK=off go run ./cmd/reference-library-seed \
//	  --db-url="$LEX_DB_URL" \
//	  --dir="docs/ClarioWatheeq/WatheeqTech Library" \
//	  --manifest="docs/ClarioWatheeq/reference_library_manifest.json" \
//	  [--byte-source=file-service --file-service-url="$LEX_FILE_SERVICE_URL" \
//	   --library-tenant-id="$LEX_REFERENCE_LIBRARY_TENANT_ID"] \
//	  [--reindex --ai-url="$LEX_AI_SERVICE_URL"] [--force]
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/text/unicode/norm"

	"github.com/clario360/platform/internal/auth"
	appconfig "github.com/clario360/platform/internal/config"
)

// referenceLibrarySeedServiceUserID is the synthetic service principal the seed
// presents to file-service for the server-to-server upload (attribution only).
const (
	referenceLibrarySeedServiceUserID = "00000000-0000-0000-0000-00000000c360"
	referenceLibrarySeedServiceEmail  = "reference-library-seed@service.watheeq"
	byteSourceVolume                  = "volume"
	byteSourceFileService             = "file-service"
)

type manifestDoc struct {
	SourceFilename string         `json:"source_filename"`
	TitleAR        string         `json:"title_ar"`
	TitleEN        string         `json:"title_en"`
	DescriptionAR  string         `json:"description_ar"`
	DescriptionEN  string         `json:"description_en"`
	Category       string         `json:"category"`
	DocType        string         `json:"doc_type"`
	Jurisdiction   string         `json:"jurisdiction"`
	Authority      string         `json:"authority"`
	Source         string         `json:"source"`
	SourceURL      string         `json:"source_url"`
	Tags           []string       `json:"tags"`
	HijriDate      string         `json:"hijri_date"`
	Metadata       map[string]any `json:"metadata"`
}

type manifestFile struct {
	Corpus       string        `json:"corpus"`
	Jurisdiction string        `json:"jurisdiction"`
	Count        int           `json:"count"`
	Documents    []manifestDoc `json:"documents"`
}

// fileServiceUploadResponse is the subset of the file-service FileResponse the
// seed needs after an upload.
type fileServiceUploadResponse struct {
	ID             string `json:"id"`
	ChecksumSHA256 string `json:"checksum_sha256"`
	SizeBytes      int64  `json:"size_bytes"`
}

// ingestDoc is one row of the AI re-index payload.
type ingestDoc struct {
	Category     string `json:"category"`
	DocType      string `json:"doc_type"`
	TitleAR      string `json:"title_ar"`
	TitleEN      string `json:"title_en"`
	Authority    string `json:"authority"`
	ContentHash  string `json:"content_hash"`
	ByteSource   string `json:"byte_source"`
	FileID       string `json:"file_id,omitempty"`
	StorageKey   string `json:"storage_key,omitempty"`
	LibraryTenID string `json:"library_tenant_id,omitempty"`
	PageCount    int    `json:"page_count,omitempty"`
}

func main() {
	var (
		dbURL          = flag.String("db-url", os.Getenv("LEX_DB_URL"), "lex_db connection string (default $LEX_DB_URL)")
		corpusDir      = flag.String("dir", envOr("LEX_REFERENCE_LIBRARY_DIR", "docs/ClarioWatheeq/WatheeqTech Library"), "mounted read-only corpus directory holding the PDFs")
		manifestPath   = flag.String("manifest", "docs/ClarioWatheeq/reference_library_manifest.json", "path to the committed manifest JSON")
		force          = flag.Bool("force", false, "re-UPSERT every row even when the catalog already appears seeded")
		byteSource     = flag.String("byte-source", byteSourceVolume, "where the bytes live: volume | file-service")
		fileServiceURL = flag.String("file-service-url", os.Getenv("LEX_FILE_SERVICE_URL"), "file-service origin for --byte-source=file-service")
		libraryTenant  = flag.String("library-tenant-id", os.Getenv("LEX_REFERENCE_LIBRARY_TENANT_ID"), "canonical library tenant id for the file-service byte path")
		aiURL          = flag.String("ai-url", os.Getenv("LEX_AI_SERVICE_URL"), "Second-Brain AI base URL for --reindex")
		reindex        = flag.Bool("reindex", false, "after upserting, POST the corpus to {ai-url}/ingest to refresh the Second-Brain index")
	)
	flag.Parse()

	if *dbURL == "" {
		log.Fatal("reference-library-seed: --db-url (or $LEX_DB_URL) is required")
	}
	if *byteSource != byteSourceVolume && *byteSource != byteSourceFileService {
		log.Fatalf("reference-library-seed: --byte-source must be %q or %q", byteSourceVolume, byteSourceFileService)
	}

	manifest, err := loadManifest(*manifestPath)
	if err != nil {
		log.Fatalf("reference-library-seed: load manifest: %v", err)
	}
	if len(manifest.Documents) == 0 {
		log.Fatal("reference-library-seed: manifest has no documents")
	}
	log.Printf("reference-library-seed: manifest %q has %d documents; corpus dir %q; byte-source=%s",
		*manifestPath, len(manifest.Documents), *corpusDir, *byteSource)

	// For the file-service byte path we mint a short-lived JWT for the library
	// tenant. Signing REQUIRES the private key (AUTH_RSA_PRIVATE_KEY_PEM); a
	// validation-only environment cannot mint and the operator must either provide
	// the key or use --byte-source=volume.
	var uploader *fileServiceUploader
	if *byteSource == byteSourceFileService {
		if *fileServiceURL == "" {
			log.Fatal("reference-library-seed: --byte-source=file-service requires --file-service-url (or $LEX_FILE_SERVICE_URL)")
		}
		if *libraryTenant == "" {
			log.Fatal("reference-library-seed: --byte-source=file-service requires --library-tenant-id (or $LEX_REFERENCE_LIBRARY_TENANT_ID)")
		}
		uploader, err = newFileServiceUploader(*fileServiceURL, *libraryTenant)
		if err != nil {
			log.Fatalf("reference-library-seed: file-service uploader: %v", err)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	pool, err := pgxpool.New(ctx, *dbURL)
	if err != nil {
		log.Fatalf("reference-library-seed: connect lex_db: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("reference-library-seed: ping lex_db: %v", err)
	}

	// Count-guard fast-path: a fully-seeded catalog is a no-op unless --force. The
	// UPSERT below is itself idempotent (content_hash unique index), so this only
	// avoids re-hashing/re-uploading 95 MB on a healthy re-run.
	var existing int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM reference_library_documents WHERE deleted_at IS NULL`).Scan(&existing); err != nil {
		log.Fatalf("reference-library-seed: count existing rows: %v", err)
	}
	if existing >= len(manifest.Documents) && !*force {
		log.Printf("reference-library-seed: catalog already has %d rows (>= %d manifest docs); nothing to do (pass --force to re-upsert)", existing, len(manifest.Documents))
		return
	}

	// Index the corpus dir once so filenames resolve regardless of Unicode
	// normalization form. The committed manifest ships NFC-composed Arabic
	// filenames, but PDFs extracted on macOS are stored NFD-decomposed; a Linux
	// deploy box (ext4) does byte-exact filename lookups, so a naive
	// filepath.Join(dir, nfcName) + os.ReadFile ENOENTs for the ~23/33 filenames
	// whose NFC and NFD byte forms differ. The index maps NFC → the ACTUAL on-disk
	// entry name so both the read here AND the storage_key we persist match the
	// real bytes the runtime volume-serve path will os.Open on that same volume.
	corpus, err := newCorpusIndex(*corpusDir)
	if err != nil {
		log.Fatalf("reference-library-seed: scan corpus dir %q: %v", *corpusDir, err)
	}

	upserted := 0
	ingestDocs := make([]ingestDoc, 0, len(manifest.Documents))
	for _, doc := range manifest.Documents {
		if doc.SourceFilename == "" || doc.TitleAR == "" || doc.Category == "" || doc.DocType == "" {
			log.Fatalf("reference-library-seed: manifest entry missing required field (source_filename/title_ar/category/doc_type): %+v", doc)
		}
		pdfPath, diskName, err := corpus.resolve(doc.SourceFilename)
		if err != nil {
			log.Fatalf("reference-library-seed: locate %q in %q: %v", doc.SourceFilename, *corpusDir, err)
		}
		data, err := os.ReadFile(pdfPath)
		if err != nil {
			log.Fatalf("reference-library-seed: read %q: %v", pdfPath, err)
		}
		sum := sha256.Sum256(data)
		hash := hex.EncodeToString(sum[:])
		size := int64(len(data))
		pageCount := pdfPageCount(data)

		row := catalogRow{
			doc:           doc,
			contentHash:   hash,
			size:          size,
			pageCount:     pageCount,
			byteSource:    *byteSource,
			libraryTenant: *libraryTenant,
			// Persist the ACTUAL on-disk byte form (not the manifest's NFC form) so
			// the runtime volume-serve os.Open matches byte-for-byte on the volume the
			// seed provisioned — portable across NFC/NFD and macOS/Linux.
			storageKey: diskName,
		}

		if *byteSource == byteSourceFileService {
			resp, err := uploader.upload(ctx, doc.SourceFilename, data)
			if err != nil {
				log.Fatalf("reference-library-seed: upload %q to file-service: %v", doc.SourceFilename, err)
			}
			row.fileID = resp.ID
			row.storageKey = "" // file-service path does not use the volume key
			if resp.ChecksumSHA256 != "" {
				row.contentHash = resp.ChecksumSHA256 // trust the store's checksum
			}
			if resp.SizeBytes > 0 {
				row.size = resp.SizeBytes
			}
		}

		if err := upsert(ctx, pool, row); err != nil {
			log.Fatalf("reference-library-seed: upsert %q: %v", doc.SourceFilename, err)
		}
		upserted++
		pagesNote := ""
		if pageCount > 0 {
			pagesNote = fmt.Sprintf(", %d pages", pageCount)
		}
		log.Printf("  [%2d/%d] %s (%d bytes%s, sha256=%s…)", upserted, len(manifest.Documents), doc.TitleAR, row.size, pagesNote, row.contentHash[:12])

		ingestDocs = append(ingestDocs, ingestDoc{
			Category:     doc.Category,
			DocType:      doc.DocType,
			TitleAR:      doc.TitleAR,
			TitleEN:      doc.TitleEN,
			Authority:    doc.Authority,
			ContentHash:  row.contentHash,
			ByteSource:   row.byteSource,
			FileID:       row.fileID,
			StorageKey:   row.storageKey,
			LibraryTenID: row.libraryTenant,
			PageCount:    pageCount,
		})
	}

	log.Printf("reference-library-seed: done — upserted %d of %d catalog rows", upserted, len(manifest.Documents))

	if *reindex {
		if *aiURL == "" {
			log.Printf("reference-library-seed: --reindex set but no --ai-url (or $LEX_AI_SERVICE_URL); skipping AI re-index")
		} else if err := triggerReindex(ctx, *aiURL, ingestDocs); err != nil {
			// Non-fatal: the catalog is provisioned regardless of AI availability.
			log.Printf("reference-library-seed: WARNING — AI re-index failed (catalog is still provisioned): %v", err)
		} else {
			log.Printf("reference-library-seed: AI re-index accepted %d documents at %s/ingest", len(ingestDocs), *aiURL)
		}
	}
}

// catalogRow is the resolved byte-binding + metadata for one UPSERT.
type catalogRow struct {
	doc           manifestDoc
	contentHash   string
	size          int64
	pageCount     int
	byteSource    string
	fileID        string
	storageKey    string
	libraryTenant string
}

func loadManifest(path string) (*manifestFile, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var mf manifestFile
	if err := json.Unmarshal(raw, &mf); err != nil {
		return nil, fmt.Errorf("parse manifest json: %w", err)
	}
	return &mf, nil
}

// corpusIndex maps NFC-normalized filenames to the ACTUAL on-disk directory-entry
// name so the seed tolerates Unicode normalization differences between the
// committed (NFC) manifest and the on-disk (often NFD, on macOS) corpus. It scans
// the directory exactly once.
type corpusIndex struct {
	dir   string
	byNFC map[string]string
}

func newCorpusIndex(dir string) (*corpusIndex, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	idx := &corpusIndex{dir: dir, byNFC: make(map[string]string, len(entries))}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		idx.byNFC[norm.NFC.String(e.Name())] = e.Name()
	}
	return idx, nil
}

// resolve returns the absolute path and the ACTUAL on-disk base name for a
// manifest source_filename. It matches on the NFC-normalized name (authoritative
// for the real byte form), falling back to a byte-exact stat for any exotic entry
// the scan did not index.
func (c *corpusIndex) resolve(sourceFilename string) (path, diskName string, err error) {
	if actual, ok := c.byNFC[norm.NFC.String(sourceFilename)]; ok {
		return filepath.Join(c.dir, actual), actual, nil
	}
	direct := filepath.Join(c.dir, sourceFilename)
	if _, statErr := os.Stat(direct); statErr == nil {
		return direct, sourceFilename, nil
	}
	return "", "", fmt.Errorf("not found in corpus dir (byte-exact or NFC-normalized)")
}

// pdfPageCountRe matches an uncompressed page object (`/Type /Page` but NOT
// `/Type /Pages`). It is a cheap, dependency-free heuristic: born-digital PDFs
// expose page objects in plaintext; object-stream-compressed PDFs (1.5+) may
// hide them, in which case the count is 0 and page_count is simply omitted
// (honest "where cheaply extractable" — the P2 OCR sidecar handles the rest).
var pdfPageCountRe = regexp.MustCompile(`/Type\s*/Page([^s]|$)`)

func pdfPageCount(data []byte) int {
	if len(data) == 0 {
		return 0
	}
	return len(pdfPageCountRe.FindAll(data, -1))
}

func upsert(ctx context.Context, pool *pgxpool.Pool, row catalogRow) error {
	doc := row.doc
	jurisdiction := doc.Jurisdiction
	if jurisdiction == "" {
		jurisdiction = "SA"
	}
	tags := doc.Tags
	if tags == nil {
		tags = []string{}
	}
	metadata := map[string]any{}
	for k, v := range doc.Metadata {
		metadata[k] = v
	}
	if row.pageCount > 0 {
		metadata["page_count"] = row.pageCount
	}
	var sourceURL *string
	if doc.SourceURL != "" {
		sourceURL = &doc.SourceURL
	}
	var hijri *string
	if doc.HijriDate != "" {
		hijri = &doc.HijriDate
	}
	// The structured as-of value for the effective_date DATE column comes from the
	// manifest's metadata.effective_gregorian (a full ISO date). The companion
	// metadata.effective_hijri string is persisted as-is inside the metadata JSONB
	// above (no dedicated column). Unknown/absent ⇒ NULL, so the frontend shows
	// "confirm current version" rather than a fabricated date.
	effectiveDate := effectiveDateFromMetadata(doc.Metadata)
	var fileID *string
	if row.fileID != "" {
		fileID = &row.fileID
	}
	var storageKey *string
	if row.storageKey != "" {
		storageKey = &row.storageKey
	}
	var libraryTenant *string
	if row.libraryTenant != "" {
		libraryTenant = &row.libraryTenant
	}

	const q = `
INSERT INTO reference_library_documents (
    title_ar, title_en, description_ar, description_en, category, doc_type,
    jurisdiction, authority, source, source_url, tags, byte_source, file_id,
    storage_key, library_tenant_id, file_size_bytes, content_hash, published,
    version, hijri_date, metadata, effective_date
) VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10, $11, $12, $13,
    $14, $15, $16, $17, true,
    1, $18, $19, $20
)
ON CONFLICT (content_hash) WHERE content_hash IS NOT NULL DO UPDATE SET
    title_ar          = EXCLUDED.title_ar,
    title_en          = EXCLUDED.title_en,
    description_ar    = EXCLUDED.description_ar,
    description_en    = EXCLUDED.description_en,
    category          = EXCLUDED.category,
    doc_type          = EXCLUDED.doc_type,
    jurisdiction      = EXCLUDED.jurisdiction,
    authority         = EXCLUDED.authority,
    source            = EXCLUDED.source,
    source_url        = EXCLUDED.source_url,
    tags              = EXCLUDED.tags,
    byte_source       = EXCLUDED.byte_source,
    file_id           = EXCLUDED.file_id,
    storage_key       = EXCLUDED.storage_key,
    library_tenant_id = EXCLUDED.library_tenant_id,
    file_size_bytes   = EXCLUDED.file_size_bytes,
    hijri_date        = EXCLUDED.hijri_date,
    metadata          = EXCLUDED.metadata,
    effective_date    = EXCLUDED.effective_date,
    published         = true,
    deleted_at        = NULL,
    updated_at        = now()`

	_, err := pool.Exec(ctx, q,
		doc.TitleAR, doc.TitleEN, doc.DescriptionAR, doc.DescriptionEN, doc.Category, doc.DocType,
		jurisdiction, doc.Authority, doc.Source, sourceURL, tags, row.byteSource, fileID,
		storageKey, libraryTenant, row.size, row.contentHash, hijri, metadata, effectiveDate,
	)
	return err
}

// effectiveDateFromMetadata extracts the structured as-of date for the
// effective_date DATE column from the manifest's metadata.effective_gregorian. It
// accepts ONLY a full ISO date (YYYY-MM-DD) so a partial value can never fabricate
// a spurious day/month; anything absent, non-string, blank, or partial yields nil
// (NULL column → the frontend shows "confirm current version").
func effectiveDateFromMetadata(metadata map[string]any) *time.Time {
	if metadata == nil {
		return nil
	}
	raw, ok := metadata["effective_gregorian"]
	if !ok {
		return nil
	}
	s, ok := raw.(string)
	if !ok {
		return nil
	}
	if s = strings.TrimSpace(s); s == "" {
		return nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil
	}
	return &t
}

// -----------------------------------------------------------------------------
// file-service uploader — mints a library-tenant JWT and POSTs a multipart upload.
// -----------------------------------------------------------------------------

type fileServiceUploader struct {
	baseURL  string
	tenantID string
	token    string
	client   *http.Client
}

func newFileServiceUploader(baseURL, tenantID string) (*fileServiceUploader, error) {
	cfg, err := appconfig.Load()
	if err != nil {
		return nil, fmt.Errorf("load auth config: %w", err)
	}
	jwtMgr, err := auth.NewJWTManager(cfg.Auth)
	if err != nil {
		return nil, fmt.Errorf("build JWT manager: %w", err)
	}
	pair, err := jwtMgr.GenerateTokenPair(referenceLibrarySeedServiceUserID, tenantID, referenceLibrarySeedServiceEmail, []string{"service"}, "")
	if err != nil {
		return nil, fmt.Errorf("mint library-tenant token (is AUTH_RSA_PRIVATE_KEY_PEM set?): %w", err)
	}
	return &fileServiceUploader{
		baseURL:  trimTrailingSlash(baseURL),
		tenantID: tenantID,
		token:    pair.AccessToken,
		client:   &http.Client{Timeout: 120 * time.Second},
	}, nil
}

func (u *fileServiceUploader) upload(ctx context.Context, filename string, data []byte) (*fileServiceUploadResponse, error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if err := mw.WriteField("suite", "lex"); err != nil {
		return nil, err
	}
	if err := mw.WriteField("dedup_check", "true"); err != nil {
		return nil, err
	}
	part, err := mw.CreateFormFile("file", filename)
	if err != nil {
		return nil, err
	}
	if _, err := part.Write(data); err != nil {
		return nil, err
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.baseURL+"/api/v1/files/upload", &body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+u.token)
	req.Header.Set("X-Tenant-ID", u.tenantID)

	resp, err := u.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("file-service upload status %d: %s", resp.StatusCode, string(payload))
	}
	var out fileServiceUploadResponse
	if err := json.Unmarshal(payload, &out); err != nil {
		return nil, fmt.Errorf("decode upload response: %w", err)
	}
	if out.ID == "" {
		return nil, fmt.Errorf("file-service upload returned no id")
	}
	return &out, nil
}

// triggerReindex POSTs the corpus metadata + byte binding to {ai}/ingest so the
// Second-Brain index is refreshed. Non-2xx is an error (surfaced as a warning by
// the caller — AI infra may be absent in a given environment).
func triggerReindex(ctx context.Context, aiURL string, docs []ingestDoc) error {
	payload, err := json.Marshal(map[string]any{"documents": docs})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, trimTrailingSlash(aiURL)+"/ingest", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("ai /ingest status %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

func trimTrailingSlash(s string) string {
	for len(s) > 0 && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
