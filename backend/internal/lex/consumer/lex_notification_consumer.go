package consumer

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
)

// notifier is the write seam the consumer drives (satisfied by
// *service.LexNotificationService). Declared as an interface so the consumer is
// testable without a live DB.
type notifier interface {
	Notify(ctx context.Context, tenantID uuid.UUID, in service.NotifyInput) (bool, error)
}

// LexNotificationConsumer subscribes to the lex CloudEvents stream and projects
// request/case/judgment lifecycle events into durable in-app inbox rows (+ email
// fan-out) (CAP-158..161, CAP-164). It is the lex-side trigger router: it writes
// rows through LexNotificationService rather than coupling to the platform
// notification-service RuleEngine. Idempotency is the inbox dedup_key (one row
// per event/recipient), so redelivery is safe. Contract-expiry (CAP-163) is
// emitted by ExpiryMonitor and projected here from com.clario360.lex.contract.*.
type LexNotificationConsumer struct {
	notifier notifier
	consumer *events.Consumer
	logger   zerolog.Logger
}

func NewLexNotificationConsumer(notifier notifier, consumer *events.Consumer, logger zerolog.Logger) *LexNotificationConsumer {
	handler := &LexNotificationConsumer{
		notifier: notifier,
		consumer: consumer,
		logger:   logger.With().Str("component", "lex-notification-consumer").Logger(),
	}
	if consumer != nil {
		consumer.Subscribe(events.Topics.LexEvents, handler)
	}
	return handler
}

func (c *LexNotificationConsumer) Start(ctx context.Context) error {
	if c.consumer == nil {
		return nil
	}
	return c.consumer.Start(ctx)
}

func (c *LexNotificationConsumer) Stop() error {
	if c.consumer == nil {
		return nil
	}
	return c.consumer.Stop()
}

// Handle routes one lex event. Unknown types are ignored (other consumers may
// own them). Errors are returned so the consumer framework can retry.
func (c *LexNotificationConsumer) Handle(ctx context.Context, event *events.Event) error {
	if c.notifier == nil || event == nil {
		return nil
	}
	tenantID, ok := parseEventTenant(event)
	if !ok {
		return nil
	}
	eventID := parseEventID(event.ID)

	switch event.Type {
	// CAP-158 request receipt.
	case "com.clario360.lex.request.created", "com.clario360.lex.request.submitted":
		return c.handleRequestReceived(ctx, tenantID, eventID, event)
	// CAP-160 additional information requested / request edited.
	case "com.clario360.lex.request.updated":
		return c.handleRequestUpdated(ctx, tenantID, eventID, event)
	// CAP-161 status update.
	case "com.clario360.lex.request.status_changed":
		return c.handleRequestStatusChanged(ctx, tenantID, eventID, event)
	// CAP-159 (PRD 13.0 "transferring a request"): request routed/transferred into a
	// handling department. Alerts the newly assigned handler (or the requester whose
	// request moved into handling).
	case "com.clario360.lex.request.routed":
		return c.handleRequestRouted(ctx, tenantID, eventID, event)
	// CAP-159 transfer / assignment.
	case "com.clario360.lex.case.transferred_to_section_manager":
		return c.handleCaseAssignment(ctx, tenantID, eventID, event, "section_manager_id")
	case "com.clario360.lex.case.officer_assigned":
		return c.handleCaseAssignment(ctx, tenantID, eventID, event, "handling_officer_id")
	case "com.clario360.lex.case.supervisor_assigned":
		return c.handleCaseAssignment(ctx, tenantID, eventID, event, "supervisor_id")
	// CAP-161 case status update.
	case "com.clario360.lex.case.status_changed":
		return c.handleCaseStatusChanged(ctx, tenantID, eventID, event)
	// CAP-164 judgment / decision issuance.
	case "com.clario360.lex.judgment.recorded", "com.clario360.lex.judgment.studied":
		return c.handleJudgment(ctx, tenantID, eventID, event)
	// #19 Case-timeline realtime: relay matter timeline / external-hold / delay /
	// deadline lifecycle events into the inbox so the notification-service WS push
	// reaches a live viewer. Routed to the matter owner (event payload owner_user_id)
	// falling back to the event actor; in-app only.
	case "com.clario360.lex.matter.timeline_updated",
		"com.clario360.lex.matter.external_hold_set",
		"com.clario360.lex.matter.external_hold_cleared",
		"com.clario360.lex.matter.delay_recorded",
		"com.clario360.lex.matter.delay_resolved",
		"com.clario360.lex.matter.delay_updated",
		"com.clario360.lex.matter.delay_reopened",
		"com.clario360.lex.matter.deadline_obligation_created":
		return c.handleMatterTimeline(ctx, tenantID, eventID, event)
	// #10 Matter-comment collaboration: notify mentioned users on @mention and the
	// matter owner (lightweight watcher) on a new comment. One event carries one
	// recipient so each lands in exactly that user's inbox.
	case "com.clario360.lex.matters.comment_mention":
		return c.handleMatterCommentMention(ctx, tenantID, eventID, event)
	case "com.clario360.lex.matters.comment_created":
		return c.handleMatterCommentCreated(ctx, tenantID, eventID, event)
	// PRD 9.1 contract review-desk receipt: acknowledge the requester by an in-app
	// row + email when their contract is received at, and acknowledged by, the legal
	// review desk. Recipient is the contract requester (owner), carried on the event
	// as requester_user_id.
	case "com.clario360.lex.contract_review_desk.intake_opened":
		return c.handleContractIntakeReceipt(ctx, tenantID, eventID, event, false)
	case "com.clario360.lex.contract_review_desk.intake_acknowledged":
		return c.handleContractIntakeReceipt(ctx, tenantID, eventID, event, true)
	// CAP-163 contract expiry (emitted by ExpiryMonitor; inbox projection only).
	case "com.clario360.lex.contract.expiring", "com.clario360.lex.contract.expired":
		return c.handleContractExpiry(ctx, tenantID, eventID, event)
	// CAP-162 SLA alerts.
	case "com.clario360.lex.sla.ack_overdue", "com.clario360.lex.sla.breached", "com.clario360.lex.sla.escalated":
		return c.handleSLAAlert(ctx, tenantID, eventID, event)
	// Internal peer-support notifications. Expiry is deliberately silent: its
	// validity window is benign cleanup, not an SLA breach.
	case "com.clario360.lex.support_request.created":
		return c.handleSupportRequest(ctx, tenantID, eventID, event, true)
	case "com.clario360.lex.support_request.accepted", "com.clario360.lex.support_request.resolved":
		return c.handleSupportRequest(ctx, tenantID, eventID, event, false)
	// The manager-approval gate. Without these three the gate is silent: the
	// approver is never told a request waits on them, so every gated request
	// stalls until they happen to open the inbox. `.approved` addresses the
	// REQUESTER only -- the colleague learns of the request from `.created`,
	// which the service emits at routing time (i.e. at approval for a gated
	// request), so notifying them here too would double-send.
	case "com.clario360.lex.support_request.submitted_for_approval",
		"com.clario360.lex.support_request.approved",
		"com.clario360.lex.support_request.rejected":
		return c.handleSupportApproval(ctx, tenantID, eventID, event)
	default:
		return nil
	}
}

