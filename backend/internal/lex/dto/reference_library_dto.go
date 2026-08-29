package dto

import (
	"strconv"
	"strings"

	"github.com/clario360/platform/internal/lex/model"
)

// Reference-library Second-Brain proxy input bounds. These cap the LLM-cost
// surface so a caller cannot force an unbounded top_k, an oversized question, or
// an unbounded doc-id filter through the /ask + /search proxies. Exported so the
// handler and service enforce the same bounds on both /ask and /search.
const (
	ReferenceLibraryMaxTopK        = 50
	ReferenceLibraryMaxQuestionLen = 2000
	ReferenceLibraryMaxDocIDs      = 50
	// ReferenceLibraryMaxCommentLen bounds the optional free-text feedback comment.
	ReferenceLibraryMaxCommentLen = 2000
)

// ReferenceLibraryListQuery is the browse/metadata-search query for the global
// reference library. Normalize() trims + folds it into the case the repository
// expects; ToFilters() maps it to the model filter with pagination applied.
type ReferenceLibraryListQuery struct {
	Search   string
	Category string
	DocType  string
	Tag      string
	Page     int
	PerPage  int
}

func (q *ReferenceLibraryListQuery) Normalize() {
	q.Search = strings.TrimSpace(q.Search)
	q.Category = strings.TrimSpace(q.Category)
	q.DocType = strings.TrimSpace(q.DocType)
	q.Tag = strings.TrimSpace(q.Tag)
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PerPage < 1 {
		q.PerPage = 25
	}
	if q.PerPage > 200 {
		q.PerPage = 200
	}
}

// CacheKey is the stable identity of a normalized browse query, used to key the
// read-through cache and derive the response ETag. Call after Normalize().
func (q ReferenceLibraryListQuery) CacheKey() string {
	return strings.Join([]string{
		"s=" + strings.ToLower(q.Search),
		"c=" + q.Category,
		"t=" + q.DocType,
		"g=" + q.Tag,
		"p=" + strconv.Itoa(q.Page),
		"n=" + strconv.Itoa(q.PerPage),
	}, "|")
}

func (q ReferenceLibraryListQuery) ToFilters() model.ReferenceLibraryListFilters {
	return model.ReferenceLibraryListFilters{
		Search:   q.Search,
		Category: q.Category,
		DocType:  q.DocType,
		Tag:      q.Tag,
		Page:     q.Page,
		PerPage:  q.PerPage,
	}
}

// ReferenceLibraryDocumentDTO is the read response shape. It embeds the catalog
// row (all json tags flatten through) and adds has_download so the frontend can
// decide whether to render a download/preview action without inspecting the byte
// binding fields itself, plus page_count surfaced from metadata for browse/detail.
type ReferenceLibraryDocumentDTO struct {
	model.ReferenceLibraryDocument
	HasDownload bool `json:"has_download"`
	// PageCount is the PDF page count when the ingestion job could cheaply extract
	// it (stored in metadata.page_count). Nil when unknown (e.g. scanned issues
	// awaiting the P2 OCR sidecar).
	PageCount *int `json:"page_count,omitempty"`
}

// NewReferenceLibraryDocumentDTO maps a catalog row to its response shape.
func NewReferenceLibraryDocumentDTO(doc model.ReferenceLibraryDocument) ReferenceLibraryDocumentDTO {
	hasDownload := (doc.StorageKey != nil && strings.TrimSpace(*doc.StorageKey) != "") || doc.FileID != nil
	return ReferenceLibraryDocumentDTO{
		ReferenceLibraryDocument: doc,
		HasDownload:              hasDownload,
		PageCount:                pageCountFromMetadata(doc.Metadata),
	}
}

// pageCountFromMetadata reads an optional page_count from the catalog metadata
// JSONB. JSON numbers decode as float64 in map[string]any; a string ("42") is
// also tolerated. Returns nil for absent/invalid/non-positive values.
func pageCountFromMetadata(metadata map[string]any) *int {
	if metadata == nil {
		return nil
	}
	raw, ok := metadata["page_count"]
	if !ok {
		return nil
	}
	var n int
	switch v := raw.(type) {
	case float64:
		n = int(v)
	case int:
		n = v
	case int64:
		n = int(v)
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return nil
		}
		n = parsed
	default:
		return nil
	}
	if n <= 0 {
		return nil
	}
	return &n
}

// NewReferenceLibraryDocumentDTOs maps a slice of catalog rows.
func NewReferenceLibraryDocumentDTOs(docs []model.ReferenceLibraryDocument) []ReferenceLibraryDocumentDTO {
	out := make([]ReferenceLibraryDocumentDTO, 0, len(docs))
	for _, doc := range docs {
		out = append(out, NewReferenceLibraryDocumentDTO(doc))
	}
	return out
}

// -----------------------------------------------------------------------------
// Second-Brain AI proxy contract (WatheeqTech_Library_Design.md §7 P2). The
// /reference-library/search (contents) and /reference-library/ask (Q&A) handlers
// proxy to the sibling AI service; these are the exact request/response shapes.
// -----------------------------------------------------------------------------

// ReferenceLibraryAskRequest is the POST /reference-library/ask body.
type ReferenceLibraryAskRequest struct {
	Question string   `json:"question"`
	TopK     int      `json:"top_k,omitempty"`
	DocIDs   []string `json:"doc_ids,omitempty"`
}

