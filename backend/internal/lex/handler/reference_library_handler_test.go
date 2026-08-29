package handler

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
)

// fakeRefLibService implements referenceLibraryServicer with canned responses and
// call tracking, so the handler's serving hardening (ETag/conditional/Range/
// caching/gating/audit) is testable without a DB, file-service, or on-disk corpus.
type fakeRefLibService struct {
	fingerprint string

	listItems []model.ReferenceLibraryDocument
	listTotal int

	getDoc *model.ReferenceLibraryDocument
	getErr error

	facets *model.ReferenceLibraryFacets

	pdf          []byte
	resolveCalls int

	aiConfigured bool
	searchResp   *dto.ReferenceLibrarySearchResponse
	askResp      *dto.ReferenceLibraryAskResponse
	articlesResp *dto.ReferenceLibraryArticlesResponse

	askStreamBody   string // canned upstream SSE frames
	askStreamStatus int    // upstream HTTP status (0 → 200)
	askStreamErr    error  // dial/transport failure before streaming

	access   []model.ReferenceLibraryAccessEntry
	feedback []model.ReferenceLibraryAskFeedbackEntry
}

func (f *fakeRefLibService) Fingerprint(context.Context) (string, error) { return f.fingerprint, nil }

func (f *fakeRefLibService) List(context.Context, model.ReferenceLibraryListFilters) ([]model.ReferenceLibraryDocument, int, error) {
	return f.listItems, f.listTotal, nil
}

func (f *fakeRefLibService) Get(_ context.Context, _ uuid.UUID) (*model.ReferenceLibraryDocument, error) {
	return f.getDoc, f.getErr
}

func (f *fakeRefLibService) Facets(context.Context) (*model.ReferenceLibraryFacets, error) {
	return f.facets, nil
}

func (f *fakeRefLibService) GetForDownload(_ context.Context, _ uuid.UUID) (*model.ReferenceLibraryDocument, error) {
	return f.getDoc, f.getErr
}

func (f *fakeRefLibService) ResolveBytes(_ context.Context, _ *model.ReferenceLibraryDocument) (*service.ReferenceLibraryContent, error) {
	f.resolveCalls++
	return service.NewReferenceLibraryContent(bytes.NewReader(f.pdf), nil, int64(len(f.pdf)), "application/pdf", "file-service", time.Unix(1_700_000_000, 0)), nil
}

func (f *fakeRefLibService) RecordAccess(entry model.ReferenceLibraryAccessEntry) {
	f.access = append(f.access, entry)
}

func (f *fakeRefLibService) AIConfigured() bool { return f.aiConfigured }

func (f *fakeRefLibService) Search(context.Context, string, int, []string) (*dto.ReferenceLibrarySearchResponse, error) {
	return f.searchResp, nil
}

func (f *fakeRefLibService) Ask(context.Context, dto.ReferenceLibraryAskRequest) (*dto.ReferenceLibraryAskResponse, error) {
	return f.askResp, nil
}

// Articles mirrors the real service contract: an unconfigured AI (or no canned
// response) yields a graceful-empty index so the handler test can exercise the
// never-503 path.
func (f *fakeRefLibService) Articles(context.Context, uuid.UUID) (*dto.ReferenceLibraryArticlesResponse, error) {
	if f.aiConfigured && f.articlesResp != nil {
		return f.articlesResp, nil
	}
	return &dto.ReferenceLibraryArticlesResponse{Data: []dto.ReferenceLibraryArticle{}}, nil
}

func (f *fakeRefLibService) RecordAskFeedback(entry model.ReferenceLibraryAskFeedbackEntry) {
	f.feedback = append(f.feedback, entry)
}

func (f *fakeRefLibService) AskStream(context.Context, dto.ReferenceLibraryAskRequest) (*service.AskStreamSession, error) {
	if f.askStreamErr != nil {
		return nil, f.askStreamErr
	}
	status := f.askStreamStatus
	if status == 0 {
		status = http.StatusOK
	}
	return &service.AskStreamSession{
		Body:       io.NopCloser(strings.NewReader(f.askStreamBody)),
		StatusCode: status,
	}, nil
}

func newRefLibRouter(svc referenceLibraryServicer) chi.Router {
	h := NewReferenceLibraryHandler(svc, nil, zerolog.Nop())
	r := chi.NewRouter()
	r.Get("/reference-library", h.List)
	r.Get("/reference-library/facets", h.Facets)
	r.Get("/reference-library/search", h.Search)
	r.Post("/reference-library/ask", h.Ask)
	r.Post("/reference-library/ask/stream", h.AskStream)
	r.Post("/reference-library/ask/feedback", h.AskFeedback)
	r.Get("/reference-library/{id}", h.Get)
	r.Get("/reference-library/{id}/download", h.Download)
	r.Get("/reference-library/{id}/articles", h.Articles)
	return r
}

