package llm

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/aigovernance"
	aigovmiddleware "github.com/clario360/platform/internal/aigovernance/middleware"
	llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"
	provider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
)

// fakeProvider is a scripted provider.LLMProvider for tests. No network.
type fakeProvider struct {
	resp     *provider.CompletionResponse
	err      error
	delay    time.Duration
	gotReq   *provider.CompletionRequest
	model    string
	provName string
}

func (f *fakeProvider) Complete(ctx context.Context, request *provider.CompletionRequest) (*provider.CompletionResponse, error) {
	f.gotReq = request
	if f.delay > 0 {
		select {
		case <-time.After(f.delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if f.err != nil {
		return nil, f.err
	}
	return f.resp, nil
}

func (f *fakeProvider) Name() string {
	if f.provName == "" {
		return "fake"
	}
	return f.provName
}

func (f *fakeProvider) Model() string {
	if f.model == "" {
		return "claude-opus-4-8"
	}
	return f.model
}

func (f *fakeProvider) SupportsParallelToolCalls() bool { return false }
func (f *fakeProvider) MaxContextTokens() int           { return 200000 }
func (f *fakeProvider) EstimateCost(int, int) float64   { return 0 }
func (f *fakeProvider) HealthCheck(context.Context) (*provider.HealthStatus, error) {
	return &provider.HealthStatus{Provider: f.Name(), Model: f.Model(), Status: "ok"}, nil
}

// fakeResolver returns a scripted provider (or an error).
type fakeResolver struct {
	prov      provider.LLMProvider
	err       error
	gotTenant uuid.UUID
	callCount int
}

func (r *fakeResolver) Resolve(_ context.Context, tenantID uuid.UUID) (provider.LLMProvider, error) {
	r.callCount++
	r.gotTenant = tenantID
	if r.err != nil {
		return nil, r.err
	}
	return r.prov, nil
}

// fakeGovernor is a small fake of the AI governance prediction logger. It runs
// the ModelFunc directly (so the governed path is exercised) and records the
// params. It can also be scripted to return ErrGovernanceUnavailable.
type fakeGovernor struct {
	unavailable bool
	otherErr    error
	gotParams   aigovernance.PredictParams
	called      bool
}

func (g *fakeGovernor) Predict(ctx context.Context, params aigovernance.PredictParams) (*aigovernance.PredictionResult, error) {
	g.called = true
	g.gotParams = params
	if g.unavailable {
		return nil, governanceUnavailable()
	}
	if g.otherErr != nil {
		return nil, g.otherErr
	}
	out, err := params.ModelFunc(ctx, params.Input)
	if err != nil {
		return nil, err
	}
	return &aigovernance.PredictionResult{
		Output:     out.Output,
		Confidence: out.Confidence,
	}, nil
}

// governanceUnavailable returns an error that errors.Is(...,
// aigovmiddleware.ErrGovernanceUnavailable) reports true for.
func governanceUnavailable() error {
	return govUnavailableErr{}
}

type govUnavailableErr struct{}

func (govUnavailableErr) Error() string { return "ai governance unavailable" }
func (govUnavailableErr) Is(target error) bool {
	return target == aigovmiddleware.ErrGovernanceUnavailable
}

// toolResponse builds a CompletionResponse that calls the named tool with the
// given arguments.
func toolResponse(name string, args map[string]any) *provider.CompletionResponse {
	return &provider.CompletionResponse{
		ToolCalls: []llmmodel.LLMToolCall{{
			ID:           "call_1",
			FunctionName: name,
			Arguments:    args,
		}},
		FinishReason: "tool_use",
	}
}

// proseResponse builds a CompletionResponse with no tool calls (prose answer).
func proseResponse(text string) *provider.CompletionResponse {
	return &provider.CompletionResponse{Content: text, FinishReason: "stop"}
}

var errScripted = errors.New("scripted provider error")
