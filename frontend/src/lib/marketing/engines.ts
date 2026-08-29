import type { MarketingEngineDetail, MarketingPlatformEngine } from './types';

/**
 * Canonical platform-core engine taxonomy for public /platform routes.
 * Mechanically ported from clario360-website (2).html.
 */
export const PLATFORM_ENGINES = [
  {
    id: "workflow",
    name: "Workflow Engine",
    description: "Configurable approvals, stage gates and state machines",
    icon: "workflow"
  },
  {
    id: "forms",
    name: "Forms Engine",
    description: "Admin-built forms and data capture, no redeploy",
    icon: "form"
  },
  {
    id: "automation",
    name: "Automation Engine",
    description: "Runbooks, drills and event-triggered actions",
    icon: "cycle"
  },
  {
    id: "integration",
    name: "Integration Engine",
    description: "Source and target adapters, gov-platform connectors",
    icon: "plug"
  },
  {
    id: "iam",
    name: "IAM",
    description: "One login, RBAC and tenant isolation across the platform",
    icon: "key"
  },
  {
    id: "files",
    name: "File Service",
    description: "Sovereign document storage, legal hold and evidence",
    icon: "file"
  },
  {
    id: "notifications",
    name: "Notifications",
    description: "Email, SMS and in-app alerting, centrally governed",
    icon: "bell"
  },
  {
    id: "licensing",
    name: "Licensing",
    description: "Per-tenant entitlement and packaging control",
    icon: "license"
  },
  {
    id: "ai",
    name: "AI Services",
    description: "Copilots, contract review and detection, RAG-ready",
    icon: "bot"
  },
  {
    id: "gateway",
    name: "API Gateway",
    description: "AuthN/Z, rate limits, routing and versioning · Go",
    icon: "server"
  },
  {
    id: "event-bus",
    name: "Event Bus",
    description: "Ordered, per-tenant, replayable domain events",
    icon: "network"
  },
  {
    id: "observability",
    name: "Observability",
    description: "RPO/RTO/latency SLOs and platform-wide audit",
    icon: "gauge"
  }
] as const satisfies readonly MarketingPlatformEngine[];

export type PlatformEngineRecord = (typeof PLATFORM_ENGINES)[number];
export type PlatformEngineId = (typeof PLATFORM_ENGINES)[number]['id'];
export type PlatformEngineRouteParam = { readonly engine: PlatformEngineId };

export const PLATFORM_ENGINE_ROUTE_PARAMS = PLATFORM_ENGINES.map((engine) => ({
  engine: engine.id,
})) satisfies readonly PlatformEngineRouteParam[];

