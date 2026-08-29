package service

import (
	"context"
	"fmt"
	"strconv"
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

// DashboardInvalidator busts the cached tenant dashboard after compliance
// mutations so the hero KPIs reflect fresh state; nil when not wired
// (e.g. tests or embeddings without a lex dashboard service).
type DashboardInvalidator interface {
	Invalidate(ctx context.Context, tenantID uuid.UUID)
}

type ComplianceService struct {
	db         *pgxpool.Pool
	contracts  *repository.ContractRepository
	clauses    *repository.ClauseRepository
	documents  *repository.DocumentRepository
	rules      *repository.ComplianceRepository
	alerts     *repository.AlertRepository
	publisher  Publisher
	metrics    *metrics.Metrics
	topic      string
	logger     zerolog.Logger
	now        func() time.Time
	dashboards DashboardInvalidator
}

func NewComplianceService(db *pgxpool.Pool, contracts *repository.ContractRepository, clauses *repository.ClauseRepository, documents *repository.DocumentRepository, rules *repository.ComplianceRepository, alerts *repository.AlertRepository, publisher Publisher, appMetrics *metrics.Metrics, topic string, logger zerolog.Logger) *ComplianceService {
	return &ComplianceService{
		db:        db,
		contracts: contracts,
		clauses:   clauses,
		documents: documents,
		rules:     rules,
		alerts:    alerts,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-compliance").Logger(),
		now:       time.Now,
	}
}

// WithDashboardInvalidator wires the dashboard cache invalidator after
// construction (the dashboard service itself depends on this service, so
// constructor injection would be circular).
func (s *ComplianceService) WithDashboardInvalidator(invalidator DashboardInvalidator) *ComplianceService {
	s.dashboards = invalidator
	return s
}

// invalidateDashboard busts the tenant's cached dashboard; nil-safe no-op when
// no invalidator is wired.
func (s *ComplianceService) invalidateDashboard(ctx context.Context, tenantID uuid.UUID) {
	if s.dashboards == nil {
		return
	}
	s.dashboards.Invalidate(ctx, tenantID)
}

func (s *ComplianceService) ListRules(ctx context.Context, tenantID uuid.UUID) ([]model.ComplianceRule, error) {
	return s.rules.ListRules(ctx, tenantID)
}

func (s *ComplianceService) ListRulesPaginated(ctx context.Context, tenantID uuid.UUID, page, perPage int) ([]model.ComplianceRule, int, error) {
	return s.rules.ListRulesPaginated(ctx, tenantID, page, perPage)
}

func (s *ComplianceService) CreateRule(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateComplianceRuleRequest) (*model.ComplianceRule, error) {
	req.Normalize()
	if strings.TrimSpace(req.Name) == "" {
		return nil, validationError("rule name is required", map[string]string{"name": "required"})
	}
	rule := &model.ComplianceRule{
		ID:            uuid.New(),
		TenantID:      tenantID,
		Name:          req.Name,
		Description:   req.Description,
		RuleType:      req.RuleType,
		Severity:      req.Severity,
		Config:        req.Config,
		ContractTypes: req.ContractTypes,
		Enabled:       req.Enabled,
		CreatedBy:     userID,
	}
	if err := s.rules.CreateRule(ctx, s.db, rule); err != nil {
		return nil, internalError("create compliance rule", err)
	}
	s.invalidateDashboard(ctx, tenantID)
	return rule, nil
}

func (s *ComplianceService) UpdateRule(ctx context.Context, tenantID, id uuid.UUID, req dto.UpdateComplianceRuleRequest) (*model.ComplianceRule, error) {
	rule, err := s.rules.GetRule(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("rule not found")
		}
		return nil, internalError("load rule", err)
	}
	wasEnabled := rule.Enabled
	if req.Name != nil {
		rule.Name = strings.TrimSpace(*req.Name)
	}
	if req.Description != nil {
		rule.Description = strings.TrimSpace(*req.Description)
	}
	if req.RuleType != nil {
		rule.RuleType = *req.RuleType
	}
	if req.Severity != nil {
		rule.Severity = *req.Severity
	}
	if req.Config != nil {
		rule.Config = req.Config
	}
	if req.ContractTypes != nil {
		rule.ContractTypes = req.ContractTypes
	}
	if req.Enabled != nil {
		rule.Enabled = *req.Enabled
	}
	if err := s.rules.UpdateRule(ctx, s.db, rule); err != nil {
		return nil, internalError("update rule", err)
	}
	// Disabling a rule dismisses its outstanding alerts so the compliance score
	// can recover once a noisy rule is turned off.
	if wasEnabled && !rule.Enabled {
		if _, err := s.alerts.DismissOpenAlertsByRule(ctx, tenantID, rule.ID, "rule disabled"); err != nil {
			return nil, internalError("dismiss alerts for disabled rule", err)
		}
	}
	s.invalidateDashboard(ctx, tenantID)
	return rule, nil
}

