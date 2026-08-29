// Package bpmn is a SELF-CONTAINED BPMN 2.0 XML import/export codec for Clario
// WorkflowDefinition documents. It is a pure translation layer: it depends only
// on internal/workflow/model and the Go standard library, and it makes NO change
// to the engine, the executors, the persisted schema, or any existing step type.
//
// The codec answers the "BPMN 2.0" RFP line two ways at once:
//
//  1. INTEROP — a Clario definition serializes to a syntactically valid BPMN 2.0
//     document (namespaced elements, an <bpmn:process> with flow nodes and
//     <bpmn:sequenceFlow> edges) that another BPMN-aware tool can parse. Each
//     Clario step type maps to its closest native BPMN flow node (see the
//     Conformance matrix), and gateway conditions ride on
//     <bpmn:conditionExpression> as BPMN expects.
//
//  2. LOSSLESS ROUND-TRIP — Clario carries strictly more information per node
//     than plain BPMN attributes can hold (an arbitrary Config map, boundary
//     events, transition conditions, trigger/variable metadata). To guarantee an
//     export→import round-trip reconstructs a SEMANTICALLY EQUIVALENT definition,
//     the codec also embeds the full Clario payload for every node inside a
//     <bpmn:extensionElements><clario:...> island. On import, when that island is
//     present it is authoritative (nothing is dropped); when it is absent (a
//     document authored by a foreign tool) the codec reconstructs from the native
//     BPMN element via the matrix and FAILS CLOSED on any construct it does not
//     understand — it never silently discards a node or edge.
package bpmn

import "github.com/clario360/platform/internal/workflow/model"

// Support classifies how faithfully a BPMN element / Clario step pairing is
// handled by the codec, so the coverage is explicit for an RFP reviewer.
type Support string

const (
	// SupportFull means the element round-trips with full fidelity in BOTH
	// directions using only native BPMN attributes plus the Clario extension
	// island; a foreign document using this element imports cleanly.
	SupportFull Support = "full"
	// SupportPartial means the element round-trips losslessly WITHIN Clario (via
	// the extension island) but a foreign document that only supplies the native
	// BPMN element imports with reduced fidelity — the Clario-specific config
	// (e.g. a DMN table, a connector binding) cannot be reconstructed from BPMN
	// attributes alone and is left empty for the author to fill in.
	SupportPartial Support = "partial"
	// SupportUnsupported means the codec neither emits nor accepts the construct;
	// encountering it on import is REPORTED as an error (fail-closed), never
	// silently dropped.
	SupportUnsupported Support = "unsupported"
)

// ConformanceRow is one row of the BPMN <-> Clario mapping table.
type ConformanceRow struct {
	// BPMNElement is the local name of the BPMN 2.0 element (without namespace
	// prefix), e.g. "userTask", "exclusiveGateway".
	BPMNElement string `json:"bpmn_element"`
	// ClarioStepType is the model step-type constant this element maps to, or ""
	// for structural elements (process, sequenceFlow) and unsupported constructs.
	ClarioStepType string `json:"clario_step_type,omitempty"`
	// Support is the fidelity classification for this pairing.
	Support Support `json:"support"`
	// Notes explains the mapping and any partial/unsupported caveats.
	Notes string `json:"notes"`
}

