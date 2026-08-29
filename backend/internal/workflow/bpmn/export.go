package bpmn

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"sort"
	"strings"

	"github.com/clario360/platform/internal/workflow/model"
)

// Export serializes a WorkflowDefinition into a BPMN 2.0 XML document.
//
// Mapping (see the Conformance matrix for the authoritative table):
//   - a synthesized <startEvent> is emitted for the definition's entry step, so
//     the process has a proper BPMN start node even though Clario has no explicit
//     "start" step type;
//   - each Clario step maps to its native BPMN flow node;
//   - each model.Transition maps to a <sequenceFlow>, carrying its guard on a
//     <conditionExpression> when present;
//   - each model.BoundaryEvent maps to a <boundaryEvent attachedToRef=...> with
//     an outgoing <sequenceFlow> to its handler step;
//   - the FULL Clario payload (step config, boundary config, transition guards,
//     and definition-level trigger/variable metadata) is embedded verbatim as a
//     JSON island in <extensionElements> so an import reconstructs it losslessly.
//
// The result is well-formed, namespaced BPMN 2.0 XML with an <?xml?> header.
func Export(def *model.WorkflowDefinition) ([]byte, error) {
	if def == nil {
		return nil, fmt.Errorf("bpmn export: definition is nil")
	}

	doc := &exportDoc{
		XmlnsBPMN:       nsBPMN,
		XmlnsClario:     nsClario,
		ID:              "def_" + sanitizeID(def.DefinitionKey, def.ID),
		TargetNamespace: nsClario,
		Exporter:        exporterName,
		ExporterVersion: exporterVersion,
	}

	proc := &exportProcess{
		ID:           "process_" + sanitizeID(def.DefinitionKey, def.ID),
		Name:         def.Name,
		IsExecutable: true,
	}

	// Definition-level Clario metadata island.
	metaJSON, err := marshalProcessMeta(def)
	if err != nil {
		return nil, err
	}
	proc.Extension = &exportExtension{Node: &exportClarioNode{Kind: "process", JSON: metaJSON}}

	// Reject unsupported step types up front (fail-closed on export too, so we
	// never emit a document we could not read back).
	for i := range def.Steps {
		st := def.Steps[i].Type
		if SupportFor(st) == SupportUnsupported {
			return nil, fmt.Errorf("bpmn export: step %q has unsupported type %q", def.Steps[i].ID, st)
		}
	}

	// Determine the entry step (the target of no transition and no boundary
	// handler). If none is unambiguous, fall back to the first step; the
	// synthesized start event points at it.
	entry := entryStepID(def.Steps)
	if entry != "" {
		startID := "start_event"
		proc.StartEvents = append(proc.StartEvents, exportStartEvent{ID: startID, Name: "Start"})
		proc.SequenceFlows = append(proc.SequenceFlows, exportSequenceFlow{
			ID:        "flow_start_" + entry,
			SourceRef: startID,
			TargetRef: entry,
		})
	}

	// Emit each step as its BPMN flow node + its transitions/boundary flows.
	for i := range def.Steps {
		step := def.Steps[i]
		if err := emitStep(proc, &step); err != nil {
			return nil, err
		}
	}

	doc.Process = proc

	out, err := xml.MarshalIndent(doc, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("bpmn export: marshalling XML: %w", err)
	}
	return append([]byte(xml.Header), append(out, '\n')...), nil
}

