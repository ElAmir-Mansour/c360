package service

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/rs/zerolog"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

type staticTokenSource struct {
	token string
	err   error
}

func (s staticTokenSource) Token(context.Context, string) (string, error) { return s.token, s.err }

func newRefLibService(t *testing.T, mock pgxmock.PgxPoolIface, cfg ReferenceLibraryConfig) *ReferenceLibraryService {
	t.Helper()
	repo := repository.NewReferenceLibraryRepository(mock, zerolog.Nop())
	return NewReferenceLibraryService(repo, cfg, zerolog.Nop())
}

func mustStatus(t *testing.T, err error, want int) {
	t.Helper()
	var appErr *apperrors.AppError
	if err == nil {
		t.Fatalf("expected error with status %d, got nil", want)
	}
	if !asAppError(err, &appErr) || appErr.Status != want {
		t.Fatalf("expected AppError status %d, got %v", want, err)
	}
}

func asAppError(err error, target **apperrors.AppError) bool {
	if ae, ok := err.(*apperrors.AppError); ok {
		*target = ae
		return true
	}
	return false
}

// -----------------------------------------------------------------------------
// Second-Brain AI proxy — 503 (unconfigured), 200 (ok), 502 (upstream error).
// -----------------------------------------------------------------------------

func TestReferenceLibraryServiceAIConfigured(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
	defer mock.Close()

	off := newRefLibService(t, mock, ReferenceLibraryConfig{})
	if off.AIConfigured() {
		t.Fatal("AIConfigured() = true for empty URL, want false")
	}
	on := newRefLibService(t, mock, ReferenceLibraryConfig{AIServiceURL: "http://ai:9000"})
	if !on.AIConfigured() {
		t.Fatal("AIConfigured() = false for set URL, want true")
	}
}

func TestReferenceLibraryServiceSearch(t *testing.T) {
	t.Run("ok proxies and parses", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/search" {
				t.Errorf("path = %q, want /search", r.URL.Path)
			}
			if q := r.URL.Query().Get("q"); q != "تحكيم" {
				t.Errorf("q = %q, want تحكيم", q)
			}
			_, _ = io.WriteString(w, `{"data":[{"doc_id":"d1","title_ar":"نظام","score":0.9}],"meta":{"count":1}}`)
		}))
		defer srv.Close()

		mock, _ := pgxmock.NewPool()
		defer mock.Close()
		svc := newRefLibService(t, mock, ReferenceLibraryConfig{AIServiceURL: srv.URL})
		resp, err := svc.Search(context.Background(), "تحكيم", 5, nil)
		if err != nil {
			t.Fatalf("Search: %v", err)
		}
		if len(resp.Data) != 1 || resp.Data[0].DocID != "d1" {
			t.Fatalf("resp = %+v", resp)
		}
	})

	t.Run("upstream 500 maps to 502", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer srv.Close()
		mock, _ := pgxmock.NewPool()
		defer mock.Close()
		svc := newRefLibService(t, mock, ReferenceLibraryConfig{AIServiceURL: srv.URL})
		_, err := svc.Search(context.Background(), "x", 0, nil)
		mustStatus(t, err, http.StatusBadGateway)
	})

	t.Run("transport failure maps to 502", func(t *testing.T) {
		mock, _ := pgxmock.NewPool()
		defer mock.Close()
		// Point at a closed server → dial fails.
		svc := newRefLibService(t, mock, ReferenceLibraryConfig{AIServiceURL: "http://127.0.0.1:1"})
		_, err := svc.Search(context.Background(), "x", 0, nil)
		mustStatus(t, err, http.StatusBadGateway)
	})
}

func TestReferenceLibraryServiceAsk(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/ask" {
			t.Errorf("got %s %s", r.Method, r.URL.Path)
		}
		_, _ = io.WriteString(w, `{"answer":"نعم","citations":[{"doc_id":"d1","score":0.8}],"model":"claude","latency_ms":12}`)
	}))
	defer srv.Close()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	svc := newRefLibService(t, mock, ReferenceLibraryConfig{AIServiceURL: srv.URL})
	resp, err := svc.Ask(context.Background(), dto.ReferenceLibraryAskRequest{Question: "هل يجوز؟"})
	if err != nil {
		t.Fatalf("Ask: %v", err)
	}
	if resp.Answer != "نعم" || len(resp.Citations) != 1 {
		t.Fatalf("resp = %+v", resp)
	}
}

