package service

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

type DocumentService struct {
	db        *pgxpool.Pool
	contracts *repository.ContractRepository
	documents *repository.DocumentRepository
	publisher Publisher
	metrics   *metrics.Metrics
	topic     string
	logger    zerolog.Logger
	now       func() time.Time
	// legalHolds enforces FR-WATHEEQ-005: a document under an active legal hold
	// cannot be deleted, archived, or superseded. Nil => no hold enforcement.
	legalHolds LegalHoldGuard
}

// WithLegalHoldGuard wires the legal-hold enforcement guard. Returns the
// receiver for chaining.
func (s *DocumentService) WithLegalHoldGuard(guard LegalHoldGuard) *DocumentService {
	s.legalHolds = guard
	return s
}

func NewDocumentService(db *pgxpool.Pool, contracts *repository.ContractRepository, documents *repository.DocumentRepository, publisher Publisher, appMetrics *metrics.Metrics, topic string, logger zerolog.Logger) *DocumentService {
	return &DocumentService{
		db:        db,
		contracts: contracts,
		documents: documents,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-documents").Logger(),
		now:       time.Now,
	}
}

func (s *DocumentService) Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateLegalDocumentRequest) (*model.LegalDocument, error) {
	req.Normalize()
	if strings.TrimSpace(req.Title) == "" {
		return nil, validationError("title is required", map[string]string{"title": "required"})
	}
	if req.ContractID != nil {
		if _, err := s.contracts.Get(ctx, tenantID, *req.ContractID); err != nil {
			if err == pgx.ErrNoRows {
				return nil, validationError("linked contract not found", map[string]string{"contract_id": "not found"})
			}
			return nil, internalError("load linked contract", err)
		}
	}
	document := &model.LegalDocument{
		ID:              uuid.New(),
		TenantID:        tenantID,
		Title:           req.Title,
		Type:            req.Type,
		Description:     req.Description,
		Category:        normalizeOptionalString(req.Category),
		Confidentiality: req.Confidentiality,
		ContractID:      req.ContractID,
		CurrentVersion:  1,
		Status:          model.DocumentStatusActive,
		Tags:            req.Tags,
		Metadata:        prepareDocumentTextProcessingMetadata(req.Metadata, req.Document, req.Processing, s.now().UTC()),
		CreatedBy:       userID,
	}
	if req.Document != nil {
		document.ExtractedText = normalizeTextPointer(req.Document.ExtractedText)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start document transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.documents.Create(ctx, tx, document); err != nil {
		return nil, internalError("create legal document", err)
	}
	if req.Document != nil {
		version := &model.DocumentVersion{
			ID:            uuid.New(),
			TenantID:      tenantID,
			DocumentID:    document.ID,
			Version:       1,
			FileID:        req.Document.FileID,
			FileName:      req.Document.FileName,
			FileSizeBytes: req.Document.FileSizeBytes,
			ContentHash:   req.Document.ContentHash,
			ExtractedText: normalizeTextPointer(req.Document.ExtractedText),
			ChangeSummary: normalizeOptionalString(&req.Document.ChangeSummary),
			UploadedBy:    userID,
		}
		if err := s.documents.InsertVersion(ctx, tx, version); err != nil {
			return nil, internalError("create document version", err)
		}
		if err := s.documents.UpdateFile(ctx, tx, tenantID, document.ID, req.Document.FileID, req.Document.FileName, req.Document.FileSizeBytes, 1); err != nil {
			return nil, internalError("update document file", err)
		}
		document.FileID = &req.Document.FileID
		document.FileName = &req.Document.FileName
		document.FileSizeBytes = &req.Document.FileSizeBytes
		document.ExtractedText = version.ExtractedText
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit document transaction", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.document.uploaded", tenantID, &userID, map[string]any{
		"id":      document.ID,
		"title":   document.Title,
		"type":    document.Type,
		"file_id": document.FileID,
	}, s.logger)
	return document, nil
}

func (s *DocumentService) BulkImport(ctx context.Context, tenantID, userID uuid.UUID, req dto.BulkImportLegalDocumentsRequest) (*model.DocumentBulkImportResult, error) {
	req.BatchID = strings.TrimSpace(req.BatchID)
	if req.BatchID == "" {
		req.BatchID = uuid.NewString()
	}
	req.SourceSystem = strings.TrimSpace(req.SourceSystem)
	if len(req.Documents) == 0 {
		return nil, validationError("at least one document is required", map[string]string{"documents": "required"})
	}
	if len(req.Documents) > 250 {
		return nil, validationError("bulk import supports at most 250 documents per request", map[string]string{"documents": "too_many"})
	}

	shouldIndex := true
	if req.Index != nil {
		shouldIndex = *req.Index
	}
	now := s.now().UTC()
	result := &model.DocumentBulkImportResult{
		BatchID:      req.BatchID,
		SourceSystem: req.SourceSystem,
		Requested:    len(req.Documents),
		Items:        make([]model.DocumentBulkImportItemResult, 0, len(req.Documents)),
	}
	for idx, itemReq := range req.Documents {
		itemReq, importMetadata := prepareBulkImportDocument(itemReq, req.BatchID, req.SourceSystem, shouldIndex, now)
		document, err := s.Create(ctx, tenantID, userID, itemReq)
		item := model.DocumentBulkImportItemResult{
			Index:       idx,
			Title:       strings.TrimSpace(itemReq.Title),
			OCRStatus:   stringFromMap(importMetadata, "ocr_status"),
			IndexStatus: stringFromMap(importMetadata, "index_status"),
			Metadata:    importMetadata,
		}
		if err != nil {
			result.Failed++
			item.Status = "failed"
			item.Error = err.Error()
			result.Items = append(result.Items, item)
			continue
		}
		result.Succeeded++
		item.Status = "imported"
		item.DocumentID = &document.ID
		item.Title = document.Title
		result.Items = append(result.Items, item)
	}
	return result, nil
}

func (s *DocumentService) List(ctx context.Context, tenantID uuid.UUID, filter model.DocumentListFilter) ([]model.LegalDocument, int, error) {
	return s.documents.List(ctx, tenantID, filter)
}

func (s *DocumentService) RepositorySummary(ctx context.Context, tenantID uuid.UUID) (*model.DocumentRepositorySummary, error) {
	documents, err := s.documents.ListRepositoryDocuments(ctx, tenantID)
	if err != nil {
		return nil, internalError("list repository documents", err)
	}
	return buildDocumentRepositorySummary(tenantID, documents, s.now().UTC()), nil
}

func (s *DocumentService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalDocument, error) {
	document, err := s.documents.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("document not found")
		}
		return nil, internalError("get document", err)
	}
	return document, nil
}