func (c *LexNotificationConsumer) handleSupportRequest(ctx context.Context, tenantID uuid.UUID, eventID *uuid.UUID, event *events.Event, incoming bool) error {
	payload := decodePayload(event.Data)
	recipientKey := "requester_id"
	actionURL := "/lex/inbox?view=sent"
	title := forms.LocalizedText{EN: "Support request updated", AR: "تم تحديث طلب الدعم"}
	body := forms.LocalizedText{EN: "Your support request was updated.", AR: "تم تحديث طلب الدعم الخاص بك."}
	if incoming {
		recipientKey = "assignee_id"
		actionURL = "/lex/inbox?view=incoming"
		title = forms.LocalizedText{EN: "New support request", AR: "طلب دعم جديد"}
		body = forms.LocalizedText{EN: "A legal colleague asked you for support.", AR: "طلب منك زميل قانوني تقديم الدعم."}
	} else if event.Type == "com.clario360.lex.support_request.accepted" {
		title = forms.LocalizedText{EN: "Support request accepted", AR: "تم قبول طلب الدعم"}
		body = forms.LocalizedText{EN: "Your colleague accepted your support request.", AR: "قبل زميلك طلب الدعم الخاص بك."}
	} else if event.Type == "com.clario360.lex.support_request.resolved" {
		actionURL = "/lex/inbox?view=history"
		title = forms.LocalizedText{EN: "Support request resolved", AR: "تم إنجاز طلب الدعم"}
		body = forms.LocalizedText{EN: "Your colleague marked your support request as resolved.", AR: "وضع زميلك علامة منجز على طلب الدعم الخاص بك."}
	}
	recipient := payloadUUIDValue(payload, recipientKey)
	if recipient == uuid.Nil {
		return nil
	}
	entityID := payloadUUID(payload, "id")
	return c.notify(ctx, tenantID, recipient, service.NotifyInput{
		Category: model.NotificationCategoryGeneral, Title: title, Body: body,
		EntityType: "support_request", EntityID: entityID, ActionURL: actionURL,
		EventID: eventID, DedupKey: dedupKey("support."+payloadString(payload, "status"), event.ID, recipient),
		Email: false,
		Metadata: map[string]any{
			"subject":          payloadString(payload, "subject"),
			"status":           payloadString(payload, "status"),
			"target_entity_id": payloadString(payload, "target_entity_id"),
		},
	})
}

