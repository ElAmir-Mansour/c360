# Clario360 SIEM Module — Product Requirements (Central Bank of Nigeria Edition)

> **Document status:** Draft v1.0
> **Owner:** Cyber & Platform Engineering
> **Target tenant:** Central Bank of Nigeria (CBN) and CBN-supervised financial institutions
> **Related:** [PRD Compliance Matrix](PRD_COMPLIANCE_MATRIX.md), [Updated Architecture as-is](../../Updated%20Architecture%20as-is.md), [Security Architecture Assessment](../../SECURITY_ARCHITECTURE_ASSESSMENT.md), [Capability Matrix](../../CAPABILITY_MATRIX.md)

---

## 1. Executive Summary

The Central Bank of Nigeria (CBN) is the apex regulator and operator of national payment infrastructure (RTGS, NIBSS, NIP, BVN, NIN-linked services) and the lender-of-last-resort to the Nigerian financial system. A compromise of CBN or any deposit-money bank (DMB) under its supervision is a systemic-risk event — economic, reputational and constitutional. CBN's own **Risk-Based Cyber-Security Framework (RBCSF)** mandates that supervised institutions operate a 24×7 Security Operations Centre (SOC) backed by an enterprise SIEM with full audit, correlation, threat-intelligence, and 24-hour incident-reporting capability.

Clario360 already ships eight production services (IAM, Gateway, Audit, Workflow, Notification, File, Cyber, Data, Acta, Lex, Visus) and a strong cyber-suite covering CTI, UEBA, CTEM, DSPM and a four-engine detection layer (Sigma, Threshold, Correlation, Anomaly). It does **not** yet ship the end-to-end log-collection-to-board-report pipeline that a Tier-1 central bank SOC requires.

This PRD specifies a new **SIEM module** that:
1. Adds a horizontally scalable log pipeline (collectors → broker → normalizer → hot/warm/cold store).
2. Layers a regulator-grade SOC console (triage, case management, SOAR playbooks, hunting workbench, war-room).
3. Bundles **CBN-aligned compliance packs**: RBCSF, NDPA/NDPR, NIBSS-IAF, SWIFT CSP, PCI DSS v4.0, NIST CSF 2.0, ISO/IEC 27001:2022.
4. Reuses Clario360's existing tamper-evident audit chain, multi-tenant gateway, RBAC, AI-governance, and Kafka event bus — no parallel infrastructure.
5. Honours Nigerian **data-residency** requirements: primary processing and storage inside Nigeria, with controlled cross-border replication for DR.

The result: CBN gets a single platform to monitor its own estate **and** supervise the cyber-posture of the institutions it regulates, with evidence ready for examination by the Banking Supervision and Payments System departments.

---

## 2. Regulatory & Strategic Context

### 2.1 Mandatory frameworks

| Framework | Owner | Applicability to this PRD |
| --- | --- | --- |
| **CBN Risk-Based Cyber-Security Framework** (RBCSF for DMBs, PSBs, OFIs, PSPs) | CBN | §6 SOC, §7 SIEM, §9 Incident Reporting, §10 Threat Intelligence — load-bearing |
| **CBN Cyber-Resilience Framework for FMIs** | CBN Payments System Mgmt | RTGS / NIBSS / NIP / CSCS impact mapping |
| **Nigeria Data Protection Act (NDPA) 2023** + NDPR 2019 | NDPC / NITDA | Data-subject rights, breach notification within 72 hrs |
| **NIBSS Industry Anti-Fraud (NIBSS-IAF) feed** | NIBSS | Mandatory ingest as a CTI source for DMBs |
| **SWIFT Customer Security Programme (CSP) v2025** | SWIFT | Required if tenant operates SWIFTNet (all DMBs do) — CSCF 1.4, 6.4, 6.5A controls |
| **PCI DSS v4.0** | PCI SSC | Required for any tenant in scope for cardholder-data environments |
| **NIST CSF 2.0** | NIST | Used by CBN bank examiners as the de-facto maturity yardstick |
| **ISO/IEC 27001:2022** | ISO | Most DMBs are certified; controls A.5.24 – A.8.16 SIEM-relevant |
| **AML/CFT** | NFIU, CBN AML/CFT Office | Correlate suspicious-activity signals; feed STRs |

### 2.2 Non-negotiable principles

- **Data residency in Nigeria.** Primary hot/warm storage and operator console must operate from Nigerian data centres (Lagos/Abuja). Cross-border replication only to approved DR sites with NDPC sign-off.
- **Tamper-evident integrity.** Every ingested log line and every analyst action must be cryptographically chained — reuse the existing [audit hash-chain](../../backend/internal/audit/service/integrity_service.go).
- **Regulator-ready evidence.** Any artefact must be exportable in a court-admissible package: chain-of-custody, hash manifest, signed timestamp.
- **24-hour incident reporting.** Material cyber-events must be reported to CBN-CSIRT within 24 hours, and to NDPC within 72 hours where personal data is involved. The system must structure incidents to make these reports automatic.
- **Zero-trust by default.** Operator access is MFA-gated, time-boxed, and recorded as a screen session for post-incident review.

---

## 3. Goals & Success Metrics

### 3.1 Goals

| ID | Goal |
| --- | --- |
| G1 | Provide CBN's SOC with a single pane to ingest, detect, investigate and report cyber-events across the Bank and supervised institutions. |
| G2 | Reduce **Mean Time to Detect (MTTD)** for critical events to ≤ 5 minutes from log emission. |
| G3 | Reduce **Mean Time to Respond (MTTR)** for P1 incidents to ≤ 60 minutes through SOAR automation. |
| G4 | Automate ≥ 80% of CBN-RBCSF compliance evidence collection. |
| G5 | Enable supervisory officers to attest to a regulated institution's cyber-posture from inside Clario360, without separate spreadsheet collection. |
| G6 | Pass independent SWIFT CSP, ISO 27001 and PCI DSS v4 assessments using SIEM-generated evidence. |

### 3.2 Success metrics (12 months post-GA)