func (s *DocumentService) Update(ctx context.Context, tenantID, id uuid.UUID, req dto.UpdateLegalDocumentRequest) (*model.LegalDocument, error) {
	document, err := s.documents.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("document not found")
		}
		return nil, internalError("load document", err)
	}
	if req.Title != nil {
		document.Title = strings.TrimSpace(*req.Title)
	}
	if req.Type != nil {
		document.Type = *req.Type
	}
	if req.Description != nil {
		document.Description = strings.TrimSpace(*req.Description)
	}
	if req.Category != nil {
		document.Category = normalizeOptionalString(req.Category)
	}
	if req.Confidentiality != nil {
		document.Confidentiality = *req.Confidentiality
	}
	if req.ContractID != nil {
		document.ContractID = req.ContractID
	}
	if req.Status != nil {
		// FR-WATHEEQ-005: a held document cannot be archived or superseded
		// (states that remove it from the live repository) while under hold.
		if (*req.Status == model.DocumentStatusArchived || *req.Status == model.DocumentStatusSuperseded) && *req.Status != document.Status {
			if err := ensureMutable(ctx, s.legalHolds, tenantID, model.LegalHoldSubjectDocument, id); err != nil {
				return nil, err
			}
		}
		document.Status = *req.Status
	}
	if req.Tags != nil {
		document.Tags = dto.NormalizeTags(req.Tags)
	}
	if req.Metadata != nil {
		document.Metadata = req.Metadata
	}
	if err := s.documents.Update(ctx, s.db, document); err != nil {
		return nil, internalError("update document", err)
	}
	return document, nil
}

