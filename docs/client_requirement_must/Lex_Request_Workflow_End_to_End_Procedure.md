# Lex Request Workflow End-to-End Procedure

Prepared for: Client operations and administration teams  
System area: Clario360 Lex / Watheeq legal service request flow  
Date: July 12, 2026

## 1. Purpose

This procedure explains how to create a workflow in the Workflow Designer, configure a legal service request approval policy, link it to a service, raise a request, and trigger the workflow end to end.

The most important design point is that Lex does not attach a workflow instance ID directly to the service catalog item. A workflow instance ID is created only when a submitted request starts approval. The end-to-end link is:

Workflow Designer Definition -> Service Catalog Entry -> Request-Approval Policy Match -> Legal Request -> Workflow Instance -> Approval Tasks

The service is linked to approval through the active request-approval policy scope. The policy should target the service and request type. If the tenant exposes policy metadata, record the Workflow Designer definition ID there for traceability.

## 2. Prerequisites

Before starting, confirm the following:

1. The administrator has access to Lex Admin and permission to manage Service Catalog and Request-Approval Policies.
2. The administrator has access to Workflow Designer and permission to create and publish workflow definitions.
3. A requester user exists and can submit legal requests.
4. An approver user exists and has the role selected in the approval policy.
5. The approver must be different from the requester who created the request. The system blocks self-approval.
6. The service must be active and must accept platform submissions.
7. If the service has eligibility rules, the requester must satisfy those rules.

## 3. Business Example Used In This Procedure

Use the following example values, then replace them with the client's real service details:

Service code: CONTRACT_REVIEW_FAST  
Request type: contract_review  
Service name: Contract Review  
Requester approval required: Yes  
Provider approval required: No  
Approval stage: requester  
Approver role: legal-dept-manager

## 4. Admin Procedure: Create And Publish The Workflow In Workflow Designer

1. Log in as an administrator with workflow design permissions.
2. Open Admin.
3. Go to Workflows.
4. Open Definitions.
5. Select Create Definition.
6. The system opens the Workflow Designer with a draft workflow.
7. Confirm the workflow has at least:
   - a start or human task step
   - an end step
   - a transition from the task step to the end step
8. Open Workflow Settings if the tenant requires a specific trigger or variables.
9. Keep the trigger as Manual unless the implementation team has instructed otherwise.
10. Select Save Draft if changes were made.
11. Select Publish.
12. Confirm the workflow status changes from Draft to Active or Read-only.
13. Record the Workflow Definition ID.

Expected result: A published workflow definition exists before the service and approval policy are configured.

Important note: For Lex request approvals, the runtime approval task routing is controlled by the request-approval policy. The Workflow Definition ID is used as the design/governance reference. The live workflow instance ID is created later when approval starts on a submitted request.

## 5. Admin Procedure: Create The Service

1. Log in as a Lex administrator.
2. Open Lex.
3. Go to Admin.
4. Open Service Catalog.
5. Select New Service.
6. Complete the service details:
   - Code: CONTRACT_REVIEW_FAST
   - Request Type: contract_review
   - English Name: Contract Review
   - Arabic Name: مراجعة عقد
   - English Description: Legal review of a contract
   - Arabic Description: مراجعة قانونية لعقد
   - Channel: Platform
   - Available To: all
   - Requester Approval Required: On
   - Provider Approval Required: Off
   - Active: On
7. Add eligibility rules if required. For a simple open service, use an "all" rule or leave the service available to all, depending on the configured tenant rule pattern.
8. Save the service.
9. Open the saved service record and record the Service ID. This ID is needed when creating the request-approval policy or testing by API.

Expected result: The service appears in the Service Catalog and can be selected from the New Legal Request wizard.

## 6. Admin Procedure: Create The Request-Approval Policy

