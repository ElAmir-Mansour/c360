# Request for Server — Clario360 Platform Deployment

**Document type:** Infrastructure Provisioning Request / Server Requirements Specification
**Platform:** Clario360 (Cybersecurity Suite + Business / GRC Suite)
**Prepared:** 2026-06-20
**Target go-live:** Watheeq & MahamaTech Phase 1 — 25 Jul 2026
**Classification:** Internal — Infrastructure & Procurement
**Status:** Draft for review / sign-off

---

## 1. Purpose

This document requests the compute, storage, network and supporting infrastructure required to deploy the **entire Clario360 solution** across a full landscape — **Development, Staging and Production**.

It is derived directly from the repository's deployment assets:

- Helm chart `deploy/helm/clario360` (base `values.yaml` + `values-staging.yaml`, `values-production.yaml`, `values-airgap.yaml`)
- Terraform IaC `deploy/terraform` (modules + `environments/{dev,staging,production}`)
- `docker-compose.yml` / `docker-compose.prod.yml` (backing-service inventory and pinned versions)
- Air-gap / escrow tooling `deploy/escrow`, `deploy/systemd`, `deploy/vault`

Three deployment models are presented side-by-side so the infrastructure team can choose:

| Model | Summary | Best fit |
|-------|---------|----------|
| **A. Managed Cloud (GKE)** | Mirror of the Terraform IaC — managed GKE node pools, Cloud SQL, Memorystore, GCS in GCP **`me-central1` (Dammam, KSA)**. Request a GCP project + quota. | Fastest path; sovereign GCP region |
| **B. Self-managed Kubernetes on VMs** | Customer-owned or sovereign-cloud VMs; you provision the nodes and run K8s + backing services yourself. | Watheeq / MahamaTech sovereign hosting on IaaS |
| **C. Air-gapped / on-prem bare-metal** | Fully offline data-center install from the escrow bundle via a private Harbor registry; **no internet egress**. | Strict data-residency / classified environments |

> **All three deployment models run the same container images and the same Helm chart.** They differ only in *where* the nodes live, *how* the backing services are provided (managed vs. self-hosted), and whether outbound internet is available.

---

## 2. What is being deployed (solution footprint)

Clario360 is a multi-tenant, event-driven platform of **Go microservices + a Next.js frontend**, fronted by an API gateway, communicating over Kafka, persisting to PostgreSQL, and using Redis, MinIO/S3, OpenSearch, Vault and ClamAV as supporting infrastructure.

### 2.1 Application services (Helm `Deployment` workloads)

| # | Service | Image | HTTP / Metrics port | Notes |
|---|---------|-------|---------------------|-------|
| 1 | api-gateway | `clario360/api-gateway` | 8080 / 9090 | Edge router, rate-limit, circuit breaker, WS proxy |
| 2 | iam-service | `clario360/iam-service` | 8081 / 9091 | Auth, RBAC, MFA, tenants (RS256 JWT) |
| 3 | audit-service | `clario360/audit-service` | 8084 / 9090 | Hash-chained audit log |
| 4 | workflow-engine | `clario360/workflow-engine` | 8085 / 9090 | Shared FSM workflow/approval engine |
| 5 | notification-service | `clario360/notification-service` | 8089 / 9090 | Email/WS notifications, digests |
| 6 | file-service | `clario360/file-service` | 8092 / 9092 | Object storage + ClamAV scanning |
| 7 | cyber-service | `clario360/cyber-service` | 8090 / 9090 | Cybersecurity suite (assets, vulns, threats, CTEM, vCISO, DSPM) |
| 8 | data-service | `clario360/data-service` | 8091 / 9090 | Data sources, pipelines, quality, lineage |
| 9 | acta-service | `clario360/acta-service` | 8086 / 9086 | Board governance |
| 10 | lex-service | `clario360/lex-service` | 8087 / 9087 | Legal / CLM (Watheeq) |
| 11 | visus-service | `clario360/visus-service` | 8088 / 9088 | Executive intelligence |
| 12 | license-service | `clario360/license-service` | 8096 / 9096 | Licensing / entitlements |
| 13 | clario-dr-service | `clario360/clario-dr-service` | 8097 / 9097 (+ mTLS 8098) | DataStream DR orchestrator |
| 14 | automation-service | `clario360/automation-service` | 8098 / 9098 | Trigger → rules → runbook engine |
| 15 | frontend | `clario360/frontend` | 3000 | Next.js 14 dashboard |
| — | onboarding-service | `clario360/onboarding-service` | 8093 / 9093 | **Disabled by default** (`enabled: false`) |