func (s *DocumentService) Delete(ctx context.Context, tenantID, id uuid.UUID) error {
	// FR-WATHEEQ-005: refuse deletion while the document is under an active hold.
	if err := ensureMutable(ctx, s.legalHolds, tenantID, model.LegalHoldSubjectDocument, id); err != nil {
		return err
	}
	if err := s.documents.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("document not found")
		}
		return internalError("delete document", err)
	}
	return nil
}

func (s *DocumentService) UploadVersion(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UploadDocumentVersionRequest) ([]model.DocumentVersion, error) {
	document, err := s.documents.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("document not found")
		}
		return nil, internalError("load document", err)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start document version transaction", err)
	}
	defer tx.Rollback(ctx)
	version := &model.DocumentVersion{
		ID:            uuid.New(),
		TenantID:      tenantID,
		DocumentID:    document.ID,
		Version:       document.CurrentVersion + 1,
		FileID:        req.FileID,
		FileName:      req.FileName,
		FileSizeBytes: req.FileSizeBytes,
		ContentHash:   req.ContentHash,
		ExtractedText: normalizeTextPointer(req.ExtractedText),
		ChangeSummary: normalizeOptionalString(&req.ChangeSummary),
		UploadedBy:    userID,
	}
	if err := s.documents.InsertVersion(ctx, tx, version); err != nil {
		return nil, internalError("create document version", err)
	}
	if err := s.documents.UpdateFile(ctx, tx, tenantID, document.ID, req.FileID, req.FileName, req.FileSizeBytes, version.Version); err != nil {
		return nil, internalError("update document current version", err)
	}
	if err := s.documents.UpdateExtractedText(ctx, tx, tenantID, document.ID, version.ExtractedText); err != nil {
		return nil, internalError("update document extracted text", err)
	}
	document.Metadata = prepareDocumentTextProcessingMetadata(
		document.Metadata,
		&req.FileReference,
		req.Processing,
		s.now().UTC(),
	)
	if err := s.documents.Update(ctx, tx, document); err != nil {
		return nil, internalError("update document processing metadata", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit document version", err)
	}
	return s.documents.ListVersions(ctx, tenantID, document.ID)
}

func (s *DocumentService) ListVersions(ctx context.Context, tenantID, id uuid.UUID) ([]model.DocumentVersion, error) {
	return s.documents.ListVersions(ctx, tenantID, id)
}

func prepareBulkImportDocument(req dto.CreateLegalDocumentRequest, batchID, sourceSystem string, shouldIndex bool, importedAt time.Time) (dto.CreateLegalDocumentRequest, map[string]any) {
	req.Normalize()
	metadata := copyStringAnyMap(req.Metadata)
	sourceRecordID := strings.TrimSpace(stringFromAny(metadata["source_record_id"]))
	ocrStatus := "not_applicable"
	textLength := 0
	fileName := ""
	if req.Document != nil {
		fileName = req.Document.FileName
		textLength = len(strings.TrimSpace(req.Document.ExtractedText))
		if textLength > 0 {
			ocrStatus = "text_provided"
		} else {
			ocrStatus = "pending"
		}
	}
	indexStatus := "skipped"
	if shouldIndex {
		indexStatus = "metadata_indexed"
		if textLength > 0 {
			indexStatus = "content_indexed"
		}
	}
	importMetadata := map[string]any{
		"batch_id":         batchID,
		"source_system":    sourceSystem,
		"source_record_id": sourceRecordID,
		"imported_at":      importedAt.Format(time.RFC3339),
		"ocr_status":       ocrStatus,
		"index_status":     indexStatus,
		"file_name":        fileName,
	}
	metadata["migration"] = map[string]any{
		"batch_id":         batchID,
		"source_system":    sourceSystem,
		"source_record_id": sourceRecordID,
		"imported_at":      importedAt.Format(time.RFC3339),
	}
	metadata["ocr"] = map[string]any{
		"status":         ocrStatus,
		"text_available": textLength > 0,
		"text_length":    textLength,
	}
	metadata["repository_index"] = map[string]any{
		"status":     indexStatus,
		"mode":       "deterministic_metadata",
		"indexed_at": importedAt.Format(time.RFC3339),
		"fields":     []string{"title", "description", "category", "tags", "metadata", "ocr"},
	}
	req.Metadata = metadata
	return req, importMetadata
}

