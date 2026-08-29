package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	lexcrypto "github.com/clario360/platform/internal/lex/crypto"
	"github.com/clario360/platform/internal/lex/model"
)

type ContractRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
	// crypto, when non-nil, transparently encrypts sensitive contract fields on
	// write and decrypts them on read (WTQ-SEC-04 at-rest). When nil the repo
	// stores/returns plaintext, preserving the prior behavior and existing tests.
	crypto *lexcrypto.FieldCrypto
}

func NewContractRepository(db *pgxpool.Pool, logger zerolog.Logger) *ContractRepository {
	return &ContractRepository{db: db, logger: logger}
}

// WithFieldCrypto enables transparent field-level encryption at rest for the
// repository's sensitive contract fields (contract body text and counterparty
// PII). Passing nil disables encryption. Returns the receiver for chaining.
func (r *ContractRepository) WithFieldCrypto(fc *lexcrypto.FieldCrypto) *ContractRepository {
	r.crypto = fc
	return r
}

// decryptContractFields decrypts the sensitive at-rest fields of a contract in
// place after it is loaded. Legacy plaintext values (no enc: prefix) pass
// through untouched. No-op when field crypto is not configured.
func (r *ContractRepository) decryptContractFields(contract *model.Contract) error {
	if contract == nil {
		return nil
	}
	if r.crypto == nil {
		// F49: field crypto is disabled (e.g. a dev profile booted without
		// LEX_CONTRACT_FIELD_ENCRYPTION_KEY, which Config.Validate() downgrades to
		// mode "off"). A row that still carries "enc:v1:" ciphertext must NOT be
		// passed through raw to the API/UI as an opaque ciphertext blob. Surface it
		// so the caller fails (single-row read) or redacts (list read) instead of
		// leaking it. Legacy plaintext rows (no prefix) still pass through.
		if lexcrypto.IsEncrypted(contract.DocumentText) ||
			ptrIsEncrypted(contract.PartyBEntity) ||
			ptrIsEncrypted(contract.PartyBContact) ||
			ptrIsEncrypted(contract.PaymentTerms) {
			return fmt.Errorf("contract %s carries encrypted fields but field crypto is not configured", contract.ID)
		}
		return nil
	}
	dec, err := r.crypto.Decrypt(contract.DocumentText)
	if err != nil {
		return fmt.Errorf("decrypt document_text: %w", err)
	}
	contract.DocumentText = dec
	if contract.PartyBEntity, err = r.crypto.DecryptPtr(contract.PartyBEntity); err != nil {
		return fmt.Errorf("decrypt party_b_entity: %w", err)
	}
	if contract.PartyBContact, err = r.crypto.DecryptPtr(contract.PartyBContact); err != nil {
		return fmt.Errorf("decrypt party_b_contact: %w", err)
	}
	if contract.PaymentTerms, err = r.crypto.DecryptPtr(contract.PaymentTerms); err != nil {
		return fmt.Errorf("decrypt payment_terms: %w", err)
	}
	return nil
}

// decryptContract is a convenience that decrypts a loaded contract and returns
// it (or the load error unchanged), for use in single-row read paths.
func (r *ContractRepository) decryptContract(contract *model.Contract, err error) (*model.Contract, error) {
	if err != nil {
		return contract, err
	}
	if derr := r.decryptContractFields(contract); derr != nil {
		return nil, derr
	}
	return contract, nil
}

// decryptContracts decrypts a slice of contracts in place and returns it (or the
// load error unchanged), for use in list read paths.
func (r *ContractRepository) decryptContracts(contracts []model.Contract, err error) ([]model.Contract, error) {
	if err != nil {
		return contracts, err
	}
	for i := range contracts {
		if derr := r.decryptContractFields(&contracts[i]); derr != nil {
			// F50: contain the blast radius. A single undecryptable row (a key
			// rotated without registering the previous key, or ciphertext present
			// while field crypto is disabled) must NOT nil the entire list. Log it
			// once — contract/tenant ids are not sensitive and the plaintext is
			// never logged — redact the still-encrypted fields, and keep the row
			// visible so the rest of the list renders.
			r.logger.Warn().
				Err(derr).
				Str("contract_id", contracts[i].ID.String()).
				Str("tenant_id", contracts[i].TenantID.String()).
				Msg("lex/contracts: field decryption failed; serving row with sensitive fields redacted")
			redactUndecryptableContractFields(&contracts[i])
		}
	}
	return contracts, nil
}

// ptrIsEncrypted reports whether a nullable string column holds "enc:v1:" ciphertext.
func ptrIsEncrypted(v *string) bool {
	return v != nil && lexcrypto.IsEncrypted(*v)
}

// redactUndecryptableContractFields blanks the sensitive at-rest fields that
// remain ciphertext after a failed decrypt, so an unreadable row is contained to
// that row rather than nilling the whole list (F50). Legacy plaintext fields are
// left untouched.
func redactUndecryptableContractFields(contract *model.Contract) {
	const marker = "[encrypted: key unavailable]"
	if lexcrypto.IsEncrypted(contract.DocumentText) {
		contract.DocumentText = marker
	}
	redactPtrIfEncrypted(&contract.PartyBEntity, marker)
	redactPtrIfEncrypted(&contract.PartyBContact, marker)
	redactPtrIfEncrypted(&contract.PaymentTerms, marker)
}