func TestReferenceLibraryHandlerListETagAndConditional(t *testing.T) {
	svc := &fakeRefLibService{
		fingerprint: "3-123",
		listItems:   []model.ReferenceLibraryDocument{{TitleAR: "نظام"}},
		listTotal:   1,
	}
	r := newRefLibRouter(svc)

	// First GET: 200 with an ETag + browse Cache-Control.
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/reference-library", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("missing ETag")
	}
	if cc := rec.Header().Get("Cache-Control"); cc != browseCacheControl {
		t.Errorf("Cache-Control = %q, want %q", cc, browseCacheControl)
	}

	// Conditional GET with the same ETag → 304, no body.
	req := httptest.NewRequest(http.MethodGet, "/reference-library", nil)
	req.Header.Set("If-None-Match", etag)
	rec2 := httptest.NewRecorder()
	r.ServeHTTP(rec2, req)
	if rec2.Code != http.StatusNotModified {
		t.Fatalf("conditional status = %d, want 304", rec2.Code)
	}
	if rec2.Body.Len() != 0 {
		t.Errorf("304 body not empty: %q", rec2.Body.String())
	}

	// A changed fingerprint changes the ETag → the old validator no longer 304s.
	svc.fingerprint = "4-999"
	rec3 := httptest.NewRecorder()
	req3 := httptest.NewRequest(http.MethodGet, "/reference-library", nil)
	req3.Header.Set("If-None-Match", etag)
	r.ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusOK {
		t.Fatalf("post-change status = %d, want 200 (stale validator must not 304)", rec3.Code)
	}
}

func TestReferenceLibraryHandlerFacetsConditional(t *testing.T) {
	svc := &fakeRefLibService{
		fingerprint: "1-1",
		facets:      &model.ReferenceLibraryFacets{Categories: []model.ReferenceLibraryFacet{{Value: "research", Count: 18}}},
	}
	r := newRefLibRouter(svc)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/reference-library/facets", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	etag := rec.Header().Get("ETag")
	req := httptest.NewRequest(http.MethodGet, "/reference-library/facets", nil)
	req.Header.Set("If-None-Match", etag)
	rec2 := httptest.NewRecorder()
	r.ServeHTTP(rec2, req)
	if rec2.Code != http.StatusNotModified {
		t.Fatalf("conditional status = %d, want 304", rec2.Code)
	}
}

func TestReferenceLibraryHandlerGetNotFound(t *testing.T) {
	svc := &fakeRefLibService{fingerprint: "1-1", getErr: apperrors.NewNotFound("NOT_FOUND", "reference library document not found")}
	r := newRefLibRouter(svc)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/reference-library/"+uuid.NewString(), nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestReferenceLibraryHandlerGetInvalidUUID(t *testing.T) {
	svc := &fakeRefLibService{fingerprint: "1-1"}
	r := newRefLibRouter(svc)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/reference-library/not-a-uuid", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestReferenceLibraryHandlerDownload(t *testing.T) {
	id := uuid.New()
	hash := "b6a8f0e1c2d3"
	doc := &model.ReferenceLibraryDocument{
		ID:          id,
		TitleEN:     "Investment Law",
		ByteSource:  "file-service",
		ContentHash: &hash,
		UpdatedAt:   time.Unix(1_700_000_000, 0),
	}
	svc := &fakeRefLibService{getDoc: doc, pdf: []byte("%PDF-1.7 hello world")}
	r := newRefLibRouter(svc)

	// Full download: 200, immutable Cache-Control, content_hash ETag, full body.
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/reference-library/"+id.String()+"/download", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("ETag"); got != "\""+hash+"\"" {
		t.Errorf("ETag = %q, want %q", got, "\""+hash+"\"")
	}
	if cc := rec.Header().Get("Cache-Control"); cc != downloadCacheControl {
		t.Errorf("Cache-Control = %q, want %q", cc, downloadCacheControl)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/pdf" {
		t.Errorf("Content-Type = %q, want application/pdf", ct)
	}
	if rec.Body.String() != "%PDF-1.7 hello world" {
		t.Errorf("body = %q", rec.Body.String())
	}
	if len(svc.access) == 0 || svc.access[len(svc.access)-1].Action != model.ReferenceLibraryActionDownload {
		t.Errorf("download not audited: %+v", svc.access)
	}

	// Conditional GET with content_hash ETag → 304 WITHOUT resolving bytes.
	svc.resolveCalls = 0
	req := httptest.NewRequest(http.MethodGet, "/reference-library/"+id.String()+"/download", nil)
	req.Header.Set("If-None-Match", "\""+hash+"\"")
	rec2 := httptest.NewRecorder()
	r.ServeHTTP(rec2, req)
	if rec2.Code != http.StatusNotModified {
		t.Fatalf("conditional status = %d, want 304", rec2.Code)
	}
	if svc.resolveCalls != 0 {
		t.Errorf("ResolveBytes called on 304 (should short-circuit): %d", svc.resolveCalls)
	}

	// Range request → 206 partial content, first 4 bytes.
	reqR := httptest.NewRequest(http.MethodGet, "/reference-library/"+id.String()+"/download", nil)
	reqR.Header.Set("Range", "bytes=0-3")
	rec3 := httptest.NewRecorder()
	r.ServeHTTP(rec3, reqR)
	if rec3.Code != http.StatusPartialContent {
		t.Fatalf("range status = %d, want 206", rec3.Code)
	}
	if rec3.Body.String() != "%PDF" {
		t.Errorf("range body = %q, want %q", rec3.Body.String(), "%PDF")
	}
}