| Metric | Target |
| --- | --- |
| Sustained ingest throughput | 250,000 EPS aggregate, burst 500,000 EPS |
| End-to-end ingest latency (collector → searchable) | p95 ≤ 30 s; p99 ≤ 60 s |
| Search latency over last 24 h hot tier | p95 ≤ 2 s for 1 GB working set |
| Search latency over 13-month warm tier | p95 ≤ 15 s |
| Detection-rule false-positive rate | ≤ 5% per rule per week (reuse `FPRate()` from `detection_rule.go`) |
| Automated case enrichment coverage | ≥ 90% of P1/P2 cases auto-enriched within 2 minutes of creation |
| Compliance evidence freshness | 100% of CBN RBCSF, NDPA, SWIFT CSP controls evidenced within their re-attestation window |
| Audit-chain integrity | 100% verifiable; any break paged within 5 minutes |

---

## 4. Scope

### 4.1 In scope

- New service: **`siem-service`** (Go) deployed alongside `cyber-service` on the existing Clario360 service mesh.
- New collector fleet: lightweight Go agents (heavy hosts) and agentless adapters (cloud-trail, syslog, Kafka-mirror, file-tail).
- New log-store sidecar: OpenSearch (open-source) for searchable hot/warm tiers; existing Postgres for case metadata and compliance state; S3-compatible (MinIO on-prem) for cold/WORM tier.
- New frontend suite at [`(dashboard)/siem/`](../../frontend/src/app/) following the existing module convention (alerts, cases, hunting, sources, content, dashboards, reports, playbooks, intel).
- SOAR playbook editor that emits to the existing [`workflow-engine`](../../backend/cmd/workflow-engine/main.go) — no second orchestrator.
- CBN-specific compliance packs (RBCSF, NDPA, SWIFT CSP, NIBSS-IAF, PCI DSS, ISO 27001, NIST CSF).
- Regulator-reporting templates (CBN-CSIRT incident form, NDPC breach form, NIBSS fraud-loss report).

### 4.2 Out of scope (v1)

- Network packet capture (NDR) — covered by future Clario360 NDR module.
- Endpoint detection agents (EDR) — third-party (e.g. CrowdStrike, SentinelOne) ingested via collector.
- DRM-grade media forensics.
- ATM-switch instrumentation beyond log ingest.
- General-purpose data lake (Clario360 `data-service` already owns this).

### 4.3 Explicitly deferred (v1.x)

- ML-driven UEBA peer-grouping refinement (extend the existing UEBA engine).
- Deception / honey-token integration.
- Federated SIEM-of-SIEMs for inter-bank threat-sharing (planned for v2 once CBN sector-CSIRT signs off).

---

## 5. Personas

| Persona | Goals | Key surfaces |
| --- | --- | --- |
| **CBN SOC Tier-1 Analyst** | Triage alerts on shift, escalate within SLA | Alert queue, case-card quick actions, playbook one-click runs |
| **CBN SOC Tier-2 Investigator** | Hunt, correlate, build timelines | Hunting workbench, raw-event search, pivot graph, forensic timeline |
| **CBN SOC Tier-3 / Threat Hunter** | Author detections, tune content, perform retro-hunts | Content editor (Sigma/KQL-equivalent), detection-as-code git sync, test harness |
| **Bank CISO (supervised institution)** | View their own institution's posture, respond to CBN findings | Tenant-scoped dashboard, compliance attestation pack, evidence uploader |
| **CBN Bank Examiner** | Sample-test a supervised institution, sign off RBCSF attestation | Multi-tenant supervisory view, evidence drilldown, attestation workflow |
| **CBN CSIRT Lead** | Coordinate cross-bank response, file 24-hour reports | War-room module, regulator-report builder, cross-tenant incident view |
| **vCISO / Compliance Officer** | Map controls, prep audit | Compliance pack viewer, gap analysis, evidence locker |
| **Forensic Specialist** | Reconstruct events, preserve chain-of-custody | Forensic timeline, evidence export, hash-manifest download |

Permissions: extend the existing RBAC enum at [backend/internal/auth/rbac.go](../../backend/internal/auth/rbac.go) with `siem:read`, `siem:write`, `siem:hunt`, `siem:respond`, `siem:content_author`, `siem:compliance_attest`, `siem:supervisory_view`, `siem:admin`. Wildcard `siem:*` follows the existing pattern. Default-roles updated: `analyst` → `siem:read,siem:hunt`, `tenant_admin` → `siem:*` for own tenant, `super_admin` → cross-tenant `siem:supervisory_view`.

---

## 6. Architecture Overview

### 6.1 Composition with existing Clario360 services

```
                +---------------------------+
                |   Frontend (dashboard)    |
                |   /siem/* suite           |
                +-------------+-------------+
                              |
                  HTTPS / WSS  (existing JWT, RS256)
                              |
                +-------------v-------------+
                |       API Gateway         |  (existing — adds /api/v1/siem prefix)
                +-------------+-------------+
                              |
   +---------------+----------+---------+----------------+
   |               |                    |                |
+--v--+        +---v---+            +---v---+        +---v---+
|siem |        | cyber |  reuse:    | audit |  reuse:|workflow
|svc  |<------>| svc   |  CTI,UEBA, | svc   |  hash  |engine
+--+--+        +-------+  MITRE,    +-------+  chain +---+---+
   |                    DSPM                                |
   | publish/consume CloudEvents (Kafka)                    |
   +----------------------+---------------------------------+
                          |
                  +-------v-------+
                  |  Kafka Bus    |  (existing)
                  +-------+-------+
                          |
       +------------------+------------------+-------------+
       |                  |                  |             |
+------v------+   +-------v-------+  +-------v------+  +---v-------+
| Collectors  |   |  Normalizer   |  | Detection    |  | Notif svc |
| - syslog    |-->|  (parsers,    |->| engines      |  | (WS push) |
| - CEF/LEEF  |   |  ECS schema)  |  | (Sigma,      |  +-----------+
| - Win Event |   +-------+-------+  | Threshold,   |
| - cloud-tr. |           |          | Correlation, |
| - file-tail |           v          | Anomaly,     |
| - k8s-audit |   +-------+-------+  | AI)          |
| - DB-audit  |   | OpenSearch    |  +-------+------+
| - NetFlow   |   | hot (7-30d)   |          |
| - EDR API   |   | warm (13mo)   |<---------+
+-------------+   +-------+-------+
                          |
                  +-------v-------+
                  | S3/MinIO WORM |
                  | cold (7-10y)  |
                  +---------------+
```

### 6.2 Service responsibilities