func (s *ComplianceService) DeleteRule(ctx context.Context, tenantID, id uuid.UUID) error {
	if err := s.rules.SoftDeleteRule(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("rule not found")
		}
		return internalError("delete rule", err)
	}
	// A deleted rule's alerts are no longer actionable — dismiss them so they
	// stop penalizing the compliance score.
	if _, err := s.alerts.DismissOpenAlertsByRule(ctx, tenantID, id, "rule deleted"); err != nil {
		return internalError("dismiss alerts for deleted rule", err)
	}
	s.invalidateDashboard(ctx, tenantID)
	return nil
}

func (s *ComplianceService) RunChecks(ctx context.Context, tenantID uuid.UUID, contractIDs []uuid.UUID) (*model.ComplianceRunResult, error) {
	rules, err := s.rules.ListEnabledRules(ctx, tenantID)
	if err != nil {
		return nil, internalError("list enabled rules", err)
	}
	contracts, err := s.loadContracts(ctx, tenantID, contractIDs)
	if err != nil {
		return nil, err
	}
	createdAlerts := make([]model.ComplianceAlert, 0)
	for _, contract := range contracts {
		analysis, _ := s.contracts.GetLatestAnalysis(ctx, tenantID, contract.ID)
		clauses, _ := s.clauses.ListByContract(ctx, tenantID, contract.ID)
		for _, rule := range rules {
			if !ruleAppliesToContract(rule, contract.Type) {
				continue
			}
			alert, ok := s.evaluateRule(rule, &contract, analysis, clauses)
			if !ok {
				continue
			}
			created, err := s.alerts.CreateOrSkipDedup(ctx, s.db, alert)
			if err != nil {
				return nil, internalError("create compliance alert", err)
			}
			if created {
				createdAlerts = append(createdAlerts, *alert)
				writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.compliance.alert_created", tenantID, nil, map[string]any{
					"id":          alert.ID,
					"contract_id": alert.ContractID,
					"severity":    alert.Severity,
					"title":       alert.Title,
				}, s.logger)
			}
		}
	}
	score, err := s.GetScore(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	result := &model.ComplianceRunResult{
		TenantID:      tenantID,
		Score:         score.Score,
		AlertsCreated: len(createdAlerts),
		Alerts:        createdAlerts,
		CalculatedAt:  s.now().UTC(),
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.compliance.checked", tenantID, nil, map[string]any{
		"tenant_id":      tenantID,
		"score":          result.Score,
		"alerts_created": result.AlertsCreated,
	}, s.logger)
	s.invalidateDashboard(ctx, tenantID)
	return result, nil
}

func (s *ComplianceService) ListAlerts(ctx context.Context, tenantID uuid.UUID, status string, severity string, page, perPage int) ([]model.ComplianceAlert, int, error) {
	return s.alerts.List(ctx, tenantID, status, severity, page, perPage)
}

func (s *ComplianceService) GetAlert(ctx context.Context, tenantID, id uuid.UUID) (*model.ComplianceAlert, error) {
	alert, err := s.alerts.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("alert not found")
		}
		return nil, internalError("get alert", err)
	}
	return alert, nil
}

func (s *ComplianceService) UpdateAlertStatus(ctx context.Context, tenantID, id, userID uuid.UUID, req dto.UpdateAlertStatusRequest) (*model.ComplianceAlert, error) {
	req.Normalize()
	var resolvedAt *time.Time
	if req.Status == model.ComplianceAlertResolved || req.Status == model.ComplianceAlertDismissed {
		now := s.now().UTC()
		resolvedAt = &now
	}
	if err := s.alerts.UpdateStatus(ctx, s.db, tenantID, id, req.Status, &userID, resolvedAt, req.ResolutionNotes); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("alert not found")
		}
		return nil, internalError("update alert status", err)
	}
	alert, err := s.alerts.Get(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("reload alert", err)
	}
	if req.Status == model.ComplianceAlertResolved {
		writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.compliance.alert_resolved", tenantID, &userID, map[string]any{
			"id":          alert.ID,
			"resolved_by": userID,
		}, s.logger)
	}
	s.invalidateDashboard(ctx, tenantID)
	return alert, nil
}

