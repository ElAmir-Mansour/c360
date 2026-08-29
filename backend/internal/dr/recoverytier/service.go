package recoverytier

import (
	"errors"
	"fmt"
	"time"
)

var (
	// ErrTierNotFound is returned when a requested catalog tier does not exist.
	ErrTierNotFound = errors.New("recoverytier: tier not found")
)

const maxDurationSeconds = int64((1<<63)-1) / int64(time.Second)

// Service is a thin facade over the built-in recovery tier catalog. When
// constructed with a SiteSource it also links the catalog to registered protected
// sites: recommending a tier for a site's configured objectives and scanning
// tenant coverage. The site-linked methods live in sites.go.
type Service struct {
	siteSource SiteSource
}

// NewService constructs a catalog-only recovery tier service. The site-linked
// operations return ErrSiteSourceNotConfigured until a SiteSource is wired.
func NewService() *Service {
	return &Service{}
}

// NewServiceWithSites constructs a recovery tier service linked to protected-site
// objectives through src, enabling per-site recommendations and the coverage scan.
func NewServiceWithSites(src SiteSource) *Service {
	return &Service{siteSource: src}
}

// ListProfiles returns the built-in catalog sorted from lowest to highest tier.
func (s *Service) ListProfiles() []TierProfile {
	return List()
}

// GetProfile returns one built-in profile by tier.
func (s *Service) GetProfile(tier Tier) (TierProfile, error) {
	profile, ok := Lookup(tier)
	if !ok {
		return TierProfile{}, fmt.Errorf("%w: %s", ErrTierNotFound, tier)
	}
	return profile, nil
}

// Recommend returns the lowest built-in tier that satisfies the request.
func (s *Service) Recommend(req RecommendationRequest) (TierProfile, error) {
	return Recommend(req)
}

// RecommendationRequestJSON is the HTTP request body for tier recommendations.
// Durations are expressed in whole seconds so clients do not need Go duration
// string handling.
type RecommendationRequestJSON struct {
	RTOSeconds          int64 `json:"rto_seconds"`
	RPOSeconds          int64 `json:"rpo_seconds"`
	BusinessCritical    bool  `json:"business_critical"`
	MissionCritical     bool  `json:"mission_critical"`
	RegulatedData       bool  `json:"regulated_data"`
	RansomwareSensitive bool  `json:"ransomware_sensitive"`
}

// ToRecommendationRequest converts second-based JSON input to the domain
// request type.
func (r RecommendationRequestJSON) ToRecommendationRequest() (RecommendationRequest, error) {
	rto, err := durationFromSeconds("rto_seconds", r.RTOSeconds)
	if err != nil {
		return RecommendationRequest{}, err
	}
	rpo, err := durationFromSeconds("rpo_seconds", r.RPOSeconds)
	if err != nil {
		return RecommendationRequest{}, err
	}
	return RecommendationRequest{
		RTO:                 rto,
		RPO:                 rpo,
		BusinessCritical:    r.BusinessCritical,
		MissionCritical:     r.MissionCritical,
		RegulatedData:       r.RegulatedData,
		RansomwareSensitive: r.RansomwareSensitive,
	}, nil
}

// ProfileResponse is the HTTP representation of a tier profile. Duration
// fields are emitted as whole seconds.
type ProfileResponse struct {
	Tier                            Tier     `json:"tier"`
	RTOSeconds                      int64    `json:"rto_seconds"`
	RPOSeconds                      int64    `json:"rpo_seconds"`
	RecommendedStrategy             Strategy `json:"recommended_strategy"`
	MinimumValidationCadenceSeconds int64    `json:"minimum_validation_cadence_seconds"`
	RequiresCyberVault              bool     `json:"requires_cyber_vault"`
	RequiresCleanRoom               bool     `json:"requires_clean_room"`
	Capabilities                    []string `json:"capabilities"`
	Notes                           []string `json:"notes"`
}

// NewProfileResponse converts a catalog profile to its HTTP representation.
func NewProfileResponse(profile TierProfile) ProfileResponse {
	return ProfileResponse{
		Tier:                            profile.Tier,
		RTOSeconds:                      seconds(profile.RTOObjective),
		RPOSeconds:                      seconds(profile.RPOObjective),
		RecommendedStrategy:             profile.RecommendedStrategy,
		MinimumValidationCadenceSeconds: seconds(profile.MinimumValidationCadence),
		RequiresCyberVault:              profile.RequiresCyberVault,
		RequiresCleanRoom:               profile.RequiresCleanRoom,
		Capabilities:                    append([]string(nil), profile.Capabilities...),
		Notes:                           append([]string(nil), profile.Notes...),
	}
}

// NewProfileResponses converts catalog profiles to HTTP representations.
func NewProfileResponses(profiles []TierProfile) []ProfileResponse {
	out := make([]ProfileResponse, 0, len(profiles))
	for _, profile := range profiles {
		out = append(out, NewProfileResponse(profile))
	}
	return out
}

func durationFromSeconds(field string, value int64) (time.Duration, error) {
	if value <= 0 {
		return 0, fmt.Errorf("%w: %s must be > 0", ErrInvalidRequest, field)
	}
	if value > maxDurationSeconds {
		return 0, fmt.Errorf("%w: %s is too large", ErrInvalidRequest, field)
	}
	return time.Duration(value) * time.Second, nil
}

func seconds(d time.Duration) int64 {
	return int64(d / time.Second)
}