func redactPtrIfEncrypted(v **string, marker string) {
	if *v != nil && lexcrypto.IsEncrypted(**v) {
		m := marker
		*v = &m
	}
}

// encryptedContractFields returns the encrypted forms of the sensitive contract
// fields WITHOUT mutating the in-memory contract, so the struct the caller holds
// keeps its plaintext values after a write. When crypto is disabled it returns
// the original values unchanged.
func (r *ContractRepository) encryptedContractFields(contract *model.Contract) (documentText string, partyBEntity, partyBContact, paymentTerms *string, err error) {
	if r.crypto == nil || contract == nil {
		return contract.DocumentText, contract.PartyBEntity, contract.PartyBContact, contract.PaymentTerms, nil
	}
	if documentText, err = r.crypto.Encrypt(contract.DocumentText); err != nil {
		return "", nil, nil, nil, fmt.Errorf("encrypt document_text: %w", err)
	}
	if partyBEntity, err = r.crypto.EncryptPtr(contract.PartyBEntity); err != nil {
		return "", nil, nil, nil, fmt.Errorf("encrypt party_b_entity: %w", err)
	}
	if partyBContact, err = r.crypto.EncryptPtr(contract.PartyBContact); err != nil {
		return "", nil, nil, nil, fmt.Errorf("encrypt party_b_contact: %w", err)
	}
	if paymentTerms, err = r.crypto.EncryptPtr(contract.PaymentTerms); err != nil {
		return "", nil, nil, nil, fmt.Errorf("encrypt payment_terms: %w", err)
	}
	return documentText, partyBEntity, partyBContact, paymentTerms, nil
}

func (r *ContractRepository) Create(ctx context.Context, q Queryer, contract *model.Contract) error {
	query := `
		INSERT INTO contracts (
			id, tenant_id, title, contract_number, type, description,
			party_a_name, party_a_entity, party_b_name, party_b_entity, party_b_contact,
			total_value, currency, payment_terms,
			effective_date, expiry_date, renewal_date, auto_renew, renewal_notice_days, signed_date,
			status, previous_status, status_changed_at, status_changed_by,
			owner_user_id, owner_name, legal_reviewer_id, legal_reviewer_name,
			risk_score, risk_level, analysis_status, last_analyzed_at,
			document_file_id, document_text, current_version,
			parent_contract_id, workflow_instance_id, department, tags, metadata,
			created_by, org_entity_id
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10,$11,
			$12,$13,$14,
			$15,$16,$17,$18,$19,$20,
			$21,$22,$23,$24,
			$25,$26,$27,$28,
			$29,$30,$31,$32,
			$33,$34,$35,
			$36,$37,$38,$39,$40,
			$41,$42
		)
		RETURNING created_at, updated_at`
	encDocumentText, encPartyBEntity, encPartyBContact, encPaymentTerms, err := r.encryptedContractFields(contract)
	if err != nil {
		return err
	}
	return q.QueryRow(ctx, query,
		contract.ID, contract.TenantID, contract.Title, contract.ContractNumber, contract.Type, contract.Description,
		contract.PartyAName, contract.PartyAEntity, contract.PartyBName, encPartyBEntity, encPartyBContact,
		contract.TotalValue, contract.Currency, encPaymentTerms,
		datePtr(contract.EffectiveDate), datePtr(contract.ExpiryDate), datePtr(contract.RenewalDate), contract.AutoRenew, contract.RenewalNoticeDays, datePtr(contract.SignedDate),
		contract.Status, contract.PreviousStatus, contract.StatusChangedAt, contract.StatusChangedBy,
		contract.OwnerUserID, contract.OwnerName, contract.LegalReviewerID, contract.LegalReviewerName,
		contract.RiskScore, contract.RiskLevel, contract.AnalysisStatus, contract.LastAnalyzedAt,
		contract.DocumentFileID, encDocumentText, contract.CurrentVersion,
		contract.ParentContractID, contract.WorkflowInstanceID, contract.Department, contract.Tags, contract.Metadata,
		contract.CreatedBy, contract.OrgEntityID,
	).Scan(&contract.CreatedAt, &contract.UpdatedAt)
}

func (r *ContractRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.Contract, error) {
	query := contractJSONSelect(`
			c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`)
	return r.decryptContract(queryRowJSON[model.Contract](ctx, r.db, query, tenantID, id))
}

