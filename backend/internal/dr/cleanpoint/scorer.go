package cleanpoint

import (
	"math"
	"sort"
	"strings"
	"time"
)

const (
	defaultMaxAttestationAge = 24 * time.Hour
	retestScoreThreshold     = 70.0
)

// Scorer evaluates recovery-point evidence with an injected clock. It holds no
// mutable state.
type Scorer struct {
	now func() time.Time
}

// NewScorer constructs a Scorer. A nil clock defaults to time.Now.
func NewScorer(clock func() time.Time) *Scorer {
	if clock == nil {
		clock = time.Now
	}
	return &Scorer{now: clock}
}

// Score evaluates ev using the Scorer's clock.
func (s *Scorer) Score(ev RecoveryPointEvidence) Decision {
	return score(ev, s.now())
}

// Score evaluates ev at now. If now is zero, time.Now is used.
func Score(ev RecoveryPointEvidence, now time.Time) Decision {
	if now.IsZero() {
		now = time.Now()
	}
	return score(ev, now)
}

type control struct {
	code   string
	weight int
	eval   func(RecoveryPointEvidence, time.Time, []Signal) controlOutcome
}

type controlOutcome struct {
	fraction float64
	findings []Finding
}

var controls = []control{
	{code: "CP-CLEANROOM", weight: 20, eval: evalCleanRoom},
	{code: "CP-MALWARE", weight: 15, eval: evalMalware},
	{code: "CP-INTEGRITY", weight: 15, eval: evalIntegrity},
	{code: "CP-RANSOMWARE", weight: 15, eval: evalRansomware},
	{code: "CP-APPVERIFY", weight: 15, eval: evalAppVerification},
	{code: "CP-ATTESTATION", weight: 10, eval: evalAttestation},
	{code: "CP-SEAL", weight: 5, eval: evalSeal},
	{code: "CP-RPO", weight: 5, eval: evalRPO},
}

func score(ev RecoveryPointEvidence, now time.Time) Decision {
	now = now.UTC()
	signals := sortedSignals(ev.Signals)
	findings := make([]Finding, 0)
	totalWeight := 0
	earned := 0.0

	for _, c := range controls {
		totalWeight += c.weight
		out := c.eval(ev, now, signals)
		earned += clampFraction(out.fraction) * float64(c.weight)
		findings = append(findings, out.findings...)
	}

	sortFindings(findings)
	score := 0.0
	if totalWeight > 0 {
		score = clampScore(roundPct(earned / float64(totalWeight) * 100))
	}

	return Decision{
		RecoveryPointID: ev.RecoveryPointID,
		Kind:            decisionKind(score, findings),
		Score:           score,
		Findings:        findings,
		Reasons:         reasonsFromFindings(findings),
		EvaluatedAt:     now,
	}
}

func evalCleanRoom(ev RecoveryPointEvidence, _ time.Time, signals []Signal) controlOutcome {
	out := pass()
	switch ev.CleanRoomVerdict {
	case CleanRoomVerdictClean:
	case CleanRoomVerdictMalware:
		out = fail(finding("CP-CLEANROOM", SignalCleanRoomVerdict, SeverityCritical, "clean-room scan reported malware", ""))
	case CleanRoomVerdictIntegrityFailed:
		out = fail(finding("CP-CLEANROOM", SignalCleanRoomVerdict, SeverityCritical, "clean-room scan reported integrity failure", ""))
	case CleanRoomVerdictError:
		out = fail(finding("CP-CLEANROOM", SignalCleanRoomVerdict, SeverityHigh, "clean-room scan did not complete", ""))
	case "":
		out = fail(finding("CP-CLEANROOM", SignalCleanRoomVerdict, SeverityHigh, "clean-room verdict is missing", ""))
	default:
		out = fail(finding("CP-CLEANROOM", SignalCleanRoomVerdict, SeverityHigh, "clean-room verdict is not trusted: "+string(ev.CleanRoomVerdict), ""))
	}
	return mergeSignals(out, "CP-CLEANROOM", signals, SignalCleanRoomVerdict)
}

func evalMalware(ev RecoveryPointEvidence, _ time.Time, signals []Signal) controlOutcome {
	out := pass()
	if len(ev.MalwareFindings) > 0 {
		out = fail(finding("CP-MALWARE", SignalMalwareFinding, SeverityCritical, "malware findings present: "+joinSorted(ev.MalwareFindings), ""))
	}
	if ev.CleanRoomVerdict == CleanRoomVerdictMalware {
		out = fail(finding("CP-MALWARE", SignalMalwareFinding, SeverityCritical, "clean-room malware verdict blocks promotion", ""))
	}
	return mergeSignals(out, "CP-MALWARE", signals, SignalMalwareFinding)
}