// Conformance is the documented, RFP-facing mapping matrix between BPMN 2.0
// elements and Clario step types. It is the SINGLE SOURCE OF TRUTH the exporter
// and importer are tested against: every supported Clario step type has exactly
// one row whose ClarioStepType is set, and every element the importer accepts has
// a row here. It is exported as a Go table (and rendered to a doc string via
// ConformanceMarkdown) so the coverage claim is verifiable, not asserted.
var Conformance = []ConformanceRow{
	// ---- structural ----
	{BPMNElement: "definitions", Support: SupportFull, Notes: "Document root. Namespaced bpmn:/clario:; targetNamespace carries the Clario definition key."},
	{BPMNElement: "process", Support: SupportFull, Notes: "One <process> per WorkflowDefinition. id=definition_key, name=definition name; trigger/variables/version carried in process-level extensionElements."},
	{BPMNElement: "sequenceFlow", Support: SupportFull, Notes: "One per model.Transition. sourceRef/targetRef map step ids; a guarded transition carries its Clario expression on <conditionExpression> AND (verbatim) in the clario extension."},

	// ---- events ----
	{BPMNElement: "startEvent", ClarioStepType: "start", Support: SupportFull, Notes: "Clario has no explicit 'start' step type; the codec synthesizes a startEvent from the definition's entry step and vice-versa (see start/end handling)."},
	{BPMNElement: "endEvent", ClarioStepType: model.StepTypeEnd, Support: SupportFull, Notes: "end <-> endEvent."},
	{BPMNElement: "intermediateCatchEvent", ClarioStepType: model.StepTypeTimer, Support: SupportFull, Notes: "timer step -> intermediateCatchEvent with <timerEventDefinition>; event_task WAIT -> intermediateCatchEvent with <messageEventDefinition>. The mode (timer vs message) is disambiguated on import by the event-definition child and the clario extension."},
	{BPMNElement: "intermediateThrowEvent", ClarioStepType: model.StepTypeEventTask, Support: SupportFull, Notes: "event_task PUBLISH -> intermediateThrowEvent with <messageEventDefinition>."},
	{BPMNElement: "boundaryEvent", Support: SupportFull, Notes: "model.BoundaryEvent (timer|error|message) -> <boundaryEvent attachedToRef=step> with the matching event-definition child; cancelActivity=true (interrupting). handler_step_id becomes the boundary's outgoing sequenceFlow target."},

	// ---- tasks / activities ----
	{BPMNElement: "userTask", ClarioStepType: model.StepTypeHumanTask, Support: SupportFull, Notes: "human_task <-> userTask."},
	{BPMNElement: "serviceTask", ClarioStepType: model.StepTypeServiceTask, Support: SupportFull, Notes: "service_task <-> serviceTask. HTTP binding (service/method/url/body/headers) preserved in the clario extension."},
	{BPMNElement: "businessRuleTask", ClarioStepType: model.StepTypeDecisionTask, Support: SupportPartial, Notes: "decision_task <-> businessRuleTask. The DMN table + hit policy round-trip via the clario extension; a foreign businessRuleTask imports as a decision_task shell with an empty table (partial)."},
	{BPMNElement: "callActivity", ClarioStepType: model.StepTypeCallActivity, Support: SupportFull, Notes: "call_activity <-> callActivity. calledElement=child definition_key; input/output mappings preserved in the clario extension."},
	{BPMNElement: "approvalChain(serviceTask)", ClarioStepType: model.StepTypeApprovalChain, Support: SupportFull, Notes: "approval_chain has no native BPMN peer; emitted as a serviceTask flagged clario:stepType=approval_chain so it round-trips exactly. A foreign serviceTask without the flag imports as service_task."},
	{BPMNElement: "connectorTask(serviceTask)", ClarioStepType: model.StepTypeConnectorTask, Support: SupportFull, Notes: "connector_task emitted as a serviceTask flagged clario:stepType=connector_task with clario:connectorType; round-trips exactly within Clario."},

	// ---- multi-instance marker ----
	{BPMNElement: "multiInstanceLoopCharacteristics", ClarioStepType: model.StepTypeMultiInstance, Support: SupportFull, Notes: "multi_instance -> a callActivity (or task) carrying <multiInstanceLoopCharacteristics isSequential=false>; the collection expression + completion policy round-trip via the clario extension."},

	// ---- gateways ----
	{BPMNElement: "exclusiveGateway", ClarioStepType: model.StepTypeCondition, Support: SupportFull, Notes: "condition -> exclusiveGateway; the branch expressions ride on the outgoing sequenceFlows' <conditionExpression>."},
	{BPMNElement: "parallelGateway", ClarioStepType: model.StepTypeParallelGateway, Support: SupportFull, Notes: "parallel_gateway <-> parallelGateway (fork/join). The branch layout round-trips via the clario extension."},
	{BPMNElement: "eventBasedGateway", ClarioStepType: model.StepTypeEventGateway, Support: SupportFull, Notes: "event_based_gateway <-> eventBasedGateway; the racing timer/message arms round-trip via the clario extension (each arm's target is also a sequenceFlow)."},

	// ---- explicitly unsupported (reported, never silently dropped) ----
	{BPMNElement: "inclusiveGateway", Support: SupportUnsupported, Notes: "OR-gateway (inclusive) has no Clario peer; import is rejected with a clear error rather than approximated as exclusive."},
	{BPMNElement: "complexGateway", Support: SupportUnsupported, Notes: "No Clario peer; import rejected."},
	{BPMNElement: "subProcess", Support: SupportUnsupported, Notes: "Embedded (inline) sub-process is not supported; use callActivity (call_activity) for composition. Import rejected."},
	{BPMNElement: "transaction", Support: SupportUnsupported, Notes: "BPMN transaction sub-process is not supported; import rejected."},
	{BPMNElement: "adHocSubProcess", Support: SupportUnsupported, Notes: "Ad-hoc sub-process is not supported; import rejected."},
	{BPMNElement: "manualTask", Support: SupportUnsupported, Notes: "manualTask has no engine semantics in Clario; import rejected (author should use userTask/human_task)."},
	{BPMNElement: "scriptTask", Support: SupportUnsupported, Notes: "Inline script execution is not supported (governance: no arbitrary code); import rejected."},
	{BPMNElement: "sendTask", Support: SupportUnsupported, Notes: "Not supported as a distinct element; use intermediateThrowEvent (event_task PUBLISH). Import rejected."},
	{BPMNElement: "receiveTask", Support: SupportUnsupported, Notes: "Not supported as a distinct element; use intermediateCatchEvent (event_task WAIT). Import rejected."},
}