export const PLATFORM_ENGINE_DETAILS = {
  workflow: {
    tag: "Process",
    long: "The Workflow Engine turns business processes into configurable approvals, stage gates and state machines. Every app — from contract approval in WatheeqTech to remediation in CTEM — routes through it, so process logic is built and changed by administrators, not redeployed by engineers.",
    points: [
      {
        title: "Visual process design",
        description: "Model approvals and state machines without code",
        icon: "workflow"
      },
      {
        title: "Stage gates",
        description: "Phase-gate any process with conditional rules",
        icon: "checkCircle"
      },
      {
        title: "SLA timers",
        description: "Working-time SLAs, escalations and reminders",
        icon: "gauge"
      },
      {
        title: "Reusable across apps",
        description: "One workflow definition serves every suite",
        icon: "cube"
      }
    ],
    consumers: [
      "WatheeqTech — contract approval",
      "EHKAM — issue remediation",
      "CTEM — exposure remediation",
      "Acta — decision-to-action"
    ]
  },
  forms: {
    tag: "Data capture",
    long: "The Forms Engine lets administrators build data-capture forms and bind them to any process. Intake, assessments, evidence requests and structured records are all defined once and reused — no redeploy to change a field.",
    points: [
      {
        title: "Drag-and-build forms",
        description: "Compose forms from typed fields",
        icon: "form"
      },
      {
        title: "Validation rules",
        description: "Enforce data quality at capture",
        icon: "checkCircle"
      },
      {
        title: "Conditional logic",
        description: "Show, hide and require dynamically",
        icon: "workflow"
      },
      {
        title: "Bound to workflow",
        description: "Forms feed directly into processes",
        icon: "network"
      }
    ],
    consumers: [
      "EHKAM — control assessments",
      "ClarioVCISO — evidence intake",
      "MahamaTech — status capture",
      "DSPM — exception requests"
    ]
  },
  automation: {
    tag: "Runbooks",
    long: "The Automation Engine executes runbooks, drills and event-triggered actions. It powers DR failover sequences, continuous control monitoring and KPI-breach responses — listening to the event bus and acting without human latency.",
    points: [
      {
        title: "Runbook orchestration",
        description: "Sequenced, gated automated actions",
        icon: "cycle"
      },
      {
        title: "Event triggers",
        description: "React to any domain event on the bus",
        icon: "zap"
      },
      {
        title: "Scheduled jobs",
        description: "Drills, scans and checks on a cadence",
        icon: "calendar"
      },
      {
        title: "Closed-loop",
        description: "Detect, act and attest automatically",
        icon: "checkCircle"
      }
    ],
    consumers: [
      "ClarioDR — failover runbooks",
      "EHKAM — continuous monitoring",
      "BOSALAH — KPI-breach alerts",
      "ClarioSec — automated response"
    ]
  },
  integration: {
    tag: "Connectors",
    long: "The Integration Engine is the shared adapter catalog — source and target connectors plus government-platform integrations like Najiz and ZATCA. Apps reuse adapters instead of each building their own connector framework.",
    points: [
      {
        title: "Adapter catalog",
        description: "Reusable source and target connectors",
        icon: "plug"
      },
      {
        title: "Gov-platform links",
        description: "Najiz, ZATCA and sector systems",
        icon: "building"
      },
      {
        title: "Protocol support",
        description: "APIs, files, webhooks and queues",
        icon: "network"
      },
      {
        title: "Shared, not duplicated",
        description: "One catalog serves every suite",
        icon: "cube"
      }
    ],
    consumers: [
      "WatheeqTech — Najiz courts",
      "ClarioMigration — cloud adapters",
      "ClarioSync — source connectors",
      "ClarioInsight — data sources"
    ]
  },
  iam: {
    tag: "Identity",
    long: "IAM provides one login, role-based access control and tenant isolation across the entire platform. Identity federates to each customer's own directory, and every permission is enforced at the gateway before a request reaches an app.",
    points: [
      {
        title: "Single sign-on",
        description: "One identity across all four suites",
        icon: "key"
      },
      {
        title: "RBAC",
        description: "Fine-grained, role-based permissions",
        icon: "lock"
      },
      {
        title: "Federated identity",
        description: "Connect to AD / Entra / your IdP",
        icon: "users"
      },
      {
        title: "Tenant isolation",
        description: "Hard boundaries between tenants",
        icon: "shield"
      }
    ],
    consumers: [
      "Every suite — one login",
      "Gateway — request authorisation",
      "Audit — who did what",
      "Admin — role management"
    ]
  },
  files: {
    tag: "Documents",
    long: "The File Service is sovereign document storage with legal hold and evidence management. Contracts, board packs, assessment evidence and recovery artefacts all live in one governed store with retention and tamper-evidence.",
    points: [
      {
        title: "Sovereign storage",
        description: "Documents stay in-Kingdom",
        icon: "file"
      },
      {
        title: "Legal hold",
        description: "Preservation holds for litigation",
        icon: "lock"
      },
      {
        title: "Evidence vault",
        description: "Audit-grade evidence retention",
        icon: "archive"
      },
      {
        title: "Versioning",
        description: "Full document history and lineage",
        icon: "layers"
      }
    ],
    consumers: [
      "WatheeqTech — contracts & holds",
      "EHKAM — assessment evidence",
      "ClarioVCISO — evidence vault",
      "Acta — board documents"
    ]
  },
  notifications: {
    tag: "Alerting",
    long: "Notifications centralise email, SMS and in-app alerting across the platform. Every app publishes alerts through one governed channel, so delivery, preferences and audit are consistent rather than reimplemented per product.",
    points: [
      {
        title: "Multi-channel",
        description: "Email, SMS and in-app",
        icon: "bell"
      },
      {
        title: "Preference control",
        description: "Per-user, per-tenant routing",
        icon: "key"
      },
      {
        title: "Event-driven",
        description: "Triggered by bus events",
        icon: "zap"
      },
      {
        title: "Governed delivery",
        description: "One audited notification path",
        icon: "checkCircle"
      }
    ],
    consumers: [
      "BOSALAH — KPI alerts",
      "ClarioDR — failover notices",
      "EHKAM — deadline reminders",
      "ClarioSec — incident alerts"
    ]
  },
  licensing: {
    tag: "Entitlement",
    long: "The Licensing engine controls per-tenant entitlement and packaging. Which suites, apps and capabilities a tenant can use is configuration — so commercial packaging changes without code, and marketplace billing can plug in cleanly.",
    points: [
      {
        title: "Per-tenant entitlement",
        description: "Enable suites and apps per tenant",
        icon: "license"
      },
      {
        title: "Packaging control",
        description: "Bundle capabilities commercially",
        icon: "cube"
      },
      {
        title: "Usage metering",
        description: "Visibility metering, not billing surprises",
        icon: "gauge"
      },
      {
        title: "Marketplace-ready",
        description: "Billing adapters plug in",
        icon: "handshake"
      }
    ],
    consumers: [
      "Platform — feature gating",
      "Sales — commercial packaging",
      "Marketplace — billing",
      "Admin — entitlement view"
    ]
  },
  ai: {
    tag: "Intelligence",
    long: "AI Services provide copilots, contract review, threat detection and RAG-grounded answers across the platform. The gold zone of ClarioDWH feeds retrieval, so AI works on governed, in-Kingdom data — not an external model with your data.",
    points: [
      {
        title: "Copilots",
        description: "In-context assistance per app",
        icon: "bot"
      },
      {
        title: "Document AI",
        description: "Contract review and risk flags",
        icon: "doc"
      },
      {
        title: "Detection",
        description: "Anomaly and threat detection",
        icon: "radar"
      },
      {
        title: "RAG-grounded",
        description: "Answers from governed data",
        icon: "sparkle"
      }
    ],
    consumers: [
      "WatheeqTech — contract review",
      "ClarioSec — detection",
      "BOSALAH — AI briefings",
      "ClarioInsight — analytics AI"
    ]
  },
  gateway: {
    tag: "Edge · Go",
    long: "The API Gateway is the single edge for the platform: authentication, authorisation, rate limiting, routing and versioning, written in Go. Every request — web, mobile, partner or public API — passes through it, so policy is enforced in one place.",
    points: [
      {
        title: "AuthN / AuthZ",
        description: "Identity and permission at the edge",
        icon: "lock"
      },
      {
        title: "Rate limiting",
        description: "Protect services under load",
        icon: "gauge"
      },
      {
        title: "Routing & versioning",
        description: "Contract-first, versioned APIs",
        icon: "network"
      },
      {
        title: "Single entry",
        description: "One enforced edge for all traffic",
        icon: "server"
      }
    ],
    consumers: [
      "Web & mobile clients",
      "Partner & public APIs",
      "Every suite — routed",
      "IAM — enforced here"
    ]
  },
  "event-bus": {
    tag: "The spine",
    long: "The Event Bus is the architectural spine of Clario360: ordered, partitioned per tenant, schema-registered and replayable. Apps publish facts as domain events and never call each other's databases — which is why suites ship, scale and fail independently.",
    points: [
      {
        title: "Ordered & partitioned",
        description: "Per-tenant ordered event streams",
        icon: "network"
      },
      {
        title: "Schema registry",
        description: "Versioned, validated event contracts",
        icon: "doc"
      },
      {
        title: "Replayable",
        description: "Rebuild state from the log",
        icon: "cycle"
      },
      {
        title: "No coupling",
        description: "Facts, not commands; no DB calls",
        icon: "shield"
      }
    ],
    consumers: [
      "Every app — publishes",
      "BOSALAH — read-model",
      "Automation — reacts",
      "Audit — attests"
    ]
  },
  observability: {
    tag: "Telemetry",
    long: "Observability provides RPO/RTO/latency SLOs and platform-wide audit. Every action is attested to an immutable trail, and the SLOs that matter — recovery objectives, sync lag, response times — are measured and surfaced, not assumed.",
    points: [
      {
        title: "SLO tracking",
        description: "RPO, RTO and latency objectives",
        icon: "gauge"
      },
      {
        title: "Immutable audit",
        description: "Tamper-evident action trail",
        icon: "lock"
      },
      {
        title: "Platform-wide",
        description: "One view across every suite",
        icon: "eye"
      },
      {
        title: "Exportable",
        description: "Evidence for auditors",
        icon: "doc"
      }
    ],
    consumers: [
      "ClarioDR — RPO/RTO",
      "ClarioSync — lag SLO",
      "Audit — full trail",
      "Every suite — telemetry"
    ]
  }
} as const satisfies Record<
  PlatformEngineId,
  MarketingEngineDetail
>;

export function getPlatformEngine(id: string): PlatformEngineRecord | undefined {
  return PLATFORM_ENGINES.find((engine) => engine.id === id);
}

export function getPlatformEngineDetail(id: string): MarketingEngineDetail | undefined {
  return PLATFORM_ENGINE_DETAILS[id as PlatformEngineId];
}