// contractListWhere builds the shared, tenant-scoped WHERE conditions +
// positional args for the contract list query surface. Conditions reference the
// "c" alias so they slot into contractJSONSelect AND contractEntityRollupSelect
// unchanged — List, ContractReport and EntityRollup all aggregate over the EXACT
// same filter set by construction. $1 is always tenant_id.
func contractListWhere(tenantID uuid.UUID, filters model.ContractListFilters) ([]string, []any) {
	args := []any{tenantID}
	arg := 2
	// The live contract register must not leak soft-archived records. Archived
	// contracts remain addressable through Get (for the archive detail link) and
	// are listed exclusively by ContractArchiveService.
	conditions := []string{
		"c.tenant_id = $1",
		"c.deleted_at IS NULL",
		"COALESCE(c.archive_status, 'active') = 'active'",
	}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf(`(
			to_tsvector('english', coalesce(c.title,'') || ' ' || coalesce(c.party_b_name,'') || ' ' || coalesce(c.description,'')) @@ plainto_tsquery('english', $%d)
			OR c.title ILIKE '%%' || $%d || '%%'
			OR c.party_b_name ILIKE '%%' || $%d || '%%'
		)`, arg, arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("c.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	if len(filters.Statuses) > 0 {
		statuses := make([]string, 0, len(filters.Statuses))
		for _, status := range filters.Statuses {
			statuses = append(statuses, string(status))
		}
		conditions = append(conditions, fmt.Sprintf("c.status = ANY($%d)", arg))
		args = append(args, statuses)
		arg++
	}
	if filters.Type != nil {
		conditions = append(conditions, fmt.Sprintf("c.type = $%d", arg))
		args = append(args, *filters.Type)
		arg++
	}
	if len(filters.Types) > 0 {
		types := make([]string, 0, len(filters.Types))
		for _, contractType := range filters.Types {
			types = append(types, string(contractType))
		}
		conditions = append(conditions, fmt.Sprintf("c.type = ANY($%d)", arg))
		args = append(args, types)
		arg++
	}
	if filters.OwnerUserID != nil {
		conditions = append(conditions, fmt.Sprintf("c.owner_user_id = $%d", arg))
		args = append(args, *filters.OwnerUserID)
		arg++
	}
	if filters.RiskLevel != nil {
		conditions = append(conditions, fmt.Sprintf("c.risk_level = $%d", arg))
		args = append(args, *filters.RiskLevel)
		arg++
	}
	if filters.Department != "" {
		conditions = append(conditions, fmt.Sprintf("COALESCE(NULLIF(c.department, ''), 'unspecified') = $%d", arg))
		args = append(args, filters.Department)
		arg++
	}
	if len(filters.Departments) > 0 {
		conditions = append(conditions, fmt.Sprintf("COALESCE(NULLIF(c.department, ''), 'unspecified') = ANY($%d)", arg))
		args = append(args, filters.Departments)
		arg++
	}
	if filters.ExpiryFrom != nil {
		conditions = append(conditions, fmt.Sprintf("c.expiry_date >= $%d", arg))
		args = append(args, *filters.ExpiryFrom)
		arg++
	}
	if filters.ExpiryTo != nil {
		conditions = append(conditions, fmt.Sprintf("c.expiry_date < $%d", arg))
		args = append(args, *filters.ExpiryTo)
		arg++
	}
	if filters.CreatedFrom != nil {
		conditions = append(conditions, fmt.Sprintf("c.created_at >= $%d", arg))
		args = append(args, *filters.CreatedFrom)
		arg++
	}
	if filters.CreatedTo != nil {
		conditions = append(conditions, fmt.Sprintf("c.created_at < $%d", arg))
		args = append(args, *filters.CreatedTo)
		arg++
	}
	if filters.StatusFrom != nil {
		conditions = append(conditions, fmt.Sprintf("c.status_changed_at >= $%d", arg))
		args = append(args, *filters.StatusFrom)
		arg++
	}
	if filters.StatusTo != nil {
		conditions = append(conditions, fmt.Sprintf("c.status_changed_at < $%d", arg))
		args = append(args, *filters.StatusTo)
		arg++
	}
	if filters.Tag != "" {
		conditions = append(conditions, fmt.Sprintf("$%d = ANY(c.tags)", arg))
		args = append(args, strings.ToLower(strings.TrimSpace(filters.Tag)))
		arg++
	}
	if filters.OrgEntityID != nil {
		conditions = append(conditions, fmt.Sprintf("c.org_entity_id = $%d", arg))
		args = append(args, *filters.OrgEntityID)
		arg++
	}
	if filters.ExpiringInDays != nil {
		conditions = append(conditions, fmt.Sprintf("c.expiry_date IS NOT NULL AND c.expiry_date <= CURRENT_DATE + $%d::int", arg))
		args = append(args, *filters.ExpiringInDays)
		arg++
	}
	return conditions, args
}

func (r *ContractRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.ContractListFilters) ([]model.Contract, int, error) {
	conditions, args := contractListWhere(tenantID, filters)
	where := strings.Join(conditions, " AND ")

	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM contracts c WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count contracts: %w", err)
	}
	if total == 0 {
		return []model.Contract{}, 0, nil
	}

	page := filters.Page
	if page < 1 {
		page = 1
	}
	perPage := filters.PerPage
	if perPage < 1 {
		perPage = 25
	}
	if perPage > 200 {
		perPage = 200
	}
	limitIdx := len(args) + 1
	offsetIdx := len(args) + 2
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.updated_at"
	orderDir := "DESC"
	if filters.SortColumn != "" {
		// SortColumn is already validated/mapped by the handler via suiteapi.ParseSort,
		// but the column prefix is "c." (the inner query alias). The outer alias is "t.",
		// so we remap to the JSON field name which becomes a top-level key in row_to_json.
		colMap := map[string]string{
			"c.title":       "t.title",
			"c.status":      "t.status",
			"c.type":        "t.type",
			"c.total_value": "t.total_value",
			"c.expiry_date": "t.expiry_date",
			"c.updated_at":  "t.updated_at",
			"c.created_at":  "t.created_at",
			"c.risk_score":  "t.risk_score",
		}
		if mapped, ok := colMap[filters.SortColumn]; ok {
			orderCol = mapped
		}
	}
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := contractJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := r.decryptContracts(queryListJSON[model.Contract](ctx, r.db, query, args...))
	if err != nil {
		return nil, 0, fmt.Errorf("list contracts: %w", err)
	}
	return items, total, nil
}

