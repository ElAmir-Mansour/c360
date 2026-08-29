package appverify

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

type fakeCommandRunner struct {
	got []CommandInvocation
	out CommandResult
	err error
}

func (r *fakeCommandRunner) RunCommand(_ context.Context, invocation CommandInvocation) (CommandResult, error) {
	r.got = append(r.got, invocation)
	return r.out, r.err
}

func TestExecutorRunsHTTPAndCommandChecks(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ready" {
			t.Fatalf("path = %s, want /ready", r.URL.Path)
		}
		_, _ = w.Write([]byte("READY rp-1"))
	}))
	t.Cleanup(srv.Close)

	runner := &fakeCommandRunner{out: CommandResult{ExitCode: 0, Stdout: "1\n"}}
	exec := NewExecutor(ExecutorConfig{
		HTTPClient: srv.Client(),
		Runner:     runner,
		Now:        fixedExecutorClock(),
	})
	plan := CheckPlan{
		WorkloadID:    "workload-1",
		WorkloadName:  "orders",
		RequestedKind: WorkloadGenericHTTP,
		ProfileKind:   WorkloadGenericHTTP,
		Parameters: map[string]string{
			"endpoint.url":      srv.URL,
			"health_path":       "/ready",
			"recovery_point_id": "rp-1",
		},
		Checks: []PlannedCheck{
			{
				Sequence: 1,
				VerificationCheck: VerificationCheck{
					ID:             "http-ready",
					Name:           "ready",
					Kind:           CheckHTTPProbe,
					Required:       true,
					TimeoutSeconds: 1,
					Probe: &ProbeSpec{
						Protocol:             ProbeHTTP,
						Target:               "{endpoint.url}",
						Method:               http.MethodGet,
						Path:                 "{health_path}",
						ExpectedStatus:       []int{200},
						ExpectedBodyContains: "{recovery_point_id}",
					},
				},
				Parameters: map[string]string{
					"endpoint.url":      srv.URL,
					"health_path":       "/ready",
					"recovery_point_id": "rp-1",
				},
			},
			{
				Sequence: 2,
				VerificationCheck: VerificationCheck{
					ID:             "sql-marker",
					Name:           "marker",
					Kind:           CheckSQLQuery,
					Required:       true,
					TimeoutSeconds: 1,
					Command: &CommandSpec{
						Tool:                   "psql",
						Query:                  "SELECT count(*) FROM markers WHERE rp = '{recovery_point_id}'",
						ExpectedOutputContains: ">=1",
					},
				},
				Parameters: map[string]string{"recovery_point_id": "rp-1"},
			},
		},
	}

	result, err := exec.Execute(context.Background(), plan)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !result.Passed || result.ChecksPassed != 2 || result.RequiredPassed != 2 {
		t.Fatalf("result = %#v, want all checks passed", result)
	}
	if len(runner.got) != 1 {
		t.Fatalf("command invocations = %d, want 1", len(runner.got))
	}
	if runner.got[0].Tool != "psql" || runner.got[0].Stdin != "SELECT count(*) FROM markers WHERE rp = 'rp-1'" {
		t.Fatalf("command invocation = %#v", runner.got[0])
	}
	if got := checkStatuses(result.Results); !reflect.DeepEqual(got, []CheckStatus{CheckStatusPassed, CheckStatusPassed}) {
		t.Fatalf("statuses = %v", got)
	}
}

func TestExecutorRunsTCPCheck(t *testing.T) {
	t.Parallel()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		conn, err := ln.Accept()
		if err == nil {
			_ = conn.Close()
		}
	}()

	plan := CheckPlan{
		RequestedKind: WorkloadGenericHTTP,
		ProfileKind:   WorkloadGenericHTTP,
		Checks: []PlannedCheck{{
			Sequence: 1,
			VerificationCheck: VerificationCheck{
				ID:             "tcp",
				Name:           "tcp",
				Kind:           CheckTCPProbe,
				Required:       true,
				TimeoutSeconds: 1,
				Probe:          &ProbeSpec{Protocol: ProbeTCP, Target: "{endpoint.address}"},
			},
			Parameters: map[string]string{"endpoint.address": ln.Addr().String()},
		}},
	}

	result, err := NewExecutor(ExecutorConfig{Now: fixedExecutorClock()}).Execute(context.Background(), plan)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !result.Passed || result.Results[0].Status != CheckStatusPassed {
		t.Fatalf("result = %#v, want passed TCP check", result)
	}
}

func TestExecutorReportsUnresolvedParameter(t *testing.T) {
	t.Parallel()

	plan := CheckPlan{
		RequestedKind: WorkloadGenericHTTP,
		ProfileKind:   WorkloadGenericHTTP,
		Checks: []PlannedCheck{{
			Sequence: 1,
			VerificationCheck: VerificationCheck{
				ID:             "http",
				Name:           "http",
				Kind:           CheckHTTPProbe,
				Required:       true,
				TimeoutSeconds: 1,
				Probe:          &ProbeSpec{Protocol: ProbeHTTP, Target: "{endpoint.url}", ExpectedStatus: []int{200}},
			},
		}},
	}

	result, err := NewExecutor(ExecutorConfig{Now: fixedExecutorClock()}).Execute(context.Background(), plan)
	if !errors.Is(err, ErrVerificationFailed) {
		t.Fatalf("err = %v, want ErrVerificationFailed", err)
	}
	if result.Passed || result.Results[0].Status != CheckStatusError {
		t.Fatalf("result = %#v, want failed error result", result)
	}
	if !strings.Contains(result.Results[0].Error, ErrUnresolvedParameter.Error()) {
		t.Fatalf("expected unresolved parameter error detail, got %#v", result.Results[0])
	}
}

func TestExecutorFailedCheckReturnsResultAndError(t *testing.T) {
	t.Parallel()

	runner := &fakeCommandRunner{out: CommandResult{ExitCode: 0, Stdout: "0\n"}}
	plan := CheckPlan{
		RequestedKind: WorkloadPostgres,
		ProfileKind:   WorkloadPostgres,
		Checks: []PlannedCheck{{
			Sequence: 1,
			VerificationCheck: VerificationCheck{
				ID:             "marker",
				Name:           "marker",
				Kind:           CheckSQLQuery,
				Required:       true,
				TimeoutSeconds: 1,
				Command:        &CommandSpec{Tool: "psql", Query: "SELECT 0", ExpectedOutputContains: ">=1"},
			},
		}},
	}

	result, err := NewExecutor(ExecutorConfig{Runner: runner, Now: fixedExecutorClock()}).Execute(context.Background(), plan)
	if !errors.Is(err, ErrVerificationFailed) {
		t.Fatalf("err = %v, want ErrVerificationFailed", err)
	}
	if result.Passed || result.ChecksPassed != 0 || result.RequiredPassed != 0 {
		t.Fatalf("result = %#v, want failed result", result)
	}
	if got := result.FailedChecks; !reflect.DeepEqual(got, []string{"marker"}) {
		t.Fatalf("failed checks = %v", got)
	}
	if result.Results[0].Status != CheckStatusFailed {
		t.Fatalf("check status = %s, want failed", result.Results[0].Status)
	}
}

func fixedExecutorClock() func() time.Time {
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	return func() time.Time { return now }
}

func checkStatuses(results []CheckResult) []CheckStatus {
	out := make([]CheckStatus, len(results))
	for i, result := range results {
		out[i] = result.Status
	}
	return out
}