func (s *ComplianceService) GetDashboard(ctx context.Context, tenantID uuid.UUID) (*model.ComplianceDashboard, error) {
	alertsByStatus, err := s.alerts.CountByStatus(ctx, tenantID)
	if err != nil {
		return nil, internalError("count alerts by status", err)
	}
	alertsBySeverity, err := s.alerts.CountBySeverity(ctx, tenantID)
	if err != nil {
		return nil, internalError("count alerts by severity", err)
	}
	activeBySeverity, err := s.alerts.CountBySeverityActive(ctx, tenantID)
	if err != nil {
		return nil, internalError("count active alerts by severity", err)
	}
	rules, err := s.rules.ListRules(ctx, tenantID)
	if err != nil {
		return nil, internalError("list rules", err)
	}
	total, err := s.contractsInScope(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	score, err := s.buildScore(ctx, tenantID, total, activeBySeverity)
	if err != nil {
		return nil, err
	}
	rulesByType := map[string]int{}
	for _, rule := range rules {
		rulesByType[string(rule.RuleType)]++
	}
	openAlerts := alertsByStatus[string(model.ComplianceAlertOpen)] +
		alertsByStatus[string(model.ComplianceAlertAcknowledged)] +
		alertsByStatus[string(model.ComplianceAlertInvestigating)]
	return &model.ComplianceDashboard{
		RulesByType:            rulesByType,
		AlertsByStatus:         alertsByStatus,
		AlertsBySeverity:       alertsBySeverity,
		ActiveAlertsBySeverity: activeBySeverity,
		OpenAlerts:             openAlerts,
		ResolvedAlerts:         alertsByStatus[string(model.ComplianceAlertResolved)],
		ContractsInScope:       total,
		ComplianceScore:        score.Score,
		CalculatedAt:           s.now().UTC(),
	}, nil
}

// contractsInScope counts the tenant's contracts (shared by GetDashboard and
// GetScore) — the score's normalization denominator.
func (s *ComplianceService) contractsInScope(ctx context.Context, tenantID uuid.UUID) (int, error) {
	_, total, err := s.contracts.List(ctx, tenantID, model.ContractListFilters{Page: 1, PerPage: 1})
	if err != nil {
		return 0, internalError("count contracts in scope", err)
	}
	return total, nil
}

// severityWeight is the per-alert score penalty by severity: a critical alert
// weighs a full contract's exposure unit (10), a low alert a tenth of it.
func severityWeight(severity string) float64 {
	switch model.ComplianceSeverity(severity) {
	case model.ComplianceSeverityCritical:
		return 10
	case model.ComplianceSeverityHigh:
		return 5
	case model.ComplianceSeverityMedium:
		return 2
	default:
		return 1
	}
}

func (s *ComplianceService) GetScore(ctx context.Context, tenantID uuid.UUID) (*model.ComplianceScore, error) {
	total, err := s.contractsInScope(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	activeBySeverity, err := s.alerts.CountBySeverityActive(ctx, tenantID)
	if err != nil {
		return nil, internalError("count active alerts by severity", err)
	}
	return s.buildScore(ctx, tenantID, total, activeBySeverity)
}

// buildScore computes the severity-weighted, portfolio-normalized compliance
// score: ACTIVE alerts (open/acknowledged/investigating) are weighted
// critical=10, high=5, medium=2, low=1 and normalized by portfolio exposure
// denom = max(contractsInScope, 1) * 10, so "every contract carries a critical
// alert" scores ~0 while a single low alert barely dents a large portfolio.
// Resolved-alert and rule-count bonuses were removed — they rewarded
// resolve-churn and rule sprawl, not compliance health.
func (s *ComplianceService) buildScore(ctx context.Context, tenantID uuid.UUID, contractsInScope int, activeBySeverity map[string]int) (*model.ComplianceScore, error) {
	openAlerts, resolvedAlerts, err := s.alerts.ScoreComponents(ctx, tenantID)
	if err != nil {
		return nil, internalError("load alert score components", err)
	}
	rules, err := s.rules.ListEnabledRules(ctx, tenantID)
	if err != nil {
		return nil, internalError("list enabled rules", err)
	}
	weightedPenalty := 0.0
	for severity, count := range activeBySeverity {
		weightedPenalty += severityWeight(severity) * float64(count)
	}
	denom := float64(max(contractsInScope, 1) * 10)
	score := clampScore(100 * (1 - weightedPenalty/denom))
	if s.metrics != nil {
		s.metrics.ComplianceScore.WithLabelValues(tenantID.String()).Set(score)
	}
	return &model.ComplianceScore{
		TenantID:       tenantID,
		Score:          score,
		OpenAlerts:     openAlerts,
		ResolvedAlerts: resolvedAlerts,
		RuleCoverage:   len(rules),
		CalculatedAt:   s.now().UTC(),
	}, nil
}

func (s *ComplianceService) CreateSystemAlert(ctx context.Context, alert *model.ComplianceAlert) (bool, error) {
	created, err := s.alerts.CreateOrSkipDedup(ctx, s.db, alert)
	if err != nil {
		return false, internalError("create system alert", err)
	}
	if created {
		writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.compliance.alert_created", alert.TenantID, nil, map[string]any{
			"id":          alert.ID,
			"contract_id": alert.ContractID,
			"severity":    alert.Severity,
			"title":       alert.Title,
		}, s.logger)
	}
	return created, nil
}