func evalIntegrity(ev RecoveryPointEvidence, _ time.Time, signals []Signal) controlOutcome {
	out := pass()
	if ev.IntegrityMismatch {
		out = fail(finding("CP-INTEGRITY", SignalIntegrityMismatch, SeverityCritical, "recovery-point integrity mismatch reported", ""))
	}
	if ev.CleanRoomVerdict == CleanRoomVerdictIntegrityFailed {
		out = fail(finding("CP-INTEGRITY", SignalIntegrityMismatch, SeverityCritical, "clean-room integrity verdict blocks promotion", ""))
	}
	return mergeSignals(out, "CP-INTEGRITY", signals, SignalIntegrityMismatch)
}

func evalRansomware(ev RecoveryPointEvidence, _ time.Time, signals []Signal) controlOutcome {
	out := pass()
	if ev.RansomwareSuspected {
		out = fail(finding("CP-RANSOMWARE", SignalRansomwareSuspicion, SeverityCritical, "ransomware suspicion reported for recovery point", ""))
	}
	if ev.EntropyAnomaly {
		out = partial(out, finding("CP-RANSOMWARE", SignalEntropyAnomaly, SeverityWarning, "entropy anomaly observed near recovery point", ""))
	}
	if ev.DeleteRateAnomaly {
		out = partial(out, finding("CP-RANSOMWARE", SignalDeleteRateAnomaly, SeverityWarning, "delete-rate anomaly observed near recovery point", ""))
	}
	return mergeSignals(out, "CP-RANSOMWARE", signals, SignalRansomwareSuspicion, SignalEntropyAnomaly, SignalDeleteRateAnomaly)
}

func evalAppVerification(ev RecoveryPointEvidence, _ time.Time, signals []Signal) controlOutcome {
	out := pass()
	switch ev.AppVerificationVerdict {
	case AppVerificationPassed:
	case AppVerificationFailed:
		out = fail(finding("CP-APPVERIFY", SignalAppVerification, SeverityHigh, "application verification failed", ""))
	case AppVerificationError:
		out = fail(finding("CP-APPVERIFY", SignalAppVerification, SeverityHigh, "application verification did not complete", ""))
	case AppVerificationSkipped:
		out = partial(out, finding("CP-APPVERIFY", SignalAppVerification, SeverityWarning, "application verification was skipped", ""))
	case "":
		out = fail(finding("CP-APPVERIFY", SignalAppVerification, SeverityHigh, "application verification evidence is missing", ""))
	default:
		out = fail(finding("CP-APPVERIFY", SignalAppVerification, SeverityHigh, "application verification verdict is not trusted: "+string(ev.AppVerificationVerdict), ""))
	}
	return mergeSignals(out, "CP-APPVERIFY", signals, SignalAppVerification)
}

func evalAttestation(ev RecoveryPointEvidence, now time.Time, signals []Signal) controlOutcome {
	out := pass()
	maxAge := defaultMaxAttestationAge
	if ev.MaxAttestationAgeSeconds > 0 {
		maxAge = time.Duration(ev.MaxAttestationAgeSeconds) * time.Second
	}

	switch {
	case !ev.AttestationVerified && ev.AttestedAt.IsZero():
		out = fail(finding("CP-ATTESTATION", SignalAttestationFreshness, SeverityHigh, "verified attestation evidence is missing", ""))
	case !ev.AttestationVerified:
		out = fail(finding("CP-ATTESTATION", SignalAttestationFreshness, SeverityHigh, "attestation is present but not verified", ""))
	case ev.AttestedAt.IsZero():
		out = fail(finding("CP-ATTESTATION", SignalAttestationFreshness, SeverityHigh, "attestation timestamp is missing", ""))
	default:
		age := now.Sub(ev.AttestedAt.UTC())
		switch {
		case age < 0:
			out = partial(out, finding("CP-ATTESTATION", SignalAttestationFreshness, SeverityWarning, "attestation timestamp is in the future", ""))
		case age <= maxAge:
		case age <= 2*maxAge:
			out = partial(out, finding("CP-ATTESTATION", SignalAttestationFreshness, SeverityWarning, "attestation is stale", ""))
		default:
			out = fail(finding("CP-ATTESTATION", SignalAttestationFreshness, SeverityHigh, "attestation is too stale to trust", ""))
		}
	}

	return mergeSignals(out, "CP-ATTESTATION", signals, SignalAttestationFreshness)
}