// handleSupportApproval delivers the manager-approval leg of the support
// lifecycle. It is kept separate from handleSupportRequest because the recipient
// is derived from a different field per event (the approver for the request that
// awaits them, the requester for the verdict on theirs) rather than from a single
// incoming/outgoing flag.
//
// An auto-cleared request (auto_no_manager / auto_self) never reaches here: the
// service routes it straight to open without emitting submitted_for_approval, so
// nobody is told to approve something no person was asked to approve.
func (c *LexNotificationConsumer) handleSupportApproval(ctx context.Context, tenantID uuid.UUID, eventID *uuid.UUID, event *events.Event) error {
	payload := decodePayload(event.Data)
	var (
		recipientKey string
		actionURL    string
		title        forms.LocalizedText
		body         forms.LocalizedText
	)
	switch event.Type {
	case "com.clario360.lex.support_request.submitted_for_approval":
		recipientKey, actionURL = "approver_user_id", "/lex/inbox?view=incoming"
		title = forms.LocalizedText{EN: "Support request awaiting your approval", AR: "طلب دعم بانتظار اعتمادك"}
		body = forms.LocalizedText{
			EN: "A team member asked for support and needs your approval before it is routed.",
			AR: "طلب أحد أعضاء الفريق الدعم ويحتاج إلى اعتمادك قبل توجيهه.",
		}
	case "com.clario360.lex.support_request.approved":
		recipientKey, actionURL = "requester_id", "/lex/inbox?view=sent"
		title = forms.LocalizedText{EN: "Support request approved", AR: "تم اعتماد طلب الدعم"}
		body = forms.LocalizedText{
			EN: "Your support request was approved and routed to your colleague.",
			AR: "تم اعتماد طلب الدعم الخاص بك وتوجيهه إلى زميلك.",
		}
	case "com.clario360.lex.support_request.rejected":
		recipientKey, actionURL = "requester_id", "/lex/inbox?view=history"
		title = forms.LocalizedText{EN: "Support request not approved", AR: "لم يتم اعتماد طلب الدعم"}
		body = forms.LocalizedText{
			EN: "Your support request was not approved and was not routed.",
			AR: "لم يتم اعتماد طلب الدعم الخاص بك ولم يتم توجيهه.",
		}
		// The rejection reason is the only actionable content the requester
		// gets, so it travels in the body rather than being buried in metadata.
		if note := payloadString(payload, "approval_note"); note != "" {
			body = forms.LocalizedText{EN: "Not approved: " + note, AR: "لم يتم الاعتماد: " + note}
		}
	default:
		return nil
	}
	recipient := payloadUUIDValue(payload, recipientKey)
	if recipient == uuid.Nil {
		return nil
	}
	entityID := payloadUUID(payload, "id")
	return c.notify(ctx, tenantID, recipient, service.NotifyInput{
		Category: model.NotificationCategoryGeneral, Title: title, Body: body,
		EntityType: "support_request", EntityID: entityID, ActionURL: actionURL,
		EventID: eventID, DedupKey: dedupKey("support.approval."+event.Type, event.ID, recipient),
		Email: false,
		Metadata: map[string]any{
			"subject":          payloadString(payload, "subject"),
			"status":           payloadString(payload, "status"),
			"approval_route":   payloadString(payload, "approval_route"),
			"approval_note":    payloadString(payload, "approval_note"),
			"target_entity_id": payloadString(payload, "target_entity_id"),
		},
	})
}

func (c *LexNotificationConsumer) handleRequestReceived(ctx context.Context, tenantID uuid.UUID, eventID *uuid.UUID, event *events.Event) error {
	payload := decodePayload(event.Data)
	recipient := requestRecipient(event, payload)
	if recipient == uuid.Nil {
		return nil
	}
	entityID := payloadUUID(payload, "id")
	return c.notify(ctx, tenantID, recipient, service.NotifyInput{
		Category:   model.NotificationCategoryRequest,
		Title:      forms.LocalizedText{EN: "Request received", AR: "تم استلام الطلب"},
		Body:       requestBody(payload, "Your legal request has been received.", "تم استلام طلبك القانوني."),
		EntityType: "legal_request",
		EntityID:   entityID,
		ActionURL:  requestActionURL(entityID),
		EventID:    eventID,
		DedupKey:   dedupKey("request.received", event.ID, recipient),
		Email:      true,
		Metadata:   requestMetadata(payload),
	})
}

func (c *LexNotificationConsumer) handleRequestUpdated(ctx context.Context, tenantID uuid.UUID, eventID *uuid.UUID, event *events.Event) error {
	payload := decodePayload(event.Data)
	recipient := requestRecipient(event, payload)
	if recipient == uuid.Nil {
		return nil
	}
	entityID := payloadUUID(payload, "id")
	return c.notify(ctx, tenantID, recipient, service.NotifyInput{
		Category:   model.NotificationCategoryRequest,
		Title:      forms.LocalizedText{EN: "Additional information requested", AR: "مطلوب معلومات إضافية"},
		Body:       requestBody(payload, "Your legal request was updated and may require additional information.", "تم تحديث طلبك القانوني وقد يتطلب معلومات إضافية."),
		EntityType: "legal_request",
		EntityID:   entityID,
		ActionURL:  requestActionURL(entityID),
		EventID:    eventID,
		DedupKey:   dedupKey("request.updated", event.ID, recipient),
		Email:      true,
		Metadata:   requestMetadata(payload),
	})
}

func (c *LexNotificationConsumer) handleRequestStatusChanged(ctx context.Context, tenantID uuid.UUID, eventID *uuid.UUID, event *events.Event) error {
	payload := decodePayload(event.Data)
	recipient := requestRecipient(event, payload)
	if recipient == uuid.Nil {
		return nil
	}
	entityID := payloadUUID(payload, "id")
	status := payloadString(payload, "status")
	bodyEN := "The status of your legal request has changed."
	bodyAR := "تم تغيير حالة طلبك القانوني."
	if status != "" {
		bodyEN = fmt.Sprintf("The status of your legal request changed to %q.", status)
	}
	return c.notify(ctx, tenantID, recipient, service.NotifyInput{
		Category:   model.NotificationCategoryRequest,
		Title:      forms.LocalizedText{EN: "Request status updated", AR: "تم تحديث حالة الطلب"},
		Body:       forms.LocalizedText{EN: bodyEN, AR: bodyAR},
		EntityType: "legal_request",
		EntityID:   entityID,
		ActionURL:  requestActionURL(entityID),
		EventID:    eventID,
		DedupKey:   dedupKey("request.status:"+status, event.ID, recipient),
		Email:      true,
		Metadata:   requestMetadata(payload),
	})
}