- **`siem-service`** (new): collector registry & control plane, parser/normalizer orchestration, detection-rule lifecycle, case management, hunting query API, playbook trigger API, compliance evidence collector, regulator-report builder.
- **`cyber-service`** (existing, extended): continues to own CTI, UEBA, MITRE, DSPM. SIEM consumes its outputs over the bus, never duplicates them.
- **`audit-service`** (existing): every SIEM event is recorded into the [hash chain](../../backend/internal/audit/service/integrity_service.go) — this is the legal evidence backbone.
- **`workflow-engine`** (existing): SOAR playbooks compile to workflow definitions; no second orchestration runtime.
- **`notification-service`** (existing): SOC pager fan-out (Slack, Teams, SMS via NIBSS gateway, email, in-app WS); reuses the [WebSocket hub](../../backend/internal/notification/websocket/hub.go).
- **`file-service`** (existing): evidence-pack upload/download with the existing virus-scan path.
- **`iam-service`** (existing): no changes required other than adding the new permissions.

### 6.3 New infrastructure

| Component | Choice (v1) | Notes |
| --- | --- | --- |
| Hot/warm log store | **OpenSearch 2.x** (Apache 2.0) | Index per (tenant, day); ISM policies move warm → frozen → delete |
| Cold/WORM store | **MinIO** S3-compatible, object-lock enabled | 7-year minimum for CBN; 10-year for SWIFT-related |
| Collector agent | **Vector** (Rust, Apache 2.0) wrapped by Clario360 control-plane | Lighter than Filebeat; supports CEF, syslog, NetFlow, AWS/GCP/Azure |
| Search/aggregation API | OpenSearch DSL behind a Clario360 query-builder | We expose **CSQL** (Clario Search Query Language) — see §9 |
| HSM-signed timestamps | YubiHSM 2 / SoftHSM in dev | Required for SWIFT CSP & NDPA evidence |

Why OpenSearch + MinIO and **not** ClickHouse: CBN-RBCSF reviewers expect a SIEM that can answer free-text and lucene-style searches interactively; ClickHouse beats it on aggregate analytics but loses on ad-hoc forensic search and lucene parity. We pick OpenSearch for v1 and reassess columnar TSDB in v2 once query patterns are observed.

---

## 7. Functional Requirements

### F1 — Log source onboarding & ingestion

**F1.1** The system must support onboarding of these source types out of the box:
- Syslog (RFC 3164 / 5424, UDP/TCP/TLS), CEF, LEEF, Windows Event Log (WEC/WEF), Sysmon, Linux audit, Kubernetes audit, AWS CloudTrail / CloudWatch, GCP Cloud Audit, Azure Activity / Defender, Office 365 Unified Audit, Google Workspace, Okta, generic JSON over HTTPS, NetFlow v5/v9/IPFIX, Zeek, Suricata, file-tail, database-audit (PostgreSQL, Oracle, SQL Server), MQ (Kafka mirror).
- **CBN-specific:** NIBSS-IAF webhook feed; CBN Banking Supervision intranet syslog forwarder; SWIFTNet Alliance Access log forwarder; RTGS audit trail; Temenos T24 / Finacle core-banking audit; ATM-switch (Postilion / BASE24) logs; Card-management-system audit (Way4, Pulse).

**F1.2** Each source must declare: source-type, expected EPS, time-zone (assume Africa/Lagos), expected message rate; the system computes baseline and alarms on ±50% deviation (silent-source detection — RBCSF §7.5).

**F1.3** Collectors must support **mutual TLS** to the broker, with certificates issued by Clario360's internal CA and rotated automatically every 90 days.

**F1.4** Inbound rate-limiting is per-tenant per-source; spillover routes to an `siem.ingest.overflow` topic and the SOC is paged.

**F1.5** Backpressure: if downstream storage is unavailable, collectors must spool to disk for up to 24 h with disk-encryption-at-rest.

### F2 — Parsing, normalization & enrichment

**F2.1** Adopt the **Elastic Common Schema (ECS) v8** as the canonical event schema. Parsers convert raw → ECS. This is the open standard CBN examiners can reason about.

**F2.2** A pipeline graph (Vector VRL or equivalent) supports: filter, drop, rename, geo-enrich, asset-enrich, identity-enrich (resolve username → IAM user record), threat-intel-enrich (call existing CTI service for IOC matches), pseudonymization (NDPA — hash BVN / NIN before storage unless a "see-real-PII" privileged role is invoked, in which case the access is itself audited).

**F2.3** Field-level encryption at rest for `event.user.bvn`, `event.user.nin`, `event.user.account_number`, `event.payment.pan`, and any field tagged `pii=true` in the parser config.

**F2.4** A parser test harness mandatory before promoting any parser to prod — author writes fixtures, system computes deltas. Wire into existing CI.

**F2.5** Schema evolution: every parser version is logged into the existing AI-governance lifecycle service (parsers are treated as low-risk models for traceability).

### F3 — Storage, retention & lifecycle

**F3.1** Default retention tiers (CBN RBCSF §11.2):
- Hot (instant search): 30 days
- Warm (sub-15s search): 13 months
- Cold/WORM (rehydratable in ≤ 4 hours): 7 years (10 years for SWIFT-tagged data)

Retention must be **per-data-class**: PII fields obey NDPA minimization (configurable shorter retention with mandatory justification trail).

**F3.2** Indices are immutable post-write (OpenSearch `force-merge + freeze`); deletion is **only** allowed via a four-eyes approval workflow recorded in the audit chain.

**F3.3** WORM objects in MinIO use object-lock in compliance mode for the legal retention period; deletion before expiry must be denied by storage, not by application.

**F3.4** Every persistence boundary (hot index roll, warm freeze, cold seal) writes a **chain anchor** to the existing audit hash chain so a forensic investigator can prove no tampering between SIEM and audit.

### F4 — Detection & correlation

**F4.1** Reuse and extend the existing four-engine detection layer in [`backend/internal/cyber/detection/`](../../backend/internal/cyber/detection/):
- **Sigma evaluator** — accept Sigma YAML rules as-is.
- **Threshold evaluator** — counts within a tumbling/sliding window.
- **Correlation evaluator** — multi-stage attack sequences (ordered, time-bounded, group-by aware).
- **Anomaly evaluator** — baseline-driven (Redis-cached baselines).