> SIEM capability is backed by **OpenSearch** (hot store) + a dedicated **MinIO "siem-cold"** WORM bucket; the DR/SIEM data planes also require **HashiCorp Vault** (PKI + transit encryption) and **mTLS** for collector/agent enrolment.

### 2.2 Jobs & scheduled work

- **`migrator`** (one-shot Job, on every deploy) — runs migrations for **10 databases**: `iam_db, platform_db, cyber_db, data_db, acta_db, lex_db, visus_db, license_db, dr_db, automation_db`.
- **`seeder`** (Job, dev only).
- **~24 CronJobs** (workflow timer/SLA/recovery, notification digests, Acta/Lex/Cyber/Visus monitors, KPI & risk snapshots, dark-data scan, audit-partition maintenance, session cleanup, weekly report generation). Each is small (≤ 0.2–1 vCPU, ≤ 128–512 Mi).

### 2.3 Optional AI / inference

- **CPU-only** llama.cpp / BitNet inference servers (`inference.llamacpp`, `inference.bitnet`) — **disabled by default**. **No GPU required.** When enabled: 4–8 vCPU / 8–16 Gi (llama.cpp), 2–4 vCPU / 4–8 Gi (BitNet), 5–10 Gi model volume.
- Primary AI path uses the **external Anthropic Claude API** (`claude-opus-4-8`), with OpenAI / Azure OpenAI as alternates.
- **Air-gapped note:** with no internet egress, the external Claude API is unreachable — AI features must run on the **self-hosted CPU inference servers** (or a GPU node). Budget for at least one inference replica in Model C.

### 2.4 Backing / supporting services (pinned versions)

| Service | Version (compose) | Role | Persistent? |
|---------|-------------------|------|-------------|
| PostgreSQL | `16-alpine` | Primary relational store (10 logical DBs) | Yes |
| Redis | `7.2-alpine` | Cache, rate-limit, sessions, leader election | Yes |
| Apache Kafka | `4.0` (KRaft, no ZooKeeper) | Event backbone (~28 topics) | Yes |
| Confluent Schema Registry | `7.6.0` | Kafka schema management | No |
| MinIO | S3-compatible | App object store + SIEM cold WORM store | Yes |
| OpenSearch | `2.15.0` | SIEM hot store | Yes |
| ClamAV | `stable` | File AV scanning | Yes (signatures) |
| HashiCorp Vault | `1.17` | Secrets, PKI, transit (DR/SIEM mTLS, KMS unseal) | Yes (Raft) |
| Prometheus | `v2.53` | Metrics | Yes |
| Grafana | `11.1` | Dashboards | Yes |
| Loki + Promtail | `2.10` | Log aggregation | Yes |
| Alertmanager | (kube-prometheus-stack) | Alert routing | No |
| Jaeger / OTel Collector | `1.58` | Distributed tracing | No |
| NGINX Ingress + cert-manager | latest | TLS ingress | No |
| ArgoCD | latest | GitOps delivery | Yes (small) |

---

## 3. Environment landscape