// handleRequestRouted projects a request.routed transfer (CAP-159, PRD 13.0
// "transferring a request") into an in-app inbox row (+ email). Recipient: the newly
// assigned handler when the payload names one (assignee_user_id/assigned_to_user_id/
// handling_officer_id), otherwise the requester whose approved request moved into
// handling. We deliberately do NOT fall back to the event actor — the actor is the
// router (a legal coordinator/admin), not the party the transfer should alert — so a
// payload with neither an assignee nor a requester is skipped. Deduped per
// (request.routed, event.ID, recipient); the spawned subject linkage travels in
// Metadata so the FE can deep-link the resulting case/consultation.
func (c *LexNotificationConsumer) handleRequestRouted(ctx context.Context, tenantID uuid.UUID, eventID *uuid.UUID, event *events.Event) error {
	payload := decodePayload(event.Data)
	recipient := payloadUUIDAny(payload, "assignee_user_id", "assigned_to_user_id", "handling_officer_id")
	toAssignee := recipient != uuid.Nil
	if recipient == uuid.Nil {
		recipient = payloadUUIDValue(payload, "requester_user_id")
	}
	if recipient == uuid.Nil {
		return nil
	}
	entityID := payloadUUID(payload, "id")
	bodyEN := "Your legal request has been transferred to the handling department."
	bodyAR := "تمت إحالة طلبك القانوني إلى الإدارة المختصة."
	if toAssignee {
		bodyEN = "A legal request has been transferred/routed to you for handling."
		bodyAR = "تمت إحالة طلب قانوني إليك للمعالجة."
	}
	metadata := requestMetadata(payload)
	metadata["subject_type"] = payloadString(payload, "subject_type")
	metadata["subject_id"] = payloadString(payload, "subject_id")
	metadata["previous_status"] = payloadString(payload, "previous_status")
	return c.notify(ctx, tenantID, recipient, service.NotifyInput{
		Category:   model.NotificationCategoryRequest,
		Title:      forms.LocalizedText{EN: "Request transferred", AR: "تمت إحالة الطلب"},
		Body:       requestBody(payload, bodyEN, bodyAR),
		EntityType: "legal_request",
		EntityID:   entityID,
		ActionURL:  requestActionURL(entityID),
		EventID:    eventID,
		DedupKey:   dedupKey("request.routed", event.ID, recipient),
		Email:      true,
		Metadata:   metadata,
	})
}

func (c *LexNotificationConsumer) handleCaseAssignment(ctx context.Context, tenantID uuid.UUID, eventID *uuid.UUID, event *events.Event, recipientKey string) error {
	payload := decodePayload(event.Data)
	recipient := payloadUUIDValue(payload, recipientKey)
	if recipient == uuid.Nil {
		return nil
	}
	caseID := payloadUUID(payload, "id")
	return c.notify(ctx, tenantID, recipient, service.NotifyInput{
		Category:   model.NotificationCategoryCase,
		Title:      forms.LocalizedText{EN: "Case assigned to you", AR: "تم إسناد قضية إليك"},
		Body:       forms.LocalizedText{EN: "A legal case has been transferred/assigned to you.", AR: "تم تحويل/إسناد قضية قانونية إليك."},
		EntityType: "legal_case",
		EntityID:   caseID,
		ActionURL:  caseActionURL(caseID),
		EventID:    eventID,
		DedupKey:   dedupKey("case.assignment:"+recipientKey, event.ID, recipient),
		Email:      true,
		Metadata:   map[string]any{"role": recipientKey},
	})
}

func (c *LexNotificationConsumer) handleCaseStatusChanged(ctx context.Context, tenantID uuid.UUID, eventID *uuid.UUID, event *events.Event) error {
	recipient := parseEventActor(event)
	if recipient == uuid.Nil {
		return nil
	}
	payload := decodePayload(event.Data)
	caseID := payloadUUID(payload, "id")
	return c.notify(ctx, tenantID, recipient, service.NotifyInput{
		Category:   model.NotificationCategoryCase,
		Title:      forms.LocalizedText{EN: "Case status updated", AR: "تم تحديث حالة القضية"},
		Body:       forms.LocalizedText{EN: "The status of a legal case has changed.", AR: "تم تغيير حالة قضية قانونية."},
		EntityType: "legal_case",
		EntityID:   caseID,
		ActionURL:  caseActionURL(caseID),
		EventID:    eventID,
		DedupKey:   dedupKey("case.status", event.ID, recipient),
		Email:      true,
		Metadata:   map[string]any{"status": payloadString(payload, "status")},
	})
}