// prepareDocumentTextProcessingMetadata records truthful PDF processing proof.
// Reading a born-digital text layer is not OCR; image-only/low-text pages remain
// explicitly pending for the server OCR sidecar. Non-PDF files are unchanged.
func prepareDocumentTextProcessingMetadata(
	metadata map[string]any,
	file *dto.FileReference,
	processing *dto.DocumentTextProcessingRequest,
	processedAt time.Time,
) map[string]any {
	if file == nil || !strings.HasSuffix(strings.ToLower(strings.TrimSpace(file.FileName)), ".pdf") {
		return metadata
	}

	out := copyStringAnyMap(metadata)
	text := strings.TrimSpace(file.ExtractedText)
	textAvailable := text != ""
	method := "none"
	textStatus := "ocr_pending"
	ocrStatus := "pending"
	pageCount := 0
	pagesWithText := 0
	pagesNeedingOCR := 0

	if processing != nil {
		pageCount = max(processing.PageCount, 0)
		pagesWithText = max(processing.PagesWithText, 0)
		pagesNeedingOCR = max(processing.PagesNeedingOCR, 0)
		if pageCount > 0 {
			pagesWithText = min(pagesWithText, pageCount)
			pagesNeedingOCR = min(pagesNeedingOCR, pageCount)
		}
	}

	if textAvailable {
		switch {
		case processing != nil && processing.TextExtractionMethod == "pdf_text_layer":
			method = "pdf_text_layer"
			if pagesNeedingOCR > 0 || processing.OCRStatus == "partial_pending" {
				textStatus = "partial"
				ocrStatus = "partial_pending"
			} else {
				textStatus = "extracted"
				ocrStatus = "not_required"
			}
		case processing != nil && processing.TextExtractionMethod == "manual":
			method = "manual"
			textStatus = "provided"
			ocrStatus = "pending"
		default:
			// Imports/API clients may supply already-extracted text without the
			// browser proof object. It is searchable, but its source and OCR
			// coverage are unknown, so do not claim OCR is unnecessary.
			method = "provided"
			textStatus = "provided"
			ocrStatus = "pending"
		}
	}

	extraction := mapFromMetadata(out["text_extraction"])
	if extraction == nil {
		extraction = map[string]any{}
	}
	extraction["status"] = textStatus
	extraction["method"] = method
	extraction["text_available"] = textAvailable
	extraction["text_length"] = len(text)
	extraction["page_count"] = pageCount
	extraction["pages_with_text"] = pagesWithText
	extraction["pages_needing_ocr"] = pagesNeedingOCR
	extraction["inspected_at"] = processedAt.Format(time.RFC3339)
	out["text_extraction"] = extraction

	ocr := mapFromMetadata(out["ocr"])
	if ocr == nil {
		ocr = map[string]any{}
	}
	// Preserve the established bulk-import proof label when text was supplied
	// by migration. It remains distinct from an OCR completion claim.
	if existing, _ := ocr["status"].(string); existing == "text_provided" && processing == nil && textAvailable {
		ocrStatus = existing
	}
	ocr["status"] = ocrStatus
	ocr["text_available"] = textAvailable
	ocr["text_length"] = len(text)
	ocr["pages_pending"] = pagesNeedingOCR
	out["ocr"] = ocr

	return out
}