func (r *ContractRepository) Update(ctx context.Context, q Queryer, contract *model.Contract) error {
	query := `
		UPDATE contracts
		SET title = $3,
		    contract_number = $4,
		    type = $5,
		    description = $6,
		    party_a_name = $7,
		    party_a_entity = $8,
		    party_b_name = $9,
		    party_b_entity = $10,
		    party_b_contact = $11,
		    total_value = $12,
		    currency = $13,
		    payment_terms = $14,
		    effective_date = $15,
		    expiry_date = $16,
		    renewal_date = $17,
		    auto_renew = $18,
		    renewal_notice_days = $19,
		    signed_date = $20,
		    owner_user_id = $21,
		    owner_name = $22,
		    legal_reviewer_id = $23,
		    legal_reviewer_name = $24,
		    department = $25,
		    tags = $26,
		    metadata = $27,
		    org_entity_id = $28,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	encDocumentText, encPartyBEntity, encPartyBContact, encPaymentTerms, err := r.encryptedContractFields(contract)
	if err != nil {
		return err
	}
	_ = encDocumentText // document_text is updated via UpdateDocument, not here
	return q.QueryRow(ctx, query,
		contract.TenantID, contract.ID,
		contract.Title, contract.ContractNumber, contract.Type, contract.Description,
		contract.PartyAName, contract.PartyAEntity, contract.PartyBName, encPartyBEntity, encPartyBContact,
		contract.TotalValue, contract.Currency, encPaymentTerms,
		datePtr(contract.EffectiveDate), datePtr(contract.ExpiryDate), datePtr(contract.RenewalDate),
		contract.AutoRenew, contract.RenewalNoticeDays, datePtr(contract.SignedDate),
		contract.OwnerUserID, contract.OwnerName, contract.LegalReviewerID, contract.LegalReviewerName,
		contract.Department, contract.Tags, contract.Metadata, contract.OrgEntityID,
	).Scan(&contract.UpdatedAt)
}

func (r *ContractRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE contracts SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *ContractRepository) InsertVersion(ctx context.Context, q Queryer, version *model.ContractVersion) error {
	query := `
		INSERT INTO contract_versions (
			id, tenant_id, contract_id, version, file_id, file_name, file_size_bytes,
			content_hash, extracted_text, change_summary, uploaded_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING uploaded_at`
	return q.QueryRow(ctx, query,
		version.ID, version.TenantID, version.ContractID, version.Version, version.FileID, version.FileName, version.FileSizeBytes,
		version.ContentHash, version.ExtractedText, version.ChangeSummary, version.UploadedBy,
	).Scan(&version.UploadedAt)
}

func (r *ContractRepository) UpdateDocument(ctx context.Context, q Queryer, tenantID, contractID uuid.UUID, fileID uuid.UUID, extractedText string, currentVersion int) error {
	if r.crypto != nil {
		enc, encErr := r.crypto.Encrypt(extractedText)
		if encErr != nil {
			return fmt.Errorf("encrypt document_text: %w", encErr)
		}
		extractedText = enc
	}
	ct, err := q.Exec(ctx, `
		UPDATE contracts
		SET document_file_id = $3,
		    document_text = $4,
		    current_version = $5,
		    analysis_status = 'pending',
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, contractID, fileID, extractedText, currentVersion,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *ContractRepository) ListVersions(ctx context.Context, tenantID, contractID uuid.UUID) ([]model.ContractVersion, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, contract_id, version, file_id, file_name, file_size_bytes,
			       content_hash, extracted_text, change_summary, uploaded_by, uploaded_at
			FROM contract_versions
			WHERE tenant_id = $1 AND contract_id = $2
			ORDER BY version DESC
		) t`
	return queryListJSON[model.ContractVersion](ctx, r.db, query, tenantID, contractID)
}

func (r *ContractRepository) GetLatestVersion(ctx context.Context, tenantID, contractID uuid.UUID) (*model.ContractVersion, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, contract_id, version, file_id, file_name, file_size_bytes,
			       content_hash, extracted_text, change_summary, uploaded_by, uploaded_at
			FROM contract_versions
			WHERE tenant_id = $1 AND contract_id = $2
			ORDER BY version DESC
			LIMIT 1
		) t`
	return queryRowJSON[model.ContractVersion](ctx, r.db, query, tenantID, contractID)
}