1. Stay logged in as a Lex administrator.
2. Open Lex.
3. Go to Admin.
4. Open Request-Approval Policies.
5. Select New Policy.
6. Complete the policy details:
   - Name: Contract review requester approval
   - Description: Approval policy for contract review requests
   - Status: Active
   - Priority: 100
   - Request Type: contract_review
   - Service: select the Contract Review service created above
   - Stage: requester
   - Currency: SAR, or the client's default currency
   - Mode: sequential
   - Quorum: all
   - Approvers: role = legal-dept-manager
7. If policy metadata is available, add:
   - workflow_definition_id: the Workflow Definition ID recorded from Workflow Designer
   - workflow_definition_source: workflow_designer
8. If authority evidence is required, enable it and enter the required role or authority amount.
9. Save the policy.
10. Use the policy recommendation tester, if available, and test with:
   - Request Type: contract_review
   - Service: Contract Review
   - Stage: requester
11. Confirm that the policy matches.

Expected result: The active request-approval policy is now available for requests raised against that service.

## 7. Requester Procedure: Raise The Legal Request

1. Log in as the requester.
2. Open Lex.
3. Go to Service Desk.
4. Select New Legal Request.
5. Select the Contract Review service.
6. Complete the request details:
   - Title: Review supplier MSA
   - Description: Please review the supplier master services agreement.
   - Priority: Normal
   - Department: enter the requester department if required
   - Beneficiary Entity: select the entity if required
   - Urgency Justification: complete only if priority is urgent
7. Submit the request details.
8. Open the created request.
9. Select Submit.
10. Confirm the submission.

Expected result: Because requester approval is required, the legal request moves from Draft to Submitted or Pending Requester Approval. It does not go straight to Approved.

## 8. Trigger The Workflow

Depending on the tenant configuration, approval may start automatically from the request action area or may be started by an authorized user, such as an approver, legal director, or administrator with approval-start permission.

1. Open the submitted legal request.
2. In the request approval section, select Start Approval if the action is visible.
3. If Start Approval is not shown in the UI, an authorized API caller can start it using:

```bash
curl -X POST "$API/api/v1/lex/requests/$REQUEST_ID/approval/start" \
  -H "Authorization: Bearer $TOKEN"
```

Expected result:

1. The system finds the best matching active request-approval policy.
2. The system creates a workflow instance for the request approval run.
3. The system creates approval task rows for the approver role or approver users.
4. The system stores the workflow instance ID on the legal request.
5. The previously published Workflow Designer definition remains the design/governance reference for the configured workflow.

## 9. Approver Procedure: Approve Or Reject The Request

1. Log in as the approver. The approver must not be the same user who created the request.
2. Open Lex.
3. Open Inbox or the request approval task list.
4. Find the approval task for the submitted request.
5. Open the task.
6. Review the request details and any supporting metadata or attachments.
7. Choose Approve or Reject.
8. Enter decision notes.
9. Submit the decision.

Expected result if approved:

1. The workflow task is completed.
2. The request approval stage is completed.
3. If only requester approval was required, the request moves through Approved and then continues to Routed or fulfilment.
4. If provider approval is also required, the system moves the request to Pending Provider Approval and starts the provider approval stage.

Expected result if rejected:

1. The workflow task is completed with a rejection outcome.
2. The request is moved to the configured rejected or returned status.
3. The requester can revise and resubmit if the process allows it.

## 10. Validation Checklist

After completing the process, confirm the following:

1. The workflow definition was created in Workflow Designer.
2. The workflow definition was published and is Active or Read-only.
3. The Workflow Definition ID was recorded.
4. The service is active in Service Catalog.
5. The service has the correct request type.
6. The service has requester or provider approval required, depending on the intended flow.
7. The request-approval policy is Active.
8. The policy scope matches the service ID, request type, stage, department, priority tier, value, and currency as applicable.
9. The policy references the Workflow Definition ID in metadata if the tenant uses metadata for traceability.
10. The requester can see and submit the service.
11. The submitted request has a workflow instance ID after approval is started.
12. Approval tasks are created for the intended approver role or users.
13. The approver can approve or reject the task.
14. The request status changes after the decision.