func evalSeal(ev RecoveryPointEvidence, now time.Time, signals []Signal) controlOutcome {
	out := pass()
	if !ev.Sealed {
		out = fail(finding("CP-SEAL", SignalImmutabilitySeal, SeverityHigh, "recovery point is not sealed", ""))
	}
	if !ev.SealVerified {
		out = failOrAppend(out, finding("CP-SEAL", SignalImmutabilitySeal, SeverityHigh, "recovery-point seal is not verified", ""))
	}
	if !ev.Immutable {
		out = failOrAppend(out, finding("CP-SEAL", SignalImmutabilitySeal, SeverityHigh, "recovery point is not immutable", ""))
	}
	if !ev.RetentionUntil.IsZero() && !ev.RetentionUntil.UTC().After(now) {
		out = failOrAppend(out, finding("CP-SEAL", SignalImmutabilitySeal, SeverityHigh, "immutable retention has expired", ""))
	}
	return mergeSignals(out, "CP-SEAL", signals, SignalImmutabilitySeal)
}

func evalRPO(ev RecoveryPointEvidence, now time.Time, signals []Signal) controlOutcome {
	out := pass()
	if ev.CreatedAt.IsZero() {
		out = partial(out, finding("CP-RPO", SignalRPOAge, SeverityWarning, "recovery-point creation time is missing", ""))
	}
	if ev.RPOObjectiveSeconds <= 0 {
		out = partial(out, finding("CP-RPO", SignalRPOAge, SeverityWarning, "RPO objective is missing", ""))
	}
	if !ev.CreatedAt.IsZero() && ev.RPOObjectiveSeconds > 0 {
		objective := time.Duration(ev.RPOObjectiveSeconds) * time.Second
		age := now.Sub(ev.CreatedAt.UTC())
		switch {
		case age < 0:
			out = partial(out, finding("CP-RPO", SignalRPOAge, SeverityWarning, "recovery-point creation time is in the future", ""))
		case age <= objective:
		case age <= 2*objective:
			out = partial(out, finding("CP-RPO", SignalRPOAge, SeverityWarning, "recovery-point age exceeds RPO objective", ""))
		default:
			out = fail(finding("CP-RPO", SignalRPOAge, SeverityHigh, "recovery-point age is far beyond RPO objective", ""))
		}
	}
	return mergeSignals(out, "CP-RPO", signals, SignalRPOAge)
}

func pass() controlOutcome {
	return controlOutcome{fraction: 1}
}

func fail(f Finding) controlOutcome {
	return controlOutcome{fraction: 0, findings: []Finding{f}}
}

func partial(out controlOutcome, f Finding) controlOutcome {
	if out.fraction > 0.5 {
		out.fraction = 0.5
	}
	out.findings = append(out.findings, f)
	return out
}

func failOrAppend(out controlOutcome, f Finding) controlOutcome {
	out.fraction = 0
	out.findings = append(out.findings, f)
	return out
}

func mergeSignals(out controlOutcome, code string, signals []Signal, kinds ...SignalKind) controlOutcome {
	for _, s := range signals {
		if !signalKindIn(s.Kind, kinds) {
			continue
		}
		f := findingFromSignal(code, s)
		switch f.Severity {
		case SeverityCritical, SeverityHigh:
			out = failOrAppend(out, f)
		case SeverityWarning:
			out = partial(out, f)
		default:
			out.findings = append(out.findings, f)
		}
	}
	return out
}

func finding(code string, kind SignalKind, severity SignalSeverity, message, evidenceRef string) Finding {
	return Finding{
		Code:        code,
		Kind:        kind,
		Severity:    normalizeSeverity(severity),
		Message:     message,
		EvidenceRef: evidenceRef,
	}
}

func findingFromSignal(code string, s Signal) Finding {
	message := strings.TrimSpace(s.Message)
	if message == "" {
		message = "signal reported"
	}
	if strings.TrimSpace(s.Code) != "" {
		message = strings.TrimSpace(s.Code) + ": " + message
	}
	return Finding{
		Code:        code,
		Kind:        s.Kind,
		Severity:    normalizeSeverity(s.Severity),
		Message:     message,
		EvidenceRef: s.EvidenceRef,
		ObservedAt:  s.ObservedAt.UTC(),
	}
}

func sortedSignals(in []Signal) []Signal {
	out := make([]Signal, len(in))
	copy(out, in)
	sort.SliceStable(out, func(i, j int) bool {
		return signalLess(out[i], out[j])
	})
	return out
}