**F4.2** Add new capabilities required for v1:
- **Cross-source correlation** — e.g. failed SWIFT login → followed within 10 min by RTGS message MT103 from a new IP → page CSIRT.
- **Sequence with negation** — "RTGS payment created without prior approval event" — required by SWIFT CSP control 2.5A.
- **Geo-velocity** — same user logged in from Lagos and Kano within 20 minutes → impossible-travel.
- **Joinable lookups** — VIP-user list, watchlist of merchant IDs, NIBSS fraud-watchlist refreshed daily.

**F4.3** Rules must carry MITRE ATT&CK tactic/technique IDs (the existing rule model already supports this) and a **CBN-RBCSF control ID** field so a rule firing can be traced to a regulatory control.

**F4.4** Detection-as-code: rules live in a git repository with CI; a webhook syncs to the SIEM. Rule deploys are reviewed via the existing workflow-engine four-eyes flow.

**F4.5** Every rule must declare a **test harness** (sample events that should match, sample events that should not). CI fails if drift exceeds 5%.

**F4.6** Rule performance budget: any single rule whose evaluator exceeds 200 ms p99 over a 1-hour window is auto-quarantined and the author is notified.

### F5 — UEBA integration

**F5.1** SIEM publishes enriched events to the existing UEBA collector (no new ingestion).

**F5.2** UEBA alerts surface in the SIEM alert queue with the existing risk score plus a **regulator-impact score** computed by SIEM (function of: VIP-user, RTGS-touching, BVN/NIN-touching, customer-facing channel).

**F5.3** A new **"insider risk"** lens combines UEBA peer-anomaly + DLP signals + privileged-access logs — required for CBN-RBCSF §8.4 and NDPA §29.

### F6 — Threat intelligence

**F6.1** Reuse existing CTI feed adapters (STIX, TAXII, MISP, OTX, CSV) — see [`backend/internal/cyber/cti/feed/adapters/`](../../backend/internal/cyber/cti/feed/adapters/).

**F6.2** Add **NIBSS-IAF** adapter (the Nigerian inter-bank anti-fraud feed) — mandatory for any DMB tenant.

**F6.3** Add **CBN-CSIRT advisory** adapter — a signed JSON feed CBN-CSIRT publishes to supervised institutions.

**F6.4** All ingested IOCs must be matched at ingest time (streaming join) and at search time (retro-hunt). Match results write back to the alert with `intel.context`.

**F6.5** False-positive feedback loops — analyst marking an alert as FP must update the IOC's confidence score (already supported by existing CTI service).

### F7 — Alerting, triage, case management

**F7.1** Every detection produces an **alert**. Alerts of the same fingerprint within a configurable dedup window roll into the same **case** (the noisier object).

**F7.2** Case object fields: id, tenant_id, severity, status (`new` / `assigned` / `investigating` / `contained` / `eradicated` / `recovered` / `closed`), assignee, queue, sla_deadline, mitre_tactics[], mitre_techniques[], affected_assets[], affected_users[], related_alerts[], related_iocs[], regulator_impact_score, cbn_control_ids[], swift_relevant, ndpa_relevant, pci_relevant, narrative, timeline[], evidence[], parent_case_id, child_case_ids[].

**F7.3** SLAs follow CBN-RBCSF and tenant policy. Defaults: P1 — triage 15 min, contain 60 min; P2 — triage 30 min, contain 4 h; P3 — triage 4 h; P4 — triage next business day.

**F7.4** Case timeline reuses the existing audit hash chain: every status change, assignee change, comment, evidence attachment writes a chained entry.

**F7.5** Four-eyes required for any case action that touches production (account disable, SWIFT message revoke, RTGS payment hold) — driven by workflow-engine.

**F7.6** **Regulator-clock**: when a case is tagged `material`, a 24-hour countdown to CBN-CSIRT report starts; a 72-hour countdown to NDPC report starts when `ndpa_relevant=true`. Countdowns are visible on the case card and trigger paging at 75 % elapsed.

### F8 — SOAR playbooks

**F8.1** A visual playbook editor compiles to a workflow definition consumable by the existing `workflow-engine`.

**F8.2** Pre-built playbooks (out of the box):
- Phishing email triage (Microsoft Defender / Proofpoint).
- Compromised user account containment (disable in IAM, revoke OAuth tokens, force password reset, paste audit to case).
- Suspicious SWIFT MT103 (page CSIRT, freeze workflow, draft CBN report).
- NIBSS-IAF IOC hit (block at firewall via firewall-mgmt API, notify fraud desk).
- Data-exfiltration via S3 (snapshot, revoke key, page DPO, prep NDPA report).
- Ransomware indicators on endpoint (isolate via EDR API, page IR retainer, freeze backups).
- RTGS anomaly playbook (engages CBN Payments System Mgmt Department).

**F8.3** Every action in a playbook must be **reversible or have a clearly documented compensating action**, and must record the API call + response into the case timeline.

**F8.4** Dry-run mode is mandatory before promotion — a playbook replays against a recent simulated incident.

### F9 — Threat hunting workbench

**F9.1** Introduce **CSQL** (Clario Search Query Language) — a thin, documented, lucene-superset DSL that compiles to OpenSearch DSL. Targets: bounded learning curve for Nigerian SOC talent already trained on Splunk SPL or Elastic KQL.

Example:
```csql
event.action=swift.mt103 user.is_vip=true
| stats count by user.name, destination.bic
| where count > 3
| sort -count
```

**F9.2** Notebooks: a Jupyter-like surface lets a hunter persist a query chain, annotate, share. Notebooks attach to cases as evidence.

**F9.3** A **pivot graph** visualises entity relationships (user ↔ host ↔ ip ↔ ioc ↔ case) — built on the existing Recharts/cytoscape stack.

**F9.4** Saved searches can be promoted to detections — closes the loop hunter → analyst.

**F9.5** Retro-hunt: any new IOC, parser, or rule can be replayed against warm tier with throttled query budget so it does not starve real-time search.

### F10 — Compliance reporting (CBN-aligned packs)

**F10.1** Each pack maps controls → required evidence → automated collector → manual upload slot → re-attestation window → owner.