func (s *ComplianceService) HandleFileIntegrityEvent(ctx context.Context, tenantID uuid.UUID, fileID uuid.UUID, eventType string, description string) error {
	contracts, err := s.contracts.GetByFileID(ctx, fileID)
	if err != nil {
		return internalError("load contracts by file", err)
	}
	documents, err := s.documents.GetByFileID(ctx, fileID)
	if err != nil {
		return internalError("load documents by file", err)
	}
	for _, contract := range contracts {
		dedup := fmt.Sprintf("%s:%s", eventType, contract.ID)
		alert := &model.ComplianceAlert{
			ID:          uuid.New(),
			TenantID:    contract.TenantID,
			ContractID:  &contract.ID,
			Title:       fmt.Sprintf("حدث سلامة مستند العقد «%s»", contract.Title),
			Description: "تم رصد حدث يتعلق بسلامة الملف المرتبط بهذا العقد.",
			Severity:    model.ComplianceSeverityHigh,
			Status:      model.ComplianceAlertOpen,
			DedupKey:    &dedup,
			Evidence: map[string]any{
				"file_id":            fileID,
				"event_type":         eventType,
				"source_description": description,
				"contract_title":     contract.Title,
			},
		}
		if _, err := s.CreateSystemAlert(ctx, alert); err != nil {
			return err
		}
	}
	for _, document := range documents {
		dedup := fmt.Sprintf("%s:%s", eventType, document.ID)
		alert := &model.ComplianceAlert{
			ID:          uuid.New(),
			TenantID:    document.TenantID,
			Title:       fmt.Sprintf("حدث سلامة وثيقة قانونية «%s»", document.Title),
			Description: "تم رصد حدث يتعلق بسلامة الملف المرتبط بهذه الوثيقة.",
			Severity:    model.ComplianceSeverityMedium,
			Status:      model.ComplianceAlertOpen,
			DedupKey:    &dedup,
			Evidence: map[string]any{
				"document_id":        document.ID,
				"file_id":            fileID,
				"event_type":         eventType,
				"source_description": description,
				"document_title":     document.Title,
			},
		}
		if _, err := s.CreateSystemAlert(ctx, alert); err != nil {
			return err
		}
	}
	return nil
}

func (s *ComplianceService) loadContracts(ctx context.Context, tenantID uuid.UUID, ids []uuid.UUID) ([]model.Contract, error) {
	if len(ids) == 0 {
		page := 1
		all := make([]model.Contract, 0)
		for {
			items, total, err := s.contracts.List(ctx, tenantID, model.ContractListFilters{Page: page, PerPage: 200})
			if err != nil {
				return nil, internalError("list contracts", err)
			}
			all = append(all, items...)
			if len(all) >= total || len(items) == 0 {
				return all, nil
			}
			page++
		}
	}
	out := make([]model.Contract, 0, len(ids))
	for _, id := range ids {
		contract, err := s.contracts.Get(ctx, tenantID, id)
		if err != nil {
			if err == pgx.ErrNoRows {
				continue
			}
			return nil, internalError("load contract", err)
		}
		out = append(out, *contract)
	}
	return out, nil
}

func ruleAppliesToContract(rule model.ComplianceRule, contractType model.ContractType) bool {
	if len(rule.ContractTypes) == 0 {
		return true
	}
	for _, allowed := range rule.ContractTypes {
		if allowed == string(contractType) {
			return true
		}
	}
	return false
}

