package appverify

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	// ErrVerificationFailed is returned when a plan executed successfully but at
	// least one planned check did not pass.
	ErrVerificationFailed = errors.New("appverify: verification failed")
	// ErrUnresolvedParameter is returned when a check contains a {placeholder}
	// the plan did not bind.
	ErrUnresolvedParameter = errors.New("appverify: unresolved parameter")
	// ErrUnsupportedCheckKind is returned when an executor does not know how to
	// run a check kind.
	ErrUnsupportedCheckKind = errors.New("appverify: unsupported check kind")
)

// CommandInvocation is the exact command execution request produced from a
// planned SQL/NoSQL/CLI/LDAP/Kubernetes check after placeholder binding.
type CommandInvocation struct {
	Tool       string            `json:"tool"`
	Args       []string          `json:"args,omitempty"`
	Stdin      string            `json:"stdin,omitempty"`
	Timeout    time.Duration     `json:"timeout"`
	CheckID    string            `json:"check_id"`
	CheckKind  CheckKind         `json:"check_kind"`
	Parameters map[string]string `json:"parameters,omitempty"`
}

// CommandResult is the captured output from a command-backed check.
type CommandResult struct {
	ExitCode int    `json:"exit_code"`
	Stdout   string `json:"stdout,omitempty"`
	Stderr   string `json:"stderr,omitempty"`
}

// CommandRunner executes command-backed checks. Deployments can replace the
// default local runner with a sandboxed runner, Kubernetes exec runner, SSH
// runner, or database-native runner.
type CommandRunner interface {
	RunCommand(ctx context.Context, invocation CommandInvocation) (CommandResult, error)
}

// Executor runs planned application verification checks and returns durable
// result data suitable for failover step detail or a dedicated store.
type Executor struct {
	httpClient *http.Client
	dial       func(ctx context.Context, network, address string, timeout time.Duration) (net.Conn, error)
	runner     CommandRunner
	now        func() time.Time
}

// ExecutorConfig customises Executor dependencies.
type ExecutorConfig struct {
	HTTPClient *http.Client
	Dial       func(ctx context.Context, network, address string, timeout time.Duration) (net.Conn, error)
	Runner     CommandRunner
	Now        func() time.Time
}

// NewExecutor constructs an app verification executor. Nil dependencies use
// real defaults: net/http, net.Dialer, local os/exec command execution, and UTC
// time.
func NewExecutor(cfg ExecutorConfig) *Executor {
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{}
	}
	if cfg.Dial == nil {
		cfg.Dial = func(ctx context.Context, network, address string, timeout time.Duration) (net.Conn, error) {
			dialer := net.Dialer{Timeout: timeout}
			return dialer.DialContext(ctx, network, address)
		}
	}
	if cfg.Runner == nil {
		cfg.Runner = LocalCommandRunner{}
	}
	if cfg.Now == nil {
		cfg.Now = func() time.Time { return time.Now().UTC() }
	}
	return &Executor{httpClient: cfg.HTTPClient, dial: cfg.Dial, runner: cfg.Runner, now: cfg.Now}
}

// Execute runs every check in plan order. It returns a Result even when checks
// fail; ErrVerificationFailed marks the non-passing gate condition.
func (e *Executor) Execute(ctx context.Context, plan CheckPlan) (Result, error) {
	if e == nil {
		e = NewExecutor(ExecutorConfig{})
	}
	now := e.now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	started := now()
	result := Result{
		WorkloadID:    plan.WorkloadID,
		WorkloadName:  plan.WorkloadName,
		RequestedKind: plan.RequestedKind,
		ProfileKind:   plan.ProfileKind,
		Passed:        true,
		ChecksTotal:   len(plan.Checks),
		StartedAt:     started,
		Results:       make([]CheckResult, 0, len(plan.Checks)),
	}
	for _, check := range plan.Checks {
		if check.Required {
			result.RequiredTotal++
		}
		cr := e.executeCheck(ctx, check)
		result.Results = append(result.Results, cr)
		if cr.Passed {
			result.ChecksPassed++
			if cr.Required {
				result.RequiredPassed++
			}
			continue
		}
		result.Passed = false
		result.FailedChecks = append(result.FailedChecks, cr.CheckID)
	}
	result.FinishedAt = now()
	result.DurationMS = result.FinishedAt.Sub(result.StartedAt).Milliseconds()
	if !result.Passed {
		return result, fmt.Errorf("%w: %v", ErrVerificationFailed, result.FailedChecks)
	}
	return result, nil
}