Packs delivered in v1:
- **CBN-RBCSF** (Risk-Based Cyber-Security Framework) — full control set.
- **CBN-CRF for FMIs** — payments-system slice.
- **NDPA 2023 + NDPR 2019** — data-subject rights, breach notification, DPIA log.
- **SWIFT CSP v2025** — CSCF controls (focus on 1.x, 2.x, 4.x, 6.x).
- **PCI DSS v4.0** — requirements 10 (logging), 12 (policy), 6 (vuln-mgmt evidence).
- **NIST CSF 2.0** — Govern, Identify, Protect, Detect, Respond, Recover.
- **ISO/IEC 27001:2022** — Annex A (focus A.5, A.8 cyber-relevant).
- **NIBSS-IAF participation** — feed health + FP-rate reporting back to NIBSS.

**F10.2** Evidence collection is event-driven: when an event of type `compliance.evidence.collected` is emitted, the pack ticks the control. No spreadsheets.

**F10.3** Each pack produces:
- A **maturity dashboard** (current % implemented, drift over time).
- A **gap report** (controls without evidence or with stale evidence).
- A **regulator-ready PDF** (signed, hash-stamped, watermarked with tenant ID).

**F10.4** Multi-tenant supervisory view: a CBN bank examiner with `siem:supervisory_view` sees an attestation row per supervised institution, drillable to control evidence — with read-only access enforced at the gateway.

### F11 — Dashboards & visualization

**F11.1** Default dashboards (mobile-responsive, dark/light, WCAG 2.1 AA):
- **SOC Operations** — live event rate, open cases by severity, SLA breaches imminent, MITRE-coverage heatmap (reuse the existing [`mitre-mini-heatmap`](../../frontend/src/components/cyber/mitre-mini-heatmap.tsx)).
- **CISO Executive** — risk-score trend, top 5 control gaps, regulator-clock state, incident-cost YTD.
- **Payments Security** — RTGS/NIBSS/NIP transaction-pattern dashboard, fraud-loss curve, NIBSS-IAF feed health.
- **Insider Risk** — UEBA top-N risky users, peer-anomaly grid.
- **Threat Landscape** — IOC hits by feed, threat-actor activity, brand-abuse incidents (reuse [`cti/global-threat-map`](../../frontend/src/components/cyber/cti/global-threat-map.tsx)).
- **Data Protection** — NDPA breach clock, DPIA register status, data-subject-request queue.
- **Cloud Posture** — multi-cloud audit events, IAM drift, public bucket alerts.

**F11.2** Every dashboard widget is **deep-linkable** into the hunting workbench so an executive view drills into raw events.

**F11.3** **Big-board mode** — a kiosk-friendly auto-rotating dashboard for the physical SOC wall.

### F12 — SOC operations console

**F12.1** **Shift handover** — pinned summary, open cases, pending playbooks, recent regulator chatter; signed at end-of-shift, captured in audit chain.

**F12.2** **War room** — when a case is promoted `severity=critical`, a war-room object is spawned: shared timeline, decision log, attendee roster, evidence locker, regulator-clock. Reuses the existing notification WS hub for live presence; reuses workflow-engine for the formal escalation tree.

**F12.3** **Tabletop / exercise mode** — incidents can be replayed against the live UI in a sandbox tenant for training (RBCSF §13.1 requires periodic exercises).

**F12.4** **Operator productivity**: command palette (Cmd-K) following the existing pattern in [`frontend/src/stores/command-palette-store.ts`](../../frontend/src/stores/command-palette-store.ts), bulk actions on alerts, keyboard-only triage flow.

### F13 — Forensics & investigation

**F13.1** **Forensic timeline** auto-builds a chronological event view across all sources tied to an entity (user, host, ip, account).

**F13.2** **Evidence locker** — uploads through `file-service` retain the existing virus-scan path. Each artefact gets a SHA-256 hash, a YubiHSM-signed RFC 3161 timestamp, and a chain-of-custody log.

**F13.3** **Export pack** — a regulator-grade ZIP: PDF report, raw events (NDJSON), CSV summary, hash manifest, custody log, signature block. Reproducible (same case + cutoff → same hash) for court use.

**F13.4** **Investigation lock** — when a case enters legal hold, all related events are pinned (cannot age out of warm/cold) and any access to them is itself audited.

### F14 — Regulator reporting

**F14.1** A regulator-report builder turns a case + evidence pack into a pre-filled form for:
- CBN-CSIRT 24-hour Cyber-Incident Report.
- NDPC 72-hour Personal-Data-Breach Notification.
- NIBSS Fraud-Loss Report (monthly aggregation + ad-hoc).
- SWIFT CSP "Significant Cyber-Security Event" notification.
- PCI DSS card-data breach notification (acquirer-specific).

**F14.2** Reports must be reviewed and digitally signed by a human (the tenant CISO or designate). Signing reuses the existing JWT identity and writes the signed artefact to the audit chain.

**F14.3** Reports are submitted via approved channels — primarily email-to-PDF + portal upload. The system tracks acknowledgement IDs.

---

## 8. Non-Functional Requirements

### 8.1 Performance & scale (per tenant, design targets)

| Metric | Steady | Peak |
| --- | --- | --- |
| Ingest EPS | 50 k | 150 k |
| Search concurrent users | 50 | 200 |
| Hot-tier query p95 (24 h, 1 GB working set) | ≤ 2 s | ≤ 5 s |
| Warm-tier query p95 (13 mo, scoped) | ≤ 15 s | ≤ 30 s |
| End-to-end alert latency | ≤ 30 s | ≤ 60 s |
| Playbook trigger fan-out | ≤ 3 s |  |

Cluster sizing in [docs/architecture/SIEM_SIZING.md](../architecture/SIEM_SIZING.md) (to be authored alongside this PRD).

### 8.2 Availability & DR

- **RTO** 30 min, **RPO** 5 min for hot tier; **RTO** 4 h for warm tier.
- Active-active across Lagos + Abuja Clario360 regions.
- DR site outside primary region but inside Nigeria, per CBN data-residency.
- Quarterly DR drill — required by CBN RBCSF.

### 8.3 Security

- All flows TLS 1.3; mTLS between collectors and broker.
- All secrets via HashiCorp Vault transit engine; no static secrets in env.
- HSM-backed signing for evidence packs, parser versions, and rule promotions.
- Operator MFA via existing IAM service (TOTP minimum; FIDO2 preferred for privileged roles).
- Privileged-action session recording (asciinema for CLI; HTML5 screen capture for console actions affecting prod).
- All SIEM admin actions chained in the existing audit hash chain — examiners can verify integrity end-to-end.
- Quarterly red-team exercise; annual external penetration test.

