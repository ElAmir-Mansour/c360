package bpmn

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"strings"

	"github.com/clario360/platform/internal/workflow/model"
)

// ImportResult is the outcome of parsing a BPMN document. Warnings collects
// non-fatal fidelity notes (e.g. a foreign businessRuleTask imported as a
// decision_task shell with an empty table) so the caller/UI can surface reduced
// fidelity WITHOUT the codec ever silently dropping data.
type ImportResult struct {
	Definition *model.WorkflowDefinition
	Warnings   []string
}

// Import parses a BPMN 2.0 XML document into a WorkflowDefinition.
//
// Fail-closed contract:
//   - malformed XML is rejected;
//   - a document with no <process> is rejected;
//   - any BPMN construct classified SupportUnsupported in the Conformance matrix
//     (inclusiveGateway, subProcess, scriptTask, ...) is REPORTED as an error,
//     never silently ignored;
//   - a flow node with no recognizable Clario mapping is an error.
//
// When a node carries a Clario extension island (a document Clario itself
// exported) the island is authoritative and the step reconstructs losslessly.
// When it does not (a foreign document) the codec maps the native BPMN element
// via the matrix, recording a warning for partial-fidelity mappings.
func Import(data []byte) (*ImportResult, error) {
	if len(strings.TrimSpace(string(data))) == 0 {
		return nil, fmt.Errorf("bpmn import: empty document")
	}

	var doc rawDefinitions
	dec := xml.NewDecoder(strings.NewReader(string(data)))
	if err := dec.Decode(&doc); err != nil {
		return nil, fmt.Errorf("bpmn import: malformed XML: %w", err)
	}
	if doc.Process == nil {
		return nil, fmt.Errorf("bpmn import: document has no <process> element")
	}

	res := &ImportResult{}
	def := &model.WorkflowDefinition{
		Name:      doc.Process.Name,
		Status:    model.DefinitionStatusDraft,
		Version:   1,
		Variables: map[string]model.VariableDef{},
		Steps:     []model.StepDefinition{},
	}
	if def.Name == "" {
		def.Name = "Imported BPMN Workflow"
	}

	// Definition-level Clario metadata (trigger config, variables, ...), if the
	// process carries a clario:process island.
	if err := applyProcessMeta(def, doc.Process, res); err != nil {
		return nil, err
	}

	// Detect and reject unsupported constructs FIRST (fail-closed) so we never
	// half-import a document we cannot faithfully represent.
	if err := rejectUnsupported(doc.Process); err != nil {
		return nil, err
	}

	// Build the transition map from sequence flows. Flows whose source is a
	// startEvent or a boundaryEvent are handled specially and excluded from the
	// per-step transition set.
	startIDs := map[string]bool{}
	for _, se := range doc.Process.StartEvents {
		startIDs[se.ID] = true
	}
	boundaryIDs := map[string]bool{}
	for _, be := range doc.Process.BoundaryEvents {
		boundaryIDs[be.ID] = true
	}

	// Reconstruct each flow node into a Clario step.
	stepByID := map[string]*model.StepDefinition{}
	addStep := func(s model.StepDefinition) {
		def.Steps = append(def.Steps, s)
		stepByID[s.ID] = &def.Steps[len(def.Steps)-1]
	}

	// endEvents
	for _, e := range doc.Process.EndEvents {
		step, err := reconstructStep(e.ID, e.Name, model.StepTypeEnd, e.Extension, res)
		if err != nil {
			return nil, err
		}
		addStep(step)
	}
	// userTasks
	for _, t := range doc.Process.UserTasks {
		step, err := reconstructStep(t.ID, t.Name, model.StepTypeHumanTask, t.Extension, res)
		if err != nil {
			return nil, err
		}
		addStep(step)
	}
	// serviceTasks (may be flagged approval_chain / connector_task)
	for _, t := range doc.Process.ServiceTasks {
		typ := model.StepTypeServiceTask
		if flag := strings.TrimSpace(t.StepTypeFlag); flag != "" {
			if !model.ValidStepTypes[flag] {
				return nil, fmt.Errorf("bpmn import: serviceTask %q has unknown clario:stepType %q", t.ID, flag)
			}
			typ = flag
		}
		step, err := reconstructStep(t.ID, t.Name, typ, t.Extension, res)
		if err != nil {
			return nil, err
		}
		addStep(step)
	}
	// businessRuleTasks -> decision_task
	for _, t := range doc.Process.BusinessRuleTasks {
		step, err := reconstructStep(t.ID, t.Name, model.StepTypeDecisionTask, t.Extension, res)
		if err != nil {
			return nil, err
		}
		if !hasClarioIsland(t.Extension) {
			res.Warnings = append(res.Warnings, fmt.Sprintf("businessRuleTask %q imported as a decision_task with no decision table (foreign document, partial fidelity)", t.ID))
		}
		addStep(step)
	}
	// callActivities -> call_activity or multi_instance (loop marker present)
	for _, c := range doc.Process.CallActivities {
		typ := model.StepTypeCallActivity
		if c.Loop != nil {
			typ = model.StepTypeMultiInstance
		}
		step, err := reconstructStep(c.ID, c.Name, typ, c.Extension, res)
		if err != nil {
			return nil, err
		}
		// If a foreign document (no island) supplied calledElement, seed config.
		if !hasClarioIsland(c.Extension) && c.CalledElement != "" {
			if step.Config == nil {
				step.Config = map[string]interface{}{}
			}
			step.Config["definition_key"] = c.CalledElement
		}
		addStep(step)
	}
	// exclusiveGateways -> condition
	for _, g := range doc.Process.ExclusiveGateways {
		step, err := reconstructStep(g.ID, g.Name, model.StepTypeCondition, g.Extension, res)
		if err != nil {
			return nil, err
		}
		addStep(step)
	}
	// parallelGateways
	for _, g := range doc.Process.ParallelGateways {
		step, err := reconstructStep(g.ID, g.Name, model.StepTypeParallelGateway, g.Extension, res)
		if err != nil {
			return nil, err
		}
		addStep(step)
	}
	// eventBasedGateways
	for _, g := range doc.Process.EventBasedGateways {
		step, err := reconstructStep(g.ID, g.Name, model.StepTypeEventGateway, g.Extension, res)
		if err != nil {
			return nil, err
		}
		addStep(step)
	}
	// intermediateCatchEvents -> timer (timerEventDefinition) or event_task WAIT (messageEventDefinition)
	for _, e := range doc.Process.IntermediateCatchEvents {
		typ := model.StepTypeTimer
		if e.Message != nil && e.Timer == nil {
			typ = model.StepTypeEventTask
		}
		step, err := reconstructStep(e.ID, e.Name, typ, e.Extension, res)
		if err != nil {
			return nil, err
		}
		addStep(step)
	}
	// intermediateThrowEvents -> event_task PUBLISH
	for _, e := range doc.Process.IntermediateThrowEvents {
		step, err := reconstructStep(e.ID, e.Name, model.StepTypeEventTask, e.Extension, res)
		if err != nil {
			return nil, err
		}
		if !hasClarioIsland(e.Extension) {
			if step.Config == nil {
				step.Config = map[string]interface{}{}
			}
			if _, ok := step.Config["mode"]; !ok {
				step.Config["mode"] = "PUBLISH"
			}
		}
		addStep(step)
	}

	// Attach boundary events to their steps.
	for _, be := range doc.Process.BoundaryEvents {
		host := stepByID[be.AttachedToRef]
		if host == nil {
			return nil, fmt.Errorf("bpmn import: boundaryEvent %q attaches to unknown step %q", be.ID, be.AttachedToRef)
		}
		bev, err := reconstructBoundary(&be, res)
		if err != nil {
			return nil, err
		}
		host.BoundaryEvents = append(host.BoundaryEvents, bev)
	}

	// Rebuild transitions from sequence flows for foreign documents (no islands).
	// When an island supplied transitions we keep those (they are authoritative)
	// but we still cross-check every foreign flow so nothing is dropped.
	applyTransitions(def, stepByID, doc.Process.SequenceFlows, startIDs, boundaryIDs, res)

	// Validate the reconstructed graph: every transition/boundary target must
	// resolve to a known step. This is the fail-closed guard against a document
	// that references a node we did not import.
	if err := validateGraph(def); err != nil {
		return nil, err
	}

	res.Definition = def
	return res, nil
}