// clarioStepToBPMN maps a Clario step type to the BPMN element the exporter
// emits for it. Types with no native peer (approval_chain, connector_task) are
// emitted as a serviceTask carrying a clario:stepType flag; multi_instance is
// handled specially (a task with a loop-characteristics marker), so it is not in
// this table.
var clarioStepToBPMN = map[string]string{
	model.StepTypeEnd:             "endEvent",
	model.StepTypeTimer:           "intermediateCatchEvent",
	model.StepTypeEventTask:       "intermediateEvent", // catch vs throw resolved from config mode at emit time
	model.StepTypeHumanTask:       "userTask",
	model.StepTypeServiceTask:     "serviceTask",
	model.StepTypeDecisionTask:    "businessRuleTask",
	model.StepTypeCallActivity:    "callActivity",
	model.StepTypeApprovalChain:   "serviceTask",
	model.StepTypeConnectorTask:   "serviceTask",
	model.StepTypeCondition:       "exclusiveGateway",
	model.StepTypeParallelGateway: "parallelGateway",
	model.StepTypeEventGateway:    "eventBasedGateway",
}

// SupportFor returns the conformance support level for a Clario step type,
// defaulting to SupportUnsupported for an unknown type.
func SupportFor(stepType string) Support {
	for _, row := range Conformance {
		if row.ClarioStepType == stepType {
			return row.Support
		}
	}
	if _, ok := clarioStepToBPMN[stepType]; ok {
		return SupportFull
	}
	return SupportUnsupported
}

// ConformanceMarkdown renders the matrix as a short Markdown table suitable for
// dropping into RFP documentation. It is derived from the same Conformance table
// the codec is tested against, so the doc can never drift from the code.
func ConformanceMarkdown() string {
	b := &markdownBuilder{}
	b.line("| BPMN 2.0 element | Clario step type | Support | Notes |")
	b.line("|---|---|---|---|")
	for _, r := range Conformance {
		st := r.ClarioStepType
		if st == "" {
			st = "-"
		}
		b.line("| `" + r.BPMNElement + "` | `" + st + "` | " + string(r.Support) + " | " + r.Notes + " |")
	}
	return b.String()
}

type markdownBuilder struct{ lines []string }

func (b *markdownBuilder) line(s string) { b.lines = append(b.lines, s) }
func (b *markdownBuilder) String() string {
	out := ""
	for i, l := range b.lines {
		if i > 0 {
			out += "\n"
		}
		out += l
	}
	return out
}