func (r *ContractRepository) GetVersion(ctx context.Context, tenantID, contractID uuid.UUID, version int) (*model.ContractVersion, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, contract_id, version, file_id, file_name, file_size_bytes,
			       content_hash, extracted_text, change_summary, uploaded_by, uploaded_at
			FROM contract_versions
			WHERE tenant_id = $1 AND contract_id = $2 AND version = $3
			LIMIT 1
		) t`
	return queryRowJSON[model.ContractVersion](ctx, r.db, query, tenantID, contractID, version)
}

func (r *ContractRepository) InsertAnalysis(ctx context.Context, q Queryer, analysis *model.ContractRiskAnalysis) error {
	normalizeContractAnalysis(analysis)
	query := `
		INSERT INTO contract_analyses (
			id, tenant_id, contract_id, contract_version, overall_risk, risk_score,
			clause_count, high_risk_clause_count, missing_clauses, key_findings, recommendations,
			compliance_flags, extracted_parties, extracted_dates, extracted_amounts,
			analysis_duration_ms, analyzed_by, analyzed_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10,$11,
			$12,$13,$14,$15,
			$16,$17,$18
		)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		analysis.ID, analysis.TenantID, analysis.ContractID, analysis.ContractVersion, analysis.OverallRisk, analysis.RiskScore,
		analysis.ClauseCount, analysis.HighRiskClauseCount, analysis.MissingClauses, analysis.KeyFindings, analysis.Recommendations,
		analysis.ComplianceFlags, analysis.ExtractedParties, analysis.ExtractedDates, analysis.ExtractedAmounts,
		analysis.AnalysisDurationMS, analysis.AnalyzedBy, analysis.AnalyzedAt,
	).Scan(&analysis.CreatedAt)
}

func normalizeContractAnalysis(analysis *model.ContractRiskAnalysis) {
	if analysis == nil {
		return
	}
	if analysis.MissingClauses == nil {
		analysis.MissingClauses = []model.ClauseType{}
	}
	if analysis.KeyFindings == nil {
		analysis.KeyFindings = []model.RiskFinding{}
	}
	if analysis.Recommendations == nil {
		analysis.Recommendations = []string{}
	}
	if analysis.ComplianceFlags == nil {
		analysis.ComplianceFlags = []model.ComplianceFlag{}
	}
	if analysis.ExtractedParties == nil {
		analysis.ExtractedParties = []model.PartyExtraction{}
	}
	if analysis.ExtractedDates == nil {
		analysis.ExtractedDates = []model.ExtractedDate{}
	}
	if analysis.ExtractedAmounts == nil {
		analysis.ExtractedAmounts = []model.ExtractedAmount{}
	}
}

