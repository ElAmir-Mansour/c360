package bpmn

import "encoding/xml"

// The export element structs below are marshalled by encoding/xml. Field ORDER
// matters: encoding/xml emits child elements in struct-field order, so within a
// process we group flow nodes by type (start, end, tasks, gateways, events,
// boundary events) followed by sequence flows. A BPMN process does not mandate a
// specific child ordering, so this is valid; every node still references others
// only by id via sequenceFlow, so grouping does not change semantics.

// exportDoc is the <bpmn:definitions> root for export.
type exportDoc struct {
	XMLName         xml.Name       `xml:"bpmn:definitions"`
	XmlnsBPMN       string         `xml:"xmlns:bpmn,attr"`
	XmlnsClario     string         `xml:"xmlns:clario,attr"`
	ID              string         `xml:"id,attr"`
	TargetNamespace string         `xml:"targetNamespace,attr"`
	Exporter        string         `xml:"exporter,attr,omitempty"`
	ExporterVersion string         `xml:"exporterVersion,attr,omitempty"`
	Process         *exportProcess `xml:"bpmn:process"`
}

// exportProcess is <bpmn:process>.
type exportProcess struct {
	ID           string           `xml:"id,attr"`
	Name         string           `xml:"name,attr,omitempty"`
	IsExecutable bool             `xml:"isExecutable,attr"`
	Extension    *exportExtension `xml:"bpmn:extensionElements,omitempty"`

	StartEvents             []exportStartEvent        `xml:"bpmn:startEvent"`
	EndEvents               []exportEndEvent          `xml:"bpmn:endEvent"`
	UserTasks               []exportTask              `xml:"bpmn:userTask"`
	ServiceTasks            []exportTask              `xml:"bpmn:serviceTask"`
	BusinessRuleTasks       []exportTask              `xml:"bpmn:businessRuleTask"`
	CallActivities          []exportCallActivity      `xml:"bpmn:callActivity"`
	ExclusiveGateways       []exportGateway           `xml:"bpmn:exclusiveGateway"`
	ParallelGateways        []exportGateway           `xml:"bpmn:parallelGateway"`
	EventBasedGateways      []exportGateway           `xml:"bpmn:eventBasedGateway"`
	IntermediateCatchEvents []exportIntermediateCatch `xml:"bpmn:intermediateCatchEvent"`
	IntermediateThrowEvents []exportIntermediateThrow `xml:"bpmn:intermediateThrowEvent"`
	BoundaryEvents          []exportBoundaryEvent     `xml:"bpmn:boundaryEvent"`
	SequenceFlows           []exportSequenceFlow      `xml:"bpmn:sequenceFlow"`
}

// exportExtension is <bpmn:extensionElements> wrapping the Clario island.
type exportExtension struct {
	Node *exportClarioNode `xml:"clario:node"`
}

// exportClarioNode is <clario:node> carrying the lossless JSON payload in CDATA.
type exportClarioNode struct {
	Kind string `xml:"kind,attr"`
	JSON string `xml:",cdata"`
}

type exportStartEvent struct {
	ID   string `xml:"id,attr"`
	Name string `xml:"name,attr,omitempty"`
}

type exportEndEvent struct {
	ID        string           `xml:"id,attr"`
	Name      string           `xml:"name,attr,omitempty"`
	Extension *exportExtension `xml:"bpmn:extensionElements,omitempty"`
}

// exportTask covers userTask / serviceTask / businessRuleTask. The concrete
// element name is set via XMLName by the caller. Implementation carries the
// clario step-type flag for approval_chain / connector_task (emitted as
// serviceTask) so a reader can see the intent without parsing the JSON island.
type exportTask struct {
	XMLName        xml.Name
	ID             string           `xml:"id,attr"`
	Name           string           `xml:"name,attr,omitempty"`
	Implementation string           `xml:"clario:stepType,attr,omitempty"`
	Extension      *exportExtension `xml:"bpmn:extensionElements,omitempty"`
}

type exportCallActivity struct {
	ID            string           `xml:"id,attr"`
	Name          string           `xml:"name,attr,omitempty"`
	CalledElement string           `xml:"calledElement,attr,omitempty"`
	Extension     *exportExtension `xml:"bpmn:extensionElements,omitempty"`
	Loop          *exportMILoop    `xml:"bpmn:multiInstanceLoopCharacteristics,omitempty"`
}

// exportMILoop is the <multiInstanceLoopCharacteristics> marker.
type exportMILoop struct {
	IsSequential bool `xml:"isSequential,attr"`
}

// exportGateway covers exclusive / parallel / event-based gateways.
type exportGateway struct {
	XMLName   xml.Name
	ID        string           `xml:"id,attr"`
	Name      string           `xml:"name,attr,omitempty"`
	Extension *exportExtension `xml:"bpmn:extensionElements,omitempty"`
}

type exportIntermediateCatch struct {
	ID        string            `xml:"id,attr"`
	Name      string            `xml:"name,attr,omitempty"`
	Extension *exportExtension  `xml:"bpmn:extensionElements,omitempty"`
	Timer     *exportTimerDef   `xml:"bpmn:timerEventDefinition,omitempty"`
	Message   *exportMessageDef `xml:"bpmn:messageEventDefinition,omitempty"`
}

type exportIntermediateThrow struct {
	ID        string            `xml:"id,attr"`
	Name      string            `xml:"name,attr,omitempty"`
	Extension *exportExtension  `xml:"bpmn:extensionElements,omitempty"`
	Message   *exportMessageDef `xml:"bpmn:messageEventDefinition,omitempty"`
}

type exportBoundaryEvent struct {
	ID             string            `xml:"id,attr"`
	Name           string            `xml:"name,attr,omitempty"`
	AttachedToRef  string            `xml:"attachedToRef,attr"`
	CancelActivity bool              `xml:"cancelActivity,attr"`
	Extension      *exportExtension  `xml:"bpmn:extensionElements,omitempty"`
	Timer          *exportTimerDef   `xml:"bpmn:timerEventDefinition,omitempty"`
	Message        *exportMessageDef `xml:"bpmn:messageEventDefinition,omitempty"`
	Error          *exportErrorDef   `xml:"bpmn:errorEventDefinition,omitempty"`
}

type exportTimerDef struct{}
type exportMessageDef struct{}
type exportErrorDef struct{}

type exportSequenceFlow struct {
	ID        string           `xml:"id,attr"`
	Name      string           `xml:"name,attr,omitempty"`
	SourceRef string           `xml:"sourceRef,attr"`
	TargetRef string           `xml:"targetRef,attr"`
	Condition *exportCondition `xml:"bpmn:conditionExpression,omitempty"`
}

// exportCondition is <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">.
type exportCondition struct {
	Type string `xml:"type,attr,omitempty"`
	Body string `xml:",chardata"`
}