// emitStep appends the BPMN flow node for one Clario step (plus its outgoing
// sequence flows and any boundary events) to the process.
func emitStep(proc *exportProcess, step *model.StepDefinition) error {
	nodeJSON, err := marshalStepPayload(step)
	if err != nil {
		return err
	}
	ext := &exportExtension{Node: &exportClarioNode{Kind: "step", JSON: nodeJSON}}

	switch step.Type {
	case model.StepTypeEnd:
		proc.EndEvents = append(proc.EndEvents, exportEndEvent{ID: step.ID, Name: step.Name, Extension: ext})
	case model.StepTypeHumanTask:
		proc.UserTasks = append(proc.UserTasks, exportTask{XMLName: xml.Name{Local: "bpmn:userTask"}, ID: step.ID, Name: step.Name, Extension: ext})
	case model.StepTypeServiceTask:
		proc.ServiceTasks = append(proc.ServiceTasks, exportTask{XMLName: xml.Name{Local: "bpmn:serviceTask"}, ID: step.ID, Name: step.Name, Extension: ext})
	case model.StepTypeApprovalChain, model.StepTypeConnectorTask:
		// No native BPMN peer: emit as a serviceTask flagged with the exact Clario
		// step type so it round-trips precisely. (The clario island already holds
		// step.Type; the flag attribute makes the intent visible to foreign tools.)
		t := exportTask{XMLName: xml.Name{Local: "bpmn:serviceTask"}, ID: step.ID, Name: step.Name, Extension: ext}
		t.Implementation = step.Type
		proc.ServiceTasks = append(proc.ServiceTasks, t)
	case model.StepTypeDecisionTask:
		proc.BusinessRuleTasks = append(proc.BusinessRuleTasks, exportTask{XMLName: xml.Name{Local: "bpmn:businessRuleTask"}, ID: step.ID, Name: step.Name, Extension: ext})
	case model.StepTypeCallActivity:
		called := configStr(step.Config, "definition_key")
		proc.CallActivities = append(proc.CallActivities, exportCallActivity{ID: step.ID, Name: step.Name, CalledElement: called, Extension: ext})
	case model.StepTypeMultiInstance:
		// A callActivity carrying the multi-instance loop marker.
		called := configStr(step.Config, "definition_key")
		ca := exportCallActivity{ID: step.ID, Name: step.Name, CalledElement: called, Extension: ext}
		ca.Loop = &exportMILoop{IsSequential: false}
		proc.CallActivities = append(proc.CallActivities, ca)
	case model.StepTypeCondition:
		proc.ExclusiveGateways = append(proc.ExclusiveGateways, exportGateway{XMLName: xml.Name{Local: "bpmn:exclusiveGateway"}, ID: step.ID, Name: step.Name, Extension: ext})
	case model.StepTypeParallelGateway:
		proc.ParallelGateways = append(proc.ParallelGateways, exportGateway{XMLName: xml.Name{Local: "bpmn:parallelGateway"}, ID: step.ID, Name: step.Name, Extension: ext})
	case model.StepTypeEventGateway:
		proc.EventBasedGateways = append(proc.EventBasedGateways, exportGateway{XMLName: xml.Name{Local: "bpmn:eventBasedGateway"}, ID: step.ID, Name: step.Name, Extension: ext})
	case model.StepTypeTimer:
		ev := exportIntermediateCatch{ID: step.ID, Name: step.Name, Extension: ext, Timer: &exportTimerDef{}}
		proc.IntermediateCatchEvents = append(proc.IntermediateCatchEvents, ev)
	case model.StepTypeEventTask:
		// PUBLISH -> throw, WAIT -> catch. Default (unspecified) to catch.
		mode := strings.ToUpper(configStr(step.Config, "mode"))
		if mode == "PUBLISH" {
			proc.IntermediateThrowEvents = append(proc.IntermediateThrowEvents, exportIntermediateThrow{ID: step.ID, Name: step.Name, Extension: ext, Message: &exportMessageDef{}})
		} else {
			proc.IntermediateCatchEvents = append(proc.IntermediateCatchEvents, exportIntermediateCatch{ID: step.ID, Name: step.Name, Extension: ext, Message: &exportMessageDef{}})
		}
	default:
		return fmt.Errorf("bpmn export: step %q has unmappable type %q", step.ID, step.Type)
	}

	// Outgoing transitions -> sequence flows.
	for ti, t := range step.Transitions {
		if t.Target == "" {
			continue
		}
		flow := exportSequenceFlow{
			ID:        fmt.Sprintf("flow_%s_%d", step.ID, ti),
			SourceRef: step.ID,
			TargetRef: t.Target,
		}
		if strings.TrimSpace(t.Condition) != "" {
			flow.Condition = &exportCondition{Type: "bpmn:tFormalExpression", Body: t.Condition}
		}
		proc.SequenceFlows = append(proc.SequenceFlows, flow)
	}

	// Boundary events attached to this step.
	for _, be := range step.BoundaryEvents {
		boundaryJSON, berr := marshalBoundaryPayload(step.ID, &be)
		if berr != nil {
			return berr
		}
		bext := &exportExtension{Node: &exportClarioNode{Kind: "boundary", JSON: boundaryJSON}}
		bev := exportBoundaryEvent{
			ID:             "boundary_" + step.ID + "_" + be.ID,
			Name:           be.Type,
			AttachedToRef:  step.ID,
			CancelActivity: true,
			Extension:      bext,
		}
		switch be.Type {
		case model.BoundaryEventTypeTimer:
			bev.Timer = &exportTimerDef{}
		case model.BoundaryEventTypeMessage:
			bev.Message = &exportMessageDef{}
		case model.BoundaryEventTypeError:
			bev.Error = &exportErrorDef{}
		default:
			return fmt.Errorf("bpmn export: step %q boundary %q has unsupported type %q", step.ID, be.ID, be.Type)
		}
		proc.BoundaryEvents = append(proc.BoundaryEvents, bev)
		// A boundary routes to its handler step via an outgoing sequence flow.
		if be.HandlerStepID != "" {
			proc.SequenceFlows = append(proc.SequenceFlows, exportSequenceFlow{
				ID:        "flow_" + bev.ID + "_" + be.HandlerStepID,
				SourceRef: bev.ID,
				TargetRef: be.HandlerStepID,
			})
		}
	}
	return nil
}