func signalLess(a, b Signal) bool {
	if signalKindRank(a.Kind) != signalKindRank(b.Kind) {
		return signalKindRank(a.Kind) < signalKindRank(b.Kind)
	}
	if severityRank(normalizeSeverity(a.Severity)) != severityRank(normalizeSeverity(b.Severity)) {
		return severityRank(normalizeSeverity(a.Severity)) > severityRank(normalizeSeverity(b.Severity))
	}
	if a.Code != b.Code {
		return a.Code < b.Code
	}
	if a.Message != b.Message {
		return a.Message < b.Message
	}
	if a.Source != b.Source {
		return a.Source < b.Source
	}
	if a.EvidenceRef != b.EvidenceRef {
		return a.EvidenceRef < b.EvidenceRef
	}
	return a.ObservedAt.Before(b.ObservedAt)
}

func sortFindings(findings []Finding) {
	sort.SliceStable(findings, func(i, j int) bool {
		a, b := findings[i], findings[j]
		if controlRank(a.Code) != controlRank(b.Code) {
			return controlRank(a.Code) < controlRank(b.Code)
		}
		if signalKindRank(a.Kind) != signalKindRank(b.Kind) {
			return signalKindRank(a.Kind) < signalKindRank(b.Kind)
		}
		if severityRank(a.Severity) != severityRank(b.Severity) {
			return severityRank(a.Severity) > severityRank(b.Severity)
		}
		if a.Message != b.Message {
			return a.Message < b.Message
		}
		if a.EvidenceRef != b.EvidenceRef {
			return a.EvidenceRef < b.EvidenceRef
		}
		return a.ObservedAt.Before(b.ObservedAt)
	})
}

func decisionKind(score float64, findings []Finding) DecisionKind {
	hasWarning := false
	for _, f := range findings {
		switch normalizeSeverity(f.Severity) {
		case SeverityCritical:
			return DecisionQuarantine
		case SeverityHigh:
			return DecisionRetest
		case SeverityWarning:
			hasWarning = true
		}
	}
	if score < retestScoreThreshold {
		return DecisionRetest
	}
	if hasWarning || score < 100 {
		return DecisionPromoteWithWarnings
	}
	return DecisionPromote
}

func reasonsFromFindings(findings []Finding) []Reason {
	if len(findings) == 0 {
		return nil
	}
	reasons := make([]Reason, 0, len(findings))
	for _, f := range findings {
		reasons = append(reasons, Reason{
			Code:     f.Code,
			Kind:     f.Kind,
			Severity: normalizeSeverity(f.Severity),
			Message:  f.Message,
		})
	}
	return reasons
}

func normalizeSeverity(severity SignalSeverity) SignalSeverity {
	switch severity {
	case SeverityInfo, SeverityWarning, SeverityHigh, SeverityCritical:
		return severity
	default:
		return SeverityWarning
	}
}

func signalKindIn(kind SignalKind, kinds []SignalKind) bool {
	for _, k := range kinds {
		if kind == k {
			return true
		}
	}
	return false
}

func joinSorted(values []string) string {
	out := make([]string, 0, len(values))
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v != "" {
			out = append(out, v)
		}
	}
	sort.Strings(out)
	return strings.Join(out, ", ")
}

func controlRank(code string) int {
	for i, c := range controls {
		if c.code == code {
			return i
		}
	}
	return len(controls)
}

func signalKindRank(kind SignalKind) int {
	switch kind {
	case SignalCleanRoomVerdict:
		return 0
	case SignalMalwareFinding:
		return 1
	case SignalIntegrityMismatch:
		return 2
	case SignalRansomwareSuspicion:
		return 3
	case SignalEntropyAnomaly:
		return 4
	case SignalDeleteRateAnomaly:
		return 5
	case SignalAppVerification:
		return 6
	case SignalAttestationFreshness:
		return 7
	case SignalImmutabilitySeal:
		return 8
	case SignalRPOAge:
		return 9
	default:
		return 100
	}
}

func severityRank(severity SignalSeverity) int {
	switch normalizeSeverity(severity) {
	case SeverityCritical:
		return 4
	case SeverityHigh:
		return 3
	case SeverityWarning:
		return 2
	case SeverityInfo:
		return 1
	default:
		return 0
	}
}

func clampFraction(v float64) float64 {
	switch {
	case v < 0:
		return 0
	case v > 1:
		return 1
	default:
		return v
	}
}

func clampScore(v float64) float64 {
	switch {
	case v < 0:
		return 0
	case v > 100:
		return 100
	default:
		return v
	}
}

func roundPct(v float64) float64 {
	return math.Round(v*100) / 100
}
