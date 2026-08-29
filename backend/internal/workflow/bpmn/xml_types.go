package bpmn

// Namespaces used by the codec. The bpmn: prefix is the OMG BPMN 2.0 model
// namespace; clario: is our private extension namespace carried inside
// <bpmn:extensionElements> so a Clario definition round-trips losslessly while
// the document stays a valid BPMN 2.0 file for foreign tools.
const (
	nsBPMN   = "http://www.omg.org/spec/BPMN/20100524/MODEL"
	nsClario = "https://clario360.com/spec/workflow/1.0"
)

// exporterName / exporterVersion identify the producing tool in the
// <definitions exporter=...> attributes, as most BPMN tools do.
const (
	exporterName    = "Clario360 Workflow Engine"
	exporterVersion = "1.0"
)

// clarioProcessMeta is the definition-level metadata carried in the process
// extensionElements JSON island so nothing outside the flow graph is lost on a
// round-trip: trigger config, variable definitions, version, status, category,
// description, and the definition key/name.
type clarioProcessMeta struct {
	Name          string                  `json:"name"`
	Description   string                  `json:"description,omitempty"`
	Category      string                  `json:"category,omitempty"`
	DefinitionKey string                  `json:"definition_key,omitempty"`
	Version       int                     `json:"version,omitempty"`
	Status        string                  `json:"status,omitempty"`
	TriggerConfig triggerConfigJSON       `json:"trigger_config"`
	Variables     map[string]variableJSON `json:"variables,omitempty"`
}

// triggerConfigJSON mirrors model.TriggerConfig for the extension payload. We
// use a local shape (rather than importing the model type directly into the XML)
// so the JSON island stays stable and independent of any future JSON tags on the
// model.
type triggerConfigJSON struct {
	Type             string                 `json:"type"`
	Topic            string                 `json:"topic,omitempty"`
	Filter           map[string]interface{} `json:"filter,omitempty"`
	Cron             string                 `json:"cron,omitempty"`
	DedupeKeyFields  []string               `json:"dedupe_key_fields,omitempty"`
	DedupeTTLSeconds int                    `json:"dedupe_ttl_seconds,omitempty"`
}

// variableJSON mirrors model.VariableDef.
type variableJSON struct {
	Type    string      `json:"type"`
	Source  string      `json:"source,omitempty"`
	Default interface{} `json:"default,omitempty"`
}

// clarioStepPayload is the lossless per-step Clario representation carried in a
// flow node's extensionElements JSON island. It captures EVERY field of
// model.StepDefinition (id/type/name/config/transitions/boundary events) so the
// importer can reconstruct the step byte-for-byte when the island is present.
type clarioStepPayload struct {
	ID             string                 `json:"id"`
	Type           string                 `json:"type"`
	Name           string                 `json:"name,omitempty"`
	Config         map[string]interface{} `json:"config,omitempty"`
	Transitions    []transitionJSON       `json:"transitions,omitempty"`
	BoundaryEvents []boundaryEventJSON    `json:"boundary_events,omitempty"`
}

// transitionJSON mirrors model.Transition.
type transitionJSON struct {
	Condition string `json:"condition,omitempty"`
	Target    string `json:"target"`
}

// boundaryEventJSON mirrors model.BoundaryEvent.
type boundaryEventJSON struct {
	ID            string                 `json:"id"`
	Type          string                 `json:"type"`
	HandlerStepID string                 `json:"handler_step_id"`
	Config        map[string]interface{} `json:"config,omitempty"`
}