// -----------------------------------------------------------------------------
// Articles proxy — OPTIONAL enrichment: unconfigured/non-2xx/transport all degrade
// to a graceful empty index ({data:[]}, nil error), NEVER a 503/502.
// -----------------------------------------------------------------------------

func TestReferenceLibraryServiceArticles(t *testing.T) {
	t.Run("unconfigured AI returns empty, no error", func(t *testing.T) {
		mock, _ := pgxmock.NewPool()
		defer mock.Close()
		svc := newRefLibService(t, mock, ReferenceLibraryConfig{})
		resp, err := svc.Articles(context.Background(), uuid.New())
		if err != nil {
			t.Fatalf("Articles: unexpected error %v", err)
		}
		if resp == nil || resp.Data == nil || len(resp.Data) != 0 {
			t.Fatalf("want graceful empty index, got %+v", resp)
		}
	})

	t.Run("ok proxies the index with doc_id", func(t *testing.T) {
		id := uuid.New()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/articles" {
				t.Errorf("path = %q, want /articles", r.URL.Path)
			}
			if got := r.URL.Query().Get("doc_id"); got != id.String() {
				t.Errorf("doc_id = %q, want %q", got, id.String())
			}
			_, _ = io.WriteString(w, `{"data":[{"article_no":"1","label":"المادة الأولى","title":"التعريفات","page":3}]}`)
		}))
		defer srv.Close()
		mock, _ := pgxmock.NewPool()
		defer mock.Close()
		svc := newRefLibService(t, mock, ReferenceLibraryConfig{AIServiceURL: srv.URL})
		resp, err := svc.Articles(context.Background(), id)
		if err != nil {
			t.Fatalf("Articles: %v", err)
		}
		if len(resp.Data) != 1 || resp.Data[0].ArticleNo != "1" {
			t.Fatalf("resp = %+v", resp)
		}
	})

	t.Run("upstream 500 degrades to empty (graceful)", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer srv.Close()
		mock, _ := pgxmock.NewPool()
		defer mock.Close()
		svc := newRefLibService(t, mock, ReferenceLibraryConfig{AIServiceURL: srv.URL})
		resp, err := svc.Articles(context.Background(), uuid.New())
		if err != nil {
			t.Fatalf("Articles must not surface upstream error, got %v", err)
		}
		if len(resp.Data) != 0 {
			t.Fatalf("want empty on upstream error, got %+v", resp)
		}
	})

	t.Run("transport failure degrades to empty", func(t *testing.T) {
		mock, _ := pgxmock.NewPool()
		defer mock.Close()
		svc := newRefLibService(t, mock, ReferenceLibraryConfig{AIServiceURL: "http://127.0.0.1:1"})
		resp, err := svc.Articles(context.Background(), uuid.New())
		if err != nil {
			t.Fatalf("Articles must not surface transport error, got %v", err)
		}
		if len(resp.Data) != 0 {
			t.Fatalf("want empty on transport failure, got %+v", resp)
		}
	})
}

// -----------------------------------------------------------------------------
// File-service client — headers, checksum, filename, 404, 502.
// -----------------------------------------------------------------------------