| Dimension | Development | Staging | Production |
|-----------|-------------|---------|------------|
| Purpose | Build/test, single replica | Pre-prod / UAT gate | Live, HA |
| Replicas per service | 1 | 2–3 | 2–3 + HPA |
| HPA / PDB | Off | On | On |
| Network policies | Off | On | On |
| TLS | Off (localhost) | On (LE staging) | On (public/sovereign CA) |
| Backing-service HA | Single instance | Limited | Full HA |
| Namespace resource quota | 16 vCPU / 32 Gi / 100 pods | (not enforced) | **64 vCPU / 128 Gi / 200 pods** |

The numbers below are taken from `values-{env}.yaml` and `terraform/environments/{env}`. They represent **steady-state minimum (at min replicas)** through **burst maximum (at HPA max)**.

---

## 4. Model A — Managed Cloud (GKE, GCP `me-central1` / Dammam)

This mirrors `deploy/terraform/environments/*`. You request a **GCP project, quota and the modules below**; GCP provides the nodes, database, cache and object storage as managed services.

### 4.1 GKE node pools

| Pool | Dev | Staging | Production |
|------|-----|---------|------------|
| **System** (ingress, monitoring, Vault, cert-manager) | 1× `e2-standard-2` (2 vCPU/8 GB), 1–2 nodes, 50 GB SSD | 2× `e2-standard-4` (4 vCPU/16 GB), 2–3 nodes, 50 GB | 3× `e2-standard-4`, 3–5 nodes, 50 GB |
| **Workload** (application microservices) | `e2-standard-4` (4 vCPU/16 GB), 1–3 nodes, 100 GB | `e2-standard-4`, 2–6 nodes, 100 GB | `e2-standard-8` (8 vCPU/32 GB), 3–12 nodes, 100 GB |
| **Compute** (pipelines, heavy batch; scale-to-zero) | `e2-standard-4`, 0–1 nodes, 200 GB | `e2-standard-4`, 0–2 nodes, 200 GB | `e2-highcpu-8` (8 vCPU/8 GB), 0–6 nodes, 200 GB |
| Cluster type | Private nodes, public endpoint, REGULAR channel | Private, REGULAR | **Private endpoint, STABLE channel, Binary Authorization enforced** |

### 4.2 Managed backing services

| Service | Dev | Staging | Production |
|---------|-----|---------|------------|
| **Cloud SQL (PostgreSQL 16)** | `db-custom-2-4096` (2 vCPU/4 GB), 20→50 GB, **ZONAL** | `db-custom-4-8192` (4 vCPU/8 GB), 50→100 GB, ZONAL | `db-custom-8-32768` (8 vCPU/32 GB), 200→1000 GB, **REGIONAL HA**, ENTERPRISE |
| Backups | 7 copies, 3-day PITR | 7 copies, 3-day PITR | **30 copies, 7-day PITR, 365-day GCS export** |
| **Memorystore (Redis 7.2)** | 1 GB, BASIC | 2 GB, BASIC | **5 GB, STANDARD_HA, 2 replicas, TLS** |
| **Kafka (Strimzi/KRaft on-cluster)** | 1 broker, 10 Gi, 0.5–1 vCPU | 3 brokers, 50 Gi, 1–2 vCPU, TLS+SASL | **3 brokers, 200 Gi each, 2–4 vCPU/4–8 Gi, TLS+SASL SCRAM-512** |
| **MinIO (on-cluster)** | standalone, 20 Gi | standalone, 50 Gi | **distributed, 4 replicas, 100 Gi each** |
| **GCS buckets** | documents, reports, temp, audit-exports, malware-quarantine (lifecycle per env) | same | same + **7-year audit retention** |
| **Vault** | 1 replica, 5 Gi | 1 replica, 10 Gi | **3 replicas (HA Raft), 20 Gi, Cloud KMS HSM auto-unseal** |
| **Monitoring (Prometheus/Loki)** | 7-day, 20 Gi each | 15-day, 50 Gi each | **30-day, 100 Gi each**, Grafana 10 Gi |

### 4.3 Managed-cloud network & platform add-ons