func (r *ReferenceLibraryAskRequest) Normalize() {
	r.Question = strings.TrimSpace(r.Question)
	if r.TopK < 0 {
		r.TopK = 0
	}
	if r.TopK > ReferenceLibraryMaxTopK {
		r.TopK = ReferenceLibraryMaxTopK
	}
	cleaned := make([]string, 0, len(r.DocIDs))
	for _, id := range r.DocIDs {
		if id = strings.TrimSpace(id); id != "" {
			cleaned = append(cleaned, id)
		}
		if len(cleaned) >= ReferenceLibraryMaxDocIDs {
			break
		}
	}
	r.DocIDs = cleaned
}

// Validate bounds-checks the normalized request, returning field errors the
// handler surfaces as a 422. Call after Normalize().
func (r ReferenceLibraryAskRequest) Validate() map[string]string {
	fields := map[string]string{}
	if r.Question == "" {
		fields["question"] = "required"
	} else if len(r.Question) > ReferenceLibraryMaxQuestionLen {
		fields["question"] = "too long"
	}
	if len(fields) == 0 {
		return nil
	}
	return fields
}

// ReferenceLibraryCitation is one grounding citation returned by the AI Q&A.
type ReferenceLibraryCitation struct {
	DocID   string  `json:"doc_id"`
	TitleAR string  `json:"title_ar"`
	TitleEN string  `json:"title_en"`
	Snippet string  `json:"snippet"`
	Page    *int    `json:"page,omitempty"`
	Score   float64 `json:"score"`
}

// ReferenceLibraryAskResponse is the answer + grounding citations from the AI.
type ReferenceLibraryAskResponse struct {
	Answer    string                     `json:"answer"`
	Citations []ReferenceLibraryCitation `json:"citations"`
	Model     string                     `json:"model"`
	LatencyMS int64                      `json:"latency_ms"`
}

// ReferenceLibrarySearchHit is one semantic-search result from the AI.
type ReferenceLibrarySearchHit struct {
	DocID   string  `json:"doc_id"`
	TitleAR string  `json:"title_ar"`
	TitleEN string  `json:"title_en"`
	Snippet string  `json:"snippet"`
	Score   float64 `json:"score"`
}

// ReferenceLibrarySearchResponse is the semantic (contents) search result page.
type ReferenceLibrarySearchResponse struct {
	Data []ReferenceLibrarySearchHit `json:"data"`
	Meta map[string]any              `json:"meta"`
}

// -----------------------------------------------------------------------------
// Article (مادة) index — the per-document article/section table of contents,
// proxied from GET {AI}/articles?doc_id={id}. Optional enrichment: when the AI
// service is unset or errors, the handler returns {data:[]} (200) and the
// frontend hides the panel rather than showing an error.
// -----------------------------------------------------------------------------

// ReferenceLibraryArticle is one article/section entry in a document's index.
type ReferenceLibraryArticle struct {
	ArticleNo string `json:"article_no"`
	Label     string `json:"label"`
	Title     string `json:"title"`
	Page      *int   `json:"page,omitempty"`
}

// ReferenceLibraryArticlesResponse is the article index proxied verbatim from the
// AI service ({data:[...]}). Data is never nil so the JSON is always {"data":[]}.
type ReferenceLibraryArticlesResponse struct {
	Data []ReferenceLibraryArticle `json:"data"`
}

// -----------------------------------------------------------------------------
// Answer feedback — the thumbs up/down (+ optional comment + citations) captured
// for a Second-Brain /ask answer via POST /reference-library/ask/feedback.
// -----------------------------------------------------------------------------

// ReferenceLibraryAskFeedbackRequest is the POST /reference-library/ask/feedback
// body: the graded question, an up/down rating, an optional comment, and the
// citations the answer was grounded on (persisted verbatim).
type ReferenceLibraryAskFeedbackRequest struct {
	Question  string                     `json:"question"`
	Rating    string                     `json:"rating"`
	Comment   string                     `json:"comment,omitempty"`
	Citations []ReferenceLibraryCitation `json:"citations,omitempty"`
}

func (r *ReferenceLibraryAskFeedbackRequest) Normalize() {
	r.Question = strings.TrimSpace(r.Question)
	r.Rating = strings.ToLower(strings.TrimSpace(r.Rating))
	r.Comment = strings.TrimSpace(r.Comment)
	if len(r.Question) > ReferenceLibraryMaxQuestionLen {
		r.Question = r.Question[:ReferenceLibraryMaxQuestionLen]
	}
	if len(r.Comment) > ReferenceLibraryMaxCommentLen {
		r.Comment = r.Comment[:ReferenceLibraryMaxCommentLen]
	}
}

// Validate bounds-checks the normalized feedback, returning field errors the
// handler surfaces as a 422. Call after Normalize(). The rating is required and
// must be one of up|down; the question is required (a feedback with no subject is
// not actionable).
func (r ReferenceLibraryAskFeedbackRequest) Validate() map[string]string {
	fields := map[string]string{}
	if r.Question == "" {
		fields["question"] = "required"
	}
	switch r.Rating {
	case "up", "down":
	case "":
		fields["rating"] = "required"
	default:
		fields["rating"] = "must be one of: up, down"
	}
	if len(fields) == 0 {
		return nil
	}
	return fields
}