func copyStringAnyMap(in map[string]any) map[string]any {
	if in == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func stringFromMap(in map[string]any, key string) string {
	value, _ := in[key].(string)
	return value
}

func buildDocumentRepositorySummary(tenantID uuid.UUID, documents []model.LegalDocument, generatedAt time.Time) *model.DocumentRepositorySummary {
	summary := &model.DocumentRepositorySummary{
		TenantID:          tenantID,
		GeneratedAt:       generatedAt.UTC(),
		TotalDocuments:    len(documents),
		ByType:            map[string]int{},
		ByStatus:          map[string]int{},
		ByConfidentiality: map[string]int{},
		ByCategory:        map[string]int{},
		Folders:           []model.DocumentFolderSummary{},
		SavedViews:        []model.DocumentSavedViewSummary{},
		Taxonomy:          []model.DocumentTaxonomySummary{},
	}
	folders := map[string]*model.DocumentFolderSummary{}
	views := map[string]*model.DocumentSavedViewSummary{}
	taxonomy := map[string]*model.DocumentTaxonomySummary{}

	for _, document := range documents {
		increment(summary.ByType, string(document.Type))
		increment(summary.ByStatus, string(document.Status))
		increment(summary.ByConfidentiality, string(document.Confidentiality))
		category := documentStringValue(document.Category, "uncategorized")
		increment(summary.ByCategory, category)

		folderPath := documentFolderPath(document)
		folder := folders[folderPath]
		if folder == nil {
			folder = &model.DocumentFolderSummary{Path: folderPath}
			folders[folderPath] = folder
		}
		folder.DocumentCount++
		if document.Confidentiality == model.DocumentConfidentialityPrivileged {
			folder.Privileged++
		}
		if document.Status == model.DocumentStatusArchived || document.Status == model.DocumentStatusSuperseded {
			folder.Archived++
		}

		addDocumentTaxonomy(taxonomy, "category", category)
		for _, tag := range document.Tags {
			addDocumentTaxonomy(taxonomy, "tag", tag)
		}
		for _, dimension := range []string{"department", "practice_area", "jurisdiction", "repository_class"} {
			if value := documentMetadataString(document.Metadata, dimension, camelKey(dimension)); value != "" {
				addDocumentTaxonomy(taxonomy, dimension, value)
			}
		}

		for _, view := range documentSavedViews(document.Metadata) {
			item := views[view.Name]
			if item == nil {
				copied := view
				item = &copied
				views[view.Name] = item
			}
			item.DocumentCount++
		}

		if documentMetadataString(document.Metadata, "retention_policy", "retentionPolicy") != "" {
			summary.Retention.WithPolicy++
		}
		if disposition := documentMetadataString(document.Metadata, "disposition_date", "dispositionDate"); disposition != "" {
			summary.Retention.WithDisposition++
			if dispositionDue(disposition, generatedAt) {
				summary.Retention.DispositionDue++
			}
		}
	}
	summary.Retention.MissingPolicy = summary.TotalDocuments - summary.Retention.WithPolicy

	for _, folder := range folders {
		summary.Folders = append(summary.Folders, *folder)
	}
	sort.Slice(summary.Folders, func(i, j int) bool {
		if summary.Folders[i].DocumentCount == summary.Folders[j].DocumentCount {
			return summary.Folders[i].Path < summary.Folders[j].Path
		}
		return summary.Folders[i].DocumentCount > summary.Folders[j].DocumentCount
	})
	for _, view := range views {
		summary.SavedViews = append(summary.SavedViews, *view)
	}
	sort.Slice(summary.SavedViews, func(i, j int) bool {
		if summary.SavedViews[i].DocumentCount == summary.SavedViews[j].DocumentCount {
			return summary.SavedViews[i].Name < summary.SavedViews[j].Name
		}
		return summary.SavedViews[i].DocumentCount > summary.SavedViews[j].DocumentCount
	})
	for _, item := range taxonomy {
		summary.Taxonomy = append(summary.Taxonomy, *item)
	}
	sort.Slice(summary.Taxonomy, func(i, j int) bool {
		if summary.Taxonomy[i].Dimension == summary.Taxonomy[j].Dimension {
			if summary.Taxonomy[i].DocumentCount == summary.Taxonomy[j].DocumentCount {
				return summary.Taxonomy[i].Value < summary.Taxonomy[j].Value
			}
			return summary.Taxonomy[i].DocumentCount > summary.Taxonomy[j].DocumentCount
		}
		return summary.Taxonomy[i].Dimension < summary.Taxonomy[j].Dimension
	})
	return summary
}

func increment(values map[string]int, key string) {
	key = strings.TrimSpace(key)
	if key == "" {
		key = "unspecified"
	}
	values[key]++
}

func documentStringValue(value *string, fallback string) string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return fallback
	}
	return strings.TrimSpace(*value)
}

