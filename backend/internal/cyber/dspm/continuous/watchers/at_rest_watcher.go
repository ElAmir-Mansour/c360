package watchers

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/cyber/dspm"
	"github.com/clario360/platform/internal/cyber/dspm/compliance"
	"github.com/clario360/platform/internal/cyber/model"
	"github.com/clario360/platform/internal/cyber/repository"
	"github.com/clario360/platform/internal/events"
)

// AtRestWatcher performs daily re-scans of registered data sources for drift detection.
type AtRestWatcher struct {
	db         *pgxpool.Pool
	repo       *repository.DSPMRepository
	alertRepo  *repository.AlertRepository
	classifier *dspm.DSPMClassifier
	tagger     *compliance.ComplianceTagger
	producer   *events.Producer
	logger     zerolog.Logger
	interval   time.Duration
	cancel     context.CancelFunc
}

// NewAtRestWatcher creates an at-rest drift detection watcher.
func NewAtRestWatcher(
	db *pgxpool.Pool,
	repo *repository.DSPMRepository,
	alertRepo *repository.AlertRepository,
	classifier *dspm.DSPMClassifier,
	tagger *compliance.ComplianceTagger,
	producer *events.Producer,
	interval time.Duration,
	logger zerolog.Logger,
) *AtRestWatcher {
	return &AtRestWatcher{
		db:         db,
		repo:       repo,
		alertRepo:  alertRepo,
		classifier: classifier,
		tagger:     tagger,
		producer:   producer,
		logger:     logger.With().Str("watcher", "at_rest").Logger(),
		interval:   interval,
	}
}

func (w *AtRestWatcher) Name() string { return "at_rest" }

func (w *AtRestWatcher) Start(ctx context.Context) error {
	ctx, w.cancel = context.WithCancel(ctx)

	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	// Run immediately on start, then on interval
	if err := w.scan(ctx); err != nil {
		w.logger.Error().Err(err).Msg("initial at-rest scan failed")
	}

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if err := w.scan(ctx); err != nil {
				w.logger.Error().Err(err).Msg("at-rest scan failed")
			}
		}
	}
}

func (w *AtRestWatcher) Stop() error {
	if w.cancel != nil {
		w.cancel()
	}
	return nil
}

// scan performs a full re-scan of all data assets for classification drift.
func (w *AtRestWatcher) scan(ctx context.Context) error {
	w.logger.Info().Msg("starting at-rest drift scan")
	start := time.Now()

	// Load all tenants with DSPM data
	tenants, err := w.loadActiveTenants(ctx)
	if err != nil {
		return fmt.Errorf("load tenants: %w", err)
	}

	totalDrifts := 0
	totalAssets := 0

	for _, tenantID := range tenants {
		drifts, assets, err := w.scanTenant(ctx, tenantID)
		if err != nil {
			w.logger.Error().Err(err).Str("tenant_id", tenantID.String()).Msg("tenant scan failed")
			continue
		}
		totalDrifts += drifts
		totalAssets += assets
	}

	w.logger.Info().
		Int("tenants", len(tenants)).
		Int("assets", totalAssets).
		Int("drifts", totalDrifts).
		Dur("duration", time.Since(start)).
		Msg("at-rest drift scan completed")

	return nil
}

// scanTenant scans all assets for a single tenant.
func (w *AtRestWatcher) scanTenant(ctx context.Context, tenantID uuid.UUID) (drifts, assets int, err error) {
	// Load all data-bearing assets
	assetList, err := w.loadTenantAssets(ctx, tenantID)
	if err != nil {
		return 0, 0, err
	}

	for _, asset := range assetList {
		select {
		case <-ctx.Done():
			return drifts, assets, ctx.Err()
		default:
		}

		assets++
		classification := w.classifier.Classify(asset)

		// Get previous DSPM record
		prevAsset, _ := w.repo.GetDataAssetByID(ctx, tenantID, asset.ID)
		if prevAsset == nil {
			continue
		}

		// Detect classification drift
		if prevAsset.DataClassification != classification.Classification {
			drifts++

			driftDirection := "deescalated"
			severity := model.SeverityMedium
			if classRank(classification.Classification) > classRank(prevAsset.DataClassification) {
				driftDirection = "escalated"
				severity = model.SeverityHigh
			}

			w.createDriftAlert(ctx, tenantID, asset, prevAsset, classification, driftDirection, severity)
		}

		// Check encryption at rest
		if prevAsset.EncryptedAtRest != nil && !*prevAsset.EncryptedAtRest && classification.ContainsPII {
			// Already flagged in posture assessment, but log for continuous tracking
			w.logger.Warn().
				Str("asset_id", asset.ID.String()).
				Str("asset_name", asset.Name).
				Msg("PII asset without encryption at rest detected during drift scan")
		}
	}

	return drifts, assets, nil
}

