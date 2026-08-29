// Package readmodel builds UI/API summaries from the existing ClarioDR
// control-plane entities. It does not persist state; every value is derived
// from sites, consistency groups, streams, recovery points, and failover runs.
package readmodel

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/model"
)

const (
	defaultRPOObjectiveSeconds = 300
	recentRunLimit             = 5
	attentionLimit             = 10
)

// Reader is the tenant-scoped DR read surface required to build summaries.
// *service.Service satisfies this interface.
type Reader interface {
	ListSites(ctx context.Context, tenantID uuid.UUID) ([]*model.ProtectedSite, error)
	GetGroup(ctx context.Context, tenantID, groupID uuid.UUID) (*model.ConsistencyGroup, error)
	ListGroups(ctx context.Context, tenantID uuid.UUID) ([]*model.ConsistencyGroup, error)
	ListGroupMembers(ctx context.Context, tenantID, groupID uuid.UUID) ([]model.ConsistencyGroupMember, error)
	ListStreams(ctx context.Context, tenantID uuid.UUID) ([]*model.ReplicationStream, error)
	ListRecoveryPoints(ctx context.Context, tenantID, groupID uuid.UUID) ([]*model.RecoveryPoint, error)
	ListFailoverRuns(ctx context.Context, tenantID uuid.UUID) ([]*model.FailoverRun, error)
}

// Posture is the dashboard-ready DR posture view for one tenant.
type Posture struct {
	GeneratedAt        time.Time            `json:"generated_at"`
	OverallHealth      string               `json:"overall_health"`
	SiteCount          int                  `json:"site_count"`
	GroupCount         int                  `json:"group_count"`
	StreamCount        int                  `json:"stream_count"`
	RecoveryPointCount int                  `json:"recovery_point_count"`
	StreamsByStatus    map[string]int       `json:"streams_by_status"`
	WorstLiveRPO       *StreamSummary       `json:"worst_live_rpo,omitempty"`
	RPOBreaches        []StreamSummary      `json:"rpo_breaches"`
	Attention          []AttentionItem      `json:"attention"`
	Groups             []GroupRollup        `json:"groups"`
	RecentRuns         []FailoverRunSummary `json:"recent_runs"`
}

// ReplicationSummary is a table-ready replication view.
type ReplicationSummary struct {
	GeneratedAt     time.Time       `json:"generated_at"`
	OverallHealth   string          `json:"overall_health"`
	TotalStreams    int             `json:"total_streams"`
	StreamsByStatus map[string]int  `json:"streams_by_status"`
	WorstLiveRPO    *StreamSummary  `json:"worst_live_rpo,omitempty"`
	RPOBreaches     []StreamSummary `json:"rpo_breaches"`
	Streams         []StreamSummary `json:"streams"`
}

// GroupSummary is the detail-panel read model for one protection group.
type GroupSummary struct {
	GeneratedAt         time.Time             `json:"generated_at"`
	GroupID             string                `json:"group_id"`
	Name                string                `json:"name"`
	Health              string                `json:"health"`
	MemberCount         int                   `json:"member_count"`
	StreamCount         int                   `json:"stream_count"`
	ReplicationPercent  int                   `json:"replication_percent"`
	RPOObjectiveSeconds int                   `json:"rpo_objective_seconds"`
	RTOObjectiveSeconds int                   `json:"rto_objective_seconds"`
	WorstLiveRPO        *StreamSummary        `json:"worst_live_rpo,omitempty"`
	RPOBreaches         []StreamSummary       `json:"rpo_breaches"`
	LatestRecoveryPoint *RecoveryPointSummary `json:"latest_recovery_point,omitempty"`
	FailoverReadiness   FailoverReadiness     `json:"failover_readiness"`
	Members             []GroupMemberSummary  `json:"members"`
	RecentRuns          []FailoverRunSummary  `json:"recent_runs"`
}