// entryStepID returns the id of the single step that is not the target of any
// transition or boundary handler (the process entry). If zero or more than one
// candidate exists it returns the first step's id as a deterministic fallback.
func entryStepID(steps []model.StepDefinition) string {
	if len(steps) == 0 {
		return ""
	}
	targeted := make(map[string]bool)
	for _, s := range steps {
		for _, t := range s.Transitions {
			if t.Target != "" {
				targeted[t.Target] = true
			}
		}
		for _, be := range s.BoundaryEvents {
			if be.HandlerStepID != "" {
				targeted[be.HandlerStepID] = true
			}
		}
	}
	var candidates []string
	for _, s := range steps {
		if !targeted[s.ID] {
			candidates = append(candidates, s.ID)
		}
	}
	sort.Strings(candidates)
	if len(candidates) == 1 {
		return candidates[0]
	}
	return steps[0].ID
}

// ---- payload marshalling ----

func marshalProcessMeta(def *model.WorkflowDefinition) (string, error) {
	meta := clarioProcessMeta{
		Name:          def.Name,
		Description:   def.Description,
		Category:      def.Category,
		DefinitionKey: def.DefinitionKey,
		Version:       def.Version,
		Status:        def.Status,
		TriggerConfig: triggerConfigJSON{
			Type:             def.TriggerConfig.Type,
			Topic:            def.TriggerConfig.Topic,
			Filter:           def.TriggerConfig.Filter,
			Cron:             def.TriggerConfig.Cron,
			DedupeKeyFields:  def.TriggerConfig.DedupeKeyFields,
			DedupeTTLSeconds: def.TriggerConfig.DedupeTTLSeconds,
		},
	}
	if len(def.Variables) > 0 {
		meta.Variables = make(map[string]variableJSON, len(def.Variables))
		for k, v := range def.Variables {
			meta.Variables[k] = variableJSON{Type: v.Type, Source: v.Source, Default: v.Default}
		}
	}
	b, err := json.Marshal(meta)
	if err != nil {
		return "", fmt.Errorf("bpmn export: marshalling process metadata: %w", err)
	}
	return string(b), nil
}

func marshalStepPayload(step *model.StepDefinition) (string, error) {
	p := clarioStepPayload{
		ID:     step.ID,
		Type:   step.Type,
		Name:   step.Name,
		Config: step.Config,
	}
	for _, t := range step.Transitions {
		p.Transitions = append(p.Transitions, transitionJSON{Condition: t.Condition, Target: t.Target})
	}
	for _, be := range step.BoundaryEvents {
		p.BoundaryEvents = append(p.BoundaryEvents, boundaryEventJSON{
			ID: be.ID, Type: be.Type, HandlerStepID: be.HandlerStepID, Config: be.Config,
		})
	}
	b, err := json.Marshal(p)
	if err != nil {
		return "", fmt.Errorf("bpmn export: marshalling step %q payload: %w", step.ID, err)
	}
	return string(b), nil
}

func marshalBoundaryPayload(stepID string, be *model.BoundaryEvent) (string, error) {
	b, err := json.Marshal(boundaryEventJSON{
		ID: be.ID, Type: be.Type, HandlerStepID: be.HandlerStepID, Config: be.Config,
	})
	if err != nil {
		return "", fmt.Errorf("bpmn export: marshalling boundary %q on step %q: %w", be.ID, stepID, err)
	}
	return string(b), nil
}

// configStr reads a string value from a config map (empty if absent/non-string).
func configStr(cfg map[string]interface{}, key string) string {
	if cfg == nil {
		return ""
	}
	if v, ok := cfg[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// sanitizeID builds a safe XML NCName-ish id from the first non-empty of the
// provided candidates, replacing characters BPMN ids should avoid.
func sanitizeID(candidates ...string) string {
	val := ""
	for _, c := range candidates {
		if strings.TrimSpace(c) != "" {
			val = c
			break
		}
	}
	if val == "" {
		val = "workflow"
	}
	var b strings.Builder
	for _, r := range val {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	return b.String()
}