func TestFileServiceClientDownload(t *testing.T) {
	t.Run("ok streams with metadata", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if got := r.Header.Get("Authorization"); got != "Bearer tok" {
				t.Errorf("Authorization = %q, want Bearer tok", got)
			}
			if got := r.Header.Get("X-Tenant-ID"); got != "lib-tenant" {
				t.Errorf("X-Tenant-ID = %q, want lib-tenant", got)
			}
			w.Header().Set("Content-Type", "application/pdf")
			w.Header().Set("X-Checksum-SHA256", "abc123")
			w.Header().Set("Content-Disposition", `attachment; filename="doc.pdf"`)
			_, _ = io.WriteString(w, "%PDF-1.7 bytes")
		}))
		defer srv.Close()

		client := NewFileServiceClient(FileServiceClientConfig{BaseURL: srv.URL, TokenSource: staticTokenSource{token: "tok"}}, zerolog.Nop())
		if !client.Ready() {
			t.Fatal("client not ready")
		}
		obj, err := client.Download(context.Background(), "lib-tenant", "file-1")
		if err != nil {
			t.Fatalf("Download: %v", err)
		}
		defer obj.Body.Close()
		body, _ := io.ReadAll(obj.Body)
		if string(body) != "%PDF-1.7 bytes" {
			t.Errorf("body = %q", string(body))
		}
		if obj.ChecksumSHA256 != "abc123" {
			t.Errorf("checksum = %q", obj.ChecksumSHA256)
		}
		if obj.Filename != "doc.pdf" {
			t.Errorf("filename = %q", obj.Filename)
		}
	})

	t.Run("404 maps to not-found", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNotFound)
		}))
		defer srv.Close()
		client := NewFileServiceClient(FileServiceClientConfig{BaseURL: srv.URL, TokenSource: staticTokenSource{token: "t"}}, zerolog.Nop())
		_, err := client.Download(context.Background(), "lib", "f")
		mustStatus(t, err, http.StatusNotFound)
	})

	t.Run("500 maps to 502", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer srv.Close()
		client := NewFileServiceClient(FileServiceClientConfig{BaseURL: srv.URL, TokenSource: staticTokenSource{token: "t"}}, zerolog.Nop())
		_, err := client.Download(context.Background(), "lib", "f")
		mustStatus(t, err, http.StatusBadGateway)
	})

	t.Run("token mint failure maps to 502", func(t *testing.T) {
		client := NewFileServiceClient(FileServiceClientConfig{BaseURL: "http://unused", TokenSource: staticTokenSource{err: io.ErrUnexpectedEOF}}, zerolog.Nop())
		_, err := client.Download(context.Background(), "lib", "f")
		mustStatus(t, err, http.StatusBadGateway)
	})

	t.Run("nil base url disables client", func(t *testing.T) {
		if NewFileServiceClient(FileServiceClientConfig{}, zerolog.Nop()) != nil {
			t.Fatal("expected nil client for empty base URL")
		}
	})
}

// -----------------------------------------------------------------------------
// ResolveBytes — volume path (seekable *os.File) and file-service path (buffered).
// -----------------------------------------------------------------------------

func TestResolveBytesVolume(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "law.pdf"), []byte("%PDF volume"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	svc := newRefLibService(t, mock, ReferenceLibraryConfig{StorageDir: dir})

	key := "law.pdf"
	doc := &model.ReferenceLibraryDocument{ByteSource: "volume", StorageKey: &key, UpdatedAt: time.Now()}
	content, err := svc.ResolveBytes(context.Background(), doc)
	if err != nil {
		t.Fatalf("ResolveBytes: %v", err)
	}
	defer content.Close()
	if content.ByteSource != "volume" {
		t.Errorf("byte_source = %q, want volume", content.ByteSource)
	}
	body, _ := io.ReadAll(content.Reader())
	if string(body) != "%PDF volume" {
		t.Errorf("body = %q", string(body))
	}
}

func TestResolveBytesVolumePathTraversalRejected(t *testing.T) {
	dir := t.TempDir()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	svc := newRefLibService(t, mock, ReferenceLibraryConfig{StorageDir: dir})
	// The "/"+key clean collapses the traversal INSIDE the corpus dir, so it can
	// never open /etc/passwd; the contained path simply does not exist → 404. This
	// proves the fail-closed containment (a leaked file would be a 200).
	bad := "../../../etc/passwd"
	doc := &model.ReferenceLibraryDocument{ByteSource: "volume", StorageKey: &bad}
	_, err := svc.ResolveBytes(context.Background(), doc)
	mustStatus(t, err, http.StatusNotFound)
}