### 8.4 Data residency & sovereignty

- Primary processing and hot/warm storage **in Nigeria** (Lagos, Abuja).
- Cross-border data movement only with explicit tenant DPO sign-off and NDPC notification where required.
- Vendor cloud regions used (if any): only those with documented Nigerian-presence operations and customer-managed encryption keys.
- A `data.residency` field on every index is non-mutable post-write and is verified at search and at export.

### 8.5 Multi-tenancy

- Hard tenant isolation at storage (one index pattern per tenant), at query (gateway-enforced filter), and at access (row-level via existing [tenant_context](../../backend/internal/database/tenant_context.go)).
- A supervisory tenant (CBN) can attach to supervised-institution tenants in read-only mode through an explicit, audited consent grant — never by default.
- Per-tenant encryption keys (envelope encryption with a CBN-controlled KEK via HSM).

### 8.6 Observability of the SIEM itself

- Health metrics (ingest EPS, queue depth, parser error rate, search latency, store free space, chain-anchor lag) exposed via the existing [observability bootstrap](../../backend/internal/observability/bootstrap/bootstrap.go).
- Tracing across collector → broker → normalizer → store via OpenTelemetry (already wired in Clario360).
- A "SIEM-of-SIEM" dashboard so the platform team can see when the SIEM is unhealthy without depending on the SIEM itself for that signal.

### 8.7 Accessibility & internationalization

- WCAG 2.1 AA. English primary; Hausa, Yoruba, Igbo for selected operator-facing strings (CBN customer-facing portals already follow this).
- All timestamps stored UTC, rendered Africa/Lagos by default with tooltip on hover.

### 8.8 Cost discipline

- Hot tier cost-per-GB targeted at ≤ 2× warm tier; warm ≤ 5× cold.
- Per-tenant ingestion quota with soft (alert) and hard (block-with-bypass) caps.
- Index-pattern lifecycle defaults documented and ratified by tenant before go-live.

---

## 9. Data Model & API Surface

### 9.1 New Postgres schemas (under `siem_db`)

- `siem_sources` — source-of-truth for every log source.
- `siem_parsers` — parser versions, status (managed via AI-governance lifecycle).
- `siem_rules` — extends the existing detection-rule model with `cbn_control_ids`, `regulator_relevance` (jsonb), `playbook_id`.
- `siem_cases` — case object as in §F7.2.
- `siem_case_events` — append-only timeline (also chained into audit).
- `siem_evidence` — pointer to file-service artefact + hash manifest + HSM signature.
- `siem_playbooks` — pointer to workflow-engine definition + metadata.
- `siem_compliance_controls` — control catalogue per pack.
- `siem_compliance_evidence_map` — control → evidence collector → status.
- `siem_supervisory_grants` — supervisory-tenant ↔ supervised-tenant ↔ scope ↔ expiry.

Migrations follow the existing [golang-migrate](../../backend/internal/database/) pattern; baseline files live in `migrations/siem_db/`.

### 9.2 New Kafka topics (CloudEvents)

- `siem.ingest.raw` — pre-parser firehose (short-retention).
- `siem.event.normalized` — ECS-shaped events.
- `siem.alert.created` / `siem.alert.updated`.
- `siem.case.created` / `siem.case.updated` / `siem.case.closed`.
- `siem.playbook.action.requested` / `.completed` / `.failed`.
- `siem.compliance.evidence.collected`.
- `siem.regulator.report.submitted` / `.acknowledged`.

All emitted using the existing [events.New(...)](../../backend/internal/events/event.go) factory; partitioned by `tenant_id` to preserve ordering.

### 9.3 New REST endpoints (under `/api/v1/siem` on the existing gateway)

| Endpoint | Method | Permission | Purpose |
| --- | --- | --- | --- |
| `/sources` | GET/POST | `siem:admin` | List/onboard sources |
| `/sources/{id}` | GET/PATCH/DELETE | `siem:admin` | Manage source |
| `/sources/{id}/health` | GET | `siem:read` | Source health |
| `/parsers` | GET/POST | `siem:admin` | Parser CRUD |
| `/rules` | GET/POST | `siem:content_author` | Detection CRUD |
| `/rules/{id}/test` | POST | `siem:content_author` | Parser/rule test harness |
| `/alerts` | GET | `siem:read` | Alert list (with CSQL filter) |
| `/cases` | GET/POST | `siem:read`/`siem:respond` | Case list/create |
| `/cases/{id}` | GET/PATCH | tenant-scoped | Case detail |
| `/cases/{id}/timeline` | GET | `siem:read` | Audited timeline |
| `/cases/{id}/evidence` | POST | `siem:respond` | Attach evidence (via file-service) |
| `/cases/{id}/regulator-report` | POST | `siem:compliance_attest` | Draft regulator report |
| `/hunt/search` | POST | `siem:hunt` | CSQL search |
| `/hunt/notebooks` | GET/POST | `siem:hunt` | Notebooks |
| `/playbooks` | GET/POST | `siem:respond` | Playbook CRUD |
| `/playbooks/{id}/run` | POST | `siem:respond` | Trigger playbook |
| `/compliance/packs` | GET | `siem:read` | List packs |
| `/compliance/packs/{slug}/status` | GET | `siem:compliance_attest` | Maturity dashboard |
| `/compliance/packs/{slug}/export` | POST | `siem:compliance_attest` | Regulator-ready PDF |
| `/supervisory/grants` | GET/POST | super-admin | Grant cross-tenant supervisory access |

All authenticated, rate-limited by endpoint group (existing `EndpointGroupRead` / `Write` / `Admin` in the gateway), audited.

### 9.4 WebSocket topics (existing notification hub)

- `siem.alert.new`
- `siem.case.updated`
- `siem.regulator.clock.tick`
- `siem.warroom.{caseId}` — presence + chat-style updates

---

## 10. Frontend Suite

### 10.1 Route structure (Next.js 14 App Router)

Under [`frontend/src/app/(dashboard)/siem/`](../../frontend/src/app/):

