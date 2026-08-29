import type { MarketingAppWithSuite, MarketingSuite } from './types';

/**
 * Canonical public Clario360 suite taxonomy.
 *
 * Mechanically ported from clario360-website (2).html. Keep product names,
 * route IDs, ordering, Arabic labels, statuses and product copy centralized here.
 */
export const MARKETING_SUITES = [
  {
    id: "datastream",
    name: "DataStream Suite",
    ar: "البيانات",
    family: "ds",
    tagline: "Data resilience and mobility — four applications on one Go replication core.",
    blurb: "One static-binary replication engine, air-gap ready, powers continuous protection, anywhere-to-anywhere migration, sub-10-second change capture, and the sovereign lakehouse everything feeds. Build the engine once; four products inherit it.",
    core: "Shared Replication Core · Go",
    coreDesc: "Capture agents (VM · DB log · file) → transport (compress · encrypt · resume · throttle) → idempotent apply & validate → checkpointing with an RPO ledger. Fixing throughput, encryption or resume logic once improves every app simultaneously.",
    apps: [
      {
        id: "clariodr",
        name: "ClarioDR",
        ar: "الاستعادة",
        role: "Failover & recovery",
        icon: "shield",
        status: "ga",
        short: "Sovereign failover, drawn end to end — immutable, ransomware-safe recovery points with one-click, audit-grade drills.",
        hero: "Sovereign failover and disaster recovery, gated end to end.",
        desc: "ClarioDR continuously protects production VMs, databases and IaC snapshots, replicating them encrypted to a sovereign or DC-2 recovery site. Every failover passes four gates — validate, approve, execute, attest — and drill mode runs the identical code path against isolated networks, so a rehearsal is the same as the real event.",
        specs: [
          {
            metric: "RTO ≤ 15 min",
            description: "Boot-ordered recovery"
          },
          {
            metric: "RPO ≤ 5 min",
            description: "At GA → ≤30s in 2027"
          },
          {
            metric: "4 gates",
            description: "Validate · Approve · Execute · Attest"
          }
        ],
        modules: [
          {
            title: "Replication manager",
            description: "Continuous capture and encrypted shipping of VMs, databases and configs",
            icon: "sync"
          },
          {
            title: "RPO monitor",
            description: "Live recovery-point tracking against your sovereign SLO",
            icon: "gauge"
          },
          {
            title: "Immutable recovery points",
            description: "Ransomware-safe, tamper-evident restore checkpoints",
            icon: "lock"
          },
          {
            title: "Consistency groups",
            description: "Application-consistent boot order across dependent systems",
            icon: "layers"
          },
          {
            title: "Runbook orchestrator",
            description: "Automation-engine-driven failover and cutover sequences",
            icon: "workflow"
          },
          {
            title: "Non-disruptive drills",
            description: "Rehearse against isolated networks with no production impact",
            icon: "cycle"
          },
          {
            title: "Attestation reports",
            description: "NCA-ready, audit-grade evidence for every drill and event",
            icon: "doc"
          },
          {
            title: "Network mappings",
            description: "Pre-mapped recovery-site routing and failover targets",
            icon: "network"
          }
        ],
        flow: [
          {
            step: "Initiate",
            description: "Operator triggers failover or drill"
          },
          {
            step: "Quiesce & sync",
            description: "Final sync, then Gate 1 RPO check"
          },
          {
            step: "Approve",
            description: "Gate 2 approval requested and granted"
          },
          {
            step: "Execute",
            description: "Gate 3 boot order runs, services validated"
          },
          {
            step: "Attest",
            description: "Gate 4 attestation report issued"
          }
        ],
        bench: "Benchmarked against enterprise DR — beaten on sovereign deployment and audit-grade, code-identical drills."
      },
      {
        id: "clariomigration",
        name: "ClarioMigration",
        ar: "الترحيل",
        role: "Move workloads anywhere",
        icon: "migrate",
        status: "soon",
        short: "Anywhere to anywhere, gated and reversible — hyperscalers migrate you in; Clario migrates you anywhere, including back.",
        hero: "Anywhere-to-anywhere workload migration — gated and reversible.",
        desc: "ClarioMigration reuses the ClarioDR replication core to move VMs, databases and files between any cloud or data centre. It assesses dependencies and plans waves, seeds an initial replica, catches up with change-data-capture, then performs a runbook-gated cutover with the rollback path armed until validation passes.",
        specs: [
          {
            metric: "99.9%",
            description: "Data-integrity checks"
          },
          {
            metric: "Near-zero",
            description: "Cutover lag via CDC"
          },
          {
            metric: "Reversible",
            description: "Rollback armed to sign-off"
          }
        ],
        modules: [
          {
            title: "Discovery & dependency map",
            description: "Automatic inventory and dependency graphing of the source estate",
            icon: "search"
          },
          {
            title: "Wave planning",
            description: "Group workloads into sequenced, low-risk migration waves",
            icon: "layers"
          },
          {
            title: "Throttled seeding",
            description: "Initial full replication with bandwidth control",
            icon: "database"
          },
          {
            title: "CDC delta catch-up",
            description: "Near-zero-lag change capture before cutover",
            icon: "sync"
          },
          {
            title: "Runbook-gated cutover",
            description: "Orchestrated switchover with armed rollback",
            icon: "workflow"
          },
          {
            title: "Validation & sign-off",
            description: "99.9% data checks before the rollback path closes",
            icon: "checkCircle"
          },
          {
            title: "Source/target adapters",
            description: "Cloud-agnostic adapters from the Integration Engine",
            icon: "plug"
          },
          {
            title: "Cloud-agnostic by design",
            description: "No lock-in — migrate in, across, or back out",
            icon: "globe"
          }
        ],
        flow: [
          {
            step: "Assess",
            description: "Discovery, dependency map, wave plan"
          },
          {
            step: "Seed",
            description: "Throttled initial full replication"
          },
          {
            step: "Delta",
            description: "CDC catch-up to near-zero lag"
          },
          {
            step: "Cutover",
            description: "Runbook-gated with rollback armed"
          },
          {
            step: "Validate",
            description: "99.9% data checks and sign-off"
          }
        ],
        bench: "Hyperscaler tools migrate you into their cloud. ClarioMigration is cloud-agnostic by construction — including the path back."
      },
      {
        id: "clariosync",
        name: "ClarioSync",
        ar: "المزامنة",
        role: "CDC ≤ 10 s",
        icon: "sync",
        status: "soon",
        short: "Change data capture at ≤10 seconds — flat, predictable pricing. The engine meters rows for visibility, never for billing surprises.",
        hero: "Change data capture, delivered in ten seconds or less.",
        desc: "ClarioSync adds a streaming pipeline on top of the shared core: log-based capture with zero source impact, ordered and partitioned streaming, in-flight transform and masking, and idempotent exactly-once delivery. Connectors come from the Integration Engine catalog — Sync adds the pipeline, not another adapter framework.",
        specs: [
          {
            metric: "≤ 10 s",
            description: "Lag SLO with alerting"
          },
          {
            metric: "Exactly-once",
            description: "Idempotent apply"
          },
          {
            metric: "Flat pricing",
            description: "Metered for visibility, not billing"
          }
        ],
        modules: [
          {
            title: "Log-based capture",
            description: "Read database logs with zero impact on the source",
            icon: "eye"
          },
          {
            title: "Ordered streaming",
            description: "Per-tenant ordered, partitioned event streams",
            icon: "network"
          },
          {
            title: "Transform & mask",
            description: "Map, mask and enrich data in flight",
            icon: "pen"
          },
          {
            title: "Idempotent delivery",
            description: "Exactly-once apply to every target",
            icon: "checkCircle"
          },
          {
            title: "Lag monitor",
            description: "≤10-second SLO with proactive alerts",
            icon: "gauge"
          },
          {
            title: "Schema-drift detection",
            description: "Detect and evolve through upstream schema changes",
            icon: "layers"
          },
          {
            title: "Multi-target fan-out",
            description: "Feed ClarioDWH, analytics, apps and recovery copies at once",
            icon: "cube"
          },
          {
            title: "Predictable pricing",
            description: "Row metering for observability, never for billing surprises",
            icon: "trend"
          }
        ],
        flow: [
          {
            step: "Capture",
            description: "Log reader, zero source impact"
          },
          {
            step: "Stream",
            description: "Ordered, partitioned event bus"
          },
          {
            step: "Transform",
            description: "Map, mask, enrich"
          },
          {
            step: "Deliver",
            description: "Idempotent exactly-once apply"
          },
          {
            step: "Monitor",
            description: "≤10s lag SLO and alerts"
          }
        ],
        bench: "Versus consumption-metered competitors, pricing stays flat and predictable — the engine meters rows for visibility, never to surprise you."
      },
      {
        id: "clariodwh",
        name: "ClarioDWH",
        ar: "المستودع",
        role: "Sovereign lakehouse",
        icon: "database",
        status: "soon",
        short: "The sovereign lakehouse everything feeds — bronze keeps the truth, silver keeps the standard, gold keeps the answers.",
        hero: "The sovereign lakehouse every source feeds into.",
        desc: "ClarioDWH is the destination for CDC streams, batch loads, app events and external feeds. A medallion architecture over sovereign object storage moves data from raw bronze, through quality-gated silver, to curated, AI-ready gold — with catalog, lineage and dark-data discovery throughout. Data stays in-Kingdom.",
        specs: [
          {
            metric: "−40% $/TB",
            description: "vs global cloud DWH"
          },
          {
            metric: "In-Kingdom",
            description: "Sovereign object storage"
          },
          {
            metric: "AI-ready",
            description: "Gold marts for RAG & BI"
          }
        ],
        modules: [
          {
            title: "Bronze zone",
            description: "Raw, immutable, replayable landing data",
            icon: "database"
          },
          {
            title: "Silver zone",
            description: "Cleansed, conformed, quality-gated data",
            icon: "layers"
          },
          {
            title: "Gold zone",
            description: "Curated marts, metrics and AI-ready datasets",
            icon: "sparkle"
          },
          {
            title: "Catalog & lineage",
            description: "Full discovery, lineage and dark-data surfacing",
            icon: "search"
          },
          {
            title: "Quality rules & contracts",
            description: "Enforced data contracts between producers and consumers",
            icon: "checkCircle"
          },
          {
            title: "SQL engine",
            description: "In-place query over sovereign object storage",
            icon: "server"
          },
          {
            title: "BI & dashboards",
            description: "Powers BOSALAH executive views and BI tools",
            icon: "gauge"
          },
          {
            title: "AI / RAG services",
            description: "Gold-zone datasets feed retrieval-augmented AI",
            icon: "bot"
          }
        ],
        flow: [
          {
            step: "Ingest",
            description: "CDC, batch, events, external feeds"
          },
          {
            step: "Bronze",
            description: "Raw, immutable, replayable"
          },
          {
            step: "Silver",
            description: "Cleansed, conformed, gated"
          },
          {
            step: "Gold",
            description: "Curated marts and metrics"
          },
          {
            step: "Serve",
            description: "BI, exec views and AI/RAG"
          }
        ],
        bench: "Data stays in-Kingdom at roughly 40% lower cost per terabyte than global cloud warehouses — sovereignty and economics, together."
      }
    ]
  },
  {
    id: "business-plus",
    name: "Business+ Suite",
    ar: "الأعمال",
    family: "bp",
    tagline: "Corporate operations in NestJS — Arabic-first, workflow-powered, event-connected.",
    blurb: "Four corporate-operations applications on one shared React shell — single navigation, single design system, single login, Arabic-first RTL. Each app owns its schema and API and never touches another app's database. They integrate only through the event bus.",
    core: "Shared Web Shell + Platform Core",
    coreDesc: "A React shell (Arabic-first RTL/LTR) gives one navigation, one design system and one login. Each NestJS module owns its schema and typed BFF endpoints, consumes the platform core (Workflow, Forms, Automation, Integration, IAM, Files, Notify, Licensing, AI), and publishes domain events. No app calls another app's database, ever.",
    apps: [
      {
        id: "watheeq",
        name: "WatheeqTech",
        ar: "وثيقتك",
        role: "Legal & contracts",
        icon: "scale",
        status: "ga",
        short: "Legal operations, Arabic-native — the architecture treats the Arabic document as the primary artifact, not a translation.",
        hero: "Legal operations and contract lifecycle, Arabic-native.",
        desc: "WatheeqTech is a sovereign Enterprise Legal Management suite, Arabic-native. One Legal Service Desk runs eight legal services end to end — from intake, SLAs and escalation, to full case and litigation management, consultations and investigations, the complete contract lifecycle, a governed bilingual clause library, and an AI drafting suite — with versioned approvals and an immutable audit trail throughout. It is KSA-native by design (full Arabic/RTL, Hijri dates, Ramadan working hours) and integrates with Najiz courts and Nafath identity. The Arabic document is the primary artifact, not a translation — Saudi-law content and government alignment are the moat.",
        specs: [
          {
            metric: "189",
            description: "Legal capabilities — 97% requirements coverage"
          },
          {
            metric: "8",
            description: "Legal services on one service desk"
          },
          {
            metric: "AR / EN",
            description: "Bilingual, Arabic-native (Hijri, Ramadan hours)"
          },
          {
            metric: "Najiz + Nafath",
            description: "Court and identity integrations"
          },
          {
            metric: "14 roles",
            description: "Permission matrix with separation of duties"
          },
          {
            metric: "AI",
            description: "Drafting that generates and rewrites documents"
          }
        ],
        modules: [
          {
            title: "Legal Service Desk",
            description: "One intake for eight legal services — auto-classification, routing, SLAs, escalation and KSA working-calendar hours",
            icon: "briefcase",
            slug: "intake-service-desk"
          },
          {
            title: "Cases & litigation",
            description: "End-to-end plaintiff and defendant case management, with a taxonomy and timelines",
            icon: "scale",
            slug: "cases-litigation"
          },
          {
            title: "Consultations & investigations",
            description: "Advisory requests, legal opinions, and investigation records with statements",
            icon: "clipboard",
            slug: "consultations-investigations"
          },
          {
            title: "Contract lifecycle (CLM)",
            description: "Request, author, negotiate, approve, e-sign and renew — with obligations tracked live",
            icon: "doc",
            slug: "contracts-clm"
          },
          {
            title: "Clause library & knowledge",
            description: "Governed, reusable bilingual clauses and templates",
            icon: "book",
            slug: "clause-library-knowledge"
          },
          {
            title: "Approvals & delegation of authority",
            description: "Versioned, type-driven approval chains with a full audit trail",
            icon: "check",
            slug: "approvals-doa"
          },
          {
            title: "Roles, access & separation of duties",
            description: "A 14-role legal permission matrix with single sign-on and enforced author-not-approver",
            icon: "lock",
            slug: "roles-access-sod"
          },
          {
            title: "E-signature & integrations",
            description: "Electronic-signature envelopes plus Najiz courts and Nafath identity",
            icon: "pen",
            slug: "e-signature-integrations"
          },
          {
            title: "Reporting, AI & governance",
            description: "AI drafting that generates and rewrites documents, plus case and SLA reporting and an immutable audit",
            icon: "trend",
            slug: "reporting-ai-governance"
          }
        ],
        flow: [
          {
            step: "Author",
            description: "Draft in Arabic or English"
          },
          {
            step: "Negotiate",
            description: "Redline and compare versions"
          },
          {
            step: "Approve",
            description: "Routed through the Workflow Engine"
          },
          {
            step: "e-Sign",
            description: "Integrated e-signature"
          },
          {
            step: "Obligations",
            description: "Tracked live, with Najiz alignment"
          }
        ],
        bench: "Benchmarked against Clio and Icertis-class CLM — differentiated by Saudi-law content, Najiz alignment, and Arabic-as-primary."
      },
      {
        id: "mahamatech",
        name: "MahamaTech",
        ar: "مهامتك",
        role: "Projects & delivery",
        icon: "target",
        status: "soon",
        short: "Delivery tied to strategy and risk — a task is never an island; it traces up to an OKR and sideways to a risk, automatically.",
        hero: "Project and portfolio delivery, tied to strategy and risk.",
        desc: "MahamaTech manages portfolios, programs, projects, boards and tasks with Arabic-first plans, Gantt and kanban. Strategy and OKRs cascade in from BOSALAH; delivery risks escalate out to EHKAM. Every task traces up to an objective and sideways to a risk — automatically — so delivery is never disconnected from why it matters.",
        specs: [
          {
            metric: "AR-first",
            description: "Plans, Gantt & kanban"
          },
          {
            metric: "Stage gates",
            description: "Workflow-engine governed"
          },
          {
            metric: "OKR-linked",
            description: "Cascade from BOSALAH"
          }
        ],
        modules: [
          {
            title: "Portfolio & programs",
            description: "Hierarchy from portfolio down to task",
            icon: "layers"
          },
          {
            title: "Plans, Gantt & kanban",
            description: "Arabic-first planning and delivery boards",
            icon: "clipboard"
          },
          {
            title: "Resourcing & capacity",
            description: "Allocate people and track capacity",
            icon: "users"
          },
          {
            title: "Timesheets & costs",
            description: "Effort and cost capture per initiative",
            icon: "gauge"
          },
          {
            title: "Stage gates",
            description: "Phase approvals via the Workflow Engine",
            icon: "workflow"
          },
          {
            title: "Status & RAID logs",
            description: "Risks, assumptions, issues and dependencies",
            icon: "alert"
          },
          {
            title: "Methodology packs",
            description: "Reusable templates and delivery methodologies",
            icon: "book"
          },
          {
            title: "Strategy & risk linkage",
            description: "Tasks trace to OKRs and to EHKAM risks",
            icon: "network"
          }
        ],
        flow: [
          {
            step: "Plan",
            description: "Portfolio, program and project structure"
          },
          {
            step: "Resource",
            description: "Capacity and allocation"
          },
          {
            step: "Execute",
            description: "Boards, tasks and timesheets"
          },
          {
            step: "Govern",
            description: "Stage gates and RAID logs"
          },
          {
            step: "Connect",
            description: "OKRs in, delivery risks out"
          }
        ],
        bench: "Matched against Monday.com, Asana and Jira on boards and plans — beaten on strategy-and-risk linkage in Arabic."
      },
      {
        id: "ehkam",
        name: "EHKAM",
        ar: "إحكام",
        role: "Risk & compliance",
        icon: "shield",
        status: "soon",
        short: "GRC with the frameworks pre-loaded — one control, many frameworks; evidence collected once satisfies every mapped regulation.",
        hero: "Governance, risk and compliance — Saudi frameworks pre-loaded.",
        desc: "EHKAM ships with NCA ECC/CSCC, SAMA CSF, PDPL, ISO 27001 and NIST mapped on day one. A unified control library lets you map once and satisfy many frameworks; assessments collect evidence into Files, issues route through the Workflow Engine, and continuous monitoring is driven by Automation. Posture stays live and regulator-ready.",
        specs: [
          {
            metric: "Day-one",
            description: "NCA · SAMA · PDPL · ISO"
          },
          {
            metric: "Map once",
            description: "Unified control library"
          },
          {
            metric: "Live posture",
            description: "Regulator-ready reporting"
          }
        ],
        modules: [
          {
            title: "Framework packs",
            description: "NCA ECC/CSCC, SAMA CSF, PDPL, ISO 27001, NIST",
            icon: "shield"
          },
          {
            title: "Unified control library",
            description: "Map a control once, satisfy many frameworks",
            icon: "layers"
          },
          {
            title: "Risk register",
            description: "Scoring, appetite and treatment tracking",
            icon: "alert"
          },
          {
            title: "Assessments & evidence",
            description: "Evidence collection wired to the File service",
            icon: "clipboard"
          },
          {
            title: "Issues & actions",
            description: "Findings routed through the Workflow Engine",
            icon: "workflow"
          },
          {
            title: "Policy lifecycle",
            description: "Policy authoring, approval and attestations",
            icon: "doc"
          },
          {
            title: "Continuous monitoring",
            description: "Automation-driven control monitoring",
            icon: "cycle"
          },
          {
            title: "Immutable audit trail",
            description: "Tamper-evident record of every action",
            icon: "lock"
          }
        ],
        flow: [
          {
            step: "Map",
            description: "One control to many frameworks"
          },
          {
            step: "Assess",
            description: "Collect evidence into Files"
          },
          {
            step: "Remediate",
            description: "Issues via Workflow Engine"
          },
          {
            step: "Monitor",
            description: "Continuous, Automation-driven"
          },
          {
            step: "Report",
            description: "Live posture to BOSALAH"
          }
        ],
        bench: "Beaten ServiceNow GRC, MetricStream and Archer on day-one Saudi framework coverage and sovereign deployment."
      },
      {
        id: "bosalah",
        name: "BOSALAH",
        ar: "بوصلة",
        role: "Strategy & board",
        icon: "gauge",
        status: "soon",
        short: "The executive layer everything feeds — it writes almost nothing of its own; it is the read-model of the whole platform, which is its power.",
        hero: "The executive and board layer the whole platform feeds.",
        desc: "BOSALAH is the read-model of Clario360. It consumes risk, delivery and legal events plus ClarioDWH marts to render a Vision-2030-aligned strategy map, cascade OKRs from org to person, drive live executive dashboards, and generate Arabic board packs. It writes almost nothing of its own — every number arrives live from the suite, not from slides.",
        specs: [
          {
            metric: "Vision 2030",
            description: "Aligned strategy map"
          },
          {
            metric: "Live",
            description: "Every number from the bus"
          },
          {
            metric: "Board packs",
            description: "Arabic document generation"
          }
        ],
        modules: [
          {
            title: "Strategy map",
            description: "Vision-2030-aligned strategic objectives",
            icon: "target"
          },
          {
            title: "OKR cascade",
            description: "Objectives from org to team to person",
            icon: "network"
          },
          {
            title: "Executive dashboards",
            description: "Live, drill-down performance views",
            icon: "gauge"
          },
          {
            title: "Board packs",
            description: "Arabic board-pack document generation",
            icon: "doc"
          },
          {
            title: "Meetings & decisions",
            description: "Decisions and action tracking",
            icon: "users"
          },
          {
            title: "Initiative funding",
            description: "Funding and benefits realisation",
            icon: "trend"
          },
          {
            title: "KPI-breach alerts",
            description: "Automation-driven alerts on threshold breach",
            icon: "bell"
          },
          {
            title: "Decision-to-action",
            description: "Decisions become actions via the Workflow Engine",
            icon: "workflow"
          }
        ],
        flow: [
          {
            step: "Consume",
            description: "Risk, delivery, legal events + DWH"
          },
          {
            step: "Align",
            description: "Vision-2030 strategy map"
          },
          {
            step: "Cascade",
            description: "OKRs org → team → person"
          },
          {
            step: "Surface",
            description: "Live dashboards and board packs"
          },
          {
            step: "Act",
            description: "Decisions become tracked actions"
          }
        ],
        bench: "Matched against Diligent Boards and Quantive on boards and OKRs — beaten because every number arrives live from the suite, not from slides."
      },
      {
        id: "acta",
        name: "Acta",
        ar: "المجالس",
        role: "Board & committee governance",
        icon: "building",
        status: "ga",
        short: "Run boards and committees properly — committees, meetings, minutes and action items, tracked to closure.",
        hero: "Board and committee governance, end to end.",
        desc: "Acta manages committees, schedules and documents meetings, captures minutes and decisions, and tracks action items to closure. It gives governance a system of record — and publishes governance events to the bus so decisions become tracked actions across the platform.",
        specs: [
          {
            metric: "Committees",
            description: "Membership & mandate"
          },
          {
            metric: "Meetings",
            description: "Agenda to minutes"
          },
          {
            metric: "Actions",
            description: "Tracked to closure"
          }
        ],
        modules: [
          {
            title: "Committees",
            description: "Manage committees, membership and mandate",
            icon: "users"
          },
          {
            title: "Meetings",
            description: "Schedule, run and document meetings",
            icon: "book"
          },
          {
            title: "Agendas",
            description: "Build and circulate agendas",
            icon: "clipboard"
          },
          {
            title: "Minutes",
            description: "Capture minutes and decisions",
            icon: "doc"
          },
          {
            title: "Action items",
            description: "Track actions through to closure",
            icon: "checkCircle"
          },
          {
            title: "Decisions",
            description: "Record and trace board decisions",
            icon: "gavel"
          },
          {
            title: "Attendance",
            description: "Track attendance and quorum",
            icon: "calendar"
          },
          {
            title: "Governance events",
            description: "Decisions flow to the bus as actions",
            icon: "network"
          }
        ],
        flow: [
          {
            step: "Convene",
            description: "Set up committee and meeting"
          },
          {
            step: "Prepare",
            description: "Build and circulate the agenda"
          },
          {
            step: "Meet",
            description: "Run the meeting and capture minutes"
          },
          {
            step: "Decide",
            description: "Record decisions"
          },
          {
            step: "Track",
            description: "Drive action items to closure"
          }
        ],
        bench: "Benchmarked against board-governance tools — differentiated by living on the same platform, so decisions become tracked actions automatically."
      }
    ]
  },
  {
    id: "clariosec",
    name: "ClarioSec",
    ar: "الأمن",
    family: "sec",
    tagline: "Security operations, threat intelligence and cyber programs — one sovereign console, Arabic-first.",
    blurb: "ClarioSec runs the full security lifecycle on the platform core: a SOC with detection, hunting and MITRE ATT&CK mapping; a threat-intelligence layer tracking actors, campaigns and brand abuse; and four cyber programs — exposure management, data security posture, behavioural analytics, and a virtual CISO. Detections, risks and evidence all flow on the same event bus the rest of Clario360 uses.",
    core: "SOC + Threat Intelligence platform",
    coreDesc: "Security Operations brings IOC management, threat feeds, threat hunting, detection rules, an event explorer and MITRE ATT&CK coverage. Threat Intelligence adds a CTI dashboard with threat events, active campaigns, threat actors, brand-abuse monitoring, and geographic and sector targeting. The four cyber programs build on top — and every detection and finding publishes to the bus for automation, audit and executive views.",
    apps: [
      {
        id: "ctem",
        name: "CTEM",
        ar: "إدارة التعرض",
        role: "Continuous threat exposure management",
        icon: "target",
        status: "ga",
        short: "Continuously find, prioritise and close exposures before they become incidents — assessment to remediation, gated and tracked.",
        hero: "Continuous threat exposure management, assessment to remediation.",
        desc: "CTEM runs the exposure-management loop: scope the attack surface, run assessments, prioritise what actually matters, and drive remediation to closure. It ties findings to assets and routes fixes through the Workflow Engine, so exposure reduction is measurable rather than a one-off scan.",
        specs: [
          {
            metric: "Continuous",
            description: "Not point-in-time scans"
          },
          {
            metric: "Prioritised",
            description: "By real exploitability"
          },
          {
            metric: "Gated",
            description: "Remediation via Workflow"
          }
        ],
        modules: [
          {
            title: "Exposure dashboard",
            description: "A live view of your current attack-surface exposure",
            icon: "gauge"
          },
          {
            title: "Assessments",
            description: "Scheduled and on-demand exposure assessments",
            icon: "target"
          },
          {
            title: "Asset correlation",
            description: "Findings tied to the assets they actually affect",
            icon: "server"
          },
          {
            title: "Prioritisation",
            description: "Rank exposures by real-world exploitability",
            icon: "trend"
          },
          {
            title: "Remediation tracking",
            description: "Drive fixes to closure through the Workflow Engine",
            icon: "workflow"
          },
          {
            title: "MITRE ATT&CK mapping",
            description: "Coverage mapped to adversary techniques",
            icon: "network"
          },
          {
            title: "Detection rules",
            description: "Author and tune detections for known exposures",
            icon: "checkCircle"
          },
          {
            title: "Threat hunting",
            description: "Proactively hunt across the estate",
            icon: "search"
          }
        ],
        flow: [
          {
            step: "Scope",
            description: "Define the attack surface"
          },
          {
            step: "Assess",
            description: "Run exposure assessments"
          },
          {
            step: "Prioritise",
            description: "Rank by exploitability"
          },
          {
            step: "Remediate",
            description: "Gated fixes via Workflow"
          },
          {
            step: "Verify",
            description: "Confirm exposure reduced"
          }
        ],
        bench: "Benchmarked against exposure-management platforms — differentiated by sovereign deployment and one console shared with the rest of the security programme."
      },
      {
        id: "dspm",
        name: "DSPM",
        ar: "وضع أمن البيانات",
        role: "Data security posture management",
        icon: "database",
        status: "ga",
        short: "Find sensitive data, see who can reach it, and fix the exposure — data assets, policies, access control and compliance in one place.",
        hero: "Data security posture — find sensitive data and control who reaches it.",
        desc: "DSPM discovers and classifies data assets, evaluates them against policy, surfaces who has access, and drives remediation of risky exposure. Exceptions are governed, access is reviewed, and compliance posture is reported continuously — so sensitive data is protected by evidence, not assumption.",
        specs: [
          {
            metric: "Discover",
            description: "Classify data assets"
          },
          {
            metric: "Access",
            description: "See and control who reaches it"
          },
          {
            metric: "Continuous",
            description: "Live compliance posture"
          }
        ],
        modules: [
          {
            title: "Data assets",
            description: "Discover and classify sensitive data across stores",
            icon: "database"
          },
          {
            title: "Policies",
            description: "Define and enforce data-security policies",
            icon: "doc"
          },
          {
            title: "Remediations",
            description: "Close risky data exposure to completion",
            icon: "workflow"
          },
          {
            title: "Exceptions",
            description: "Govern and time-box accepted exceptions",
            icon: "alert"
          },
          {
            title: "Access control",
            description: "See and manage who can reach sensitive data",
            icon: "key"
          },
          {
            title: "Compliance",
            description: "Map posture to frameworks and report it live",
            icon: "scale"
          },
          {
            title: "Lineage & discovery",
            description: "Surface dark data and its lineage",
            icon: "search"
          },
          {
            title: "Audit trail",
            description: "Immutable record of access and changes",
            icon: "lock"
          }
        ],
        flow: [
          {
            step: "Discover",
            description: "Find and classify data"
          },
          {
            step: "Assess",
            description: "Evaluate against policy"
          },
          {
            step: "Expose",
            description: "Surface who has access"
          },
          {
            step: "Remediate",
            description: "Fix risky exposure"
          },
          {
            step: "Report",
            description: "Live compliance posture"
          }
        ],
        bench: "Beaten data-security-posture tools on sovereign deployment and on sharing a control library with GRC, so evidence is collected once."
      },
      {
        id: "ueba",
        name: "UEBA",
        ar: "تحليل السلوك",
        role: "User & entity behaviour analytics",
        icon: "finger",
        status: "soon",
        short: "Detect the threats signatures miss — baseline normal behaviour for users and entities, then surface the anomalies that matter.",
        hero: "User and entity behaviour analytics — catch what signatures miss.",
        desc: "UEBA builds behavioural baselines for users and entities, then scores deviations to surface insider threats, compromised accounts and lateral movement. Anomalies feed the SOC and publish to the bus, so behavioural risk becomes part of the same detection and response loop as everything else.",
        specs: [
          {
            metric: "Baselined",
            description: "Per user and entity"
          },
          {
            metric: "Scored",
            description: "Risk-ranked anomalies"
          },
          {
            metric: "Connected",
            description: "Feeds SOC & automation"
          }
        ],
        modules: [
          {
            title: "Behavioural baselines",
            description: "Learn normal behaviour per user and entity",
            icon: "trend"
          },
          {
            title: "Anomaly scoring",
            description: "Risk-rank deviations from the baseline",
            icon: "gauge"
          },
          {
            title: "Insider-threat detection",
            description: "Surface risky internal activity",
            icon: "users"
          },
          {
            title: "Account-compromise signals",
            description: "Detect compromised-credential patterns",
            icon: "key"
          },
          {
            title: "Lateral-movement detection",
            description: "Spot movement across the estate",
            icon: "network"
          },
          {
            title: "Entity risk timeline",
            description: "Track how an entity's risk evolves",
            icon: "eye"
          },
          {
            title: "SOC integration",
            description: "Feed anomalies into detection and response",
            icon: "shield"
          },
          {
            title: "Bus publishing",
            description: "Behavioural events available platform-wide",
            icon: "zap"
          }
        ],
        flow: [
          {
            step: "Collect",
            description: "Activity across users & entities"
          },
          {
            step: "Baseline",
            description: "Learn what normal looks like"
          },
          {
            step: "Score",
            description: "Rank deviations by risk"
          },
          {
            step: "Surface",
            description: "Route anomalies to the SOC"
          },
          {
            step: "Respond",
            description: "Automate and attest"
          }
        ],
        bench: "Matched against UEBA modules in major SIEMs — differentiated by running on the same sovereign console and bus as the whole platform."
      },
      {
        id: "clariovciso",
        name: "ClarioVCISO",
        ar: "مدير الأمن الافتراضي",
        role: "Virtual CISO",
        icon: "bot",
        status: "ga",
        short: "A virtual CISO that runs the security programme — risk register, policies, third-party risk, evidence, maturity and incident readiness, with AI briefings.",
        hero: "A virtual CISO that runs the whole security programme.",
        desc: "ClarioVCISO is the management layer over security: a live risk register, policy lifecycle, third-party risk, an evidence vault, maturity-and-budget tracking, awareness and IAM, and incident readiness — with AI-generated executive briefings. It turns scattered security work into a governed, board-ready programme.",
        specs: [
          {
            metric: "Programme",
            description: "Risk to readiness"
          },
          {
            metric: "AI briefings",
            description: "Executive-ready"
          },
          {
            metric: "Evidence",
            description: "Vaulted & auditable"
          }
        ],
        modules: [
          {
            title: "Executive briefing",
            description: "AI-generated security briefings for leadership",
            icon: "bot"
          },
          {
            title: "Risk register",
            description: "Live security-risk register with treatment",
            icon: "book"
          },
          {
            title: "Policy lifecycle",
            description: "Author, approve and attest security policies",
            icon: "doc"
          },
          {
            title: "Compliance",
            description: "Track posture against required frameworks",
            icon: "checkCircle"
          },
          {
            title: "Third-party risk",
            description: "Assess and monitor vendor risk",
            icon: "handshake"
          },
          {
            title: "Evidence vault",
            description: "Collect and retain audit evidence",
            icon: "lock"
          },
          {
            title: "Maturity & budget",
            description: "Track security maturity against spend",
            icon: "gauge"
          },
          {
            title: "Incident readiness",
            description: "Awareness, IAM and incident preparedness",
            icon: "alert"
          }
        ],
        flow: [
          {
            step: "Assess",
            description: "Risk register and maturity"
          },
          {
            step: "Govern",
            description: "Policies and third-party risk"
          },
          {
            step: "Evidence",
            description: "Vault audit evidence"
          },
          {
            step: "Brief",
            description: "AI executive briefings"
          },
          {
            step: "Improve",
            description: "Track maturity vs budget"
          }
        ],
        bench: "Benchmarked against vCISO services and GRC tooling — beaten by combining live programme management with AI briefings on a sovereign platform."
      }
    ]
  },
  {
    id: "clarioinsight",
    name: "ClarioInsight",
    ar: "التحليلات",
    family: "insight",
    tagline: "Data intelligence and analytics — pipelines, quality and dark-data discovery, surfaced as live dashboards.",
    blurb: "ClarioInsight is the analytics layer of Clario360: a data-intelligence engine that manages sources, models, pipelines, quality and dark-data discovery, paired with a dashboards-and-reporting surface for KPIs, reports and alerts. It reads from the sovereign lakehouse and turns governed data into decisions.",
    core: "Data Intelligence + Dashboards",
    coreDesc: "Data Intelligence handles sources, data models, pipelines, quality rules, contradiction detection and dark-data discovery. The dashboards surface gives every team live dashboards, KPIs, reports and alerts. Together they read from ClarioDWH and the event bus, so the numbers are governed and current.",
    apps: [
      {
        id: "data-intelligence",
        name: "Data Intelligence",
        ar: "ذكاء البيانات",
        role: "Sources, models, pipelines & quality",
        icon: "layers",
        status: "ga",
        short: "Govern data end to end — sources, models, pipelines, quality and dark-data discovery, with contradiction detection built in.",
        hero: "Data intelligence — govern data from source to insight.",
        desc: "The data-intelligence engine connects sources, defines models, runs pipelines and enforces quality rules — while surfacing contradictions and discovering dark data across the estate. It is the governance layer that makes analytics trustworthy.",
        specs: [
          {
            metric: "Pipelines",
            description: "Source to model"
          },
          {
            metric: "Quality",
            description: "Rules enforced"
          },
          {
            metric: "Dark data",
            description: "Discovered & surfaced"
          }
        ],
        modules: [
          {
            title: "Data sources",
            description: "Connect and manage data sources",
            icon: "plug"
          },
          {
            title: "Data models",
            description: "Define conformed, reusable models",
            icon: "boxes"
          },
          {
            title: "Pipelines",
            description: "Build and run data pipelines",
            icon: "workflow"
          },
          {
            title: "Data quality",
            description: "Enforce quality rules and gates",
            icon: "checkCircle"
          },
          {
            title: "Contradictions",
            description: "Surface conflicting data automatically",
            icon: "zap"
          },
          {
            title: "Dark data",
            description: "Discover ungoverned, hidden data",
            icon: "search"
          },
          {
            title: "Analytics",
            description: "Analyse across the governed estate",
            icon: "trend"
          },
          {
            title: "Lakehouse link",
            description: "Reads from ClarioDWH zones",
            icon: "database"
          }
        ],
        flow: [
          {
            step: "Connect",
            description: "Bring in data sources"
          },
          {
            step: "Model",
            description: "Define conformed models"
          },
          {
            step: "Process",
            description: "Run governed pipelines"
          },
          {
            step: "Validate",
            description: "Enforce quality rules"
          },
          {
            step: "Discover",
            description: "Surface dark data & conflicts"
          }
        ],
        bench: "Differentiated by governing quality and discovering dark data on the same sovereign platform that stores and secures the data."
      },
      {
        id: "dashboards",
        name: "Visus Dashboards",
        ar: "لوحات المعلومات",
        role: "Dashboards, KPIs, reports & alerts",
        icon: "gauge",
        status: "ga",
        short: "Live dashboards, KPIs, reports and alerts — the reporting surface every team reads, fed by governed data.",
        hero: "Dashboards, KPIs and reports — fed by governed, live data.",
        desc: "The dashboards surface turns governed data into live dashboards, tracked KPIs, scheduled reports and threshold alerts. Because it reads from the same lakehouse and bus as the rest of the platform, every figure is current and traceable — not a stale export.",
        specs: [
          {
            metric: "Live",
            description: "Always current"
          },
          {
            metric: "KPIs",
            description: "Tracked & alerting"
          },
          {
            metric: "Reports",
            description: "Scheduled & shareable"
          }
        ],
        modules: [
          {
            title: "Dashboards",
            description: "Build and share live dashboards",
            icon: "gauge"
          },
          {
            title: "KPIs",
            description: "Define and track key metrics",
            icon: "trend"
          },
          {
            title: "Reports",
            description: "Schedule and distribute reports",
            icon: "doc"
          },
          {
            title: "Alerts",
            description: "Threshold alerts on the metrics that matter",
            icon: "bell"
          },
          {
            title: "Drill-down",
            description: "Move from summary to detail",
            icon: "search"
          },
          {
            title: "Data binding",
            description: "Reads governed data from the lakehouse",
            icon: "database"
          },
          {
            title: "Access control",
            description: "Scope dashboards by role and tenant",
            icon: "key"
          },
          {
            title: "Export & share",
            description: "Share figures with traceability",
            icon: "zap"
          }
        ],
        flow: [
          {
            step: "Bind",
            description: "Connect to governed data"
          },
          {
            step: "Build",
            description: "Compose dashboards & KPIs"
          },
          {
            step: "Track",
            description: "Monitor metrics live"
          },
          {
            step: "Alert",
            description: "Trigger on thresholds"
          },
          {
            step: "Share",
            description: "Distribute reports"
          }
        ],
        bench: "Matched against BI tools on dashboards and reports — beaten because the data is governed, sovereign and live, not a periodic extract."
      }
    ]
  }
] as const satisfies readonly MarketingSuite[];