func (r *ContractRepository) GetLatestAnalysis(ctx context.Context, tenantID, contractID uuid.UUID) (*model.ContractRiskAnalysis, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, contract_id, contract_version, overall_risk, risk_score,
			       clause_count, high_risk_clause_count, missing_clauses, key_findings, recommendations,
			       compliance_flags, extracted_parties, extracted_dates, extracted_amounts,
			       analysis_duration_ms, analyzed_by, analyzed_at, created_at
			FROM contract_analyses
			WHERE tenant_id = $1 AND contract_id = $2
			ORDER BY analyzed_at DESC
			LIMIT 1
		) t`
	return queryRowJSON[model.ContractRiskAnalysis](ctx, r.db, query, tenantID, contractID)
}

func (r *ContractRepository) UpdateAnalysisFields(ctx context.Context, q Queryer, tenantID, contractID uuid.UUID, riskScore float64, riskLevel model.RiskLevel, status model.AnalysisStatus, analyzedAt time.Time) error {
	ct, err := q.Exec(ctx, `
		UPDATE contracts
		SET risk_score = $3,
		    risk_level = $4,
		    analysis_status = $5,
		    last_analyzed_at = $6,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, contractID, riskScore, riskLevel, status, analyzedAt,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *ContractRepository) SetAnalysisStatus(ctx context.Context, tenantID, contractID uuid.UUID, status model.AnalysisStatus) error {
	ct, err := r.db.Exec(ctx, `UPDATE contracts SET analysis_status = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, contractID, status)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *ContractRepository) UpdateStatus(ctx context.Context, q Queryer, tenantID, contractID uuid.UUID, previousStatus *model.ContractStatus, status model.ContractStatus, changedBy *uuid.UUID, changedAt time.Time, signedDate *time.Time) error {
	ct, err := q.Exec(ctx, `
		UPDATE contracts
		SET previous_status = $3,
		    status = $4,
		    status_changed_by = $5,
		    status_changed_at = $6,
		    signed_date = COALESCE($7, signed_date),
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, contractID, previousStatus, status, changedBy, changedAt, datePtr(signedDate),
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *ContractRepository) SetWorkflowInstance(ctx context.Context, q Queryer, tenantID, contractID uuid.UUID, workflowInstanceID *uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE contracts
		SET workflow_instance_id = $3,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, contractID, workflowInstanceID,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *ContractRepository) Search(ctx context.Context, tenantID uuid.UUID, search string, page, perPage int) ([]model.ContractSummary, int, error) {
	filters := model.ContractListFilters{Page: page, PerPage: perPage, Search: search}
	items, total, err := r.List(ctx, tenantID, filters)
	if err != nil {
		return nil, 0, err
	}
	summaries := make([]model.ContractSummary, 0, len(items))
	for _, item := range items {
		summaries = append(summaries, summarizeContract(item))
	}
	return summaries, total, nil
}

func (r *ContractRepository) Stats(ctx context.Context, tenantID uuid.UUID) (*model.ContractStats, error) {
	stats := &model.ContractStats{
		ByStatus:    map[string]int{},
		ByType:      map[string]int{},
		ByRiskLevel: map[string]int{},
	}
	rows, err := r.db.Query(ctx, `SELECT status, COUNT(*) FROM contracts WHERE tenant_id = $1 AND deleted_at IS NULL AND COALESCE(archive_status, 'active') = 'active' GROUP BY status`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var count int
		if err := rows.Scan(&key, &count); err != nil {
			return nil, err
		}
		stats.ByStatus[key] = count
	}
	for _, query := range []struct {
		sql string
		dst map[string]int
	}{
		{`SELECT type, COUNT(*) FROM contracts WHERE tenant_id = $1 AND deleted_at IS NULL AND COALESCE(archive_status, 'active') = 'active' GROUP BY type`, stats.ByType},
		{`SELECT risk_level, COUNT(*) FROM contracts WHERE tenant_id = $1 AND deleted_at IS NULL AND COALESCE(archive_status, 'active') = 'active' GROUP BY risk_level`, stats.ByRiskLevel},
	} {
		rows, err := r.db.Query(ctx, query.sql, tenantID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var key string
			var count int
			if err := rows.Scan(&key, &count); err != nil {
				rows.Close()
				return nil, err
			}
			query.dst[key] = count
		}
		rows.Close()
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM contracts WHERE tenant_id = $1 AND status = 'active' AND expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + 30 AND deleted_at IS NULL AND COALESCE(archive_status, 'active') = 'active'`, tenantID).Scan(&stats.Expiring30Days); err != nil {
		return nil, err
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM contracts WHERE tenant_id = $1 AND status = 'active' AND expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + 7 AND deleted_at IS NULL AND COALESCE(archive_status, 'active') = 'active'`, tenantID).Scan(&stats.Expiring7Days); err != nil {
		return nil, err
	}
	return stats, nil
}

func (r *ContractRepository) ListExpiring(ctx context.Context, tenantID uuid.UUID, horizonDays int) ([]model.ExpiringContractSummary, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT c.id, c.title, c.type, c.status, c.party_b_name,
			       c.expiry_date::timestamptz AS expiry_date,
			       GREATEST((c.expiry_date::date - CURRENT_DATE), 0) AS days_until_expiry,
			       c.owner_name, c.legal_reviewer_name
			FROM contracts c
			WHERE c.tenant_id = $1
			  AND c.status = 'active'
			  AND c.expiry_date IS NOT NULL
			  AND c.deleted_at IS NULL
			  AND COALESCE(c.archive_status, 'active') = 'active'
			  AND c.expiry_date <= CURRENT_DATE + $2::int
			ORDER BY c.expiry_date ASC
		) t`
	return queryListJSON[model.ExpiringContractSummary](ctx, r.db, query, tenantID, horizonDays)
}

func (r *ContractRepository) ListRenewalWarningCandidates(ctx context.Context, tenantID uuid.UUID, horizonDays, leadDays int) ([]model.Contract, error) {
	query := contractJSONSelect(`
				c.tenant_id = $1
				AND c.status = 'active'
				AND c.deleted_at IS NULL
				AND COALESCE(c.archive_status, 'active') = 'active'
				AND (
					(c.renewal_date IS NOT NULL AND c.renewal_date <= CURRENT_DATE + $2::int)
					OR (
						c.expiry_date IS NOT NULL
						AND (
							c.expiry_date - make_interval(days => GREATEST(c.renewal_notice_days, $3::int))
						) <= CURRENT_TIMESTAMP + make_interval(days => $2::int)
					)
				)`) + ` ORDER BY COALESCE(t.renewal_date, t.expiry_date) ASC, t.title ASC`
	return r.decryptContracts(queryListJSON[model.Contract](ctx, r.db, query, tenantID, horizonDays, leadDays))
}

func (r *ContractRepository) CountByType(ctx context.Context, tenantID uuid.UUID) (map[string]int, error) {
	return r.aggregateCounts(ctx, tenantID, "type")
}

func (r *ContractRepository) CountByStatus(ctx context.Context, tenantID uuid.UUID) (map[string]int, error) {
	return r.aggregateCounts(ctx, tenantID, "status")
}

func (r *ContractRepository) RecentContracts(ctx context.Context, tenantID uuid.UUID, limit int) ([]model.ContractSummary, error) {
	query := contractJSONSelect(`c.tenant_id = $1 AND c.deleted_at IS NULL AND COALESCE(c.archive_status, 'active') = 'active'`) + ` ORDER BY t.created_at DESC LIMIT $2`
	contracts, err := r.decryptContracts(queryListJSON[model.Contract](ctx, r.db, query, tenantID, limit))
	if err != nil {
		return nil, err
	}
	out := make([]model.ContractSummary, 0, len(contracts))
	for _, contract := range contracts {
		out = append(out, summarizeContract(contract))
	}
	return out, nil
}

func (r *ContractRepository) HighRiskContracts(ctx context.Context, tenantID uuid.UUID, limit int) ([]model.ContractRiskSummary, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT id, title, type, status, risk_level, COALESCE(risk_score, 0) AS risk_score, party_b_name, expiry_date::timestamptz AS expiry_date
			FROM contracts
			WHERE tenant_id = $1 AND risk_level IN ('critical','high') AND deleted_at IS NULL
			  AND COALESCE(archive_status, 'active') = 'active'
			ORDER BY COALESCE(risk_score, 0) DESC, updated_at DESC
			LIMIT $2
		) t`
	return queryListJSON[model.ContractRiskSummary](ctx, r.db, query, tenantID, limit)
}