```
siem/
  page.tsx                 — SOC overview
  alerts/                  — alert queue + detail
  cases/
    page.tsx               — case kanban + table
    [caseId]/page.tsx      — case workspace (timeline, evidence, war-room tab)
  hunt/
    page.tsx               — CSQL workbench
    notebooks/[id]/page.tsx
  sources/                 — source onboarding
  content/                 — rule/parser editor (detection-as-code git diff)
  playbooks/               — playbook editor + run history
  intel/                   — IOC search + feed health (deep-links to cyber/cti)
  dashboards/              — saved dashboards (SOC, CISO, Payments…)
  compliance/
    [pack]/page.tsx        — pack dashboard
  supervisory/             — CBN bank-examiner cross-tenant view (gated)
  reports/                 — regulator-report drafts + history
  settings/                — retention, parser CI keys, HSM config
```

### 10.2 Reused components

- Charts: existing recharts wrappers ([`components/charts/`](../../frontend/src/components/charts/)).
- KPI cards, severity indicators, status badges from the [shared component library](../../frontend/src/components/shared/).
- Forms: `form-field`, `combobox`, `date-range-picker`, `search-input`, `file-upload`.
- Real-time: [`use-websocket`](../../frontend/src/hooks/use-websocket.ts) + [`realtime-store`](../../frontend/src/stores/realtime-store.ts).
- Tables: `DataTable` (remember the `onSortChange` required-prop pattern).

### 10.3 New components (component-library home: `components/siem/`)

- `csql-query-editor` — Monaco-based, with syntax highlight & autocomplete (reuse the local monaco asset routing already shipped).
- `pivot-graph` — entity-relationship graph (cytoscape).
- `forensic-timeline` — vertical event timeline with severity lanes.
- `regulator-clock` — countdown widget for case cards.
- `playbook-canvas` — node-edge editor (react-flow).
- `compliance-control-card` — status, evidence list, attestation action.
- `evidence-locker` — chained list with hash manifest download.
- `war-room-panel` — presence + decision-log + countdown.
- `supervisory-attestation-row` — for CBN examiner view.

### 10.4 Branding

- Inherit the existing CBN colour palette in [cbn_branding.md](../../cbn_branding.md). Primary surfaces use #1B5E20 / #C6A962. SOC-wall mode uses high-contrast dark theme.

---

## 11. Integration Map

| Existing service | Integration | New code |
| --- | --- | --- |
| `iam-service` | Add new SIEM permissions to RBAC enum, default-role map | Touch in [`auth/rbac.go`](../../backend/internal/auth/rbac.go) |
| `api-gateway` | New route prefix `/api/v1/siem`, endpoint-group bindings | Add to [`gateway/config/routes.go`](../../backend/internal/gateway/config/routes.go) |
| `audit-service` | SIEM emits to Kafka; existing consumer chains. SIEM also consumes audit events for self-supervision | No code change; configuration only |
| `cyber-service` | SIEM publishes enriched events for UEBA/CTI; consumes IOC matches and risk scores | Extend cyber consumers to read SIEM topics |
| `workflow-engine` | Playbooks compile to workflow definitions | Add a `siem.playbook.*` task type |
| `notification-service` | Pager fan-out, WS push for SOC console | Add SIEM templates and WS topics |
| `file-service` | Evidence uploads, regulator PDFs | No code change; new bucket policies |
| `data-service` | Pull asset catalog for enrichment (no duplication) | Read-only API consumption |
| `acta-service` | Compliance evidence shared into governance workflows | Cross-publish on `siem.compliance.*` |
| `lex-service` | Regulator-letter templates and NDPA clause guidance | Optional v1.x |
| `visus-service` | Executive cross-suite dashboards consume SIEM widgets | Register SIEM widget pack |
| `aigovernance` | Parser/model registration, drift on AI-assisted detections | Extend model catalogue with `parser` and `detection-ai` types |

---

## 12. Rollout Plan (phased)

### Phase 0 — Foundations (Weeks 1–4)
- Sign-off on PRD; align with CBN-CSIRT contact and Banking Supervision.
- Stand up OpenSearch + MinIO + Vector in dev.
- Service skeleton `siem-service` with bootstrap and admin port.
- New RBAC permissions and gateway prefix.

### Phase 1 — Ingest & Search (Weeks 5–10)
- Collector control plane + 6 priority sources: Linux syslog, Windows Event, CloudTrail, Office 365, NIBSS-IAF, generic JSON.
- ECS normalization pipeline + parser test harness.
- Hot/warm/cold lifecycle + chain anchors.
- CSQL v1 (lucene-superset subset).
- Alpha to internal SOC.

### Phase 2 — Detection & Alerts (Weeks 11–16)
- Wire existing detection engines onto the new pipeline.
- Cross-source correlation + geo-velocity + sequence-with-negation.
- Alert UI, dedup, case object basics.
- Detection-as-code git sync + CI test harness.

### Phase 3 — Response & SOAR (Weeks 17–22)
- Case workspace, timeline, evidence locker.
- Playbook canvas + workflow-engine compiler.
- 5 OOTB playbooks (phishing, account compromise, S3 exfil, EDR isolation, suspicious SWIFT).
- War-room module.

### Phase 4 — Compliance Packs (Weeks 23–28)
- CBN-RBCSF, NDPA, SWIFT CSP, PCI DSS, NIST CSF 2.0, ISO 27001 packs.
- Regulator-report builder + signing + tracking.
- Supervisory cross-tenant view (CBN examiner).
- Big-board mode.

### Phase 5 — Hardening & Examination (Weeks 29–34)
- Red-team exercise.
- External pen test.
- DR drill.
- CBN sandbox-environment dry-run with Banking Supervision.

### Phase 6 — GA & Onboarding (Weeks 35+)
- Pilot with 3 supervised institutions before full rollout.
- 24×7 SOC playbook book signed by CBN.
- Annual content-tuning programme initiated.

---

## 13. Acceptance Criteria (excerpted)

The SIEM module is GA when **all** of the following are evidenced by tests + DR drill + external auditor:

1. A new log source can be onboarded end-to-end (config → first searchable event) in ≤ 30 minutes.
2. A custom Sigma rule deployed via the git-sync path produces an alert in production within 60 seconds of a matching event.
3. A P1 case is created, assigned, contained, and closed using only the SIEM UI — with a regulator-ready PDF generated in under 10 minutes from incident start.
4. The audit chain over 30 days of SIEM activity verifies 100% intact under `POST /api/v1/audit/verify`.
5. A CBN-RBCSF attestation pack can be exported and is signed-off by an external auditor with no spreadsheet substitution.
6. A cross-tenant supervisory grant is granted, used, expired, and audited.
7. DR drill demonstrates RTO 30 min / RPO 5 min for the hot tier.
8. External pen test produces no high or critical findings (or all are remediated within the agreed window).
9. Independent SWIFT CSP and PCI DSS v4 assessments using SIEM evidence pass without manual gap-filling.