// handleJudgment projects a judgment/decision issuance (CAP-164) into an in-app
// inbox row (+ email). Recipient: the case owner / handling officer — the party who
// must act on the ruling — resolved from the case-owner keys the payload carries
// about the affected case (case_owner_user_id/owner_user_id/handling_officer_id/
// supervisor_id), NOT the actor who recorded it (who already knows). It falls back to
// the event actor only when the payload names no case owner.
//
// LIMITATION: today the judgment.recorded/studied emitter payload
// (litigation_judgment_service.go) carries only {id, case_id, judgment_ref, outcome}
// and does not yet include the case owner, so until that emitter is enriched to add a
// case_owner_user_id (out of this file's scope) the fall-back still targets the actor.
// A DB-backed owner lookup keyed on payload case_id would require a case-reader seam
// on this consumer (a new constructor dependency wired at every call site), which is
// outside this change's file boundary; resolving from payload keys is the minimal
// correct fix and matches the owner-key pattern already used by the contract-expiry
// and matter-timeline handlers.
func (c *LexNotificationConsumer) handleJudgment(ctx context.Context, tenantID uuid.UUID, eventID *uuid.UUID, event *events.Event) error {
	payload := decodePayload(event.Data)
	recipient := payloadUUIDAny(payload, "case_owner_user_id", "owner_user_id", "handling_officer_id", "supervisor_id")
	if recipient == uuid.Nil {
		recipient = parseEventActor(event)
	}
	if recipient == uuid.Nil {
		return nil
	}
	caseID := payloadUUID(payload, "case_id")
	judgmentRef := payloadString(payload, "judgment_ref")
	bodyEN := "A judgment/decision has been issued on a legal case."
	if judgmentRef != "" {
		bodyEN = fmt.Sprintf("Judgment %s has been issued on a legal case.", judgmentRef)
	}
	return c.notify(ctx, tenantID, recipient, service.NotifyInput{
		Category:   model.NotificationCategoryJudgment,
		Title:      forms.LocalizedText{EN: "Judgment issued", AR: "صدر حكم"},
		Body:       forms.LocalizedText{EN: bodyEN, AR: "صدر حكم/قرار في قضية قانونية."},
		EntityType: "legal_judgment",
		EntityID:   payloadUUID(payload, "id"),
		ActionURL:  caseActionURL(caseID),
		EventID:    eventID,
		DedupKey:   dedupKey("judgment", event.ID, recipient),
		Email:      true,
		Metadata:   map[string]any{"case_id": optionalUUIDString(caseID), "judgment_ref": judgmentRef, "outcome": payloadString(payload, "outcome")},
	})
}

// handleMatterTimeline projects a matter timeline/external-hold/delay/deadline
// lifecycle event (#19) into an in-app inbox row so the notification-service
// WebSocket channel pushes a live update. Recipient: the matter owner when the
// payload carries owner_user_id, otherwise the event actor. In-app only (no
// email); deduped per (event.Type, event.ID, recipient). The matter_id and the
// classified category travel in Metadata so the FE can route/label the toast.
func (c *LexNotificationConsumer) handleMatterTimeline(ctx context.Context, tenantID uuid.UUID, eventID *uuid.UUID, event *events.Event) error {
	payload := decodePayload(event.Data)
	recipient := payloadUUIDValue(payload, "owner_user_id")
	if recipient == uuid.Nil {
		recipient = parseEventActor(event)
	}
	if recipient == uuid.Nil {
		return nil
	}
	matterID := payloadUUID(payload, "matter_id")
	if matterID == nil {
		matterID = payloadUUID(payload, "id")
	}
	title, bodyEN, bodyAR := matterTimelineText(event.Type, payload)
	return c.notify(ctx, tenantID, recipient, service.NotifyInput{
		Category:   model.NotificationCategoryCase,
		Title:      title,
		Body:       forms.LocalizedText{EN: bodyEN, AR: bodyAR},
		EntityType: "legal_matter",
		EntityID:   matterID,
		ActionURL:  matterActionURL(matterID),
		EventID:    eventID,
		DedupKey:   dedupKey(event.Type, event.ID, recipient),
		Email:      false,
		Metadata: map[string]any{
			"event_type": event.Type,
			"matter_id":  optionalUUIDString(matterID),
			"category":   payloadString(payload, "category"),
			"actor_id":   strings.TrimSpace(event.UserID),
		},
	})
}

// matterTimelineText maps a matter-timeline CloudEvent type to a localized inbox
// title/body. Unknown matter.* types fall back to a generic "Timeline updated".
func matterTimelineText(eventType string, payload map[string]any) (forms.LocalizedText, string, string) {
	category := payloadString(payload, "category")
	switch eventType {
	case "com.clario360.lex.matter.timeline_updated":
		return forms.LocalizedText{EN: "Matter timeline updated", AR: "تم تحديث الجدول الزمني للقضية"},
			"The timeline estimate for a matter was updated.", "تم تحديث تقدير الجدول الزمني لقضية."
	case "com.clario360.lex.matter.external_hold_set":
		body := "A matter was placed on external hold."
		if category != "" {
			body = fmt.Sprintf("A matter was placed on external hold (%s).", category)
		}
		return forms.LocalizedText{EN: "Matter placed on hold", AR: "تم تعليق القضية"}, body, "تم تعليق قضية لانتظار طرف خارجي."
	case "com.clario360.lex.matter.external_hold_cleared":
		return forms.LocalizedText{EN: "Matter hold cleared", AR: "تم رفع تعليق القضية"},
			"An external hold on a matter was cleared.", "تم رفع التعليق الخارجي عن قضية."
	case "com.clario360.lex.matter.delay_recorded":
		body := "A delay was recorded on a matter."
		if category != "" {
			body = fmt.Sprintf("A %s delay was recorded on a matter.", category)
		}
		return forms.LocalizedText{EN: "Delay recorded", AR: "تم تسجيل تأخير"}, body, "تم تسجيل تأخير على قضية."
	case "com.clario360.lex.matter.delay_resolved":
		return forms.LocalizedText{EN: "Delay resolved", AR: "تم حل التأخير"},
			"A delay on a matter was resolved.", "تم حل تأخير على قضية."
	case "com.clario360.lex.matter.delay_updated":
		return forms.LocalizedText{EN: "Delay updated", AR: "تم تحديث التأخير"},
			"A delay record on a matter was updated.", "تم تحديث سجل تأخير على قضية."
	case "com.clario360.lex.matter.delay_reopened":
		return forms.LocalizedText{EN: "Delay reopened", AR: "تمت إعادة فتح التأخير"},
			"A delay on a matter was reopened.", "تمت إعادة فتح تأخير على قضية."
	case "com.clario360.lex.matter.deadline_obligation_created":
		return forms.LocalizedText{EN: "Deadline added", AR: "تمت إضافة موعد نهائي"},
			"A deadline was added to a matter.", "تمت إضافة موعد نهائي لقضية."
	default:
		return forms.LocalizedText{EN: "Timeline updated", AR: "تم تحديث الجدول الزمني"},
			"A matter timeline was updated.", "تم تحديث الجدول الزمني لقضية."
	}
}