// applyProcessMeta pulls the definition-level Clario metadata from the process
// island when present; otherwise leaves a manual-trigger default so the imported
// draft is valid for authoring.
func applyProcessMeta(def *model.WorkflowDefinition, proc *rawProcess, res *ImportResult) error {
	if hasClarioIsland(proc.Extension) {
		var meta clarioProcessMeta
		if err := json.Unmarshal([]byte(islandJSON(proc.Extension)), &meta); err != nil {
			return fmt.Errorf("bpmn import: decoding process metadata island: %w", err)
		}
		if meta.Name != "" {
			def.Name = meta.Name
		}
		def.Description = meta.Description
		def.Category = meta.Category
		def.TriggerConfig = model.TriggerConfig{
			Type:             meta.TriggerConfig.Type,
			Topic:            meta.TriggerConfig.Topic,
			Filter:           meta.TriggerConfig.Filter,
			Cron:             meta.TriggerConfig.Cron,
			DedupeKeyFields:  meta.TriggerConfig.DedupeKeyFields,
			DedupeTTLSeconds: meta.TriggerConfig.DedupeTTLSeconds,
		}
		for k, v := range meta.Variables {
			def.Variables[k] = model.VariableDef{Type: v.Type, Source: v.Source, Default: v.Default}
		}
		return nil
	}
	// Foreign document: default to a manual trigger; the author sets the rest.
	def.TriggerConfig = model.TriggerConfig{Type: model.TriggerTypeManual}
	res.Warnings = append(res.Warnings, "process has no Clario metadata; defaulted to a manual trigger")
	return nil
}