---

## 14. Risks & Open Questions

| Risk | Severity | Mitigation |
| --- | --- | --- |
| OpenSearch scale-out cost under sustained ingest spikes | High | Per-tenant ingest quotas + selective field indexing; v2 reassess ClickHouse for analytics |
| Data residency vs. cloud-collector ergonomics for CBN-supervised institutions on global clouds | High | Hybrid collector — agentless cloud pull terminating into in-Nigeria broker only; encrypted in flight |
| Parser drift across heterogeneous core-banking versions (Temenos, Finacle, Flexcube) | Medium | Versioned parsers + AI-governance lifecycle; CI harness mandatory |
| Operator skill gap on CSQL | Medium | CSQL syntax = lucene-superset; documentation + in-product tutorial; KQL/SPL crosswalk cheatsheet |
| Regulator-report channel inconsistency (CBN-CSIRT email vs portal vs phone) | Medium | Builder produces all three formats; tracker captures whichever channel acknowledged |
| HSM availability single-point-of-failure for evidence signing | High | Active-active YubiHSM cluster + SoftHSM emergency fallback with reduced trust level |
| Multi-tenant isolation under supervisory cross-grant | High | Read-only at gateway, query-rewrite at SIEM, periodic auditor-run isolation test |

### Open questions for stakeholders

1. **Will CBN's Banking Supervision act as a tenant in Clario360, or as an overlay supervisory entity?** Drives the supervisory-grant model.
2. **What is the agreed list of "material event" thresholds** that trigger the 24-hour CSIRT report? Need a formal table jointly signed.
3. **NIBSS-IAF feed format & delivery SLA** — current state assumed JSON-over-HTTPS; confirm.
4. **SWIFT CSP attestation cycle** — quarterly snapshot in-product, or annual export for the formal CSP submission?
5. **Retention** — confirm 7-year baseline vs the 10-year SWIFT slice; NDPA may push some PII to 1-year max — define matrix per data class.
6. **HSM ownership** — CBN-operated HSM or Clario360-operated HSM with CBN-held key share?
7. **DR site location** — Lagos + Abuja confirmed; is a third Port-Harcourt site in scope for FMI tier?

---

## 15. Compliance & Regulatory Mapping (summary; full matrix in §10 packs)

| Framework | SIEM control | Where implemented |
| --- | --- | --- |
| CBN-RBCSF §6 (SOC) | 24×7 console, shift handover, exercises | §F12 |
| CBN-RBCSF §7 (SIEM) | Ingest, parse, detect, correlate, store | §F1–F4 |
| CBN-RBCSF §9 (Incident Reporting) | Case management + 24-hour clock + builder | §F7, §F14 |
| CBN-RBCSF §10 (Threat Intelligence) | Reuse CTI + NIBSS-IAF + CBN-CSIRT feeds | §F6 |
| CBN-RBCSF §11 (Logging & Monitoring) | Source registry + retention tiers + chain anchors | §F1, §F3 |
| CBN-CRF FMIs (Payments) | Payments-security dashboard + RTGS/NIBSS detections | §F4.2, §F11 |
| NDPA 2023 §29 (Breach Notification) | 72-hour clock + NDPC report builder | §F7.6, §F14 |
| NDPA 2023 §32 (Data-Subject Rights) | Hunt workbench supports DSR scoping; case template | §F9, §F12 |
| SWIFT CSP CSCF 6.4 / 6.5A | SWIFT log ingest, correlation rules, evidence pack | §F1, §F4, §F10 |
| PCI DSS v4 Requirement 10 | Universal audit logging + tamper-evident chain | Reuse audit-service |
| NIST CSF 2.0 Detect.AE / Respond.AN | Detection engines + case workflow | §F4, §F7 |
| ISO/IEC 27001:2022 A.5.24 / A.8.16 | Incident response + monitoring | §F7, §F12 |

---

## 16. Appendices

### A. Glossary
- **RBCSF** — Risk-Based Cyber-Security Framework (CBN).
- **NIBSS-IAF** — Nigeria Inter-Bank Settlement System, Industry Anti-Fraud feed.
- **DMB / OFI / PSB / PSP** — Deposit-Money Bank / Other Financial Institution / Payment Service Bank / Payment Service Provider.
- **CSQL** — Clario Search Query Language (new in this PRD).
- **ECS** — Elastic Common Schema (canonical event shape).
- **WORM** — Write-Once-Read-Many storage (regulatory cold tier).
- **CSIRT** — Computer Security Incident Response Team.

### B. References (internal)
- [PRD Compliance Matrix](PRD_COMPLIANCE_MATRIX.md)
- [Security Architecture Assessment](../../SECURITY_ARCHITECTURE_ASSESSMENT.md)
- [Capability Matrix](../../CAPABILITY_MATRIX.md)
- [CTI Readiness Report](../../CTI_READINESS_REPORT.md)
- [Production Readiness Audit](../../PRODUCTION_READINESS_AUDIT.md)
- [CBN Branding](../../cbn_branding.md)
- [backend/internal/cyber/detection/](../../backend/internal/cyber/detection/) — existing detection engines
- [backend/internal/audit/service/integrity_service.go](../../backend/internal/audit/service/integrity_service.go) — tamper-evident chain
- [backend/internal/observability/bootstrap/bootstrap.go](../../backend/internal/observability/bootstrap/bootstrap.go) — service bootstrap pattern
- [backend/internal/notification/websocket/hub.go](../../backend/internal/notification/websocket/hub.go) — WS fan-out

### C. References (external)
- Central Bank of Nigeria — Risk-Based Cyber-Security Framework for DMBs and PSPs.
- Nigeria Data Protection Act 2023.
- SWIFT Customer Security Programme — Customer Security Controls Framework v2025.
- PCI Security Standards Council — PCI DSS v4.0.
- NIST — Cybersecurity Framework 2.0.
- ISO/IEC 27001:2022 and ISO/IEC 27035 series.

---

*End of PRD.*
