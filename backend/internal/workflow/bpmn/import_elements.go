package bpmn

import "encoding/xml"

// The raw* structs are the permissive IMPORT model. encoding/xml matches child
// elements to fields by local name regardless of namespace prefix, so these
// parse both Clario-exported documents (bpmn:/clario: prefixes) and foreign
// documents using other prefixes for the same BPMN namespace. Any child of
// <process> NOT captured by a named field lands in Unknown via the `,any`
// collector, which the importer inspects to fail closed on unsupported/
// unrecognized constructs (it never silently drops a node).

type rawDefinitions struct {
	XMLName xml.Name    `xml:"definitions"`
	Process *rawProcess `xml:"process"`
}

type rawProcess struct {
	ID        string        `xml:"id,attr"`
	Name      string        `xml:"name,attr"`
	Extension *rawExtension `xml:"extensionElements"`

	StartEvents             []rawSimpleNode    `xml:"startEvent"`
	EndEvents               []rawSimpleNode    `xml:"endEvent"`
	UserTasks               []rawTask          `xml:"userTask"`
	ServiceTasks            []rawTask          `xml:"serviceTask"`
	BusinessRuleTasks       []rawTask          `xml:"businessRuleTask"`
	CallActivities          []rawCallActivity  `xml:"callActivity"`
	ExclusiveGateways       []rawGateway       `xml:"exclusiveGateway"`
	ParallelGateways        []rawGateway       `xml:"parallelGateway"`
	EventBasedGateways      []rawGateway       `xml:"eventBasedGateway"`
	IntermediateCatchEvents []rawEvent         `xml:"intermediateCatchEvent"`
	IntermediateThrowEvents []rawEvent         `xml:"intermediateThrowEvent"`
	BoundaryEvents          []rawBoundaryEvent `xml:"boundaryEvent"`
	SequenceFlows           []rawSequenceFlow  `xml:"sequenceFlow"`

	// Unknown captures every OTHER child element of the process (unsupported or
	// unrecognized flow nodes) so the importer can fail closed on them.
	Unknown []rawUnknown `xml:",any"`
}

// rawExtension is <extensionElements>. It captures the Clario island (a child
// whose local name is "node") regardless of namespace prefix.
type rawExtension struct {
	Node *rawClarioNode `xml:"node"`
}

type rawClarioNode struct {
	Kind string `xml:"kind,attr"`
	// JSON is the CDATA/chardata payload.
	JSON string `xml:",chardata"`
}

type rawSimpleNode struct {
	ID        string        `xml:"id,attr"`
	Name      string        `xml:"name,attr"`
	Extension *rawExtension `xml:"extensionElements"`
}

type rawTask struct {
	ID   string `xml:"id,attr"`
	Name string `xml:"name,attr"`
	// StepTypeFlag captures clario:stepType (matched by local name "stepType").
	StepTypeFlag string        `xml:"stepType,attr"`
	Extension    *rawExtension `xml:"extensionElements"`
}

type rawCallActivity struct {
	ID            string        `xml:"id,attr"`
	Name          string        `xml:"name,attr"`
	CalledElement string        `xml:"calledElement,attr"`
	Extension     *rawExtension `xml:"extensionElements"`
	Loop          *rawMILoop    `xml:"multiInstanceLoopCharacteristics"`
}

type rawMILoop struct {
	IsSequential bool `xml:"isSequential,attr"`
}

type rawGateway struct {
	ID        string        `xml:"id,attr"`
	Name      string        `xml:"name,attr"`
	Extension *rawExtension `xml:"extensionElements"`
}

type rawEvent struct {
	ID        string        `xml:"id,attr"`
	Name      string        `xml:"name,attr"`
	Extension *rawExtension `xml:"extensionElements"`
	Timer     *rawEventDef  `xml:"timerEventDefinition"`
	Message   *rawEventDef  `xml:"messageEventDefinition"`
	Error     *rawEventDef  `xml:"errorEventDefinition"`
}

type rawBoundaryEvent struct {
	ID            string        `xml:"id,attr"`
	Name          string        `xml:"name,attr"`
	AttachedToRef string        `xml:"attachedToRef,attr"`
	Extension     *rawExtension `xml:"extensionElements"`
	Timer         *rawEventDef  `xml:"timerEventDefinition"`
	Message       *rawEventDef  `xml:"messageEventDefinition"`
	Error         *rawEventDef  `xml:"errorEventDefinition"`
}

type rawEventDef struct{}

type rawSequenceFlow struct {
	ID        string        `xml:"id,attr"`
	Name      string        `xml:"name,attr"`
	SourceRef string        `xml:"sourceRef,attr"`
	TargetRef string        `xml:"targetRef,attr"`
	Condition *rawCondition `xml:"conditionExpression"`
}

type rawCondition struct {
	Body string `xml:",chardata"`
}

// rawUnknown captures the name + id of an unrecognized child element.
type rawUnknown struct {
	XMLName xml.Name
	ID      string `xml:"id,attr"`
}