func (s *ComplianceService) evaluateRule(rule model.ComplianceRule, contract *model.Contract, analysis *model.ContractRiskAnalysis, clauses []model.Clause) (*model.ComplianceAlert, bool) {
	now := s.now().UTC()
	var (
		shouldAlert bool
		title       string
		description string
		dedup       string
		evidence    = map[string]any{"rule_type": rule.RuleType}
	)
	switch rule.RuleType {
	case model.ComplianceRuleExpiryWarning:
		days := intConfig(rule.Config, "days_before", 30)
		if contract.Status == model.ContractStatusActive && contract.ExpiryDate != nil && int(contract.ExpiryDate.Sub(now).Hours()/24) <= days {
			shouldAlert = true
			title = fmt.Sprintf("العقد «%s» تنتهي مدته خلال %s", contract.Title, arabicDays(days))
			description = "تم تفعيل قاعدة تنبيه انتهاء العقد."
			evidence["contract_title"] = contract.Title
			evidence["expiry_date"] = contract.ExpiryDate
			evidence["days_until_expiry"] = int(contract.ExpiryDate.Sub(now).Hours() / 24)
			evidence["horizon_days"] = days
			// Cross-engine dedup contract: the ExpiryMonitor writes expiry alerts
			// with dedup key "expiry:<contractID>:<horizon>" (monitor/expiry_monitor.go).
			// Using the same key here means whichever engine fires second hits
			// CreateOrSkipDedup's ON CONFLICT, so the same expiry condition can
			// never double-alert.
			dedup = fmt.Sprintf("expiry:%s:%d", contract.ID, days)
		}
	case model.ComplianceRuleMissingClause:
		if analysis != nil && len(analysis.MissingClauses) > 0 {
			shouldAlert = true
			title = fmt.Sprintf("العقد «%s» يفتقد بنودًا قياسية", contract.Title)
			description = "يفتقد العقد بندًا أو أكثر من البنود القياسية المطلوبة."
			evidence["contract_title"] = contract.Title
			evidence["missing_clauses"] = analysis.MissingClauses
		}
	case model.ComplianceRuleRiskThreshold:
		threshold := floatConfig(rule.Config, "min_score", 70)
		requiredStatus := stringConfig(rule.Config, "required_status", string(model.ContractStatusLegalReview))
		if contract.RiskScore != nil && *contract.RiskScore > threshold && string(contract.Status) != requiredStatus {
			shouldAlert = true
			title = fmt.Sprintf("العقد عالي المخاطر «%s» ليس في حالة المراجعة المطلوبة", contract.Title)
			description = "تتجاوز درجة المخاطر الحد المسموح به، والحالة الحالية لا تطابق حالة المراجعة المطلوبة."
			evidence["contract_title"] = contract.Title
			evidence["risk_score"] = *contract.RiskScore
			evidence["risk_threshold"] = threshold
			evidence["status"] = contract.Status
			evidence["required_status"] = requiredStatus
		}
	case model.ComplianceRuleReviewOverdue:
		days := intConfig(rule.Config, "overdue_days", 7)
		if (contract.Status == model.ContractStatusInternalReview || contract.Status == model.ContractStatusLegalReview) &&
			contract.StatusChangedAt != nil && contract.StatusChangedAt.Before(now.AddDate(0, 0, -days)) {
			shouldAlert = true
			title = fmt.Sprintf("تأخرت مراجعة العقد «%s»", contract.Title)
			description = "بقي العقد في المراجعة لمدة تتجاوز اتفاقية مستوى الخدمة المسموح بها."
			evidence["contract_title"] = contract.Title
			evidence["overdue_days"] = days
		}
	case model.ComplianceRuleUnsignedContract:
		if contract.Status == model.ContractStatusPendingSignature || (contract.Status == model.ContractStatusActive && contract.SignedDate == nil) {
			shouldAlert = true
			title = fmt.Sprintf("العقد «%s» غير موقّع", contract.Title)
			description = "حالة التوقيع لا تستوفي السياسة المعتمدة."
			evidence["contract_title"] = contract.Title
		}
	case model.ComplianceRuleValueThreshold:
		minValue := floatConfig(rule.Config, "min_value", 1_000_000)
		if contract.TotalValue != nil && *contract.TotalValue >= minValue {
			shouldAlert = true
			title = fmt.Sprintf("العقد «%s» يتجاوز حد القيمة", contract.Title)
			description = "قيمة العقد تتجاوز الحد المحدد في قاعدة الامتثال."
			evidence["contract_title"] = contract.Title
			evidence["contract_value"] = *contract.TotalValue
			evidence["value_threshold"] = minValue
		}
	case model.ComplianceRuleJurisdictionCheck:
		if analysis != nil && hasComplianceFlag(analysis, "foreign_governing_law") {
			shouldAlert = true
			title = fmt.Sprintf("العقد «%s» يستخدم قانونًا حاكمًا أجنبيًا", contract.Title)
			description = "تم تفعيل قاعدة التحقق من الاختصاص."
			evidence["contract_title"] = contract.Title
		}
	case model.ComplianceRuleDataProtectionRequired:
		if strings.Contains(strings.ToLower(contract.DocumentText), "personal data") && !hasClause(clauses, model.ClauseTypeDataProtection) {
			shouldAlert = true
			title = fmt.Sprintf("العقد «%s» يفتقد بنود حماية البيانات", contract.Title)
			description = "تم العثور على لغة تتعلق بالبيانات الشخصية دون بند لحماية البيانات."
			evidence["contract_title"] = contract.Title
		}
	case model.ComplianceRuleCustom:
		shouldAlert = evaluateCustomRule(rule.Config, contract)
		if shouldAlert {
			title = fmt.Sprintf("تم تفعيل قاعدة امتثال مخصصة للعقد «%s»", contract.Title)
			description = "تطابقت شروط القاعدة المخصصة."
			evidence["contract_title"] = contract.Title
		}
	}
	if !shouldAlert {
		return nil, false
	}
	if dedup == "" {
		dedup = fmt.Sprintf("rule:%s:contract:%s", rule.ID, contract.ID)
	}
	return &model.ComplianceAlert{
		ID:          uuid.New(),
		TenantID:    contract.TenantID,
		RuleID:      &rule.ID,
		ContractID:  &contract.ID,
		Title:       title,
		Description: description,
		Severity:    rule.Severity,
		Status:      model.ComplianceAlertOpen,
		DedupKey:    &dedup,
		Evidence:    evidence,
	}, true
}