## 11. API Procedure For Technical Teams

This section can be used by implementation or support teams to validate the same process through APIs.

### Step 1: Create The Workflow Definition

```bash
curl -X POST "$API/api/v1/workflows/definitions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Contract Review Approval Workflow",
    "description": "Workflow definition created before linking the service approval policy.",
    "category": "custom",
    "trigger_config": { "type": "manual" },
    "steps": [
      {
        "id": "start",
        "type": "human_task",
        "name": "Start",
        "config": {
          "assignee_role": "admin",
          "form_fields": []
        },
        "transitions": [{ "target": "end" }]
      },
      {
        "id": "end",
        "type": "end",
        "name": "End",
        "config": {},
        "transitions": []
      }
    ],
    "variables": {}
  }'
```

Record the returned workflow definition ID as WORKFLOW_DEFINITION_ID.

### Step 2: Publish The Workflow Definition

```bash
curl -X POST "$API/api/v1/workflows/definitions/$WORKFLOW_DEFINITION_ID/publish" \
  -H "Authorization: Bearer $TOKEN"
```

Expected result: The workflow definition status is Active and `published_at` is populated.

### Step 3: Create The Service Catalog Entry

```bash
curl -X POST "$API/api/v1/lex/service-catalog" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "CONTRACT_REVIEW_FAST",
    "request_type": "contract_review",
    "name": { "en": "Contract Review", "ar": "مراجعة عقد" },
    "description": { "en": "Legal review of a contract", "ar": "مراجعة قانونية لعقد" },
    "available_to": ["all"],
    "requester_approval_required": true,
    "provider_approval_required": false,
    "channel": "platform",
    "active": true,
    "eligibility_rules": [{ "rule_type": "all", "value": "" }]
  }'
```

Record the returned service ID as SERVICE_ID.

### Step 4: Create The Request-Approval Policy

```bash
curl -X POST "$API/api/v1/lex/request-approval/policies" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Contract review requester approval",
    "description": "Approval policy for contract review requests",
    "status": "active",
    "priority": 100,
    "request_type": "contract_review",
    "service_id": "'"$SERVICE_ID"'",
    "stage": "requester",
    "currency": "SAR",
    "mode": "sequential",
    "quorum": "all",
    "approvers": [
      { "type": "role", "ref": "legal-dept-manager" }
    ],
    "metadata": {
      "workflow_definition_id": "'"$WORKFLOW_DEFINITION_ID"'",
      "workflow_definition_source": "workflow_designer"
    }
  }'
```

Record the returned policy ID.

### Step 5: Raise The Request Through Intake

```bash
curl -X POST "$API/api/v1/lex/intake/submit" \
  -H "Authorization: Bearer $REQUESTER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "service_id": "'"$SERVICE_ID"'",
    "title": { "en": "Review supplier MSA", "ar": "مراجعة اتفاقية المورد" },
    "description": "Please review the supplier master services agreement.",
    "priority": "normal",
    "metadata": { "source": "portal" }
  }'
```

Record the returned request ID as REQUEST_ID.

### Step 6: Submit The Legal Request

```bash
curl -X POST "$API/api/v1/lex/legal-requests/$REQUEST_ID/submit" \
  -H "Authorization: Bearer $REQUESTER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "notes": "Submitted from service catalog intake" }'
```

### Step 7: Start The Approval Workflow

```bash
curl -X POST "$API/api/v1/lex/requests/$REQUEST_ID/approval/start" \
  -H "Authorization: Bearer $APPROVAL_STARTER_TOKEN"
```

Record the returned workflow instance ID as WORKFLOW_INSTANCE_ID.

### Step 8: Get Approval Tasks

```bash
curl "$API/api/v1/lex/requests/$REQUEST_ID/approval/tasks" \
  -H "Authorization: Bearer $APPROVER_TOKEN"
```