func (r *ContractRepository) TotalValueBreakdown(ctx context.Context, tenantID uuid.UUID) (model.TotalValueBreakdown, error) {
	breakdown := model.TotalValueBreakdown{
		ByType:     map[string]float64{},
		ByCurrency: map[string]float64{},
	}
	rows, err := r.db.Query(ctx, `SELECT type, COALESCE(SUM(total_value),0)::float8 FROM contracts WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL AND COALESCE(archive_status, 'active') = 'active' GROUP BY type`, tenantID)
	if err != nil {
		return breakdown, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var value float64
		if err := rows.Scan(&key, &value); err != nil {
			return breakdown, err
		}
		breakdown.ByType[key] = value
	}
	rows, err = r.db.Query(ctx, `SELECT currency, COALESCE(SUM(total_value),0)::float8 FROM contracts WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL AND COALESCE(archive_status, 'active') = 'active' GROUP BY currency`, tenantID)
	if err != nil {
		return breakdown, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var value float64
		if err := rows.Scan(&key, &value); err != nil {
			return breakdown, err
		}
		breakdown.ByCurrency[key] = value
	}
	return breakdown, nil
}

func (r *ContractRepository) MonthlyActivity(ctx context.Context, tenantID uuid.UUID) ([]model.MonthlyContractActivity, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			WITH months AS (
				SELECT generate_series(date_trunc('month', CURRENT_DATE) - interval '11 months', date_trunc('month', CURRENT_DATE), interval '1 month') AS month_start
			)
			SELECT to_char(month_start, 'YYYY-MM') AS month,
			       COALESCE((SELECT COUNT(*) FROM contracts c WHERE c.tenant_id = $1 AND date_trunc('month', c.created_at) = month_start AND c.deleted_at IS NULL), 0) AS created,
			       COALESCE((SELECT COUNT(*) FROM contracts c WHERE c.tenant_id = $1 AND c.status = 'active' AND date_trunc('month', c.status_changed_at) = month_start AND c.deleted_at IS NULL), 0) AS activated,
			       COALESCE((SELECT COUNT(*) FROM contracts c WHERE c.tenant_id = $1 AND c.status = 'expired' AND date_trunc('month', c.status_changed_at) = month_start AND c.deleted_at IS NULL), 0) AS expired,
			       COALESCE((SELECT COUNT(*) FROM contracts c WHERE c.tenant_id = $1 AND c.status = 'renewed' AND date_trunc('month', c.status_changed_at) = month_start AND c.deleted_at IS NULL), 0) AS renewed
			FROM months
			ORDER BY month_start
		) t`
	return queryListJSON[model.MonthlyContractActivity](ctx, r.db, query, tenantID)
}

func (r *ContractRepository) ListDueForExpiryBucket(ctx context.Context, lowerExclusive, upperInclusive int) ([]model.Contract, error) {
	query := contractJSONSelect(`
			c.status = 'active'
			AND c.expiry_date IS NOT NULL
			AND c.deleted_at IS NULL
			AND COALESCE(c.archive_status, 'active') = 'active'
			AND (c.expiry_date::date - CURRENT_DATE) <= $1::int
			AND (c.expiry_date::date - CURRENT_DATE) > $2::int`)
	return r.decryptContracts(queryListJSON[model.Contract](ctx, r.db, query, upperInclusive, lowerExclusive))
}

func (r *ContractRepository) ListExpiredActive(ctx context.Context) ([]model.Contract, error) {
	query := contractJSONSelect(`c.status = 'active' AND c.expiry_date IS NOT NULL AND c.expiry_date < CURRENT_DATE AND c.deleted_at IS NULL AND COALESCE(c.archive_status, 'active') = 'active'`)
	return r.decryptContracts(queryListJSON[model.Contract](ctx, r.db, query))
}

func (r *ContractRepository) RecordExpiryNotification(ctx context.Context, q Queryer, tenantID, contractID uuid.UUID, horizon int) (bool, error) {
	var id uuid.UUID
	err := q.QueryRow(ctx, `
		INSERT INTO expiry_notifications (tenant_id, contract_id, horizon_days)
		VALUES ($1, $2, $3)
		ON CONFLICT (contract_id, horizon_days) DO NOTHING
		RETURNING id`,
		tenantID, contractID, horizon,
	).Scan(&id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (r *ContractRepository) GetByWorkflowInstance(ctx context.Context, workflowInstanceID uuid.UUID) (*model.Contract, error) {
	query := contractJSONSelect(`c.workflow_instance_id = $1 AND c.deleted_at IS NULL`)
	return r.decryptContract(queryRowJSON[model.Contract](ctx, r.db, query, workflowInstanceID))
}

func (r *ContractRepository) GetByFileID(ctx context.Context, fileID uuid.UUID) ([]model.Contract, error) {
	query := contractJSONSelect(`(c.document_file_id = $1 OR EXISTS (SELECT 1 FROM contract_versions v WHERE v.contract_id = c.id AND v.file_id = $1)) AND c.deleted_at IS NULL`)
	return r.decryptContracts(queryListJSON[model.Contract](ctx, r.db, query, fileID))
}

func (r *ContractRepository) ListTenantIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := r.db.Query(ctx, `SELECT DISTINCT tenant_id FROM contracts WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var tenantID uuid.UUID
		if err := rows.Scan(&tenantID); err != nil {
			return nil, err
		}
		out = append(out, tenantID)
	}
	return out, rows.Err()
}