func hasClause(clauses []model.Clause, clauseType model.ClauseType) bool {
	for _, clause := range clauses {
		if clause.ClauseType == clauseType {
			return true
		}
	}
	return false
}

func hasComplianceFlag(analysis *model.ContractRiskAnalysis, code string) bool {
	if analysis == nil {
		return false
	}
	for _, flag := range analysis.ComplianceFlags {
		if flag.Code == code {
			return true
		}
	}
	return false
}

func arabicDays(n int) string {
	switch {
	case n == 1:
		return "يوم واحد"
	case n == 2:
		return "يومين"
	case n >= 3 && n <= 10:
		return fmt.Sprintf("%d أيام", n)
	default:
		return fmt.Sprintf("%d يومًا", n)
	}
}

func intConfig(config map[string]any, key string, fallback int) int {
	if config == nil {
		return fallback
	}
	switch value := config[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	case string:
		if parsed, err := strconv.Atoi(value); err == nil {
			return parsed
		}
	}
	return fallback
}

func floatConfig(config map[string]any, key string, fallback float64) float64 {
	if config == nil {
		return fallback
	}
	switch value := config[key].(type) {
	case float64:
		return value
	case int:
		return float64(value)
	case string:
		if parsed, err := strconv.ParseFloat(value, 64); err == nil {
			return parsed
		}
	}
	return fallback
}

func stringConfig(config map[string]any, key string, fallback string) string {
	if config == nil {
		return fallback
	}
	if value, ok := config[key].(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func evaluateCustomRule(config map[string]any, contract *model.Contract) bool {
	field := stringConfig(config, "field", "")
	operator := stringConfig(config, "operator", "eq")
	value := config["value"]
	switch field {
	case "risk_score":
		if contract.RiskScore == nil {
			return false
		}
		return compareNumeric(*contract.RiskScore, operator, value)
	case "total_value":
		if contract.TotalValue == nil {
			return false
		}
		return compareNumeric(*contract.TotalValue, operator, value)
	case "status":
		if wanted, ok := value.(string); ok {
			switch operator {
			case "neq":
				return string(contract.Status) != wanted
			default:
				return string(contract.Status) == wanted
			}
		}
	}
	return false
}

func compareNumeric(current float64, operator string, value any) bool {
	target := floatConfig(map[string]any{"v": value}, "v", 0)
	switch operator {
	case "gt":
		return current > target
	case "gte":
		return current >= target
	case "lt":
		return current < target
	case "lte":
		return current <= target
	case "neq":
		return current != target
	default:
		return current == target
	}
}