// handleMatterCommentMention (#10) projects a matter-comment @mention event into
// an in-app inbox row (+ email) for the single mentioned user named in the
// payload. The service emits one event per mentioned user, so the recipient is
// the payload's mentioned_user_id. Deduped per (event.Type, event.ID, recipient).
func (c *LexNotificationConsumer) handleMatterCommentMention(ctx context.Context, tenantID uuid.UUID, eventID *uuid.UUID, event *events.Event) error {
	payload := decodePayload(event.Data)
	recipient := payloadUUIDValue(payload, "mentioned_user_id")
	if recipient == uuid.Nil {
		return nil
	}
	matterID := payloadUUID(payload, "matter_id")
	if matterID == nil {
		matterID = payloadUUID(payload, "id")
	}
	author := payloadString(payload, "author_name")
	snippet := payloadString(payload, "snippet")
	bodyEN := "You were mentioned in a comment on a legal matter."
	bodyAR := "تمت الإشارة إليك في تعليق على قضية قانونية."
	if author != "" {
		bodyEN = fmt.Sprintf("%s mentioned you in a comment on a legal matter.", author)
	}
	if snippet != "" {
		bodyEN = fmt.Sprintf("%s “%s”", bodyEN, snippet)
	}
	return c.notify(ctx, tenantID, recipient, service.NotifyInput{
		Category:   model.NotificationCategoryCase,
		Title:      forms.LocalizedText{EN: "You were mentioned", AR: "تمت الإشارة إليك"},
		Body:       forms.LocalizedText{EN: bodyEN, AR: bodyAR},
		EntityType: "legal_matter",
		EntityID:   matterID,
		ActionURL:  matterActionURL(matterID),
		EventID:    eventID,
		DedupKey:   dedupKey(event.Type, event.ID, recipient),
		Email:      true,
		Metadata: map[string]any{
			"matter_id":  optionalUUIDString(matterID),
			"comment_id": payloadString(payload, "comment_id"),
			"author_id":  payloadString(payload, "author_id"),
			"snippet":    snippet,
		},
	})
}

// handleMatterCommentCreated (#10) is the lightweight watcher path: notify the
// matter owner (payload owner_user_id) that a new comment was posted. In-app only
// (no email — the mention path carries the louder email signal). Deduped per
// (event.Type, event.ID, recipient).
func (c *LexNotificationConsumer) handleMatterCommentCreated(ctx context.Context, tenantID uuid.UUID, eventID *uuid.UUID, event *events.Event) error {
	payload := decodePayload(event.Data)
	recipient := payloadUUIDValue(payload, "owner_user_id")
	if recipient == uuid.Nil {
		return nil
	}
	matterID := payloadUUID(payload, "matter_id")
	if matterID == nil {
		matterID = payloadUUID(payload, "id")
	}
	author := payloadString(payload, "author_name")
	snippet := payloadString(payload, "snippet")
	bodyEN := "A new comment was posted on your matter."
	bodyAR := "تمت إضافة تعليق جديد على قضيتك."
	if author != "" {
		bodyEN = fmt.Sprintf("%s posted a comment on your matter.", author)
	}
	if snippet != "" {
		bodyEN = fmt.Sprintf("%s “%s”", bodyEN, snippet)
	}
	return c.notify(ctx, tenantID, recipient, service.NotifyInput{
		Category:   model.NotificationCategoryCase,
		Title:      forms.LocalizedText{EN: "New comment on your matter", AR: "تعليق جديد على قضيتك"},
		Body:       forms.LocalizedText{EN: bodyEN, AR: bodyAR},
		EntityType: "legal_matter",
		EntityID:   matterID,
		ActionURL:  matterActionURL(matterID),
		EventID:    eventID,
		DedupKey:   dedupKey(event.Type, event.ID, recipient),
		Email:      false,
		Metadata: map[string]any{
			"matter_id":  optionalUUIDString(matterID),
			"comment_id": payloadString(payload, "comment_id"),
			"author_id":  payloadString(payload, "author_id"),
			"snippet":    snippet,
		},
	})
}