// GroupRollup is the compact group row included in the posture dashboard.
type GroupRollup struct {
	GroupID             string                `json:"group_id"`
	Name                string                `json:"name"`
	Health              string                `json:"health"`
	MemberCount         int                   `json:"member_count"`
	StreamCount         int                   `json:"stream_count"`
	ReplicationPercent  int                   `json:"replication_percent"`
	RPOObjectiveSeconds int                   `json:"rpo_objective_seconds"`
	RTOObjectiveSeconds int                   `json:"rto_objective_seconds"`
	WorstLiveRPO        *StreamSummary        `json:"worst_live_rpo,omitempty"`
	LatestRecoveryPoint *RecoveryPointSummary `json:"latest_recovery_point,omitempty"`
	FailoverReadiness   FailoverReadiness     `json:"failover_readiness"`
	LastRun             *FailoverRunSummary   `json:"last_run,omitempty"`
}

// FailoverReadiness summarizes whether a protection group has the minimum
// current state required to enter failover gates without an avoidable stop.
type FailoverReadiness struct {
	Status          string              `json:"status"`
	CanFailover     bool                `json:"can_failover"`
	BlockingReasons []string            `json:"blocking_reasons"`
	WarningReasons  []string            `json:"warning_reasons"`
	ActiveRun       *FailoverRunSummary `json:"active_run,omitempty"`
}

// GroupMemberSummary enriches a group member with site and stream posture.
type GroupMemberSummary struct {
	GroupID   string         `json:"group_id"`
	SiteID    string         `json:"site_id"`
	SiteName  string         `json:"site_name,omitempty"`
	SiteKind  string         `json:"site_kind,omitempty"`
	BootOrder int            `json:"boot_order"`
	Stream    *StreamSummary `json:"stream,omitempty"`
}

// StreamSummary is the replication row shape used by dashboards and summaries.
type StreamSummary struct {
	StreamID            string     `json:"stream_id"`
	SiteID              string     `json:"site_id"`
	SiteName            string     `json:"site_name,omitempty"`
	SiteKind            string     `json:"site_kind,omitempty"`
	Status              string     `json:"status"`
	Health              string     `json:"health"`
	AppliedSeq          int64      `json:"applied_seq"`
	SourceLSN           *string    `json:"source_lsn,omitempty"`
	AppliedAt           *time.Time `json:"applied_at,omitempty"`
	LastError           *string    `json:"last_error,omitempty"`
	RPOSeconds          *int       `json:"rpo_seconds,omitempty"`
	LagSeconds          *int       `json:"lag_seconds,omitempty"`
	HasData             bool       `json:"has_data"`
	BreachesRPO         bool       `json:"breaches_rpo"`
	RPOObjectiveSeconds int        `json:"rpo_objective_seconds"`
	MeasuredAt          time.Time  `json:"measured_at"`
}

// RecoveryPointSummary is the latest immutable point row for a group.
type RecoveryPointSummary struct {
	ID              string    `json:"id"`
	MarkerLSN       string    `json:"marker_lsn"`
	RPOSeconds      int       `json:"rpo_seconds"`
	ValidationRatio *float64  `json:"validation_ratio,omitempty"`
	IsValidated     bool      `json:"is_validated"`
	LegalHold       bool      `json:"legal_hold"`
	ContentHash     string    `json:"content_hash"`
	SealedAt        time.Time `json:"sealed_at"`
	RetentionUntil  time.Time `json:"retention_until"`
}

// FailoverRunSummary is a compact run row for activity feeds.
type FailoverRunSummary struct {
	RunID               string     `json:"run_id"`
	GroupID             string     `json:"group_id"`
	Mode                string     `json:"mode"`
	Status              string     `json:"status"`
	RTOObjectiveSeconds int        `json:"rto_objective_seconds"`
	RTOActualSeconds    *int       `json:"rto_actual_seconds,omitempty"`
	MetRTO              *bool      `json:"met_rto,omitempty"`
	InitiatedAt         time.Time  `json:"initiated_at"`
	CompletedAt         *time.Time `json:"completed_at,omitempty"`
	LastError           *string    `json:"last_error,omitempty"`
}

