import type { LucideIcon } from 'lucide-react';
import {
  Activity, BookOpen, Boxes, Braces, Cloud, Code2, Database, FileKey,
  GitBranch, KeyRound, LifeBuoy, Radio, Rocket, Search, ShieldCheck, Terminal, Webhook,
} from 'lucide-react';
import { watheeqRouteArticles } from './watheeq-route-guides';

export type DocBlock =
  | { type: 'text'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'steps'; items: Array<{ title: string; text: string }> }
  | { type: 'code'; language: string; code: string }
  | { type: 'callout'; tone: 'info' | 'warning' | 'success'; title: string; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] };

export type DocSection = { id: string; title: string; blocks: DocBlock[] };
export type DocArticle = {
  slug: string;
  title: string;
  description: string;
  group: string;
  icon: LucideIcon;
  updated: string;
  sections: DocSection[];
};

const API = '$CLARIO360_API_URL/api/v1';

const coreDocArticles: DocArticle[] = [
  {
    slug: 'getting-started/introduction', title: 'Introduction', group: 'Get started',
    description: 'Learn how Clario360 combines four enterprise suites with one sovereign platform core.',
    icon: BookOpen, updated: 'July 18, 2026',
    sections: [
      { id: 'platform-model', title: 'The platform model', blocks: [
        { type: 'text', text: 'Clario360 is a multi-tenant enterprise platform for resilience, corporate operations, cybersecurity and analytics. Every application consumes shared identity, workflow, integration, audit, notification and event services.' },
        { type: 'table', headers: ['Suite', 'Primary domain', 'Representative capabilities'], rows: [
          ['DataStream', 'Resilience & data mobility', 'Recovery, migration, CDC, sovereign lakehouse'],
          ['Business+', 'Corporate operations', 'Legal, GRC, projects, boards and strategy'],
          ['ClarioSec', 'Security & cyber', 'SOC, CTEM, DSPM, UEBA and virtual CISO'],
          ['ClarioInsight', 'Data intelligence', 'Sources, models, pipelines, quality and dashboards'],
        ]},
      ]},
      { id: 'shared-core', title: 'One shared core', blocks: [
        { type: 'bullets', items: ['One tenant-aware identity and permission model', 'One immutable audit trail across every suite', 'One event bus for cross-suite facts—not database coupling', 'One workflow and forms layer configured without redeployment', 'One deployment artifact for SaaS, private cloud, on-premise and air-gapped estates'] },
        { type: 'callout', tone: 'info', title: 'API stability', text: 'Public APIs are versioned under /api/v1. Internal service routes are not part of the compatibility guarantee.' },
      ]},
    ],
  },
  {
    slug: 'getting-started/quickstart', title: 'Quickstart', group: 'Get started',
    description: 'Authenticate and make your first request against the Clario360 API.',
    icon: Rocket, updated: 'July 18, 2026',
    sections: [
      { id: 'before-you-start', title: 'Before you start', blocks: [
        { type: 'bullets', items: ['A Clario360 tenant with API access enabled', 'An API key or access token with the required resource scopes', 'The deployment-specific base URL issued by your administrator'] },
      ]},
      { id: 'first-request', title: 'Make your first request', blocks: [
        { type: 'steps', items: [{ title: 'Create credentials', text: 'Create a least-privilege key through the governed API-key administration surface.' }, { title: 'Export the key', text: 'Store the key in your shell or secret manager. Never commit it to source control.' }, { title: 'Call the API', text: 'Send an API key with X-API-Key, or an access token as a Bearer credential.' }] },
        { type: 'code', language: 'bash', code: `export CLARIO360_API_URL="http://localhost:8080"\nexport CLARIO360_API_KEY="••••••••"\n\ncurl "${API}/cyber/alerts?per_page=5" \\\n  -H "X-API-Key: $CLARIO360_API_KEY" \\\n  -H "Accept: application/json"` },
        { type: 'code', language: 'json', code: `{\n  "data": [],\n  "pagination": {\n    "limit": 10,\n    "next_cursor": null\n  },\n  "request_id": "req_01J..." \n}` },
      ]},
      { id: 'next-steps', title: 'Next steps', blocks: [
        { type: 'bullets', items: ['Review authentication and token lifecycle guidance', 'Install the Python SDK for typed resources and retries', 'Choose the product API reference that matches your licensed suite'] },
      ]},
    ],
  },
  {
    slug: 'getting-started/core-concepts', title: 'Core concepts', group: 'Get started',
    description: 'Understand tenants, suites, resources, events and platform-wide governance.',
    icon: Boxes, updated: 'July 17, 2026',
    sections: [
      { id: 'tenancy', title: 'Tenants and isolation', blocks: [{ type: 'text', text: 'A tenant is the primary security, data and entitlement boundary. Resource access is evaluated against tenant context on every authenticated request; client-supplied tenant identifiers are never trusted as authorization.' }] },
      { id: 'resources', title: 'Resources and identifiers', blocks: [{ type: 'text', text: 'Platform objects use stable identifiers, timestamps and version metadata. Collection endpoints use cursor pagination so large, changing result sets remain consistent.' }, { type: 'table', headers: ['Concept', 'Purpose'], rows: [['Resource ID', 'Stable identity for an object'], ['Request ID', 'Trace a call across gateway and services'], ['Idempotency key', 'Safely retry supported mutations'], ['Event ID', 'Deduplicate and replay domain facts']] }] },
      { id: 'events', title: 'Events, not coupling', blocks: [{ type: 'text', text: 'Applications publish immutable domain facts to the event bus. Consumers build projections and automations without reaching into another service’s database.' }] },
    ],
  },
  {
    slug: 'build/authentication', title: 'Authentication', group: 'Build',
    description: 'Use access tokens, API keys and service credentials safely.',
    icon: KeyRound, updated: 'July 19, 2026',
    sections: [
      { id: 'bearer-tokens', title: 'Bearer tokens', blocks: [{ type: 'text', text: 'Protected platform endpoints accept RS256-signed JWT access tokens through the Authorization header. Interactive sessions use short-lived access tokens and protected refresh cookies.' }, { type: 'code', language: 'http', code: `Authorization: Bearer <access_token>` }] },
      { id: 'api-keys', title: 'API keys', blocks: [{ type: 'text', text: 'API keys are intended for server-to-server automation. Scope them narrowly, store them in a secret manager, and rotate them on a schedule.' }, { type: 'code', language: 'http', code: 'X-API-Key: <api_key>' }, { type: 'callout', tone: 'warning', title: 'Keep credentials server-side', text: 'Never embed an API key in browser code, mobile bundles, logs, screenshots or support tickets.' }] },
      { id: 'authorization', title: 'Permissions and tenant context', blocks: [{ type: 'bullets', items: ['Authentication establishes identity; authorization is evaluated separately', 'Roles aggregate granular resource permissions', 'Entitlements determine which suites and capabilities are licensed', 'Sensitive actions can require segregation-of-duties checks and approval'] }] },
      { id: 'errors', title: 'Authentication errors', blocks: [{ type: 'table', headers: ['Status', 'Meaning', 'Action'], rows: [['401', 'Missing, expired or invalid credential', 'Refresh or replace the credential'], ['403', 'Authenticated but not permitted', 'Review scopes, role and entitlement'], ['429', 'Rate limit exceeded', 'Back off and honor Retry-After']] }] },
    ],
  },
  {
    slug: 'build/api-conventions', title: 'API conventions', group: 'Build',
    description: 'Versioning, pagination, filtering, errors and idempotent operations.',
    icon: Braces, updated: 'July 18, 2026',
    sections: [
      { id: 'requests', title: 'Requests and responses', blocks: [{ type: 'bullets', items: ['JSON request and response bodies use application/json', 'Timestamps use RFC 3339 in UTC', 'Unknown fields may be added without a major version change', 'Every response carries or returns a request identifier for support tracing'] }] },
      { id: 'pagination', title: 'Pagination', blocks: [{ type: 'code', language: 'bash', code: `curl "${API}/cyber/alerts?per_page=50&page=2" \\\n  -H "X-API-Key: $CLARIO360_API_KEY"` }] },
      { id: 'errors', title: 'Errors', blocks: [{ type: 'code', language: 'json', code: `{\n  "error": {\n    "code": "validation_failed",\n    "message": "The request could not be processed.",\n    "details": [{ "field": "name", "reason": "required" }]\n  },\n  "request_id": "req_01J..."\n}` }] },
      { id: 'idempotency', title: 'Idempotency', blocks: [{ type: 'text', text: 'For supported create and action endpoints, send a unique Idempotency-Key. Reusing the key with the same payload returns the original result; reusing it with a different payload is rejected.' }] },
    ],
  },
  {
    slug: 'build/python-sdk', title: 'Python SDK', group: 'Build',
    description: 'Install the official Python client and automate Clario360 resources.',
    icon: Terminal, updated: 'July 16, 2026',
    sections: [
      { id: 'install', title: 'Install', blocks: [{ type: 'code', language: 'bash', code: 'pip install clario360' }] },
      { id: 'configure', title: 'Configure a client', blocks: [{ type: 'code', language: 'python', code: `import os\nfrom clario360 import Clario360\n\nclient = Clario360(\n    api_key=os.environ["CLARIO360_API_KEY"],\n    api_url=os.environ["CLARIO360_API_URL"],\n)` }] },
      { id: 'resources', title: 'Work with resources', blocks: [{ type: 'code', language: 'python', code: `alerts = client.cyber.alerts.list(per_page=5)\n\nfor alert in alerts.data:\n    print(alert.id, alert.title, alert.severity)` }] },
      { id: 'reliability', title: 'Retries and errors', blocks: [{ type: 'text', text: 'The SDK exposes typed exceptions and automatically retries eligible transient failures with bounded backoff. Mutations are only retried when the operation is known to be idempotent.' }] },
    ],
  },
  {
    slug: 'build/webhooks', title: 'Webhooks', group: 'Build',
    description: 'Receive signed events reliably and protect against replay.',
    icon: Webhook, updated: 'July 18, 2026',
    sections: [
      { id: 'delivery', title: 'Delivery model', blocks: [{ type: 'text', text: 'Webhook deliveries contain an event identifier, event type, tenant context, occurrence time and resource payload. Endpoints should acknowledge quickly and process asynchronously.' }] },
      { id: 'verify', title: 'Verify signatures', blocks: [{ type: 'code', language: 'text', code: `signed_payload = timestamp + "." + raw_request_body\nexpected = HMAC_SHA256(webhook_secret, signed_payload)` }, { type: 'bullets', items: ['Verify against the raw body before parsing JSON', 'Use constant-time comparison', 'Reject timestamps outside the configured replay window', 'Deduplicate by event ID before applying side effects'] }] },
      { id: 'retries', title: 'Retries and failures', blocks: [{ type: 'text', text: 'Return a 2xx response after durable receipt. Non-2xx responses are retried with exponential backoff; exhausted deliveries are retained for operator review and replay.' }] },
    ],
  },
  {
    slug: 'watheeq/overview', title: 'WatheeqTech how-to', group: 'WatheeqTech',
    description: 'A task-oriented guide to operating the Arabic-first enterprise legal management suite.',
    icon: BookOpen, updated: 'July 20, 2026',
    sections: [
      { id: 'what-you-can-do', title: 'What you can do', blocks: [
        { type: 'text', text: 'WatheeqTech is the legal operations domain of Clario360. It connects legal intake, approvals, matters, litigation, consultations, investigations, contracts, documents, signatures, obligations and reporting under one tenant-aware audit trail.' },
        { type: 'table', headers: ['Journey', 'Start in WatheeqTech', 'Typical outcome'], rows: [
          ['Legal service request', 'Service Desk → New Legal Request', 'Approved and routed request with SLA'],
          ['Matter or case', 'Matters or Cases', 'Governed legal work record and timeline'],
          ['Consultation or investigation', 'Consultations or Investigations', 'Assigned work, findings and closure'],
          ['Contract lifecycle', 'Contracts', 'Reviewed, approved, signed and monitored contract'],
          ['Knowledge and compliance', 'Clause Library, Regulations, Compliance', 'Governed content and traceable alerts'],
        ] },
      ] },
      { id: 'personas', title: 'Choose your role', blocks: [
        { type: 'table', headers: ['Role', 'Primary work'], rows: [
          ['Requester', 'Submit requests, supply evidence and track delivery'],
          ['Legal professional', 'Triage, fulfil, advise, investigate and manage records'],
          ['Approver', 'Review approval tasks and record reasoned decisions'],
          ['Legal administrator', 'Configure services, SLAs, policies, roles and calendars'],
          ['Security / integration administrator', 'Manage identity, connectors and secret rotation'],
        ] },
        { type: 'callout', tone: 'info', title: 'Permission-aware interface', text: 'Actions appear only when the signed-in user has the corresponding WatheeqTech permission, tenant entitlement and record visibility.' },
      ] },
      { id: 'how-the-work-connects', title: 'How the work connects', blocks: [
        { type: 'steps', items: [
          { title: 'Intake', text: 'A request enters through the platform or an authenticated inbound email channel.' },
          { title: 'Govern', text: 'Eligibility, completeness, SLA and approval policies are evaluated.' },
          { title: 'Execute', text: 'Approved work is routed into a request, matter, case, consultation, investigation or contract workflow.' },
          { title: 'Preserve', text: 'Documents, decisions, events and custody evidence remain linked to the legal record.' },
          { title: 'Measure', text: 'Dashboards and reports expose workload, SLA, risk, obligation and compliance status.' },
        ] },
      ] },
    ],
  },
  {
    slug: 'watheeq/configure-service-desk', title: 'Configure the Legal Service Desk', group: 'WatheeqTech',
    description: 'Create a bilingual legal service, define eligibility and SLA rules, and make it available to requesters.',
    icon: Boxes, updated: 'July 20, 2026',
    sections: [
      { id: 'prerequisites', title: 'Before you begin', blocks: [
        { type: 'bullets', items: ['Use a legal administrator account with Service Catalog permissions', 'Confirm the request type and owning legal team', 'Prepare English and Arabic names and descriptions', 'Confirm the official working calendar, Ramadan hours and holidays', 'Identify any requester or provider approval requirement'] },
      ] },
      { id: 'create-service', title: 'Create a service', blocks: [
        { type: 'steps', items: [
          { title: 'Open the catalog', text: 'Go to WatheeqTech → Admin → Service Catalog and select New Service.' },
          { title: 'Describe the service', text: 'Enter a stable code, request type, bilingual name, bilingual description and supported intake channel.' },
          { title: 'Set availability', text: 'Choose the eligible audience and add department, entity or role rules when the service is restricted.' },
          { title: 'Configure governance', text: 'Enable requester approval, provider approval or both as required by the operating model.' },
          { title: 'Set SLA targets', text: 'Configure acknowledgement and completion targets against the active working calendar.' },
          { title: 'Activate and test', text: 'Save the service, activate it, and confirm it appears for an eligible requester but not an ineligible user.' },
        ] },
        { type: 'callout', tone: 'warning', title: 'Stable service codes', text: 'Treat the service code as an integration identifier. Change the bilingual display name when needed, but avoid recycling codes.' },
      ] },
      { id: 'validate', title: 'Validation checklist', blocks: [
        { type: 'bullets', items: ['The service is active and accepts the intended channel', 'Eligibility rules match the target organization units', 'Urgent requests require a justification', 'SLA calculations honor weekends, holidays and Ramadan hours', 'Approval requirements have a matching active policy', 'A test requester can complete every required field and attachment'] },
      ] },
    ],
  },
  {
    slug: 'watheeq/request-approval-workflow', title: 'Build a request approval workflow', group: 'WatheeqTech',
    description: 'Connect Workflow Designer, the service catalog and approval policy into one governed request flow.',
    icon: GitBranch, updated: 'July 20, 2026',
    sections: [
      { id: 'relationship', title: 'Understand the relationship', blocks: [
        { type: 'text', text: 'A service does not store a live workflow instance ID. The published workflow definition is the design reference; the active request-approval policy matches the service and creates a workflow instance only when approval starts.' },
        { type: 'code', language: 'text', code: 'Workflow definition → Service catalog → Approval policy match\n→ Legal request → Workflow instance → Approval tasks' },
      ] },
      { id: 'configure', title: 'Configure the workflow', blocks: [
        { type: 'steps', items: [
          { title: 'Publish the definition', text: 'In Admin → Workflows → Definitions, create a workflow with a human task, end step and valid transition, then publish it.' },
          { title: 'Create or open the service', text: 'In WatheeqTech → Admin → Service Catalog, confirm its request type and enable the required approval stage.' },
          { title: 'Create the policy', text: 'Open Request-Approval Policies and scope a new active policy to the service, request type and requester or provider stage.' },
          { title: 'Choose decision rules', text: 'Set priority, sequential or parallel mode, quorum, approver users or roles, value thresholds and currency where applicable.' },
          { title: 'Record traceability', text: 'Where policy metadata is enabled, store the published workflow definition ID as the governance reference.' },
          { title: 'Test policy recommendation', text: 'Use the recommendation tester with the exact service, request type, stage, priority and value context.' },
        ] },
      ] },
      { id: 'decision-controls', title: 'Decision controls', blocks: [
        { type: 'bullets', items: ['The requester and approver must be different people', 'Segregation of duties is checked when the decision is submitted', 'Authority evidence can be required for value-sensitive decisions', 'Decision notes become part of the immutable record', 'Rejected or returned requests follow the configured revision path'] },
      ] },
    ],
  },
  {
    slug: 'watheeq/submit-legal-request', title: 'Submit and track a legal request', group: 'WatheeqTech',
    description: 'Raise a governed request, pass approval, follow SLA status and confirm delivery.',
    icon: Rocket, updated: 'July 20, 2026',
    sections: [
      { id: 'submit', title: 'Submit a request', blocks: [
        { type: 'steps', items: [
          { title: 'Start the request', text: 'Go to WatheeqTech → Service Desk and select New Legal Request.' },
          { title: 'Choose a service', text: 'Select one of the services available to your role, department and organization entity.' },
          { title: 'Describe the need', text: 'Enter the title, description, priority, department and beneficiary entity requested by the service.' },
          { title: 'Supply evidence', text: 'Complete service-specific requirements and upload allowed supporting documents.' },
          { title: 'Justify urgency', text: 'When Urgent is selected, enter a specific business or legal deadline justification.' },
          { title: 'Submit', text: 'Review the summary and submit. WatheeqTech starts the configured requester approval or routes the request directly.' },
        ] },
      ] },
      { id: 'approval-and-routing', title: 'Approval and routing', blocks: [
        { type: 'text', text: 'If approval is required, the request enters Pending Requester Approval or Pending Provider Approval. The matching policy creates tasks for the configured roles or users. After approval, routing assigns the legal provider and starts fulfilment and SLA tracking.' },
        { type: 'table', headers: ['Status', 'Meaning', 'What to do'], rows: [
          ['Draft', 'Not yet submitted', 'Complete requirements and submit'],
          ['Pending approval', 'A governed decision is outstanding', 'Monitor the approval task; do not resubmit'],
          ['Routed / In progress', 'Legal owns the work', 'Follow activity and respond to information requests'],
          ['Delivered', 'Legal supplied the outcome', 'Review and confirm delivery'],
          ['Returned / Rejected', 'Revision or closure is required', 'Read the decision notes before acting'],
        ] },
      ] },
      { id: 'track-sla', title: 'Track SLA and delivery', blocks: [
        { type: 'bullets', items: ['The request timeline records submission, approval, routing and delivery events', 'SLA clocks use the official working calendar rather than elapsed clock time', 'Escalation levels surface before and after breach', 'Notifications link back to the governed request record', 'Delivery confirmation closes the requester-to-provider loop'] },
      ] },
    ],
  },
  {
    slug: 'watheeq/manage-matters', title: 'Open and manage a legal matter', group: 'WatheeqTech',
    description: 'Run conflict checks, triage a matter and connect contracts, obligations, documents and activity.',
    icon: FileKey, updated: 'July 20, 2026',
    sections: [
      { id: 'open-matter', title: 'Open a matter', blocks: [
        { type: 'steps', items: [
          { title: 'Check for conflicts', text: 'Before opening the matter, run the conflict check using the parties, subject and relevant organization entities.' },
          { title: 'Create the record', text: 'Go to WatheeqTech → Matters, select New Matter, and enter the bilingual title, category, owner, parties, sensitivity and business context.' },
          { title: 'Triage', text: 'Set priority, risk, responsible team, initial deadlines and the recommended handling path.' },
          { title: 'Link related work', text: 'Attach the originating request and link relevant contracts, obligations, documents or cases.' },
        ] },
      ] },
      { id: 'operate', title: 'Operate the matter', blocks: [
        { type: 'bullets', items: ['Use the timeline for significant advice, decisions and external correspondence', 'Assign tasks with owners and due dates', 'Keep privileged or confidential documents under the correct classification', 'Monitor linked obligations and reminders', 'Use status transitions rather than free-text closure notes to preserve reporting accuracy'] },
      ] },
      { id: 'close', title: 'Close the matter', blocks: [
        { type: 'steps', items: [
          { title: 'Resolve open work', text: 'Complete or explicitly disposition remaining tasks, obligations and approvals.' },
          { title: 'Record the outcome', text: 'Capture the final legal position, business decision and any continuing obligations.' },
          { title: 'Verify the file', text: 'Confirm required documents and communications are attached and classified.' },
          { title: 'Close', text: 'Move the matter to its terminal status. The timeline and audit history remain available.' },
        ] },
      ] },
    ],
  },
  {
    slug: 'watheeq/manage-litigation', title: 'Manage a case and litigation lifecycle', group: 'WatheeqTech',
    description: 'Create a case, manage parties and hearings, preserve evidence and record judgment outcomes.',
    icon: ShieldCheck, updated: 'July 20, 2026',
    sections: [
      { id: 'intake', title: 'Create and assess a case', blocks: [
        { type: 'steps', items: [
          { title: 'Open the case', text: 'Go to WatheeqTech → Cases and create the case from an approved request, matter or direct authorized intake.' },
          { title: 'Classify the dispute', text: 'Choose plaintiff or defendant posture, court, dispute taxonomy, parties, claims and material dates.' },
          { title: 'Assess strength', text: 'Record facts, evidence, legal grounds, exposure, probability and recommended strategy.' },
          { title: 'Assign ownership', text: 'Set the responsible lawyer, supervisor and supporting team.' },
        ] },
      ] },
      { id: 'litigate', title: 'Run the litigation record', blocks: [
        { type: 'bullets', items: ['Draft and approve statements of claim or response memoranda', 'Track pleadings, filings and court references', 'Schedule hearings and record reports, attendance and next actions', 'Manage court experts, assignments and expert deliverables', 'Apply legal holds to preserve evidence and prevent disposal', 'Keep every case document linked to the correct stage and classification'] },
        { type: 'callout', tone: 'info', title: 'Najiz integration boundary', text: 'Najiz synchronization is deployment and government-onboarding dependent. Sandbox or manual fallback states are labeled honestly and must not be treated as confirmed court submission.' },
      ] },
      { id: 'judgment', title: 'Record judgment and objection', blocks: [
        { type: 'steps', items: [
          { title: 'Record the judgment', text: 'Capture the judgment date, outcome, awarded values, reasoning summary and official document.' },
          { title: 'Evaluate objection', text: 'Record objection eligibility, deadline, grounds and approval decision.' },
          { title: 'Update exposure', text: 'Reflect the financial, operational and precedent impact on the case and linked matter.' },
          { title: 'Close or continue', text: 'Move to enforcement, appeal or closure using the governed case state transition.' },
        ] },
      ] },
    ],
  },
  {
    slug: 'watheeq/consultations-investigations', title: 'Run consultations and investigations', group: 'WatheeqTech',
    description: 'Triage legal advice, preserve investigation evidence and obtain findings sign-off.',
    icon: Search, updated: 'July 20, 2026',
    sections: [
      { id: 'consultation', title: 'Deliver a legal consultation', blocks: [
        { type: 'steps', items: [
          { title: 'Accept and classify', text: 'Open the approved consultation, confirm legal topic, urgency, conflicts and responsible practice area.' },
          { title: 'Research', text: 'Link regulations, clauses, precedents and relevant organizational policies.' },
          { title: 'Draft advice', text: 'State the question, assumptions, analysis, options, risk and recommended action.' },
          { title: 'Review and deliver', text: 'Complete the configured peer or supervisor review, deliver the response and archive the final advice.' },
        ] },
      ] },
      { id: 'investigation', title: 'Conduct an investigation', blocks: [
        { type: 'steps', items: [
          { title: 'Define scope', text: 'Record allegations, authority, scope, stakeholders, confidentiality and target dates.' },
          { title: 'Plan evidence', text: 'Identify custodians, interviews, documents, systems and preservation requirements.' },
          { title: 'Record activity', text: 'Log interviews, evidence receipts, observations and investigative decisions chronologically.' },
          { title: 'Write findings', text: 'Separate substantiated facts, unsubstantiated allegations, analysis and recommendations.' },
          { title: 'Obtain sign-off', text: 'Route findings through the configured distinct-actor approval before closure.' },
        ] },
      ] },
      { id: 'safety', title: 'Confidentiality and evidence safety', blocks: [
        { type: 'bullets', items: ['Restrict sensitive records to the investigation team and authorized reviewers', 'Use legal holds when evidence must be preserved', 'Do not overwrite interview notes or source documents; create a new version', 'Record conflicts and recusals', 'Keep external dependencies and delays visible in the timeline'] },
      ] },
    ],
  },
  {
    slug: 'watheeq/contract-lifecycle', title: 'Run the contract lifecycle', group: 'WatheeqTech',
    description: 'Create, review, negotiate, approve, sign, archive and monitor a contract.',
    icon: FileKey, updated: 'July 20, 2026',
    sections: [
      { id: 'create-review', title: 'Create and review', blocks: [
        { type: 'steps', items: [
          { title: 'Create the contract', text: 'Go to WatheeqTech → Contracts and enter the parties, category, owner, value, currency, effective dates and renewal terms.' },
          { title: 'Upload the source', text: 'Attach the document as the first version and verify the file classification and confidentiality.' },
          { title: 'Analyze', text: 'Run classification, clause extraction and risk analysis when those services are enabled.' },
          { title: 'Review clauses', text: 'Compare extracted clauses with the active playbook and record accept, revise or escalate decisions.' },
          { title: 'Start legal review', text: 'Start the configured workflow and resolve required reviewer tasks.' },
        ] },
      ] },
      { id: 'negotiate-approve', title: 'Negotiate and approve', blocks: [
        { type: 'bullets', items: ['Upload each counterparty turn as a new version', 'Use redline comparison to review changes between selected versions', 'Record playbook deviations and fallback positions', 'Route material deviations through the correct authority tier', 'Keep commercial and legal approval decisions distinct when policy requires it'] },
      ] },
      { id: 'sign-monitor', title: 'Sign and monitor', blocks: [
        { type: 'steps', items: [
          { title: 'Prepare signature', text: 'Create an envelope from the approved version, add recipients in order and validate signing authority.' },
          { title: 'Send and track', text: 'Dispatch through the enabled native or provider rail and monitor recipient events.' },
          { title: 'Preserve custody', text: 'Record the signed file, provider proof and custody evidence before marking execution complete.' },
          { title: 'Extract obligations', text: 'Review extracted obligations, assign owners, deadlines and reminder escalation.' },
          { title: 'Monitor renewal', text: 'Use expiry and renewal warnings to decide renew, amend, terminate or allow expiry.' },
        ] },
        { type: 'callout', tone: 'warning', title: 'AI review is assistive', text: 'Classification, drafting and extraction outputs require authorized human review. Provider and AI availability varies by deployment.' },
      ] },
    ],
  },
  {
    slug: 'watheeq/documents-signatures', title: 'Govern documents and e-signatures', group: 'WatheeqTech',
    description: 'Version legal documents, control access and preserve signature chain-of-custody evidence.',
    icon: FileKey, updated: 'July 20, 2026',
    sections: [
      { id: 'repository', title: 'Manage a legal document', blocks: [
        { type: 'steps', items: [
          { title: 'Create the record', text: 'Go to WatheeqTech → Documents and select the document type, owner, language, confidentiality and retention category.' },
          { title: 'Upload content', text: 'Upload an allowed file. Malware, content and attachment-policy checks run before it becomes available.' },
          { title: 'Link the record', text: 'Associate it with its request, matter, case, contract, consultation or investigation.' },
          { title: 'Create versions', text: 'Upload revised content as a new version; never replace the historical file.' },
          { title: 'Archive', text: 'Apply the governed retention and electronic archive path when the record becomes final.' },
        ] },
      ] },
      { id: 'signature-envelope', title: 'Create a signature envelope', blocks: [
        { type: 'steps', items: [
          { title: 'Select the final version', text: 'Only use the approved document version intended for execution.' },
          { title: 'Add recipients', text: 'Enter recipient identity, language, role and signing order.' },
          { title: 'Validate authority', text: 'Confirm each signatory has the required delegation or organizational authority.' },
          { title: 'Send', text: 'Dispatch the envelope and monitor view, sign, decline, expiry and provider events.' },
          { title: 'Record custody', text: 'Preserve the signed artifact, hash, timestamps, identity evidence and provider proof envelope.' },
        ] },
      ] },
      { id: 'provider-modes', title: 'Understand provider modes', blocks: [
        { type: 'table', headers: ['Mode', 'Meaning'], rows: [
          ['Native / deterministic', 'WatheeqTech records recipient actions and evidence using the configured internal rail'],
          ['emdha', 'Qualified electronic signature; requires live provider onboarding and credentials'],
          ['Nafath confirmation', 'National identity confirmation; distinct from the signature event itself'],
          ['Manual fallback', 'The external act occurs outside the connector and must be evidenced explicitly'],
        ] },
      ] },
    ],
  },
  {
    slug: 'watheeq/knowledge-compliance', title: 'Govern clauses, regulations and compliance', group: 'WatheeqTech',
    description: 'Maintain approved bilingual legal knowledge and turn it into contract compliance controls.',
    icon: BookOpen, updated: 'July 20, 2026',
    sections: [
      { id: 'clause-library', title: 'Govern a clause', blocks: [
        { type: 'steps', items: [
          { title: 'Create the entry', text: 'Add Arabic and English text, category, jurisdiction, risk position and usage guidance.' },
          { title: 'Submit for governance', text: 'Route the clause to the authorized reviewer rather than activating it directly.' },
          { title: 'Record the decision', text: 'Approve, reject or return with reasoned notes and effective dates.' },
          { title: 'Use in playbooks', text: 'Add the governed clause as preferred, fallback or prohibited language for a contract type.' },
        ] },
      ] },
      { id: 'regulations', title: 'Maintain regulation coverage', blocks: [
        { type: 'bullets', items: ['Create and govern Saudi or tenant-specific regulation entries', 'Link regulations to reusable clauses', 'Record effective dates and superseded versions', 'Search in Arabic or English', 'Map contract requirements to the relevant regulatory source'] },
      ] },
      { id: 'compliance-run', title: 'Run contract compliance', blocks: [
        { type: 'steps', items: [
          { title: 'Define the rule', text: 'Create a compliance rule with scope, severity and evaluation criteria.' },
          { title: 'Run evaluation', text: 'Evaluate selected contracts or the eligible contract portfolio.' },
          { title: 'Triage alerts', text: 'Assign an owner, review evidence and update each alert through its governed status.' },
          { title: 'Measure posture', text: 'Use the compliance dashboard and score to track unresolved issues and trends.' },
        ] },
      ] },
    ],
  },
  {
    slug: 'watheeq/admin-integrations', title: 'Administer organization, roles and integrations', group: 'WatheeqTech',
    description: 'Import the organization structure, assign responsibility and operate governed connectors.',
    icon: Boxes, updated: 'July 20, 2026',
    sections: [
      { id: 'organization', title: 'Import the organization structure', blocks: [
        { type: 'steps', items: [
          { title: 'Download a template', text: 'Use the XLSX, CSV or JSON template from WatheeqTech → Admin → Organization.' },
          { title: 'Prepare stable codes', text: 'Populate code, parent_code, entity_type and at least one bilingual name. Add manager and role bindings where known.' },
          { title: 'Choose a mode', text: 'Use create for new records, update for existing records, merge for both, or replace to deactivate omitted entities.' },
          { title: 'Run dry-run', text: 'Resolve duplicate codes, invalid UUIDs, missing parents, cycles and unsupported roles before applying.' },
          { title: 'Apply atomically', text: 'Apply the validated import. Entities, paths, roles and memberships commit together or roll back together.' },
        ] },
      ] },
      { id: 'roles-sod', title: 'Assign roles safely', blocks: [
        { type: 'bullets', items: ['Assign responsibility roles to the appropriate organization entity', 'Keep requester, approver and final sign-off duties separated', 'Use Delegation of Authority for temporary or value-limited authority', 'Review effective permissions from both role and tenant entitlement', 'Audit privileged role changes and delegation expiry'] },
      ] },
      { id: 'integrations', title: 'Configure an integration', blocks: [
        { type: 'steps', items: [
          { title: 'Choose a connector', text: 'Open Admin → Integrations and choose SSO, SCIM, HR, archive, email, signature, court or custom REST.' },
          { title: 'Enter deployment settings', text: 'Supply endpoints and non-secret metadata, then store credentials through the protected secret fields.' },
          { title: 'Test connection', text: 'Review the honest health grade: healthy, sandbox, not configured or unavailable.' },
          { title: 'Submit governed change', text: 'When maker-checker is enabled, a different authorized administrator approves activation.' },
          { title: 'Monitor', text: 'Inspect sync runs, retry state, dead-letter records, rotation status and event diagnostics.' },
        ] },
        { type: 'callout', tone: 'warning', title: 'Government and provider gating', text: 'Najiz, Nafath, emdha and other providers require customer credentials, network approval and provider certification. A configured sandbox is never labeled as live production.' },
      ] },
    ],
  },
  {
    slug: 'watheeq/reporting-audit', title: 'Report, audit and export legal operations', group: 'WatheeqTech',
    description: 'Use legal dashboards, operational reports and immutable history to answer management and audit questions.',
    icon: Activity, updated: 'July 20, 2026',
    sections: [
      { id: 'dashboards', title: 'Use operational dashboards', blocks: [
        { type: 'table', headers: ['View', 'Use it to answer'], rows: [
          ['Service Desk', 'What is new, pending approval, at risk or breached?'],
          ['Contracts', 'What is in review, high risk, expiring or awaiting signature?'],
          ['Matters and cases', 'What is open, overdue, high exposure or awaiting an external party?'],
          ['Obligations', 'Which commitments are due, escalated or overdue?'],
          ['Compliance', 'Which rules failed and what remains unresolved?'],
        ] },
      ] },
      { id: 'reports', title: 'Export a report', blocks: [
        { type: 'steps', items: [
          { title: 'Choose a governed report', text: 'Open WatheeqTech → Reports and select contracts, matters, obligations or the available operational report.' },
          { title: 'Set scope', text: 'Apply date, owner, organization, status and other permitted filters.' },
          { title: 'Preview', text: 'Confirm totals and sample rows before producing the export.' },
          { title: 'Export', text: 'Generate JSON or CSV where supported. The request and actor remain traceable.' },
        ] },
      ] },
      { id: 'audit-history', title: 'Read the audit history', blocks: [
        { type: 'bullets', items: ['Use the record timeline for business events and state transitions', 'Use version history for document and content changes', 'Use approval history for policy, actor, decision and notes', 'Use platform audit for privileged access and configuration changes', 'Preserve request IDs and UTC timestamps when escalating an issue'] },
      ] },
    ],
  },
  {
    slug: 'reference/api-overview', title: 'API reference', group: 'Reference',
    description: 'Choose a governed API contract for your platform workload.',
    icon: Code2, updated: 'July 19, 2026',
    sections: [
      { id: 'contracts', title: 'Published contracts', blocks: [{ type: 'table', headers: ['Contract', 'Coverage', 'Version'], rows: [['ClarioDR service', 'Recovery plans, replications, failover and restore', 'OpenAPI 3.1'], ['Watheeq Legal API', 'Requests, matters, cases, contracts, documents and approvals', 'OpenAPI 3.1'], ['License & entitlement', 'Tenant licenses, plans, assignments and effective access', 'OpenAPI 3.1']] }] },
      { id: 'base-urls', title: 'Base URLs', blocks: [{ type: 'table', headers: ['Environment', 'Base URL'], rows: [['Managed / private cloud', 'Deployment-specific; issued by your administrator'], ['On-premise', 'https://<your-gateway>/api/v1'], ['Local development', 'http://localhost:8080/api/v1']] }] },
      { id: 'source-of-truth', title: 'Contract source of truth', blocks: [{ type: 'callout', tone: 'info', title: 'Governed surface', text: 'The OpenAPI files define the supported public subset. Internal route registrations can be broader and must not be treated as public contracts.' }] },
    ],
  },
  {
    slug: 'reference/dr-api', title: 'ClarioDR API', group: 'Reference',
    description: 'Automate recovery plans, protection groups and failover operations.',
    icon: Database, updated: 'July 15, 2026',
    sections: [
      { id: 'resources', title: 'Primary resources', blocks: [{ type: 'bullets', items: ['Recovery plans and ordered execution steps', 'Protection groups and replication state', 'Recovery point objectives and health', 'Failover, failback and validation operations'] }] },
      { id: 'example', title: 'Read recovery status', blocks: [{ type: 'code', language: 'bash', code: `curl "$CLARIO_BASE_URL/api/v1/dr/recovery-plans" \\\n  -H "Authorization: Bearer $CLARIO_API_KEY"` }] },
      { id: 'safety', title: 'Operational safety', blocks: [{ type: 'callout', tone: 'warning', title: 'Destructive operations', text: 'Failover and failback actions may require an approval, change window and idempotency key. Validate plans in an isolated recovery network first.' }] },
    ],
  },
  {
    slug: 'reference/watheeq-api', title: 'Watheeq Legal API', group: 'Reference',
    description: 'Integrate legal intake, matters, cases, contracts and governed approvals.',
    icon: FileKey, updated: 'July 19, 2026',
    sections: [
      { id: 'domains', title: 'Resource domains', blocks: [{ type: 'table', headers: ['Domain', 'Examples'], rows: [['Service desk', 'Catalog, request types, requests and SLA state'], ['Legal work', 'Matters, consultations, investigations and settlements'], ['Litigation', 'Cases, hearings, filings, evidence and legal holds'], ['Contracts', 'Contracts, clauses, obligations, versions and signatures'], ['Governance', 'Approvals, delegation, segregation of duties and audit']] }] },
      { id: 'aliases', title: 'Route compatibility', blocks: [{ type: 'text', text: 'The governed legal surface supports the Watheeq naming used by customer integrations. Some deployments retain /lex route aliases for compatibility; use the base path issued for your tenant.' }] },
      { id: 'example', title: 'Create a legal request', blocks: [{ type: 'code', language: 'json', code: `{\n  "service_id": "svc_contract_review",\n  "request_type": "contract_review",\n  "title": "Review supplier agreement",\n  "priority": "normal",\n  "payload": { "counterparty": "Example Co." }\n}` }] },
    ],
  },
  {
    slug: 'reference/license-api', title: 'Licensing API', group: 'Reference',
    description: 'Inspect effective entitlements and manage governed tenant licensing.',
    icon: FileKey, updated: 'July 17, 2026',
    sections: [
      { id: 'model', title: 'Entitlement model', blocks: [{ type: 'text', text: 'Effective access composes the tenant license, plan entitlements, explicit overrides, seat assignments and user permissions. A licensed capability can still be unavailable to a user who lacks the matching permission.' }] },
      { id: 'effective-access', title: 'Read effective access', blocks: [{ type: 'code', language: 'bash', code: `curl "$CLARIO_BASE_URL/api/v1/entitlements/me" \\\n  -H "Authorization: Bearer $ACCESS_TOKEN"` }] },
      { id: 'administration', title: 'Administrative changes', blocks: [{ type: 'callout', tone: 'warning', title: 'Privileged API', text: 'License assignment and reconciliation endpoints require platform administration permissions and write immutable audit events.' }] },
    ],
  },
  {
    slug: 'operate/deployment', title: 'Deployment models', group: 'Operate',
    description: 'Choose SaaS, private cloud, on-premise or fully air-gapped operation.',
    icon: Cloud, updated: 'July 18, 2026',
    sections: [
      { id: 'models', title: 'Supported models', blocks: [{ type: 'table', headers: ['Model', 'Control plane', 'Connectivity'], rows: [['SaaS', 'Clario360-operated', 'Managed public endpoints'], ['Private cloud', 'Dedicated customer environment', 'Private network and controlled egress'], ['On-premise', 'Customer data centre', 'Customer gateway and infrastructure'], ['Air-gapped', 'Customer-controlled', 'No runtime internet dependency']] }] },
      { id: 'dependencies', title: 'Core dependencies', blocks: [{ type: 'bullets', items: ['Kubernetes-compatible compute', 'PostgreSQL, Redis and Kafka/Redpanda-compatible messaging', 'S3-compatible object storage', 'Vault-compatible secret and key management', 'Ingress, DNS, certificates, metrics, logs and traces'] }] },
      { id: 'promotion', title: 'Release promotion', blocks: [{ type: 'steps', items: [{ title: 'Preflight', text: 'Validate capacity, secrets, schemas, backups and dependency health.' }, { title: 'Deploy', text: 'Apply versioned manifests and run backward-compatible migrations.' }, { title: 'Verify', text: 'Run smoke tests, audit checks and cross-suite event validation.' }, { title: 'Close or roll back', text: 'Record evidence; revert through the governed rollback runbook if gates fail.' }] }],
      },
    ],
  },
  {
    slug: 'operate/security', title: 'Security model', group: 'Operate',
    description: 'Understand defense-in-depth controls across identity, data and operations.',
    icon: ShieldCheck, updated: 'July 19, 2026',
    sections: [
      { id: 'principles', title: 'Security principles', blocks: [{ type: 'bullets', items: ['Tenant isolation at gateway, service and persistence layers', 'Least privilege through granular permissions and entitlements', 'Encryption in transit and at rest with managed key rotation', 'Tamper-evident audit for sensitive reads and all mutations', 'Fail-closed verification for signed callbacks and provider events'] }] },
      { id: 'secrets', title: 'Secrets and keys', blocks: [{ type: 'text', text: 'Production credentials belong in the configured secret manager, never manifests or environment files committed to source control. Rotation procedures cover API keys, database credentials, certificates, webhook secrets and signing keys.' }] },
      { id: 'reporting', title: 'Report a vulnerability', blocks: [{ type: 'callout', tone: 'info', title: 'Coordinated disclosure', text: 'Use the security contact in SECURITY.md. Do not submit sensitive findings through public issue trackers.' }] },
    ],
  },
  {
    slug: 'operate/audit-compliance', title: 'Audit & compliance', group: 'Operate',
    description: 'Trace actions, export evidence and align controls to regulated frameworks.',
    icon: Activity, updated: 'July 17, 2026',
    sections: [
      { id: 'audit-events', title: 'Audit events', blocks: [{ type: 'text', text: 'Audit events capture actor, tenant, action, target, outcome, time, request context and relevant change metadata. Sensitive values and credentials are redacted before persistence.' }] },
      { id: 'evidence', title: 'Evidence lifecycle', blocks: [{ type: 'steps', items: [{ title: 'Collect', text: 'Ingest signed attestations, configuration state and operational evidence.' }, { title: 'Preserve', text: 'Apply retention, integrity controls and legal holds.' }, { title: 'Map', text: 'Associate evidence with controls and regulatory requirements.' }, { title: 'Export', text: 'Create a bounded, auditable evidence package for reviewers.' }] }],
      },
      { id: 'frameworks', title: 'Framework alignment', blocks: [{ type: 'bullets', items: ['NCA Essential Cybersecurity Controls', 'SAMA Cyber Security Framework where applicable', 'Saudi PDPL data governance obligations', 'ISO 27001 and SOC 2 control mappings for customer assurance'] }, { type: 'callout', tone: 'info', title: 'Not legal advice', text: 'Framework mappings support customer assurance but do not replace an organisation’s own legal or regulatory assessment.' }] },
    ],
  },
  {
    slug: 'operate/observability', title: 'Observability', group: 'Operate',
    description: 'Monitor service health, trace requests and diagnose cross-suite workflows.',
    icon: Radio, updated: 'July 14, 2026',
    sections: [
      { id: 'signals', title: 'Telemetry signals', blocks: [{ type: 'table', headers: ['Signal', 'Use'], rows: [['Metrics', 'SLOs, capacity, saturation and error rates'], ['Logs', 'Structured service and audit-adjacent diagnostics'], ['Traces', 'Request flow across gateway and services'], ['Events', 'Domain flow, consumer lag and replay status']] }] },
      { id: 'correlation', title: 'Correlation', blocks: [{ type: 'text', text: 'Preserve the request ID returned by the platform. It is the fastest way to correlate gateway access, service logs, traces and audit events without exposing payload data.' }] },
    ],
  },
  {
    slug: 'support/troubleshooting', title: 'Troubleshooting', group: 'Support',
    description: 'Diagnose common authentication, API, event and connectivity failures.',
    icon: LifeBuoy, updated: 'July 18, 2026',
    sections: [
      { id: 'checklist', title: 'Start here', blocks: [{ type: 'steps', items: [{ title: 'Capture context', text: 'Record time, environment, tenant, endpoint, status and request ID.' }, { title: 'Check platform status', text: 'Confirm gateway and dependency health before changing configuration.' }, { title: 'Classify the failure', text: 'Separate authentication, authorization, entitlement, validation and transient service errors.' }, { title: 'Retry safely', text: 'Retry reads and idempotent mutations only; use bounded exponential backoff.' }] }],
      },
      { id: 'common-errors', title: 'Common errors', blocks: [{ type: 'table', headers: ['Symptom', 'Likely cause', 'Check'], rows: [['401 responses', 'Expired or invalid token', 'Issuer, audience, expiry and clock'], ['403 responses', 'Permission or entitlement', 'Role, scope, tenant and license'], ['429 responses', 'Rate limiting', 'Retry-After and client concurrency'], ['Missing events', 'Consumer lag or filter', 'Topic, tenant partition and offsets'], ['Webhook failures', 'Signature or replay rejection', 'Raw body, timestamp and active secret']] }] },
      { id: 'support-bundle', title: 'Prepare a support bundle', blocks: [{ type: 'bullets', items: ['Request IDs and UTC timestamps', 'Sanitized request and response metadata', 'Deployment version and environment type', 'Relevant health output and reproduction steps'] }] },
    ],
  },
];

export const docArticles: DocArticle[] = [...coreDocArticles, ...watheeqRouteArticles];

export const docGroups = [
  { title: 'GET STARTED', items: docArticles.filter((a) => a.group === 'Get started') },
  { title: 'BUILD', items: docArticles.filter((a) => a.group === 'Build') },
  { title: 'WATHEEQTECH HOW-TO', items: docArticles.filter((a) => a.group === 'WatheeqTech') },
  { title: 'WATHEEQTECH PAGES', items: docArticles.filter((a) => a.group === 'WatheeqTech pages') },
  { title: 'REFERENCE', items: docArticles.filter((a) => a.group === 'Reference') },
  { title: 'OPERATE', items: docArticles.filter((a) => a.group === 'Operate') },
  { title: 'SUPPORT', items: docArticles.filter((a) => a.group === 'Support') },
];

export function findDoc(slug: string) {
  return docArticles.find((article) => article.slug === slug);
}