func TestReferenceLibraryHandlerSearchGating(t *testing.T) {
	svc := &fakeRefLibService{aiConfigured: false}
	r := newRefLibRouter(svc)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/reference-library/search?q=x", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "second brain not configured") {
		t.Errorf("body = %q", rec.Body.String())
	}
}

func TestReferenceLibraryHandlerAskValidation(t *testing.T) {
	svc := &fakeRefLibService{aiConfigured: true}
	r := newRefLibRouter(svc)

	// Empty question → 422 before touching the AI.
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/reference-library/ask", strings.NewReader(`{"question":"  "}`)))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}

	// Valid question but AI unconfigured → 503.
	svc.aiConfigured = false
	rec2 := httptest.NewRecorder()
	r.ServeHTTP(rec2, httptest.NewRequest(http.MethodPost, "/reference-library/ask", strings.NewReader(`{"question":"هل يجوز؟"}`)))
	if rec2.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec2.Code)
	}
}

func TestReferenceLibraryHandlerAskProxies(t *testing.T) {
	svc := &fakeRefLibService{
		aiConfigured: true,
		askResp:      &dto.ReferenceLibraryAskResponse{Answer: "نعم", Model: "claude"},
	}
	r := newRefLibRouter(svc)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/reference-library/ask", strings.NewReader(`{"question":"هل يجوز؟"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "\"answer\":\"نعم\"") {
		t.Errorf("body = %q", rec.Body.String())
	}
	if len(svc.access) == 0 || svc.access[len(svc.access)-1].Action != model.ReferenceLibraryActionAsk {
		t.Errorf("ask not audited: %+v", svc.access)
	}
}

func TestReferenceLibraryAskStream(t *testing.T) {
	askBody := func() *bytes.Reader {
		return bytes.NewReader([]byte(`{"question":"ما هو نظام المحاماة؟"}`))
	}

	// Unconfigured AI → 503 before any streaming, honest error (never fabricated).
	t.Run("unconfigured returns 503", func(t *testing.T) {
		r := newRefLibRouter(&fakeRefLibService{aiConfigured: false})
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/reference-library/ask/stream", askBody()))
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("want 503, got %d", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "second brain not configured") {
			t.Fatalf("want honest 503 body, got %q", rec.Body.String())
		}
	})

	// Happy path → the upstream SSE frames are proxied verbatim as text/event-stream.
	t.Run("passes upstream SSE through verbatim", func(t *testing.T) {
		frames := "event: token\ndata: {\"text\":\"النظام\"}\n\n" +
			"event: token\ndata: {\"text\":\" ...\"}\n\n" +
			"event: citations\ndata: {\"citations\":[],\"model\":\"claude\"}\n\n" +
			"event: done\ndata: {}\n\n"
		r := newRefLibRouter(&fakeRefLibService{aiConfigured: true, askStreamBody: frames, askStreamStatus: http.StatusOK})
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/reference-library/ask/stream", askBody()))
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d", rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
			t.Fatalf("want text/event-stream, got %q", ct)
		}
		if rec.Body.String() != frames {
			t.Fatalf("SSE not proxied verbatim:\n got %q\nwant %q", rec.Body.String(), frames)
		}
	})

	// Upstream non-2xx (its own 503) → in-band terminal error+done frame, transport still 200.
	t.Run("upstream error becomes terminal SSE error frame", func(t *testing.T) {
		r := newRefLibRouter(&fakeRefLibService{
			aiConfigured:    true,
			askStreamStatus: http.StatusServiceUnavailable,
			askStreamBody:   `{"error":"llm not configured"}`,
		})
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/reference-library/ask/stream", askBody()))
		if rec.Code != http.StatusOK {
			t.Fatalf("SSE transport must be 200, got %d", rec.Code)
		}
		body := rec.Body.String()
		if !strings.Contains(body, "event: error") || !strings.Contains(body, "llm not configured") {
			t.Fatalf("want terminal error frame carrying the upstream message, got %q", body)
		}
		if !strings.Contains(body, "event: done") {
			t.Fatalf("want terminal done frame, got %q", body)
		}
	})

	// Malformed body → 400 (validation before any streaming).
	t.Run("empty question rejected", func(t *testing.T) {
		r := newRefLibRouter(&fakeRefLibService{aiConfigured: true})
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/reference-library/ask/stream", bytes.NewReader([]byte(`{"question":"  "}`))))
		if rec.Code != http.StatusUnprocessableEntity && rec.Code != http.StatusBadRequest {
			t.Fatalf("want 4xx for empty question, got %d", rec.Code)
		}
	})
}

