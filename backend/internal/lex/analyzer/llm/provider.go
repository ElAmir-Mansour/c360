// Package llm contains the governed, tool-use LLM enricher for ClarioLex
// contract analysis. It wraps the shared vciso LLM provider with the AI
// governance middleware so every clause/obligation extraction call is
// tenant-scoped, audited, and falls back to the deterministic analyzer on any
// failure. This package is self-contained and does NOT import the lex service
// or deterministic analyzer, avoiding import cycles (provider does not import
// lex; lex/analyzer/llm imports provider).
package llm

import (
	"context"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/aigovernance"
	aigovmiddleware "github.com/clario360/platform/internal/aigovernance/middleware"
	provider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
)

// ProviderResolver is the narrow port the enricher depends on so tests can
// inject a fake without depending on the concrete *provider.Manager.
// *provider.Manager already satisfies this interface.
type ProviderResolver interface {
	Resolve(ctx context.Context, tenantID uuid.UUID) (provider.LLMProvider, error)
}

// PredictGovernor is the narrow port over the AI governance prediction logger.
// The concrete *aigovmiddleware.PredictionLogger satisfies this via its
// Predict(ctx, aigovernance.PredictParams) method, and tests can inject a small
// fake to exercise the governed path (including ErrGovernanceUnavailable)
// without a real registry/database.
type PredictGovernor interface {
	Predict(ctx context.Context, params aigovernance.PredictParams) (*aigovernance.PredictionResult, error)
}

// Compile-time assertions that the real shared types satisfy the narrow ports.
var (
	_ ProviderResolver = (*provider.Manager)(nil)
	_ PredictGovernor  = (*aigovmiddleware.PredictionLogger)(nil)
)