func documentFolderPath(document model.LegalDocument) string {
	path := documentMetadataString(document.Metadata, "folder_path", "folderPath", "folder")
	if path == "" {
		path = documentStringValue(document.Category, "Unfiled")
	}
	path = strings.TrimSpace(strings.ReplaceAll(path, "\\", "/"))
	if path == "" {
		return "Unfiled"
	}
	path = strings.Trim(path, "/")
	if path == "" {
		return "Unfiled"
	}
	return path
}

func documentMetadataString(metadata map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := metadata[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			if trimmed := strings.TrimSpace(typed); trimmed != "" {
				return trimmed
			}
		}
	}
	return ""
}

func camelKey(value string) string {
	parts := strings.Split(value, "_")
	if len(parts) == 1 {
		return value
	}
	for i := 1; i < len(parts); i++ {
		if parts[i] == "" {
			continue
		}
		parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
	}
	return strings.Join(parts, "")
}

func addDocumentTaxonomy(items map[string]*model.DocumentTaxonomySummary, dimension, value string) {
	dimension = strings.TrimSpace(dimension)
	value = strings.TrimSpace(value)
	if dimension == "" || value == "" {
		return
	}
	key := dimension + "\x00" + value
	item := items[key]
	if item == nil {
		item = &model.DocumentTaxonomySummary{Dimension: dimension, Value: value}
		items[key] = item
	}
	item.DocumentCount++
}

func documentSavedViews(metadata map[string]any) []model.DocumentSavedViewSummary {
	var out []model.DocumentSavedViewSummary
	add := func(name string, filters map[string]any) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		out = append(out, model.DocumentSavedViewSummary{Name: name, Filters: filters})
	}
	if name := documentMetadataString(metadata, "saved_view", "savedView"); name != "" {
		add(name, nil)
	}
	switch raw := metadata["saved_views"].(type) {
	case []any:
		for _, item := range raw {
			if view, ok := item.(map[string]any); ok {
				add(documentMetadataString(view, "name", "title"), mapFromMetadata(view["filters"]))
			}
			if name, ok := item.(string); ok {
				add(name, nil)
			}
		}
	case []string:
		for _, name := range raw {
			add(name, nil)
		}
	}
	if raw, ok := metadata["savedViews"].([]any); ok {
		for _, item := range raw {
			if view, ok := item.(map[string]any); ok {
				add(documentMetadataString(view, "name", "title"), mapFromMetadata(view["filters"]))
			}
		}
	}
	return out
}

func mapFromMetadata(value any) map[string]any {
	raw, ok := value.(map[string]any)
	if !ok || raw == nil {
		return nil
	}
	copied := make(map[string]any, len(raw))
	for key, item := range raw {
		copied[key] = item
	}
	return copied
}

func dispositionDue(value string, now time.Time) bool {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		parsed, err = time.Parse("2006-01-02", value)
	}
	return err == nil && !parsed.After(now.UTC())
}
