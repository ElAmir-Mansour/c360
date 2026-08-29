package dto

type OrganizationDetailsRequest struct {
	OrganizationName string `json:"organization_name" validate:"required,min=2,max=100"`
	Industry         string `json:"industry" validate:"required"`
	Country          string `json:"country" validate:"required,len=2"`
	City             string `json:"city,omitempty" validate:"omitempty,max=120"`
	OrganizationSize string `json:"organization_size" validate:"required"`
}

type BrandingRequest struct {
	PrimaryColor string `json:"primary_color,omitempty" validate:"omitempty,len=7"`
	AccentColor  string `json:"accent_color,omitempty" validate:"omitempty,len=7"`
	LogoFileID   string `json:"logo_file_id,omitempty" validate:"omitempty,uuid4"`
}

type TeamStepRequest struct {
	Invitations []InvitationInput `json:"invitations"`
}

type SuitesStepRequest struct {
	ActiveSuites []string `json:"active_suites" validate:"required,min=1,dive,required"`
	PlanKey      string   `json:"plan_key,omitempty"`
	Seats        int      `json:"seats,omitempty"`
}

type WizardStepResponse struct {
	Message          string `json:"message"`
	CurrentStep      int    `json:"current_step"`
	CompletedSteps   []int  `json:"completed_steps"`
	InvitationsSent  int    `json:"invitations_sent,omitempty"`
	OrganizationName string `json:"organization_name,omitempty"`
}

type OnboardingProduct struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Description    string `json:"description"`
	EntitlementKey string `json:"entitlement_key"`
}

type OnboardingPlan struct {
	Key             string   `json:"key"`
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	SelfServe       bool     `json:"self_serve"`
	Default         bool     `json:"default"`
	SeatLimit       int      `json:"seat_limit"`
	TrialDays       int      `json:"trial_days"`
	GraceDays       int      `json:"grace_days"`
	IncludedSuites  []string `json:"included_suites"`
	EntitlementKeys []string `json:"entitlement_keys"`
}

type OnboardingPlanCatalogResponse struct {
	Plans          []OnboardingPlan    `json:"plans"`
	Products       []OnboardingProduct `json:"products"`
	DefaultPlanKey string              `json:"default_plan_key"`
	DefaultSeats   int                 `json:"default_seats"`
}