// handleContractIntakeReceipt projects a contract review-desk intake receipt
// (intake_opened) or acknowledgement (intake_acknowledged) into the requester's
// in-app inbox row (+ email) — the PRD §9.1 "receipt / acknowledgement to the
// requester" obligation. Recipient is the contract requester (owner) named on the
// event as requester_user_id; we deliberately do NOT fall back to the event actor,
// who is the desk clerk/registrar processing the intake rather than the party the
// receipt should reach (mirrors handleRequestRouted). An event without a requester
// is skipped. Deduped per (event.Type, event.ID, recipient) so redelivery is safe.
func (c *LexNotificationConsumer) handleContractIntakeReceipt(ctx context.Context, tenantID uuid.UUID, eventID *uuid.UUID, event *events.Event, acknowledged bool) error {
	payload := decodePayload(event.Data)
	recipient := payloadUUIDValue(payload, "requester_user_id")
	if recipient == uuid.Nil {
		return nil
	}
	contractID := payloadUUID(payload, "contract_id")
	reference := payloadString(payload, "reference_number")
	title := payloadString(payload, "contract_title")

	titleText := forms.LocalizedText{EN: "Contract received by legal review desk", AR: "تم استلام العقد لدى مكتب المراجعة القانونية"}
	bodyEN := "Your contract has been received by the legal review desk."
	bodyAR := "تم استلام عقدك لدى مكتب المراجعة القانونية."
	if acknowledged {
		titleText = forms.LocalizedText{EN: "Contract review acknowledged", AR: "تم الإقرار باستلام العقد للمراجعة"}
		bodyEN = "The legal review desk has acknowledged receipt of your contract for review."
		bodyAR = "أقرّ مكتب المراجعة القانونية باستلام عقدك للمراجعة."
	}
	return c.notify(ctx, tenantID, recipient, service.NotifyInput{
		Category:   model.NotificationCategoryContract,
		Title:      titleText,
		Body:       contractReceiptBody(reference, title, bodyEN, bodyAR),
		EntityType: "contract",
		EntityID:   contractID,
		ActionURL:  contractActionURL(contractID),
		EventID:    eventID,
		DedupKey:   dedupKey(event.Type, event.ID, recipient),
		Email:      true,
		Metadata: map[string]any{
			"reference_number": reference,
			"contract_title":   title,
			"status":           payloadString(payload, "status"),
		},
	})
}

// contractReceiptBody prefixes the desk reference number (and the contract title
// when present) onto the localized receipt body, mirroring requestBody's
// request-number prefix so the requester can match the receipt to their submission.
func contractReceiptBody(reference, title, fallbackEN, fallbackAR string) forms.LocalizedText {
	if reference == "" {
		return forms.LocalizedText{EN: fallbackEN, AR: fallbackAR}
	}
	subject := reference
	if title != "" {
		subject = fmt.Sprintf("%s (%s)", reference, title)
	}
	return forms.LocalizedText{
		EN: fmt.Sprintf("Contract %s — %s", subject, fallbackEN),
		AR: fmt.Sprintf("العقد %s — %s", subject, fallbackAR),
	}
}

func (c *LexNotificationConsumer) handleContractExpiry(ctx context.Context, tenantID uuid.UUID, eventID *uuid.UUID, event *events.Event) error {
	payload := decodePayload(event.Data)
	recipient := payloadUUIDValue(payload, "owner_user_id")
	if recipient == uuid.Nil {
		recipient = parseEventActor(event)
	}
	if recipient == uuid.Nil {
		return nil
	}
	contractID := payloadUUID(payload, "id")
	title := payloadString(payload, "title")
	bodyEN := "A contract is approaching its expiry date."
	if title != "" {
		bodyEN = fmt.Sprintf("Contract %q is approaching its expiry date.", title)
	}
	if event.Type == "com.clario360.lex.contract.expired" {
		bodyEN = "A contract has expired."
		if title != "" {
			bodyEN = fmt.Sprintf("Contract %q has expired.", title)
		}
	}
	return c.notify(ctx, tenantID, recipient, service.NotifyInput{
		Category:   model.NotificationCategoryContract,
		Title:      forms.LocalizedText{EN: "Contract expiry", AR: "انتهاء صلاحية العقد"},
		Body:       forms.LocalizedText{EN: bodyEN, AR: "يقترب أحد العقود من تاريخ انتهائه."},
		EntityType: "contract",
		EntityID:   contractID,
		ActionURL:  contractActionURL(contractID),
		EventID:    eventID,
		DedupKey:   dedupKey(event.Type, event.ID, recipient),
		Email:      true,
		Metadata:   map[string]any{"horizon": payload["horizon"]},
	})
}

func (c *LexNotificationConsumer) handleSLAAlert(ctx context.Context, tenantID uuid.UUID, eventID *uuid.UUID, event *events.Event) error {
	payload := decodePayload(event.Data)
	recipient := payloadUUIDAny(payload, "recipient_user_id", "recipient_id", "owner_user_id", "requester_user_id", "assignee_user_id")
	if recipient == uuid.Nil {
		recipient = parseEventActor(event)
	}
	if recipient == uuid.Nil {
		return nil
	}
	requestID := payloadUUID(payload, "legal_request_id")
	if requestID == nil {
		requestID = payloadUUID(payload, "request_id")
	}
	title := forms.LocalizedText{EN: "SLA alert", AR: "تنبيه اتفاقية مستوى الخدمة"}
	body := forms.LocalizedText{EN: "A legal request SLA requires attention.", AR: "تتطلب اتفاقية مستوى الخدمة لطلب قانوني الانتباه."}
	switch event.Type {
	case "com.clario360.lex.sla.ack_overdue":
		title = forms.LocalizedText{EN: "SLA acknowledgement overdue", AR: "تأخر إقرار اتفاقية مستوى الخدمة"}
		body = forms.LocalizedText{EN: "A legal request has not been acknowledged within the SLA window.", AR: "لم يتم إقرار طلب قانوني ضمن مدة اتفاقية مستوى الخدمة."}
	case "com.clario360.lex.sla.breached":
		title = forms.LocalizedText{EN: "SLA breached", AR: "تم تجاوز اتفاقية مستوى الخدمة"}
		body = forms.LocalizedText{EN: "A legal request has breached its SLA deadline.", AR: "تجاوز طلب قانوني الموعد المحدد في اتفاقية مستوى الخدمة."}
	case "com.clario360.lex.sla.escalated":
		level := payloadString(payload, "escalation_level")
		if level != "" {
			title = forms.LocalizedText{EN: "SLA escalated", AR: "تم تصعيد اتفاقية مستوى الخدمة"}
			body = forms.LocalizedText{EN: fmt.Sprintf("A legal request SLA has escalated to level %s.", level), AR: "تم تصعيد اتفاقية مستوى الخدمة لطلب قانوني."}
		} else {
			title = forms.LocalizedText{EN: "SLA escalated", AR: "تم تصعيد اتفاقية مستوى الخدمة"}
		}
	}
	return c.notify(ctx, tenantID, recipient, service.NotifyInput{
		Category:   model.NotificationCategoryRequest,
		Title:      title,
		Body:       body,
		EntityType: "legal_request",
		EntityID:   requestID,
		ActionURL:  requestActionURL(requestID),
		EventID:    eventID,
		DedupKey:   dedupKey(event.Type, event.ID, recipient),
		Email:      true,
		Metadata: map[string]any{
			"sla_clock_id":      payloadString(payload, "id"),
			"legal_request_id":  optionalUUIDString(requestID),
			"turnaround_due_at": payload["turnaround_due_at"],
			"breached_at":       payload["breached_at"],
			"escalation_level":  payload["escalation_level"],
		},
	})
}

