package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	iammodel "github.com/clario360/platform/internal/iam/model"
	onboardingdto "github.com/clario360/platform/internal/onboarding/dto"
	onboardingmodel "github.com/clario360/platform/internal/onboarding/model"
)

type WizardService struct {
	onboardingRepo   wizardOnboardingRepository
	provisioningRepo provisioningStepsReader
	invitationSvc    *InvitationService
	producer         *events.Producer
	logger           zerolog.Logger
	metrics          *Metrics
	licenseAssigner  LicenseAssigner
	lexProvisioner   LexProvisioner
}

func NewWizardService(
	onboardingRepo wizardOnboardingRepository,
	provisioningRepo provisioningStepsReader,
	invitationSvc *InvitationService,
	producer *events.Producer,
	logger zerolog.Logger,
	metrics *Metrics,
	licenseAssigner LicenseAssigner,
	lexProvisioner LexProvisioner,
) *WizardService {
	return &WizardService{
		onboardingRepo:   onboardingRepo,
		provisioningRepo: provisioningRepo,
		invitationSvc:    invitationSvc,
		producer:         producer,
		logger:           logger.With().Str("service", "onboarding_wizard").Logger(),
		metrics:          metrics,
		licenseAssigner:  licenseAssigner,
		lexProvisioner:   lexProvisioner,
	}
}