func (e *Executor) executeCheck(ctx context.Context, check PlannedCheck) CheckResult {
	started := e.now()
	res := CheckResult{
		Sequence:  check.Sequence,
		CheckID:   check.ID,
		Name:      check.Name,
		Kind:      check.Kind,
		Required:  check.Required,
		Status:    CheckStatusError,
		StartedAt: started,
	}
	var (
		detail string
		err    error
		pass   bool
	)
	switch check.Kind {
	case CheckHTTPProbe:
		pass, detail, err = e.runHTTP(ctx, check)
	case CheckTCPProbe:
		pass, detail, err = e.runTCP(ctx, check)
	case CheckSQLQuery, CheckNoSQLCommand, CheckCLICommand, CheckLDAPQuery, CheckKubernetesAPI:
		pass, detail, err = e.runCommand(ctx, check)
	default:
		err = fmt.Errorf("%w: %s", ErrUnsupportedCheckKind, check.Kind)
	}
	res.FinishedAt = e.now()
	res.DurationMS = res.FinishedAt.Sub(res.StartedAt).Milliseconds()
	res.Detail = detail
	if err != nil {
		res.Error = err.Error()
		res.Status = CheckStatusError
		return res
	}
	res.Passed = pass
	if pass {
		res.Status = CheckStatusPassed
	} else {
		res.Status = CheckStatusFailed
	}
	return res
}