// AttentionItem is an operator-facing issue derived from current DR state.
type AttentionItem struct {
	Severity     string `json:"severity"`
	Kind         string `json:"kind"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	Message      string `json:"message"`
}

type snapshot struct {
	sites         []*model.ProtectedSite
	groups        []*model.ConsistencyGroup
	streams       []*model.ReplicationStream
	runs          []*model.FailoverRun
	siteByID      map[string]*model.ProtectedSite
	streamsBySite map[string]*model.ReplicationStream
}

// BuildPosture returns the tenant-wide DR posture read model.
func BuildPosture(ctx context.Context, r Reader, tenantID uuid.UUID, now time.Time) (*Posture, error) {
	snap, err := loadSnapshot(ctx, r, tenantID)
	if err != nil {
		return nil, err
	}

	out := &Posture{
		GeneratedAt:     now.UTC(),
		StreamsByStatus: map[string]int{},
		RPOBreaches:     []StreamSummary{},
		Attention:       []AttentionItem{},
		Groups:          []GroupRollup{},
		RecentRuns:      recentRuns(snap.runs, recentRunLimit),
	}
	out.SiteCount = len(snap.sites)
	out.GroupCount = len(snap.groups)
	out.StreamCount = len(snap.streams)

	allStreams, worst, breaches := streamSummaries(snap.streams, snap.siteByID, now)
	for _, stream := range allStreams {
		out.StreamsByStatus[stream.Status]++
		if stream.Health == "critical" {
			out.Attention = append(out.Attention, AttentionItem{
				Severity:     "critical",
				Kind:         "stream_error",
				ResourceType: "stream",
				ResourceID:   stream.StreamID,
				Message:      fmt.Sprintf("بثّ النسخ المتماثل للموقع «%s» في حالة خطأ", displaySite(stream)),
			})
		}
	}
	out.WorstLiveRPO = worst
	out.RPOBreaches = breaches
	for _, breach := range breaches {
		out.Attention = append(out.Attention, AttentionItem{
			Severity:     "warning",
			Kind:         "rpo_breach",
			ResourceType: "stream",
			ResourceID:   breach.StreamID,
			Message:      fmt.Sprintf("تجاوز هدف نقطة الاستعادة (RPO) للموقع «%s» الحدَّ بمقدار %d ثانية (الهدف %d ثانية)", displaySite(breach), *breach.RPOSeconds, breach.RPOObjectiveSeconds),
		})
	}

	for _, group := range snap.groups {
		groupID, err := uuid.Parse(group.ID)
		if err != nil {
			return nil, fmt.Errorf("readmodel: parsing group id %q: %w", group.ID, err)
		}
		members, err := r.ListGroupMembers(ctx, tenantID, groupID)
		if err != nil {
			return nil, err
		}
		points, err := r.ListRecoveryPoints(ctx, tenantID, groupID)
		if err != nil {
			return nil, err
		}
		out.RecoveryPointCount += len(points)
		rollup := buildGroupRollup(group, members, points, snap.runs, snap.siteByID, snap.streamsBySite, now)
		out.Groups = append(out.Groups, rollup)
		if rollup.Health == "critical" {
			out.Attention = append(out.Attention, AttentionItem{
				Severity:     "critical",
				Kind:         "group_health",
				ResourceType: "group",
				ResourceID:   rollup.GroupID,
				Message:      fmt.Sprintf("مجموعة الحماية «%s» بحاجة إلى مراجعة", rollup.Name),
			})
		}
		if !rollup.FailoverReadiness.CanFailover {
			out.Attention = append(out.Attention, AttentionItem{
				Severity:     "critical",
				Kind:         "failover_readiness",
				ResourceType: "group",
				ResourceID:   rollup.GroupID,
				Message:      fmt.Sprintf("تعذّر تنفيذ تجاوز الفشل لمجموعة «%s»: %s", rollup.Name, firstReason(rollup.FailoverReadiness.BlockingReasons)),
			})
		}
	}
	out.OverallHealth = reduceOverallHealth(groupHealthes(out.Groups), allStreams)
	out.Attention = limitAttention(out.Attention, attentionLimit)
	return out, nil
}

// BuildReplicationSummary returns the tenant-wide replication table read model.
func BuildReplicationSummary(ctx context.Context, r Reader, tenantID uuid.UUID, now time.Time) (*ReplicationSummary, error) {
	snap, err := loadSnapshot(ctx, r, tenantID)
	if err != nil {
		return nil, err
	}
	streams, worst, breaches := streamSummaries(snap.streams, snap.siteByID, now)
	out := &ReplicationSummary{
		GeneratedAt:     now.UTC(),
		TotalStreams:    len(streams),
		StreamsByStatus: map[string]int{},
		WorstLiveRPO:    worst,
		RPOBreaches:     breaches,
		Streams:         streams,
	}
	for _, stream := range streams {
		out.StreamsByStatus[stream.Status]++
	}
	out.OverallHealth = reduceOverallHealth(nil, streams)
	return out, nil
}

// BuildGroupSummary returns the detail read model for one consistency group.
func BuildGroupSummary(ctx context.Context, r Reader, tenantID, groupID uuid.UUID, now time.Time) (*GroupSummary, error) {
	group, err := r.GetGroup(ctx, tenantID, groupID)
	if err != nil {
		return nil, err
	}
	snap, err := loadSnapshot(ctx, r, tenantID)
	if err != nil {
		return nil, err
	}
	members, err := r.ListGroupMembers(ctx, tenantID, groupID)
	if err != nil {
		return nil, err
	}
	points, err := r.ListRecoveryPoints(ctx, tenantID, groupID)
	if err != nil {
		return nil, err
	}

	rollup := buildGroupRollup(group, members, points, snap.runs, snap.siteByID, snap.streamsBySite, now)
	out := &GroupSummary{
		GeneratedAt:         now.UTC(),
		GroupID:             rollup.GroupID,
		Name:                rollup.Name,
		Health:              rollup.Health,
		MemberCount:         rollup.MemberCount,
		StreamCount:         rollup.StreamCount,
		ReplicationPercent:  rollup.ReplicationPercent,
		RPOObjectiveSeconds: rollup.RPOObjectiveSeconds,
		RTOObjectiveSeconds: rollup.RTOObjectiveSeconds,
		WorstLiveRPO:        rollup.WorstLiveRPO,
		LatestRecoveryPoint: rollup.LatestRecoveryPoint,
		FailoverReadiness:   rollup.FailoverReadiness,
		RecentRuns:          recentRuns(filterRunsByGroup(snap.runs, group.ID), recentRunLimit),
		Members:             make([]GroupMemberSummary, 0, len(members)),
	}
	for _, member := range members {
		site := snap.siteByID[member.SiteID]
		entry := GroupMemberSummary{
			GroupID:   member.GroupID,
			SiteID:    member.SiteID,
			BootOrder: member.BootOrder,
		}
		if site != nil {
			entry.SiteName = site.Name
			entry.SiteKind = site.Kind
		}
		if stream := snap.streamsBySite[member.SiteID]; stream != nil {
			summary := buildStreamSummary(stream, site, now)
			entry.Stream = &summary
			if summary.BreachesRPO {
				out.RPOBreaches = append(out.RPOBreaches, summary)
			}
		}
		out.Members = append(out.Members, entry)
	}
	return out, nil
}

func loadSnapshot(ctx context.Context, r Reader, tenantID uuid.UUID) (*snapshot, error) {
	sites, err := r.ListSites(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	groups, err := r.ListGroups(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	streams, err := r.ListStreams(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	runs, err := r.ListFailoverRuns(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	snap := &snapshot{
		sites:         sites,
		groups:        groups,
		streams:       streams,
		runs:          runs,
		siteByID:      map[string]*model.ProtectedSite{},
		streamsBySite: map[string]*model.ReplicationStream{},
	}
	for _, site := range sites {
		snap.siteByID[site.ID] = site
	}
	for _, stream := range streams {
		snap.streamsBySite[stream.SiteID] = stream
	}
	return snap, nil
}

func buildGroupRollup(group *model.ConsistencyGroup, members []model.ConsistencyGroupMember, points []*model.RecoveryPoint, runs []*model.FailoverRun, sites map[string]*model.ProtectedSite, streamsBySite map[string]*model.ReplicationStream, now time.Time) GroupRollup {
	rollup := GroupRollup{
		GroupID:     group.ID,
		Name:        group.Name,
		MemberCount: len(members),
	}
	var (
		healthyStreams int
		streams        []StreamSummary
		siteList       []*model.ProtectedSite
	)
	for _, member := range members {
		site := sites[member.SiteID]
		if site != nil {
			siteList = append(siteList, site)
		}
		stream := streamsBySite[member.SiteID]
		if stream == nil {
			continue
		}
		summary := buildStreamSummary(stream, site, now)
		streams = append(streams, summary)
		rollup.StreamCount++
		if summary.Health == "healthy" {
			healthyStreams++
		}
		if summary.HasData && (rollup.WorstLiveRPO == nil || summary.rpoValue() > rollup.WorstLiveRPO.rpoValue()) {
			copy := summary
			rollup.WorstLiveRPO = &copy
		}
	}
	rollup.Health = reduceOverallHealth(nil, streams)
	if rollup.MemberCount > 0 {
		rollup.ReplicationPercent = int(float64(healthyStreams) / float64(rollup.MemberCount) * 100)
	}
	rollup.RPOObjectiveSeconds = minRPOObjective(siteList)
	rollup.RTOObjectiveSeconds = maxRTOObjective(siteList)
	rollup.LatestRecoveryPoint = latestRecoveryPoint(points)
	if latest := recentRuns(filterRunsByGroup(runs, group.ID), 1); len(latest) > 0 {
		rollup.LastRun = &latest[0]
	}
	rollup.FailoverReadiness = buildFailoverReadiness(rollup, members, streams, runs, now)
	return rollup
}

func buildFailoverReadiness(rollup GroupRollup, members []model.ConsistencyGroupMember, streams []StreamSummary, runs []*model.FailoverRun, now time.Time) FailoverReadiness {
	readiness := FailoverReadiness{
		Status:          "ready",
		CanFailover:     true,
		BlockingReasons: []string{},
		WarningReasons:  []string{},
	}
	if active := activeRunSummary(runs, rollup.GroupID); active != nil {
		readiness.ActiveRun = active
		readiness.Status = "in_progress"
		readiness.CanFailover = false
		readiness.BlockingReasons = append(readiness.BlockingReasons, fmt.Sprintf("عملية تجاوز الفشل %s في الحالة %s", active.RunID, active.Status))
		return readiness
	}
	if len(members) == 0 {
		readiness.BlockingReasons = append(readiness.BlockingReasons, "مجموعة الحماية لا تحتوي على أعضاء")
	}
	if len(streams) < len(members) {
		readiness.BlockingReasons = append(readiness.BlockingReasons, "عضو واحد أو أكثر بلا بثّ نسخ متماثل")
	}
	for _, stream := range streams {
		switch stream.Health {
		case "critical":
			readiness.BlockingReasons = append(readiness.BlockingReasons, fmt.Sprintf("بثّ النسخ للموقع «%s» في حالة خطأ", displaySite(stream)))
		case "paused":
			readiness.BlockingReasons = append(readiness.BlockingReasons, fmt.Sprintf("بثّ النسخ للموقع «%s» متوقّف مؤقتًا", displaySite(stream)))
		case "seeding":
			readiness.BlockingReasons = append(readiness.BlockingReasons, fmt.Sprintf("بثّ النسخ للموقع «%s» بلا حالة استعادة مطبَّقة", displaySite(stream)))
		case "warning":
			if stream.BreachesRPO {
				readiness.WarningReasons = append(readiness.WarningReasons, fmt.Sprintf("تجاوز هدف نقطة الاستعادة (RPO) الفعلي للموقع «%s» الحدَّ المحدّد", displaySite(stream)))
			}
		}
	}
	point := rollup.LatestRecoveryPoint
	switch {
	case point == nil:
		readiness.BlockingReasons = append(readiness.BlockingReasons, "لا تتوفّر أي نقطة استعادة")
	case !point.IsValidated:
		readiness.BlockingReasons = append(readiness.BlockingReasons, "لم يتم التحقّق من أحدث نقطة استعادة")
	case point.ValidationRatio == nil:
		readiness.BlockingReasons = append(readiness.BlockingReasons, "أحدث نقطة استعادة بلا نسبة تحقّق")
	case *point.ValidationRatio < core.ValidationThreshold:
		readiness.BlockingReasons = append(readiness.BlockingReasons, fmt.Sprintf("نسبة التحقّق لأحدث نقطة استعادة (%.4f) دون الحدّ الأدنى (%.4f)", *point.ValidationRatio, core.ValidationThreshold))
	case !point.RetentionUntil.IsZero() && !point.RetentionUntil.After(now):
		readiness.BlockingReasons = append(readiness.BlockingReasons, "انتهت مدة الاحتفاظ بأحدث نقطة استعادة")
	}
	if point != nil && !point.LegalHold {
		readiness.WarningReasons = append(readiness.WarningReasons, "أحدث نقطة استعادة غير خاضعة للحجز القانوني")
	}

	if len(readiness.BlockingReasons) > 0 {
		readiness.Status = "blocked"
		readiness.CanFailover = false
		return readiness
	}
	if len(readiness.WarningReasons) > 0 {
		readiness.Status = "degraded"
	}
	return readiness
}

func streamSummaries(streams []*model.ReplicationStream, sites map[string]*model.ProtectedSite, now time.Time) ([]StreamSummary, *StreamSummary, []StreamSummary) {
	out := make([]StreamSummary, 0, len(streams))
	var worst *StreamSummary
	var breaches []StreamSummary
	for _, stream := range streams {
		summary := buildStreamSummary(stream, sites[stream.SiteID], now)
		out = append(out, summary)
		if summary.BreachesRPO {
			breaches = append(breaches, summary)
		}
		if summary.HasData && (worst == nil || summary.rpoValue() > worst.rpoValue()) {
			copy := summary
			worst = &copy
		}
	}
	return out, worst, breaches
}

func buildStreamSummary(stream *model.ReplicationStream, site *model.ProtectedSite, now time.Time) StreamSummary {
	now = now.UTC()
	objective := defaultRPOObjectiveSeconds
	summary := StreamSummary{
		StreamID:   stream.ID,
		SiteID:     stream.SiteID,
		Status:     stream.Status,
		AppliedSeq: stream.AppliedSeq,
		SourceLSN:  stream.SourceLSN,
		AppliedAt:  stream.AppliedAt,
		LastError:  stream.LastError,
		MeasuredAt: now,
	}
	if site != nil {
		summary.SiteName = site.Name
		summary.SiteKind = site.Kind
		if site.RPOObjectiveSeconds > 0 {
			objective = site.RPOObjectiveSeconds
		}
	}
	summary.RPOObjectiveSeconds = objective
	if rpo, ok := stream.LiveRPO(now); ok {
		seconds := int(rpo.Seconds())
		summary.RPOSeconds = &seconds
		summary.LagSeconds = &seconds
		summary.HasData = true
		summary.BreachesRPO = seconds > objective
	}
	summary.Health = streamHealth(summary)
	return summary
}

func streamHealth(s StreamSummary) string {
	switch s.Status {
	case model.StreamStatusError:
		return "critical"
	case model.StreamStatusDegraded:
		return "warning"
	case model.StreamStatusPaused:
		return "paused"
	case model.StreamStatusPending, model.StreamStatusSeeding:
		if !s.HasData {
			return "seeding"
		}
	}
	if s.BreachesRPO {
		return "warning"
	}
	if !s.HasData {
		return "seeding"
	}
	return "healthy"
}

func reduceOverallHealth(groups []string, streams []StreamSummary) string {
	if len(groups) == 0 && len(streams) == 0 {
		return "empty"
	}
	rank := 0
	for _, h := range groups {
		if score := healthRank(h); score > rank {
			rank = score
		}
	}
	for _, s := range streams {
		if score := healthRank(s.Health); score > rank {
			rank = score
		}
	}
	switch rank {
	case 4:
		return "critical"
	case 3:
		return "warning"
	case 2:
		return "paused"
	case 1:
		return "seeding"
	default:
		return "healthy"
	}
}

func healthRank(h string) int {
	switch h {
	case "critical":
		return 4
	case "warning":
		return 3
	case "paused":
		return 2
	case "seeding":
		return 1
	default:
		return 0
	}
}

func groupHealthes(groups []GroupRollup) []string {
	out := make([]string, 0, len(groups))
	for _, group := range groups {
		out = append(out, group.Health)
	}
	return out
}

func latestRecoveryPoint(points []*model.RecoveryPoint) *RecoveryPointSummary {
	if len(points) == 0 {
		return nil
	}
	sorted := append([]*model.RecoveryPoint(nil), points...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].SealedAt.Equal(sorted[j].SealedAt) {
			return sorted[i].ID > sorted[j].ID
		}
		return sorted[i].SealedAt.After(sorted[j].SealedAt)
	})
	p := sorted[0]
	return &RecoveryPointSummary{
		ID:              p.ID,
		MarkerLSN:       p.MarkerLSN,
		RPOSeconds:      p.RPOSeconds,
		ValidationRatio: p.ValidationRatio,
		IsValidated:     p.IsValidated,
		LegalHold:       p.LegalHold,
		ContentHash:     p.ContentHash,
		SealedAt:        p.SealedAt,
		RetentionUntil:  p.RetentionUntil,
	}
}

func recentRuns(runs []*model.FailoverRun, limit int) []FailoverRunSummary {
	if limit <= 0 {
		return nil
	}
	sorted := append([]*model.FailoverRun(nil), runs...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].InitiatedAt.Equal(sorted[j].InitiatedAt) {
			return sorted[i].ID > sorted[j].ID
		}
		return sorted[i].InitiatedAt.After(sorted[j].InitiatedAt)
	})
	if len(sorted) > limit {
		sorted = sorted[:limit]
	}
	out := make([]FailoverRunSummary, 0, len(sorted))
	for _, run := range sorted {
		summary := FailoverRunSummary{
			RunID:               run.ID,
			GroupID:             run.GroupID,
			Mode:                run.Mode,
			Status:              run.Status,
			RTOObjectiveSeconds: run.RTOObjectiveSeconds,
			RTOActualSeconds:    run.RTOActualSeconds,
			InitiatedAt:         run.InitiatedAt,
			CompletedAt:         run.CompletedAt,
			LastError:           run.LastError,
		}
		if summary.RTOActualSeconds == nil {
			if actual, ok := run.RTOActual(); ok {
				seconds := int(actual.Seconds())
				summary.RTOActualSeconds = &seconds
			}
		}
		if summary.RTOActualSeconds != nil && run.RTOObjectiveSeconds > 0 {
			met := *summary.RTOActualSeconds <= run.RTOObjectiveSeconds
			summary.MetRTO = &met
		}
		out = append(out, summary)
	}
	return out
}

func activeRunSummary(runs []*model.FailoverRun, groupID string) *FailoverRunSummary {
	for _, run := range recentRuns(filterRunsByGroup(runs, groupID), len(runs)) {
		if !terminalRunStatus(run.Status) {
			copy := run
			return &copy
		}
	}
	return nil
}

func terminalRunStatus(status string) bool {
	switch status {
	case model.StatusCompleted, model.StatusFailed, model.StatusCancelled, model.StatusRolledBack:
		return true
	default:
		return false
	}
}

func filterRunsByGroup(runs []*model.FailoverRun, groupID string) []*model.FailoverRun {
	out := make([]*model.FailoverRun, 0, len(runs))
	for _, run := range runs {
		if run.GroupID == groupID {
			out = append(out, run)
		}
	}
	return out
}

func minRPOObjective(sites []*model.ProtectedSite) int {
	min := 0
	for _, site := range sites {
		if site.RPOObjectiveSeconds <= 0 {
			continue
		}
		if min == 0 || site.RPOObjectiveSeconds < min {
			min = site.RPOObjectiveSeconds
		}
	}
	return min
}

func maxRTOObjective(sites []*model.ProtectedSite) int {
	max := 0
	for _, site := range sites {
		if site.RTOObjectiveSeconds > max {
			max = site.RTOObjectiveSeconds
		}
	}
	return max
}

func limitAttention(items []AttentionItem, limit int) []AttentionItem {
	if len(items) <= limit {
		return items
	}
	sort.SliceStable(items, func(i, j int) bool {
		return healthRank(items[i].Severity) > healthRank(items[j].Severity)
	})
	return items[:limit]
}

func displaySite(s StreamSummary) string {
	if s.SiteName != "" {
		return s.SiteName
	}
	return s.SiteID
}

func firstReason(reasons []string) string {
	if len(reasons) == 0 {
		return "لم تُستوفَ فحوصات الجاهزية"
	}
	return reasons[0]
}

func (s StreamSummary) rpoValue() int {
	if s.RPOSeconds == nil {
		return 0
	}
	return *s.RPOSeconds
}