- VPC (REGIONAL), 3 subnets: **public** `10.0.0.0/24` (LB/NAT), **private** `10.0.1.0/24` (GKE nodes), **isolated** `10.0.2.0/24` (Cloud SQL / Redis / Vault, **egress-deny to internet**).
- Secondary ranges: pods `10.1.0.0/16`, services `10.2.0.0/20`. Cloud NAT, Private Service Access (`/20`).
- Cloud DNS (DNSSEC in prod), NGINX Ingress + cert-manager (Let's Encrypt prod), ArgoCD GitOps, Calico network policies.
- KMS key ring (3 keys: gke-secrets, data-encryption, database-encryption), 90-day rotation, **HSM protection in production**. 12 per-service Google service accounts via Workload Identity.

---

## 5. Model B — Self-managed Kubernetes on VMs (server BOM)

You provision the **VMs / instances** below (sovereign cloud IaaS or customer hypervisor) and run Kubernetes + backing services yourself. This is the core "request for server."

> Sizing parity with Model A. Backing services (PostgreSQL, Redis, Kafka, OpenSearch, MinIO) run on **dedicated stateful VMs** rather than managed services; Vault and monitoring run on the system pool.

### 5.1 Production — server line items

| Role | Qty | vCPU | RAM | Disk | Notes |
|------|----:|-----:|----:|------|-------|
| K8s control plane | 3 | 4 | 8 GB | 100 GB SSD | etcd quorum, HA API server |
| System / infra workers | 3 | 4 | 16 GB | 100 GB SSD | ingress, Prometheus/Loki/Grafana, cert-manager, ArgoCD, Vault (3 pods) |
| Application workers | 3–12 | 8 | 32 GB | 100 GB SSD | the 15 microservices + frontend; autoscaling |
| Compute / batch workers | 0–6 | 8 | 16 GB | 200 GB SSD | pipelines, dark-data scan, report gen |
| PostgreSQL (primary + standby) | 2 | 8 | 32 GB | 500 GB+ SSD | streaming replication; +1 read replica optional |
| Redis (HA) | 3 | 2 | 8 GB | 20 GB SSD | Sentinel/cluster, 5 GB usable |
| Kafka brokers (KRaft) | 3 | 4 | 16 GB | 300 GB SSD | RF=3, min-ISR=2 |
| OpenSearch (SIEM hot) | 3 | 4 | 16 GB | 500 GB+ SSD | 4 GB JVM heap, scales with log volume |
| MinIO (distributed) | 4 | 4 | 8 GB | **≥ 1 TB data disk each** | app store + SIEM cold WORM |
| Bastion / jump host | 1 | 2 | 4 GB | 50 GB | admin access, kubectl/helm |
| **Production subtotal (steady min)** | **~24 VMs** | **~118 vCPU** | **~390 GB** | **~6–8 TB** | App pool at 3, compute at 1 |
| **Production (burst max)** | **up to ~35 VMs** | **~230 vCPU** | **~520 GB** | grows with data | App pool 12, compute 6 |

> MinIO data-disk sizing is the dominant storage variable — size it to the customer's document/SIEM/DR retention (WORM SIEM cold = 7-year COMPLIANCE retention). Start at **1 TB/node (4 TB raw, ~2 TB usable with EC)** and grow.

### 5.2 Staging — server line items

| Role | Qty | vCPU | RAM | Disk |
|------|----:|-----:|----:|------|
| K8s control plane | 3 | 2 | 4 GB | 80 GB |
| System workers | 2 | 4 | 16 GB | 50 GB |
| Application workers | 2–6 | 4 | 16 GB | 100 GB |
| Compute workers | 0–2 | 4 | 16 GB | 200 GB |
| PostgreSQL | 1 (+1 standby opt.) | 4 | 8 GB | 100 GB SSD |
| Redis | 1 | 2 | 4 GB | 10 GB |
| Kafka brokers | 3 | 2 | 8 GB | 50 GB |
| OpenSearch | 1 | 4 | 8 GB | 100 GB |
| MinIO | 1 | 2 | 4 GB | 200 GB |
| **Staging subtotal** | **~13–17 VMs** | **~45–60 vCPU** | **~130 GB** | **~1.2 TB** |

### 5.3 Development — server line items

Dev can collapse onto a **single 3-node cluster** (or even a `kind`/minikube box for non-shared dev). Recommended shared dev:

| Role | Qty | vCPU | RAM | Disk |
|------|----:|-----:|----:|------|
| K8s single control+worker | 1 | 4 | 16 GB | 100 GB |
| Application/compute worker | 1–3 | 4 | 16 GB | 100 GB |
| Backing services (all-in-one) | 1 | 4 | 16 GB | 200 GB | PostgreSQL + Redis + Kafka(1) + MinIO + OpenSearch single-node |
| **Dev subtotal** | **~3–5 VMs** | **~16–24 vCPU** | **~48–64 GB** | **~400 GB** |

### 5.4 Model B landscape total (indicative)

| Environment | VMs | vCPU (steady) | RAM (steady) | Storage |
|-------------|----:|--------------:|-------------:|---------|
| Development | 3–5 | ~16–24 | ~48–64 GB | ~0.4 TB |
| Staging | 13–17 | ~45–60 | ~130 GB | ~1.2 TB |
| Production | 24 (→35 burst) | ~118 (→230) | ~390 GB (→520) | ~6–8 TB + growth |
| **Landscape** | **~40–55 VMs** | **~180–300 vCPU** | **~570–710 GB** | **~8–10 TB + growth** |

---

## 6. Model C — Air-gapped / on-prem bare-metal

Same workloads as Model B, deployed **offline** from the escrow bundle (`deploy/escrow/clario360-escrow-<version>.tar.gz`) through a **private Harbor registry** (`harbor.internal.corp:5000`). No outbound internet. Driven by `values-airgap.yaml`.

### 6.1 Additional / changed requirements vs. Model B

| Item | Requirement |
|------|-------------|
| **Private container registry** | Harbor (or equivalent) — **1× server, 4 vCPU / 8 GB / ≥ 500 GB SSD** for all images + base images mirrored from the escrow `dependencies/images/` tarballs. |
| **Build / bootstrap host** | 1× server, 8 vCPU / 16 GB / 200 GB — offline build (`GOWORK=off go build -mod=vendor`), `npm run build`, image load, `helm`/`kubectl`/`terraform` CLIs (all bundled in escrow). |
| **Internal CA & TLS** | Mandatory internal CA (no Let's Encrypt). TLS secret `clario360-internal-tls`. |
| **Email** | `email.enabled: false` — no external SMTP; notifications via in-app/WS only (or an internal relay). |
| **Telemetry** | OTLP external export disabled; Prometheus/Grafana/Loki **internal only**. |
| **AI / inference** | External Claude API unreachable → **enable self-hosted CPU inference** (`inference.llamacpp` and/or `bitnet`). Add **1–2 inference nodes (8 vCPU / 16 GB, +10 Gi model volume each)**; optional GPU node if higher throughput needed. |
| **Vault** | Self-hosted HA (3 nodes) with **HSM or KMS auto-unseal**; PKI roots `pki-siem-root` / `pki-dr-root` (10-year), transit keys for tenant DEKs. |
| **WORM storage** | MinIO Object Lock — SIEM cold (`COMPLIANCE`, 7-year) and DR recovery points (`GOVERNANCE`) buckets must be on lockable storage. |
| **Escrow verification** | Run `verification/verify-integrity.sh` (SHA256SUMS) + `verify-build.sh` on the bootstrap host before deploy. |
| **Optional non-K8s DR agent** | Customer-side **ClarioDR capture agent** can run via `systemd` (`deploy/systemd/clario-dr-agent.service`) or container — small footprint (1–2 vCPU / 2–4 GB) on the protected estate, not the central cluster. |

### 6.2 Air-gapped production server BOM

Use the **Model B Production BOM (§5.1)** as the baseline and **add**: Harbor registry (1), build/bootstrap host (1), inference nodes (1–2). Physical hosts may consolidate multiple VM roles via a hypervisor (VMware/Proxmox/KVM) provided per-role CPU/RAM/disk and anti-affinity (3 brokers / 3 etcd / 3 OpenSearch on **separate physical hosts**) are preserved.

**Indicative bare-metal layout (production):** 6–9 physical servers, each **2× CPU (32–64 cores total) / 256–512 GB RAM / NVMe + bulk SSD**, running a hypervisor that hosts the ~26 VM roles above with N+1 host redundancy. Exact host count depends on consolidation ratio and the customer's blade/rack standard.

---

## 7. Storage requirements (all models)

| Data class | Where | Prod size (start) | Retention / notes |
|------------|-------|-------------------|-------------------|
| Relational (PostgreSQL) | block SSD | 200 GB → 1 TB | 10 logical DBs; auto-grow; 30 backups + PITR |
| Kafka logs | block SSD | 3 × 200 Gi | 7-day default; audit topic 90-day; DR progress 1-day |
| OpenSearch (SIEM hot) | block SSD | 3 × 500 GB+ | sized to daily ingest × hot window |
| MinIO app objects | object | ≥ 100 Gi/node ×4 | documents/reports/temp |
| MinIO SIEM cold (WORM) | object (Object Lock) | grows with retention | **COMPLIANCE 7-year** |
| MinIO DR recovery points (WORM) | object (Object Lock) | grows with RPO/retention | **GOVERNANCE** |
| Prometheus / Loki | block SSD | 100 Gi each | 30-day prod |
| Vault (Raft) | block SSD | 20 Gi ×3 | HA |
| Registry (air-gap) | block SSD | ≥ 500 GB | all images |
| Per-PVC bounds | — | min 1 Gi / max 50 Gi | LimitRange default |

---

## 8. Network & connectivity requirements

| Requirement | Detail |
|-------------|--------|
| Ingress | HTTPS 443 → NGINX Ingress; `clario360.com` + `api.clario360.com` (or internal equivalents). Body size 100 MB, 120 s timeouts. |
| Inter-service | In-cluster only; network policies enforced (staging/prod/air-gap). |
| Egress | Model A/B: to Anthropic Claude API (AI), SMTP, CVE feeds, ACME. **Model C: none** (deny-all egress). |
| Data-plane segmentation | DB/Redis/Vault in an isolated subnet with **egress-deny to internet**. |
| mTLS | Required for ClarioDR agents (`:8098`) and SIEM collector enrolment; CRL refresh 30 s–1 m. |
| Load balancer | 1 external L4/L7 per environment (or sovereign-cloud LB). |
| DNS | Public/sovereign zone; DNSSEC in production. |
| Bandwidth | Sized to SIEM/DR replication ingest — confirm with customer log/replication volume. |

---

## 9. Security & compliance requirements

The platform implements controls aligned to **ISO 27001:2022, NCA ECC (National Cybersecurity Authority Essential Controls), SAMA CSF, and NDMO** data-governance requirements. The provisioned infrastructure must support:

- **Data residency in KSA** — GCP `me-central1` (Dammam) for Model A, or in-Kingdom data centre / sovereign cloud for Models B/C.
- **Encryption at rest** — AES-256-GCM; KMS/HSM-backed keys, 90-day rotation; **HSM protection level in production**.
- **Encryption in transit** — TLS 1.3; mTLS for DR/SIEM data planes.
- **Secrets** — HashiCorp Vault (HA in prod), Workload Identity / AppRole; **no secrets in images or env files**.
- **WORM immutability** — Object Lock for SIEM cold (7-year COMPLIANCE) and DR recovery points (GOVERNANCE).
- **Audit** — hash-chained audit log, 7-year export retention, dedicated audit Kafka topic (90-day) and bucket.
- **Supply-chain / sovereignty** — signed images (Binary Authorization in prod); **source/build escrow** for air-gap.
- **Hardening** — private node/endpoint, shielded nodes, network policies, PDBs, resource quotas (prod 64 vCPU / 128 Gi / 200 pods per app namespace).

---

## 10. Supporting infrastructure (all models)

| Component | Requirement |
|-----------|-------------|
| CI/CD | ArgoCD (GitOps) — small footprint on system pool. Build pipeline (online) or escrow bootstrap host (air-gap). |
| Container registry | GCR/Artifact Registry (Model A) or **Harbor** (Models B/C). |
| Monitoring | Prometheus + Grafana + Alertmanager + Loki/Promtail (kube-prometheus-stack). |
| Tracing | Jaeger / OTel Collector (omit external export in air-gap). |
| Backup/DR | DB backups + GCS/object export; ClarioDR for application-level recovery. |
| Admin access | Bastion/jump host; IAP/SSH (non-prod) or VPN. |

---

## 11. Assumptions & exclusions

**Assumptions**
1. Kubernetes **1.27+**; container runtime containerd.
2. Steady-state sizing assumes min replicas; HPA bursts to the maxima shown. Final storage (MinIO/OpenSearch/Kafka) depends on **customer data volume and retention** — confirm SIEM daily ingest and DR RPO/retention before locking disk sizes.
3. Onboarding-service is disabled; AI inference is disabled by default (enabled for air-gap).
4. One bastion + one LB per environment; shared registry/monitoring across environments where policy allows.
5. CPU is x86-64 with AVX2/FMA (required by the CPU inference build).

**Exclusions (out of scope of this request)**
- End-user devices, corporate VPN, and WAN links.
- External SaaS subscriptions (Anthropic Claude API quota, SMTP provider, public CA) — procured separately; N/A for air-gap.
- Application licensing/entitlement keys (handled by license-service).

---

## 12. Consolidated request summary

| Model | Dev | Staging | Production | Notes |
|-------|-----|---------|------------|-------|
| **A — Managed GKE (me-central1)** | 1 sys + 1–3 wkld + 0–1 compute nodes; `db-2-4096`; Redis 1 GB | 2 sys + 2–6 wkld; `db-4-8192`; Redis 2 GB | 3 sys + 3–12 wkld + 0–6 compute; `db-8-32768` REGIONAL; Redis 5 GB HA | GCP project + quota + Terraform apply |
| **B — Self-managed VMs** | ~3–5 VMs / ~16–24 vCPU / ~48–64 GB | ~13–17 VMs / ~45–60 vCPU / ~130 GB | ~24 VMs (→35 burst) / ~118–230 vCPU / ~390–520 GB | Full BOM in §5 |
| **C — Air-gapped bare-metal** | as B (offline) | as B (offline) | B + Harbor + bootstrap host + 1–2 inference nodes; ~6–9 physical hosts | Escrow bundle, no egress |

**Recommended default:** **Model B (self-managed VMs)** for the Watheeq/MahamaTech sovereign hosting, with Model C as the fallback for any classified/air-gapped tenant. Model A is the fastest path if a GCP `me-central1` sovereign footprint is acceptable.

---

## 13. Sign-off

| Role | Name | Decision / Notes | Date |
|------|------|------------------|------|
| Requestor (Engineering) | | | |
| CTO (Saleh) — runtime/infra decision | | | |
| Infrastructure / Cloud Ops | | | |
| Security & Compliance (NCA/SAMA/NDMO) | | | |
| Procurement | | | |

---

*Generated from the Clario360 repository deployment assets (`deploy/helm`, `deploy/terraform`, `docker-compose*.yml`, `deploy/escrow`) on 2026-06-20. Verify against current `values-*.yaml` and `terraform/environments/*` before purchase, and confirm storage sizing against the target tenant's data-volume and retention profile.*