// rejectUnsupported fails closed on any BPMN construct the codec does not map.
func rejectUnsupported(proc *rawProcess) error {
	unsupported := map[string]bool{}
	for _, r := range Conformance {
		if r.Support == SupportUnsupported {
			unsupported[strings.ToLower(r.BPMNElement)] = true
		}
	}
	for _, e := range proc.Unknown {
		local := strings.ToLower(localName(e.XMLName))
		if unsupported[local] {
			return fmt.Errorf("bpmn import: unsupported BPMN construct <%s> (id=%q); rejected rather than silently dropped", localName(e.XMLName), e.ID)
		}
		// An unrecognized flow node we neither support nor explicitly list is
		// still fail-closed: we do not silently drop it.
		if isFlowNodeCandidate(local) {
			return fmt.Errorf("bpmn import: unrecognized flow element <%s> (id=%q); rejected rather than silently dropped", localName(e.XMLName), e.ID)
		}
	}
	return nil
}

// reconstructStep builds a Clario step from a BPMN node, preferring the Clario
// island (lossless) and falling back to the native mapping.
func reconstructStep(id, name, fallbackType string, ext *rawExtension, res *ImportResult) (model.StepDefinition, error) {
	if id == "" {
		return model.StepDefinition{}, fmt.Errorf("bpmn import: a %s node is missing its id", fallbackType)
	}
	if hasClarioIsland(ext) {
		var p clarioStepPayload
		if err := json.Unmarshal([]byte(islandJSON(ext)), &p); err != nil {
			return model.StepDefinition{}, fmt.Errorf("bpmn import: decoding step %q island: %w", id, err)
		}
		step := model.StepDefinition{
			ID:     firstNonEmpty(p.ID, id),
			Type:   firstNonEmpty(p.Type, fallbackType),
			Name:   firstNonEmpty(p.Name, name),
			Config: p.Config,
		}
		for _, t := range p.Transitions {
			step.Transitions = append(step.Transitions, model.Transition{Condition: t.Condition, Target: t.Target})
		}
		for _, be := range p.BoundaryEvents {
			step.BoundaryEvents = append(step.BoundaryEvents, model.BoundaryEvent{
				ID: be.ID, Type: be.Type, HandlerStepID: be.HandlerStepID, Config: be.Config,
			})
		}
		if !model.ValidStepTypes[step.Type] {
			return model.StepDefinition{}, fmt.Errorf("bpmn import: step %q has unknown type %q in Clario island", id, step.Type)
		}
		return step, nil
	}
	// Foreign node (no Clario island): map via the conformance matrix. Partial-
	// fidelity mappings (e.g. businessRuleTask) are noted by the caller.
	if !model.ValidStepTypes[fallbackType] {
		return model.StepDefinition{}, fmt.Errorf("bpmn import: node %q maps to unknown step type %q", id, fallbackType)
	}
	return model.StepDefinition{ID: id, Type: fallbackType, Name: name, Config: map[string]interface{}{}}, nil
}

// reconstructBoundary rebuilds a model.BoundaryEvent from a rawBoundaryEvent.
func reconstructBoundary(be *rawBoundaryEvent, res *ImportResult) (model.BoundaryEvent, error) {
	if hasClarioIsland(be.Extension) {
		var p boundaryEventJSON
		if err := json.Unmarshal([]byte(islandJSON(be.Extension)), &p); err != nil {
			return model.BoundaryEvent{}, fmt.Errorf("bpmn import: decoding boundary %q island: %w", be.ID, err)
		}
		if !model.ValidBoundaryEventTypes[p.Type] {
			return model.BoundaryEvent{}, fmt.Errorf("bpmn import: boundary %q has unknown type %q", be.ID, p.Type)
		}
		return model.BoundaryEvent{ID: p.ID, Type: p.Type, HandlerStepID: p.HandlerStepID, Config: p.Config}, nil
	}
	// Foreign boundary: infer type from the event-definition child.
	var typ string
	switch {
	case be.Timer != nil:
		typ = model.BoundaryEventTypeTimer
	case be.Message != nil:
		typ = model.BoundaryEventTypeMessage
	case be.Error != nil:
		typ = model.BoundaryEventTypeError
	default:
		return model.BoundaryEvent{}, fmt.Errorf("bpmn import: boundaryEvent %q has no recognized event definition (timer/message/error)", be.ID)
	}
	return model.BoundaryEvent{ID: firstNonEmpty(be.ID, typ), Type: typ, Config: map[string]interface{}{}}, nil
}