func TestResolveBytesFileService(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/pdf")
		_, _ = io.WriteString(w, "%PDF file-service")
	}))
	defer srv.Close()

	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	svc := newRefLibService(t, mock, ReferenceLibraryConfig{DefaultLibraryTenantID: "lib-tenant"})
	client := NewFileServiceClient(FileServiceClientConfig{BaseURL: srv.URL, TokenSource: staticTokenSource{token: "tok"}}, zerolog.Nop())
	svc.WithFileService(client)

	fileID := uuid.New()
	doc := &model.ReferenceLibraryDocument{ByteSource: "file-service", FileID: &fileID, UpdatedAt: time.Now()}
	content, err := svc.ResolveBytes(context.Background(), doc)
	if err != nil {
		t.Fatalf("ResolveBytes: %v", err)
	}
	defer content.Close()
	if content.ByteSource != "file-service" {
		t.Errorf("byte_source = %q, want file-service", content.ByteSource)
	}
	body, _ := io.ReadAll(content.Reader())
	if string(body) != "%PDF file-service" {
		t.Errorf("body = %q", string(body))
	}
	// Seekable: rewind and re-read (proves Range serving works).
	if _, err := content.Reader().Seek(0, io.SeekStart); err != nil {
		t.Fatalf("seek: %v", err)
	}
	rewound, _ := io.ReadAll(content.Reader())
	if !bytes.Equal(rewound, body) {
		t.Errorf("rewind mismatch")
	}
}

func TestResolveBytesFileServiceUnconfiguredNoFallback(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	// file-service selected, no client wired, no storage_key → clear 502.
	svc := newRefLibService(t, mock, ReferenceLibraryConfig{})
	fileID := uuid.New()
	doc := &model.ReferenceLibraryDocument{ByteSource: "file-service", FileID: &fileID}
	_, err := svc.ResolveBytes(context.Background(), doc)
	mustStatus(t, err, http.StatusBadGateway)
}

// -----------------------------------------------------------------------------
// Fingerprint + read-through cache — corpus reads hit the DB once per fingerprint.
// -----------------------------------------------------------------------------

func TestReferenceLibraryFingerprintCaching(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	updated := time.Date(2026, 7, 11, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`SELECT COUNT\(\*\), MAX\(updated_at\)`).
		WillReturnRows(pgxmock.NewRows([]string{"count", "max"}).AddRow(2, &updated))

	svc := newRefLibService(t, mock, ReferenceLibraryConfig{CacheTTL: time.Minute})
	fp1, err := svc.Fingerprint(context.Background())
	if err != nil {
		t.Fatalf("Fingerprint: %v", err)
	}
	// Second call within TTL must NOT re-query (only one ExpectQuery registered).
	fp2, err := svc.Fingerprint(context.Background())
	if err != nil {
		t.Fatalf("Fingerprint 2: %v", err)
	}
	if fp1 != fp2 || fp1 == "" {
		t.Fatalf("fingerprints differ or empty: %q vs %q", fp1, fp2)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations (second call should have been cached): %v", err)
	}
}

func TestReferenceLibraryListCaching(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	updated := time.Date(2026, 7, 11, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`SELECT COUNT\(\*\), MAX\(updated_at\)`).
		WillReturnRows(pgxmock.NewRows([]string{"count", "max"}).AddRow(1, &updated))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM reference_library_documents`).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(`SELECT row_to_json`).
		WithArgs(25, 0).
		WillReturnRows(pgxmock.NewRows([]string{"row_to_json"}).
			AddRow([]byte(`{"id":"11111111-1111-1111-1111-111111111111","title_ar":"نظام"}`)))

	svc := newRefLibService(t, mock, ReferenceLibraryConfig{CacheTTL: time.Minute})
	filters := model.ReferenceLibraryListFilters{Page: 1, PerPage: 25}
	if _, total, err := svc.List(context.Background(), filters); err != nil || total != 1 {
		t.Fatalf("List 1: total=%d err=%v", total, err)
	}
	// Identical query within TTL is served from cache — no further DB queries.
	if _, total, err := svc.List(context.Background(), filters); err != nil || total != 1 {
		t.Fatalf("List 2: total=%d err=%v", total, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations (second List should have been cached): %v", err)
	}
}