func (c *LexNotificationConsumer) notify(ctx context.Context, tenantID, recipient uuid.UUID, in service.NotifyInput) error {
	in.RecipientID = recipient
	in.CreatedBy = recipient
	if _, err := c.notifier.Notify(ctx, tenantID, in); err != nil {
		return fmt.Errorf("write notification inbox row: %w", err)
	}
	return nil
}

// --- payload helpers --------------------------------------------------------

func decodePayload(data json.RawMessage) map[string]any {
	if len(data) == 0 {
		return map[string]any{}
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return map[string]any{}
	}
	return payload
}

func parseEventTenant(event *events.Event) (uuid.UUID, bool) {
	id, err := uuid.Parse(strings.TrimSpace(event.TenantID))
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}

func parseEventActor(event *events.Event) uuid.UUID {
	id, err := uuid.Parse(strings.TrimSpace(event.UserID))
	if err != nil {
		return uuid.Nil
	}
	return id
}

func parseEventID(raw string) *uuid.UUID {
	id, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil
	}
	return &id
}

// requestRecipient resolves the request notification recipient: a
// requester_user_id in the payload wins, otherwise the event actor (the user who
// created/changed the request, i.e. the requester).
func requestRecipient(event *events.Event, payload map[string]any) uuid.UUID {
	if id := payloadUUIDValue(payload, "requester_user_id"); id != uuid.Nil {
		return id
	}
	return parseEventActor(event)
}

func payloadUUID(payload map[string]any, key string) *uuid.UUID {
	id := payloadUUIDValue(payload, key)
	if id == uuid.Nil {
		return nil
	}
	return &id
}

func payloadUUIDValue(payload map[string]any, key string) uuid.UUID {
	raw, ok := payload[key]
	if !ok {
		return uuid.Nil
	}
	s, ok := raw.(string)
	if !ok {
		return uuid.Nil
	}
	id, err := uuid.Parse(strings.TrimSpace(s))
	if err != nil {
		return uuid.Nil
	}
	return id
}

func payloadUUIDAny(payload map[string]any, keys ...string) uuid.UUID {
	for _, key := range keys {
		if id := payloadUUIDValue(payload, key); id != uuid.Nil {
			return id
		}
	}
	return uuid.Nil
}

func payloadString(payload map[string]any, key string) string {
	raw, ok := payload[key]
	if !ok {
		return ""
	}
	if s, ok := raw.(string); ok {
		return strings.TrimSpace(s)
	}
	return strings.TrimSpace(fmt.Sprint(raw))
}

func optionalUUIDString(id *uuid.UUID) string {
	if id == nil {
		return ""
	}
	return id.String()
}

func requestBody(payload map[string]any, fallbackEN, fallbackAR string) forms.LocalizedText {
	number := payloadString(payload, "request_number")
	if number != "" {
		return forms.LocalizedText{
			EN: fmt.Sprintf("Legal request %s — %s", number, fallbackEN),
			AR: fmt.Sprintf("الطلب القانوني %s — %s", number, fallbackAR),
		}
	}
	return forms.LocalizedText{EN: fallbackEN, AR: fallbackAR}
}

func requestMetadata(payload map[string]any) map[string]any {
	return map[string]any{
		"request_number": payloadString(payload, "request_number"),
		"request_type":   payloadString(payload, "request_type"),
		"priority":       payloadString(payload, "priority"),
		"status":         payloadString(payload, "status"),
	}
}

func dedupKey(prefix, eventID string, recipient uuid.UUID) string {
	return fmt.Sprintf("%s:%s:%s", prefix, eventID, recipient)
}

func requestActionURL(id *uuid.UUID) string {
	if id == nil {
		return ""
	}
	return "/lex/requests/" + id.String()
}

func caseActionURL(id *uuid.UUID) string {
	if id == nil {
		return ""
	}
	return "/lex/cases/" + id.String()
}

func contractActionURL(id *uuid.UUID) string {
	if id == nil {
		return ""
	}
	return "/lex/contracts/" + id.String()
}

func matterActionURL(id *uuid.UUID) string {
	if id == nil {
		return ""
	}
	return "/lex/matters/" + id.String()
}