func (r *ContractRepository) aggregateCounts(ctx context.Context, tenantID uuid.UUID, column string) (map[string]int, error) {
	switch column {
	case "type", "status":
	default:
		return nil, fmt.Errorf("unsupported aggregate column %q", column)
	}
	rows, err := r.db.Query(ctx, fmt.Sprintf(`SELECT %s, COUNT(*) FROM contracts WHERE tenant_id = $1 AND deleted_at IS NULL AND COALESCE(archive_status, 'active') = 'active' GROUP BY %s`, column, column), tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var key string
		var count int
		if err := rows.Scan(&key, &count); err != nil {
			return nil, err
		}
		out[key] = count
	}
	return out, rows.Err()
}

func contractJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT c.id, c.tenant_id, c.title, c.contract_number, c.type, c.description,
			       c.party_a_name, c.party_a_entity, c.party_b_name, c.party_b_entity, c.party_b_contact,
			       c.total_value::float8 AS total_value, c.currency, c.payment_terms,
			       c.effective_date::timestamptz AS effective_date,
			       c.expiry_date::timestamptz AS expiry_date,
			       c.renewal_date::timestamptz AS renewal_date,
			       c.auto_renew, c.renewal_notice_days,
			       c.signed_date::timestamptz AS signed_date,
			       c.status, c.previous_status,
			       c.status_changed_at, c.status_changed_by,
			       c.owner_user_id, c.owner_name, c.legal_reviewer_id, c.legal_reviewer_name,
			       c.risk_score::float8 AS risk_score, COALESCE(c.risk_level, 'none') AS risk_level,
			       COALESCE(c.analysis_status, 'pending') AS analysis_status,
			       c.last_analyzed_at, c.document_file_id, COALESCE(c.document_text, '') AS document_text,
			       c.current_version, c.parent_contract_id, c.workflow_instance_id,
			       c.org_entity_id, oe.name AS org_entity_name,
			       c.department, COALESCE(c.tags, '{}') AS tags, COALESCE(c.metadata, '{}'::jsonb) AS metadata,
			       c.created_by, c.created_at, c.updated_at, c.deleted_at
			FROM contracts c
			LEFT JOIN legal_org_entities oe
			       ON oe.id = c.org_entity_id
			      AND oe.tenant_id = c.tenant_id
			      AND oe.deleted_at IS NULL
			WHERE ` + where + `
		) t`
}

// EntityRollup aggregates the CURRENT filter set per linked org entity:
// contract count plus total_value summed per currency (mixed-currency books are
// never summed together — GET /contracts/entity-rollup, feature #11). Contracts
// without an org_entity_id land in ONE "unassigned" bucket (nil entity_id) so
// the buckets always reconcile with the filtered list total. Reuses
// contractListWhere so List and the roll-up can never drift apart.
func (r *ContractRepository) EntityRollup(ctx context.Context, tenantID uuid.UUID, filters model.ContractListFilters) ([]model.ContractEntityRollupRow, error) {
	conditions, args := contractListWhere(tenantID, filters)
	query := contractEntityRollupSelect(strings.Join(conditions, " AND "))
	return queryListJSON[model.ContractEntityRollupRow](ctx, r.db, query, args...)
}

func contractEntityRollupSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			WITH filtered AS (
				SELECT c.tenant_id, c.org_entity_id, c.currency, c.total_value
				FROM contracts c
				WHERE ` + where + `
			),
			per_currency AS (
				SELECT tenant_id, org_entity_id, currency,
				       COUNT(*) AS contract_count,
				       COALESCE(SUM(total_value), 0)::float8 AS total_value
				FROM filtered
				GROUP BY tenant_id, org_entity_id, currency
			)
			SELECT p.org_entity_id AS entity_id,
			       oe.code AS entity_code,
			       oe.name AS entity_name,
			       SUM(p.contract_count)::int AS count,
			       COALESCE(
			           jsonb_object_agg(p.currency, p.total_value) FILTER (WHERE p.currency IS NOT NULL),
			           '{}'::jsonb
			       ) AS total_value_by_currency
			FROM per_currency p
			LEFT JOIN legal_org_entities oe
			       ON oe.id = p.org_entity_id
			      AND oe.tenant_id = p.tenant_id
			      AND oe.deleted_at IS NULL
			GROUP BY p.org_entity_id, oe.code, oe.name
			ORDER BY count DESC, entity_code ASC NULLS LAST
		) t`
}

func summarizeContract(contract model.Contract) model.ContractSummary {
	return model.ContractSummary{
		ID:             contract.ID,
		Title:          contract.Title,
		Type:           contract.Type,
		Status:         contract.Status,
		PartyBName:     contract.PartyBName,
		RiskLevel:      contract.RiskLevel,
		RiskScore:      contract.RiskScore,
		ExpiryDate:     contract.ExpiryDate,
		CurrentVersion: contract.CurrentVersion,
		CreatedAt:      contract.CreatedAt,
	}
}

func datePtr(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	// Contract milestones are timestamps, not date-only values. Preserve the
	// entered time (normalised to UTC) so create/update and signature completion
	// round-trip without silently resetting to midnight.
	normalized := value.UTC()
	return &normalized
}