func (e *Executor) runHTTP(ctx context.Context, check PlannedCheck) (bool, string, error) {
	if check.Probe == nil {
		return false, "", errors.New("http probe metadata is required")
	}
	timeout := timeoutFor(check)
	target, err := resolveTemplate(check.Probe.Target, check.Parameters)
	if err != nil {
		return false, "", err
	}
	path, err := resolveTemplate(check.Probe.Path, check.Parameters)
	if err != nil {
		return false, "", err
	}
	url := joinTargetPath(target, path)
	method := strings.TrimSpace(check.Probe.Method)
	if method == "" {
		method = http.MethodGet
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, method, url, nil)
	if err != nil {
		return false, "", fmt.Errorf("build http request: %w", err)
	}
	start := e.now()
	resp, err := e.httpClient.Do(req)
	if err != nil {
		return false, "", fmt.Errorf("http %s %s: %w", method, url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	statusOK := expectedStatusOK(resp.StatusCode, check.Probe.ExpectedStatus)
	bodyOK := true
	expectedBody, err := resolveTemplate(check.Probe.ExpectedBodyContains, check.Parameters)
	if err != nil {
		return false, "", err
	}
	if expectedBody != "" {
		bodyOK = strings.Contains(string(body), expectedBody)
	}
	detail := fmt.Sprintf("http %s %s status=%d status_ok=%t body_contains=%t latency_ms=%d",
		method, url, resp.StatusCode, statusOK, bodyOK, e.now().Sub(start).Milliseconds())
	return statusOK && bodyOK, detail, nil
}

func (e *Executor) runTCP(ctx context.Context, check PlannedCheck) (bool, string, error) {
	if check.Probe == nil {
		return false, "", errors.New("tcp probe metadata is required")
	}
	timeout := timeoutFor(check)
	target, err := resolveTemplate(check.Probe.Target, check.Parameters)
	if err != nil {
		return false, "", err
	}
	start := e.now()
	conn, err := e.dial(ctx, "tcp", target, timeout)
	if err != nil {
		return false, fmt.Sprintf("tcp dial %s failed", target), nil
	}
	_ = conn.Close()
	return true, fmt.Sprintf("tcp dialed %s latency_ms=%d", target, e.now().Sub(start).Milliseconds()), nil
}

func (e *Executor) runCommand(ctx context.Context, check PlannedCheck) (bool, string, error) {
	if check.Command == nil {
		return false, "", errors.New("command metadata is required")
	}
	timeout := timeoutFor(check)
	tool, err := resolveTemplate(check.Command.Tool, check.Parameters)
	if err != nil {
		return false, "", err
	}
	args := make([]string, len(check.Command.Args))
	for i, arg := range check.Command.Args {
		args[i], err = resolveTemplate(arg, check.Parameters)
		if err != nil {
			return false, "", err
		}
	}
	query, err := resolveTemplate(check.Command.Query, check.Parameters)
	if err != nil {
		return false, "", err
	}
	expect, err := resolveTemplate(check.Command.ExpectedOutputContains, check.Parameters)
	if err != nil {
		return false, "", err
	}
	invocation := CommandInvocation{
		Tool:       tool,
		Args:       args,
		Stdin:      query,
		Timeout:    timeout,
		CheckID:    check.ID,
		CheckKind:  check.Kind,
		Parameters: cloneStringMap(check.Parameters),
	}
	commandCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	out, err := e.runner.RunCommand(commandCtx, invocation)
	output := strings.TrimSpace(strings.Join(nonEmptyStrings(out.Stdout, out.Stderr), "\n"))
	if err != nil {
		return false, output, err
	}
	if out.ExitCode != 0 {
		return false, output, nil
	}
	ok := expectedOutputOK(output, expect)
	return ok, output, nil
}

// LocalCommandRunner executes command checks on the local host with os/exec.
// Deployments that require remote execution should inject a different runner.
type LocalCommandRunner struct{}

// RunCommand executes invocation.Tool with invocation.Args and writes Stdin when
// present. The context should already include the desired timeout.
func (LocalCommandRunner) RunCommand(ctx context.Context, invocation CommandInvocation) (CommandResult, error) {
	if strings.TrimSpace(invocation.Tool) == "" {
		return CommandResult{ExitCode: -1}, errors.New("command tool is required")
	}
	cmd := exec.CommandContext(ctx, invocation.Tool, invocation.Args...)
	if invocation.Stdin != "" {
		cmd.Stdin = strings.NewReader(invocation.Stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	exitCode := 0
	if err != nil {
		exitCode = -1
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
			err = nil
		}
	}
	if ctx.Err() != nil {
		return CommandResult{ExitCode: exitCode, Stdout: stdout.String(), Stderr: stderr.String()}, ctx.Err()
	}
	return CommandResult{ExitCode: exitCode, Stdout: stdout.String(), Stderr: stderr.String()}, err
}

func timeoutFor(check PlannedCheck) time.Duration {
	if check.TimeoutSeconds <= 0 {
		return 30 * time.Second
	}
	return time.Duration(check.TimeoutSeconds) * time.Second
}

func expectedStatusOK(got int, expected []int) bool {
	if len(expected) == 0 {
		return got >= 200 && got < 300
	}
	for _, want := range expected {
		if got == want {
			return true
		}
	}
	return false
}

func expectedOutputOK(output, expected string) bool {
	expected = strings.TrimSpace(expected)
	if expected == "" {
		return true
	}
	if strings.HasPrefix(expected, ">=") {
		want, err := strconv.ParseFloat(strings.TrimSpace(strings.TrimPrefix(expected, ">=")), 64)
		if err == nil {
			got, ok := firstNumber(output)
			return ok && got >= want
		}
	}
	if strings.HasPrefix(expected, "<=") {
		want, err := strconv.ParseFloat(strings.TrimSpace(strings.TrimPrefix(expected, "<=")), 64)
		if err == nil {
			got, ok := firstNumber(output)
			return ok && got <= want
		}
	}
	return strings.Contains(output, expected)
}

var numberRE = regexp.MustCompile(`[-+]?\d+(\.\d+)?`)

func firstNumber(s string) (float64, bool) {
	match := numberRE.FindString(s)
	if match == "" {
		return math.NaN(), false
	}
	v, err := strconv.ParseFloat(match, 64)
	return v, err == nil
}

var placeholderRE = regexp.MustCompile(`\{([a-zA-Z0-9_.-]+)\}`)

func resolveTemplate(s string, params map[string]string) (string, error) {
	var missing []string
	out := placeholderRE.ReplaceAllStringFunc(s, func(token string) string {
		key := strings.TrimSuffix(strings.TrimPrefix(token, "{"), "}")
		value, ok := params[key]
		if !ok {
			missing = append(missing, key)
			return token
		}
		return value
	})
	if len(missing) > 0 {
		return "", fmt.Errorf("%w: %s", ErrUnresolvedParameter, strings.Join(missing, ","))
	}
	return out, nil
}

func joinTargetPath(target, path string) string {
	target = strings.TrimSpace(target)
	path = strings.TrimSpace(path)
	if path == "" {
		return target
	}
	if strings.HasPrefix(path, "http://") || strings.HasPrefix(path, "https://") {
		return path
	}
	if strings.HasSuffix(target, "/") && strings.HasPrefix(path, "/") {
		return target + strings.TrimPrefix(path, "/")
	}
	if !strings.HasSuffix(target, "/") && !strings.HasPrefix(path, "/") {
		return target + "/" + path
	}
	return target + path
}

func nonEmptyStrings(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			out = append(out, strings.TrimSpace(value))
		}
	}
	return out
}