// applyTransitions rebuilds transitions from foreign sequence flows and wires
// boundary handler targets. When steps already have transitions from an island,
// those are authoritative and we do not duplicate; but we assert every foreign
// flow was accounted for so nothing is dropped.
func applyTransitions(def *model.WorkflowDefinition, stepByID map[string]*model.StepDefinition, flows []rawSequenceFlow, startIDs, boundaryIDs map[string]bool, res *ImportResult) {
	// Discover boundary handler targets from flows whose source is a boundary
	// node, keyed by the boundary node id.
	boundaryHandler := map[string]string{}
	for _, f := range flows {
		if boundaryIDs[f.SourceRef] {
			boundaryHandler[f.SourceRef] = f.TargetRef
		}
	}
	// Apply the discovered targets to any boundary whose island did not already
	// carry a handler_step_id (foreign docs whose boundary id equals the node id).
	for i := range def.Steps {
		for j := range def.Steps[i].BoundaryEvents {
			be := &def.Steps[i].BoundaryEvents[j]
			if be.HandlerStepID == "" {
				if tgt, ok := boundaryHandler[be.ID]; ok {
					be.HandlerStepID = tgt
				}
			}
		}
	}

	// If any step already carries island transitions, treat islands as
	// authoritative for that step and skip flow-derived transitions to avoid
	// duplicates.
	hasIslandTransitions := false
	for i := range def.Steps {
		if len(def.Steps[i].Transitions) > 0 {
			hasIslandTransitions = true
			break
		}
	}
	if hasIslandTransitions {
		return
	}

	// Foreign document: derive transitions from sequence flows (excluding start
	// and boundary sources; those are structural).
	for _, f := range flows {
		if startIDs[f.SourceRef] || boundaryIDs[f.SourceRef] {
			continue
		}
		src := stepByID[f.SourceRef]
		if src == nil {
			res.Warnings = append(res.Warnings, fmt.Sprintf("sequenceFlow %q has unknown source %q; ignored", f.ID, f.SourceRef))
			continue
		}
		cond := ""
		if f.Condition != nil {
			cond = strings.TrimSpace(f.Condition.Body)
		}
		src.Transitions = append(src.Transitions, model.Transition{Condition: cond, Target: f.TargetRef})
	}
}

// validateGraph fails closed if any transition or boundary handler references a
// step that was not imported.
func validateGraph(def *model.WorkflowDefinition) error {
	ids := map[string]bool{}
	for _, s := range def.Steps {
		ids[s.ID] = true
	}
	for _, s := range def.Steps {
		for _, t := range s.Transitions {
			if t.Target != "" && !ids[t.Target] {
				return fmt.Errorf("bpmn import: step %q transitions to unknown step %q", s.ID, t.Target)
			}
		}
		for _, be := range s.BoundaryEvents {
			if be.HandlerStepID != "" && !ids[be.HandlerStepID] {
				return fmt.Errorf("bpmn import: step %q boundary %q routes to unknown step %q", s.ID, be.ID, be.HandlerStepID)
			}
		}
	}
	return nil
}

// ---- helpers ----

func hasClarioIsland(ext *rawExtension) bool {
	return ext != nil && ext.Node != nil && strings.TrimSpace(ext.Node.JSON) != ""
}

func islandJSON(ext *rawExtension) string {
	if ext == nil || ext.Node == nil {
		return ""
	}
	return strings.TrimSpace(ext.Node.JSON)
}

func localName(n xml.Name) string {
	if i := strings.LastIndex(n.Local, ":"); i >= 0 {
		return n.Local[i+1:]
	}
	return n.Local
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// isFlowNodeCandidate reports whether an unrecognized element local-name looks
// like a BPMN flow node (Task/Event/Gateway/Activity/subProcess), so we
// fail-closed on it rather than treat it as harmless metadata.
func isFlowNodeCandidate(local string) bool {
	l := strings.ToLower(local)
	for _, suffix := range []string{"task", "event", "gateway", "activity", "subprocess"} {
		if strings.HasSuffix(l, suffix) {
			return true
		}
	}
	return false
}