// driftDirectionAr renders the drift direction code as a Saudi-Arabic phrase for
// the (Arabic default) UI. The raw code is kept as data in the evidence Value.
func driftDirectionAr(direction string) string {
	switch direction {
	case "escalated":
		return "تصاعدت حساسيته"
	case "deescalated":
		return "تراجعت حساسيته"
	default:
		return direction
	}
}

func (w *AtRestWatcher) createDriftAlert(ctx context.Context, tenantID uuid.UUID, asset *model.Asset, prevAsset *model.DSPMDataAsset, classification *dspm.ClassificationResult, direction string, severity model.Severity) {
	now := time.Now().UTC()

	metadata, _ := json.Marshal(map[string]interface{}{
		"previous_classification": prevAsset.DataClassification,
		"current_classification":  classification.Classification,
		"drift_direction":         direction,
		"pii_types":               classification.PIITypes,
	})

	alert := &model.Alert{
		ID:       uuid.New(),
		TenantID: tenantID,
		Title:    fmt.Sprintf("رُصد انحراف في تصنيف الأصل %s: %s من %s إلى %s", asset.Name, driftDirectionAr(direction), prevAsset.DataClassification, classification.Classification),
		Description: fmt.Sprintf(
			"تغيّر تصنيف الأصل %s من %s إلى %s أثناء فحص الانحراف الساكن، ما يشير إلى تغيّر في مستوى حساسية البيانات.",
			asset.Name, prevAsset.DataClassification, classification.Classification,
		),
		Severity: severity,
		Status:   model.AlertStatusNew,
		Source:   "dspm_at_rest",
		AssetID:  &asset.ID,
		AssetIDs: []uuid.UUID{asset.ID},
		Explanation: model.AlertExplanation{
			Summary: fmt.Sprintf("انحراف تصنيف بيانات الأصل %s: من %s إلى %s", asset.Name, prevAsset.DataClassification, classification.Classification),
			Reason:  fmt.Sprintf("رصد الفحص اليومي الساكن أن حساسية التصنيف %s من %s إلى %s.", driftDirectionAr(direction), prevAsset.DataClassification, classification.Classification),
			Evidence: []model.AlertEvidence{
				{Label: "السابق", Field: "previous_classification", Value: prevAsset.DataClassification, Description: "التصنيف في آخر فحص"},
				{Label: "الحالي", Field: "current_classification", Value: classification.Classification, Description: "التصنيف في الفحص الحالي"},
				{Label: "الاتجاه", Field: "drift_direction", Value: direction, Description: "ما إذا كانت البيانات أصبحت أكثر أو أقل حساسية"},
			},
			RecommendedActions: []string{
				"راجِع أصل البيانات بحثًا عن تغييرات حديثة في المخطط أو البيانات.",
				"حدّث ضوابط الوصول لتتوافق مع مستوى التصنيف الجديد.",
				"تحقّق من استيفاء متطلبات الامتثال للتصنيف الجديد.",
			},
		},
		ConfidenceScore: 0.85,
		EventCount:      1,
		FirstEventAt:    now,
		LastEventAt:     now,
		Tags:            []string{"dspm", "drift", direction},
		Metadata:        metadata,
	}

	if _, err := w.alertRepo.Create(ctx, alert); err != nil {
		w.logger.Error().Err(err).Str("asset_id", asset.ID.String()).Msg("create drift alert")
	}
}

func (w *AtRestWatcher) loadActiveTenants(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := w.db.Query(ctx, `
		SELECT DISTINCT tenant_id FROM dspm_data_assets
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tenants []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		tenants = append(tenants, id)
	}
	return tenants, rows.Err()
}

func (w *AtRestWatcher) loadTenantAssets(ctx context.Context, tenantID uuid.UUID) ([]*model.Asset, error) {
	rows, err := w.db.Query(ctx, `
		SELECT id, tenant_id, name, type::text, host(ip_address), hostname, mac_address::text,
		       os, os_version, owner, department, location, criticality::text, status::text,
		       discovered_at, last_seen_at, discovery_source, metadata, tags, created_by, created_at, updated_at
		FROM assets
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND (
			type = 'database'
			OR (type = 'application' AND (metadata ? 'schema_info' OR metadata ? 'columns'))
			OR (type = 'cloud_resource' AND tags && ARRAY['s3', 'blob', 'gcs', 'storage'])
		  )
	`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var assets []*model.Asset
	for rows.Next() {
		asset, err := scanAssetRow(rows)
		if err != nil {
			return nil, err
		}
		assets = append(assets, asset)
	}
	return assets, rows.Err()
}

func classRank(classification string) int {
	switch classification {
	case "restricted":
		return 4
	case "confidential":
		return 3
	case "internal":
		return 2
	case "public":
		return 1
	default:
		return 0
	}
}