Record the task ID as TASK_ID.

### Step 9: Approve The Task

```bash
curl -X POST "$API/api/v1/lex/requests/$REQUEST_ID/approval/$WORKFLOW_INSTANCE_ID/tasks/$TASK_ID/decision" \
  -H "Authorization: Bearer $APPROVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "approve",
    "notes": "Approved"
  }'
```

## 12. Common Issues And Resolutions

Issue: The request does not trigger approval.  
Resolution: Confirm the service has requester_approval_required or provider_approval_required enabled. Also confirm the legal request has been submitted.

Issue: The workflow definition cannot be created because the name already exists.  
Resolution: Use a unique workflow definition name, then publish the new draft.

Issue: No policy is matched.  
Resolution: Confirm the active policy matches request_type, service_id, stage, department, priority tier, currency, and value range. If any policy scope field is too specific, the request may not match.

Issue: The approver receives a forbidden error.  
Resolution: Confirm the approver has the required approver role and the request approval permission. For the tested flow, the approver role is legal-dept-manager.

Issue: The approver cannot approve their own request.  
Resolution: Use a different approver user. The system intentionally blocks self-approval.

Issue: The service is not visible to the requester.  
Resolution: Confirm the service is active, channel is platform, and eligibility rules allow that requester.

Issue: The request is approved immediately without workflow.  
Resolution: Confirm approval is required on the service. If no approval is required, submit moves the request directly to Approved.

## 13. Integration Test Evidence

This procedure was validated end to end with Playwright UI automation on July 12, 2026.

Validation performed:

1. Created a workflow definition from Admin > Workflows > Definitions > Create Definition.
2. Opened the Workflow Designer for the newly created draft.
3. Published the workflow definition and confirmed it became active/read-only.
4. Created a service catalog entry for the test request type.
5. Created an active request-approval policy scoped to the service and request type, with the Workflow Definition ID recorded in metadata.
6. Logged in as a requester and raised a new request from the Legal Service Desk UI.
7. Submitted the draft request.
8. Logged in as an approver and opened the request Approval tab.
9. Started the approval workflow from the UI.
10. Approved the visible workflow task.
11. Confirmed the request reached Routed status.
12. Confirmed the request had no pending approval tasks remaining.

Evidence screenshots were generated by the test run:

1. Workflow designer created.
2. Workflow designer published.
3. Service selected.
4. Request review before create.
5. Request created successfully.
6. Request submitted.
7. Workflow task visible.
8. Final routed status.

Latest automated test results from the July 12, 2026 validation pass:

```text
Backend Lex/workflow integration:
GOWORK=off go test ./internal/lex/... ./internal/workflow/... ./cmd/workflow-engine ./internal/audit/service ./internal/middleware ./internal/auth -count=1
Result: passed

Frontend Watheeq/Lex integration subset:
npx vitest run [selected Watheeq/Lex integration specs]
Result: 16 test files passed, 151 tests passed

Frontend production build:
npm run build
Result: passed

Browser Watheeq E2E suite on production build:
PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test e2e/watheeq-*.spec.ts --project=chromium --reporter=line --timeout=180000
Result: 29 passed
```

Note: A production-server trial on port 3003 failed because the gateway CORS policy does not allow `http://localhost:3003`. The final production-build browser run used `http://localhost:3000`, which is an allowed origin, and passed all Watheeq E2E tests.

## 14. Implementation Notes

The Lex request workflow flow is policy-driven:

1. The Workflow Designer definition is created and published first as the design/governance artifact.
2. The service catalog entry determines the request type, channel, eligibility, and whether requester or provider approval is required.
3. The request-approval policy determines which service and request type use the approval route, who approves the request, and how approval is routed.
4. The workflow instance is created only when approval starts.
5. The legal request stores the workflow_instance_id after the workflow is started.
6. The decision endpoint validates that the workflow instance belongs to the legal request before accepting an approval or rejection.