func TestReferenceLibraryHandlerArticles(t *testing.T) {
	// AI unset → the service returns an empty index and the handler responds 200
	// {data:[]} (optional enrichment must NEVER 503 — the frontend hides the panel).
	t.Run("graceful empty when AI unset", func(t *testing.T) {
		r := newRefLibRouter(&fakeRefLibService{aiConfigured: false})
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/reference-library/"+uuid.NewString()+"/articles", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (articles must not 503/error)", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), `"data":[]`) {
			t.Errorf("body = %q, want empty {\"data\":[]}", rec.Body.String())
		}
	})

	// Configured AI with a canned index → proxied verbatim as {data:[...]}.
	t.Run("proxies the index verbatim", func(t *testing.T) {
		page := 12
		svc := &fakeRefLibService{
			aiConfigured: true,
			articlesResp: &dto.ReferenceLibraryArticlesResponse{Data: []dto.ReferenceLibraryArticle{
				{ArticleNo: "1", Label: "المادة الأولى", Title: "التعريفات", Page: &page},
			}},
		}
		r := newRefLibRouter(svc)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/reference-library/"+uuid.NewString()+"/articles", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		body := rec.Body.String()
		if !strings.Contains(body, `"article_no":"1"`) || !strings.Contains(body, "المادة الأولى") {
			t.Errorf("body = %q, want the proxied article index", body)
		}
	})

	// Invalid id → 400 (never reaches the AI proxy).
	t.Run("invalid uuid rejected", func(t *testing.T) {
		r := newRefLibRouter(&fakeRefLibService{aiConfigured: true})
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/reference-library/not-a-uuid/articles", nil))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})
}

func TestReferenceLibraryHandlerAskFeedback(t *testing.T) {
	// Valid thumbs-up with a comment + citations → 204, recorded with the citations
	// captured as JSON and the tenant/user coming from the request context (here nil,
	// as the test router has no auth middleware).
	t.Run("valid up → 204 and recorded", func(t *testing.T) {
		svc := &fakeRefLibService{}
		r := newRefLibRouter(svc)
		rec := httptest.NewRecorder()
		body := `{"question":"هل يجوز؟","rating":"up","comment":"مفيد","citations":[{"doc_id":"d1","score":0.9}]}`
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/reference-library/ask/feedback", strings.NewReader(body)))
		if rec.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204", rec.Code)
		}
		if len(svc.feedback) != 1 {
			t.Fatalf("feedback not recorded: %+v", svc.feedback)
		}
		got := svc.feedback[0]
		if got.Rating != "up" || got.Question != "هل يجوز؟" || got.Comment != "مفيد" {
			t.Errorf("recorded feedback = %+v", got)
		}
		if !strings.Contains(string(got.Citations), `"doc_id":"d1"`) {
			t.Errorf("citations not captured: %q", string(got.Citations))
		}
	})

	// Rating is required + constrained: missing, blank, or out-of-set → 422 and NO
	// feedback recorded. A missing question is likewise a 422.
	for _, tc := range []struct {
		name string
		body string
	}{
		{"missing rating", `{"question":"x"}`},
		{"invalid rating", `{"question":"x","rating":"meh"}`},
		{"missing question", `{"rating":"up"}`},
	} {
		t.Run(tc.name+" → 422", func(t *testing.T) {
			svc := &fakeRefLibService{}
			r := newRefLibRouter(svc)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/reference-library/ask/feedback", strings.NewReader(tc.body)))
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want 422", rec.Code)
			}
			if len(svc.feedback) != 0 {
				t.Errorf("invalid feedback was recorded: %+v", svc.feedback)
			}
		})
	}

	// Malformed JSON → 400.
	t.Run("malformed body → 400", func(t *testing.T) {
		r := newRefLibRouter(&fakeRefLibService{})
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/reference-library/ask/feedback", strings.NewReader(`{not json`)))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})
}