export type MarketingSuiteRecord = (typeof MARKETING_SUITES)[number];
export type MarketingSuiteId = (typeof MARKETING_SUITES)[number]['id'];
export type MarketingAppId = (typeof MARKETING_SUITES)[number]['apps'][number]['id'];

export const MARKETING_APPS = MARKETING_SUITES.flatMap((suite) =>
  suite.apps.map((app) => ({
    ...app,
    suiteId: suite.id,
    suiteName: suite.name,
    suiteFamily: suite.family,
  })),
) satisfies readonly MarketingAppWithSuite[];

export type MarketingAppRecord = (typeof MARKETING_APPS)[number];
export type MarketingSuiteRouteParam = { readonly suite: MarketingSuiteId };
export type MarketingAppRouteParam = { readonly suite: MarketingSuiteId; readonly app: MarketingAppId };
export type MarketingSuiteAppRouteParam = { readonly app: MarketingAppId };

export const MARKETING_SUITE_ROUTE_PARAMS = MARKETING_SUITES.map((suite) => ({
  suite: suite.id,
})) satisfies readonly MarketingSuiteRouteParam[];

export const MARKETING_APP_ROUTE_PARAMS = MARKETING_SUITES.flatMap((suite) =>
  suite.apps.map((app) => ({
    suite: suite.id,
    app: app.id,
  })),
) satisfies readonly MarketingAppRouteParam[];

export function getMarketingSuite(id: string): MarketingSuiteRecord | undefined {
  return MARKETING_SUITES.find((suite) => suite.id === id);
}

export function getMarketingApp(id: string): MarketingAppRecord | undefined {
  return MARKETING_APPS.find((app) => app.id === id);
}

export function getMarketingAppsForSuite(suiteId: string): readonly MarketingAppRecord[] {
  return MARKETING_APPS.filter((app) => app.suiteId === suiteId);
}

export function getMarketingAppRouteParamsForSuite(
  suiteId: string,
): readonly MarketingSuiteAppRouteParam[] {
  const suite = getMarketingSuite(suiteId);

  if (!suite) {
    return [];
  }

  return suite.apps.map((app) => ({ app: app.id }));
}