func (s *WizardService) GetProgress(ctx context.Context, tenantID uuid.UUID) (*onboardingmodel.WizardProgress, error) {
	current, err := s.onboardingRepo.GetOnboardingByTenantID(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	progress := &onboardingmodel.WizardProgress{
		TenantID:                current.TenantID,
		CurrentStep:             current.CurrentStep,
		CurrentStepLabel:        toWizardStepLabel(current.CurrentStep),
		StepsCompleted:          current.StepsCompleted,
		WizardCompleted:         current.WizardCompleted,
		EmailVerified:           current.EmailVerified,
		OrganizationName:        current.OrgName,
		Industry:                current.OrgIndustry,
		Country:                 current.OrgCountry,
		City:                    current.OrgCity,
		OrganizationSize:        current.OrgSize,
		LogoFileID:              current.LogoFileID,
		PrimaryColor:            current.PrimaryColor,
		AccentColor:             current.AccentColor,
		ActiveSuites:            current.ActiveSuites,
		PlanKey:                 current.PlanKey,
		Seats:                   current.Seats,
		ProvisioningStatus:      current.ProvisioningStatus,
		ProvisioningStartedAt:   current.ProvisioningStartedAt,
		ProvisioningCompletedAt: current.ProvisioningCompletedAt,
		ProvisioningError:       current.ProvisioningError,
	}
	if s.provisioningRepo != nil && current.ProvisioningStatus != onboardingmodel.OnboardingProvisioningPending {
		steps, err := s.provisioningRepo.ListSteps(ctx, tenantID)
		if err == nil && len(steps) > 0 {
			ps := buildProvisioningStatus(steps)
			progress.Provisioning = &ps
		}
	}
	return progress, nil
}

func (s *WizardService) SaveOrganization(ctx context.Context, tenantID uuid.UUID, req onboardingdto.OrganizationDetailsRequest) (*onboardingdto.WizardStepResponse, error) {
	if err := validateOrganizationDetails(req.OrganizationName, req.Country); err != nil {
		return nil, err
	}
	if _, ok := onboardingmodel.ValidOrgIndustries[onboardingmodel.OrgIndustry(req.Industry)]; !ok {
		return nil, fmt.Errorf("invalid organization industry: %w", iammodel.ErrValidation)
	}
	if _, ok := onboardingmodel.ValidOrgSizes[onboardingmodel.OrgSize(req.OrganizationSize)]; !ok {
		return nil, fmt.Errorf("invalid organization size: %w", iammodel.ErrValidation)
	}
	var city *string
	if trimmed := strings.TrimSpace(req.City); trimmed != "" {
		city = &trimmed
	}
	progress, err := s.onboardingRepo.UpdateOrganization(
		ctx,
		tenantID,
		strings.TrimSpace(req.OrganizationName),
		onboardingmodel.OrgIndustry(req.Industry),
		normalizeCountry(req.Country),
		city,
		onboardingmodel.OrgSize(req.OrganizationSize),
	)
	if err != nil {
		return nil, err
	}
	if s.metrics != nil && s.metrics.wizardStepCompletionsTotal != nil {
		s.metrics.wizardStepCompletionsTotal.WithLabelValues(toWizardStepLabel(1)).Inc()
	}
	publishOnboardingEvent(ctx, s.producer,
		"com.clario360.onboarding.wizard.step_completed",
		tenantID,
		nil,
		map[string]any{"step_number": 1, "step_name": toWizardStepLabel(1)},
		s.logger,
	)
	return &onboardingdto.WizardStepResponse{
		Message:          "Organization details saved.",
		CurrentStep:      progress.CurrentStep,
		CompletedSteps:   progress.StepsCompleted,
		OrganizationName: req.OrganizationName,
	}, nil
}

func (s *WizardService) SaveBranding(ctx context.Context, tenantID uuid.UUID, logoFileID *uuid.UUID, primaryColor, accentColor *string) (*onboardingdto.WizardStepResponse, error) {
	if primaryColor != nil {
		if err := validateHexColor(*primaryColor); err != nil {
			return nil, err
		}
	}
	if accentColor != nil {
		if err := validateHexColor(*accentColor); err != nil {
			return nil, err
		}
	}
	progress, err := s.onboardingRepo.UpdateBranding(ctx, tenantID, logoFileID, primaryColor, accentColor)
	if err != nil {
		return nil, err
	}
	if s.metrics != nil && s.metrics.wizardStepCompletionsTotal != nil {
		s.metrics.wizardStepCompletionsTotal.WithLabelValues(toWizardStepLabel(2)).Inc()
	}
	publishOnboardingEvent(ctx, s.producer,
		"com.clario360.onboarding.wizard.step_completed",
		tenantID,
		nil,
		map[string]any{"step_number": 2, "step_name": toWizardStepLabel(2)},
		s.logger,
	)
	return &onboardingdto.WizardStepResponse{
		Message:        "Branding saved.",
		CurrentStep:    progress.CurrentStep,
		CompletedSteps: progress.StepsCompleted,
	}, nil
}

func (s *WizardService) SaveTeam(ctx context.Context, tenantID, invitedBy uuid.UUID, invitedByName string, req onboardingdto.TeamStepRequest) (*onboardingdto.WizardStepResponse, error) {
	validInvites := make([]onboardingdto.InvitationInput, 0, len(req.Invitations))
	for _, item := range req.Invitations {
		if strings.TrimSpace(item.Email) == "" {
			continue
		}
		validInvites = append(validInvites, item)
	}
	sent := 0
	if len(validInvites) > 0 {
		invitations, err := s.invitationSvc.CreateBatch(ctx, tenantID, invitedBy, invitedByName, onboardingdto.BatchInviteRequest{Invitations: validInvites})
		if err != nil {
			return nil, err
		}
		sent = len(invitations)
	}
	progress, err := s.onboardingRepo.MarkTeamStepCompleted(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	if s.metrics != nil && s.metrics.wizardStepCompletionsTotal != nil {
		s.metrics.wizardStepCompletionsTotal.WithLabelValues(toWizardStepLabel(3)).Inc()
	}
	publishOnboardingEvent(ctx, s.producer,
		"com.clario360.onboarding.wizard.step_completed",
		tenantID,
		&invitedBy,
		map[string]any{"step_number": 3, "step_name": toWizardStepLabel(3)},
		s.logger,
	)
	return &onboardingdto.WizardStepResponse{
		Message:         "Team step saved.",
		CurrentStep:     progress.CurrentStep,
		CompletedSteps:  progress.StepsCompleted,
		InvitationsSent: sent,
	}, nil
}

func (s *WizardService) SaveSuites(ctx context.Context, tenantID uuid.UUID, req onboardingdto.SuitesStepRequest) (*onboardingdto.WizardStepResponse, error) {
	activeSuites, err := ensureActiveSuites(req.ActiveSuites)
	if err != nil {
		return nil, err
	}
	planKey, seats, err := normalizePlanSelection(req.PlanKey, req.Seats)
	if err != nil {
		return nil, err
	}
	progress, err := s.onboardingRepo.UpdateSuites(ctx, tenantID, activeSuites, planKey, seats)
	if err != nil {
		return nil, err
	}
	// Re-scope the tenant's trial license to the final suite selection. This is now
	// the FIRST authoritative scoped license write: the async provisioning step only
	// grants the full base trial (AssignBaseTrial writes no overrides), so the chosen
	// suite is granted as soon as this lands and cannot be clobbered by provisioning.
	// Best-effort for the step response — a licensing hiccup must not 500 the user —
	// but a failure here means the scope did not apply, so it is logged at Error and
	// counted (it is no longer covered by an earlier scoped provisioning write).
	if s.licenseAssigner != nil {
		if err := s.licenseAssigner.RescopeLicense(ctx, tenantID.String(), activeSuites, seats); err != nil {
			s.logger.Error().Err(err).Str("tenant_id", tenantID.String()).
				Msg("re-scope trial license to selected suites failed (non-fatal; authoritative scoped write did not apply)")
			if s.metrics != nil && s.metrics.licenseRescopeFailuresTotal != nil {
				s.metrics.licenseRescopeFailuresTotal.WithLabelValues("suites").Inc()
			}
		}
	}
	// Apply the Watheeq Legal Affairs starter template when the customer selected
	// Watheeq/Lex in the wizard. This runs HERE (not in the verify-email pipeline,
	// which provisions with the DEFAULT suites before the wizard suite choice) so a
	// Watheeq-selected-in-wizard signup actually gets its template + legal roles.
	// Idempotent + non-fatal: a transient lex outage must not block the suites step
	// (the lex endpoint is idempotent, so it can be safely retried).
	if s.lexProvisioner != nil && suiteSelected(activeSuites, "lex") {
		adminUserID := ""
		if onboarding, err := s.onboardingRepo.GetOnboardingByTenantID(ctx, tenantID); err != nil {
			s.logger.Warn().Err(err).Str("tenant_id", tenantID.String()).
				Msg("load admin user for Watheeq provisioning failed (non-fatal); provisioning without admin role assignment")
		} else {
			adminUserID = onboarding.AdminUserID.String()
		}
		if err := s.lexProvisioner.ProvisionLegalAffairs(ctx, tenantID.String(), adminUserID); err != nil {
			s.logger.Warn().Err(err).Str("tenant_id", tenantID.String()).
				Msg("provision Watheeq Legal Affairs for selected suites failed (non-fatal; retryable)")
		}
	}
	if s.metrics != nil && s.metrics.wizardStepCompletionsTotal != nil {
		s.metrics.wizardStepCompletionsTotal.WithLabelValues(toWizardStepLabel(4)).Inc()
	}
	publishOnboardingEvent(ctx, s.producer,
		"com.clario360.onboarding.wizard.step_completed",
		tenantID,
		nil,
		map[string]any{
			"step_number": 4,
			"step_name":   toWizardStepLabel(4),
			"plan_key":    planKey,
			"seats":       seats,
		},
		s.logger,
	)
	return &onboardingdto.WizardStepResponse{
		Message:        "Suites saved.",
		CurrentStep:    progress.CurrentStep,
		CompletedSteps: progress.StepsCompleted,
	}, nil
}

func (s *WizardService) Complete(ctx context.Context, tenantID uuid.UUID) (*onboardingdto.WizardStepResponse, error) {
	progress, err := s.onboardingRepo.CompleteWizard(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	// Belt-and-suspenders FINAL license re-scope. The chosen suite is already safe
	// after SaveSuites (the only async writer now grants the full base trial and
	// writes no overrides, so it cannot clobber the selection). This re-affirms the
	// scope with the customer's persisted seats (progress.Seats — not a hardcoded 0,
	// which previously reset seats to the trial default). Non-fatal: a licensing
	// hiccup must not fail wizard completion.
	if s.licenseAssigner != nil && len(progress.ActiveSuites) > 0 {
		if err := s.licenseAssigner.RescopeLicense(ctx, tenantID.String(), progress.ActiveSuites, progress.Seats); err != nil {
			s.logger.Error().Err(err).Str("tenant_id", tenantID.String()).
				Msg("final license re-scope at wizard complete failed (non-fatal)")
			if s.metrics != nil && s.metrics.licenseRescopeFailuresTotal != nil {
				s.metrics.licenseRescopeFailuresTotal.WithLabelValues("complete").Inc()
			}
		}
	}
	if s.metrics != nil {
		if s.metrics.wizardStepCompletionsTotal != nil {
			s.metrics.wizardStepCompletionsTotal.WithLabelValues(toWizardStepLabel(5)).Inc()
		}
		if s.metrics.wizardCompletionsTotal != nil {
			s.metrics.wizardCompletionsTotal.WithLabelValues().Inc()
		}
	}
	publishOnboardingEvent(ctx, s.producer,
		"com.clario360.onboarding.wizard.completed",
		tenantID,
		nil,
		map[string]any{
			"step_number":      5,
			"step_name":        toWizardStepLabel(5),
			"suites_selected":  progress.ActiveSuites,
			"wizard_completed": true,
		},
		s.logger,
	)
	return &onboardingdto.WizardStepResponse{
		Message:        "Onboarding complete.",
		CurrentStep:    progress.CurrentStep,
		CompletedSteps: progress.StepsCompleted,
	}, nil
}
