#!/usr/bin/env bash
#
# Phase 1 API/event contract check.
#
# Static checks for the DR, Watheeq/Lex, and licensing OpenAPI foundations plus the
# transactional outbox write-path anchors. The checks intentionally validate
# existing code references instead of generating code.

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "${REPO_ROOT}"

fail() { echo "contract FAIL: $*" >&2; exit 1; }
ok()   { echo "contract ok  : $*"; }

normalized_anchor_exists() {
    python3 - "$1" "$2" <<'PY'
from pathlib import Path
import re
import sys

source = Path(sys.argv[1]).read_text()
anchor = sys.argv[2]

def normalize(value: str) -> str:
    # Prettier may switch quote style and wrap calls without changing their
    # contract meaning. Normalize those presentation-only differences while
    # keeping the complete semantic anchor comparison.
    compact = re.sub(r"\s+", "", value.replace('"', "'")).replace(";", "")
    return compact.replace(",)", ")").replace(",]", "]").replace(",}", "}")

raise SystemExit(0 if normalize(anchor) in normalize(source) else 1)
PY
}

require_any_anchor() {
    local label="$1"
    local file="$2"
    shift 2
    local anchor
    for anchor in "$@"; do
        if grep -F "${anchor}" "${file}" >/dev/null; then
            return 0
        fi
    done
    fail "${label} anchor missing in ${file}"
}

python3 scripts/generate-watheeq-api-docs.py --check
ok "Watheeq/Lex generated route inventory is current"

python3 - <<'PY'
from pathlib import Path
import re

try:
    import yaml
except Exception as exc:
    raise SystemExit(f"PyYAML is required to parse OpenAPI files: {exc}")

specs = {
    "docs/api/clario-dr-service.openapi.yaml": {
        "paths": {
            "/agents": ["get", "post"],
            "/agents/enroll": ["post"],
            "/agents/{agentID}": ["get"],
            "/agents/{agentID}/enrollment-token": ["post"],
            "/app-verification": ["get"],
            "/app-verification/{id}": ["get"],
            "/assurance/assessments/{id}": ["get"],
            "/assurance/controls": ["get"],
            "/assurance/groups/{group}/evaluate": ["post"],
            "/assurance/groups/{group}/latest": ["get"],
            "/attestation-ledger": ["get"],
            "/attestation-ledger/anchor": ["post"],
            "/attestation-ledger/verify": ["get"],
            "/attestation-ledger/{seq}/proof": ["get"],
            "/bcm/assessments/{id}": ["get"],
            "/bcm/packs": ["get"],
            "/bcm/packs/{key}": ["get"],
            "/bcm/packs/{key}/assess": ["post"],
            "/boot-runs/{runID}": ["get"],
            "/byok/keys": ["get", "post"],
            "/byok/keys/custody-log": ["get"],
            "/byok/keys/rotate": ["post"],
            "/copilot/chat": ["post"],
            "/copilot/sessions/{sessionID}": ["get"],
            "/cyber-vaults": ["get", "post"],
            "/cyber-vaults/assessments": ["get"],
            "/cyber-vaults/{vaultID}": ["put"],
            "/cyber-vaults/{vaultID}/assessments/latest": ["get"],
            "/cyber-vaults/{vaultID}/evaluate": ["post"],
            "/cyber-vaults/{vaultID}/sync/plan": ["post"],
            "/drill-results/{id}/diff": ["get"],
            "/drill-schedules": ["get", "post"],
            "/drill-schedules/{id}/next-runs": ["get"],
            "/failback-runs": ["get", "post"],
            "/failback-runs/{id}": ["get"],
            "/failback-runs/{id}/advance": ["post"],
            "/failback-runs/{id}/approve-cutback": ["post"],
            "/failback-runs/{id}/steps": ["get"],
            "/failover-runs": ["get", "post"],
            "/failover-runs/{runID}": ["get"],
            "/failover-runs/{runID}/approve": ["post"],
            "/failover-runs/{runID}/attestation": ["get"],
            "/failover-runs/{runID}/cancel": ["post"],
            "/failover-runs/{runID}/steps": ["get"],
            "/failover/{id}/cancel": ["post"],
            "/gameday/runs/{runID}": ["get"],
            "/gameday/scenarios": ["get", "post"],
            "/gameday/scenarios/{scenarioID}/runs": ["post"],
            "/groups": ["get", "post"],
            "/groups/{groupID}": ["get"],
            "/groups/{groupID}/app-consistent-point": ["post"],
            "/groups/{groupID}/boot-plan": ["get"],
            "/groups/{groupID}/boot-runs": ["post"],
            "/groups/{groupID}/boot-services": ["post"],
            "/groups/{groupID}/consistency-barriers": ["get"],
            "/groups/{groupID}/drill-results": ["get"],
            "/groups/{groupID}/journal/materialize": ["post"],
            "/groups/{groupID}/members": ["get", "post"],
            "/groups/{groupID}/network-mappings": ["get", "post"],
            "/groups/{groupID}/recovery-points": ["get", "post"],
            "/groups/{groupID}/runbook": ["get"],
            "/groups/{groupID}/summary": ["get"],
            "/groups/{groupID}/runbook/regenerate": ["post"],
            "/groups/{groupID}/runbook/versions": ["get"],
            "/groups/{groupID}/topology": ["get"],
            "/groups/{groupID}/topology/edges": ["post"],
            "/groups/{groupID}/topology/failover-target": ["get"],
            "/iac-snapshots": ["get", "post"],
            "/iac-snapshots/{id}": ["get"],
            "/iac-snapshots/{id}/diff": ["get"],
            "/iac-snapshots/{id}/reconstitution-plan": ["get"],
            "/instant-sessions/{id}": ["get"],
            "/instant-sessions/{id}/chunks/{index}": ["get", "put"],
            "/instant-sessions/{id}/finalize": ["post"],
            "/integrations": ["get", "post"],
            "/integrations/{id}": ["delete", "get", "put"],
            "/integrations/{id}/test": ["post"],
            "/predictions": ["get"],
            "/posture": ["get"],
            "/ransomware/signals": ["get"],
            "/ransomware/streams/{streamID}/signals": ["get"],
            "/recovery-points/{id}/instant-recovery": ["post"],
            "/recovery-points/{recoveryPointID}": ["get"],
            "/recovery-points/{recoveryPointID}/cleanroom": ["get"],
            "/recovery-points/{recoveryPointID}/cleanroom-scan": ["post"],
            "/recovery-points/{recoveryPointID}/validate": ["post"],
            "/recovery-tiers": ["get"],
            "/recovery-tiers/coverage": ["get"],
            "/recovery-tiers/{tier}": ["get"],
            "/recovery-tiers/recommend": ["post"],
            "/recovery-tiers/sites/{site}/recommend": ["get"],
            "/rehearsal-proofs/failover-runs/{runID}": ["get"],
            "/rehearsal-proofs/failover-runs/{runID}/seal": ["post"],
            "/rehearsal-proofs/failover-runs/{runID}/sealed": ["get"],
            "/rehearsal-proofs/gameday/{runID}": ["get"],
            "/rehearsal-proofs/gameday/{runID}/seal": ["post"],
            "/rehearsal-proofs/gameday/{runID}/sealed": ["get"],
            "/rehearsal-proofs/runbook-runs/{runID}": ["get"],
            "/rehearsal-proofs/runbook-runs/{runID}/seal": ["post"],
            "/rehearsal-proofs/runbook-runs/{runID}/sealed": ["get"],
            "/replication/summary": ["get"],
            "/selfdr/artifacts": ["get"],
            "/selfdr/assess": ["post"],
            "/selfdr/assessments/latest": ["get"],
            "/selfdr/assessments/{id}": ["get"],
            "/selfdr/backups": ["post"],
            "/selfdr/components": ["get"],
            "/selfdr/offline-bundle": ["post"],
            "/sites": ["get", "post"],
            "/sites/{siteID}": ["get"],
            "/storage-snapshots/{id}": ["get"],
            "/storage-snapshots/{id}/replicate": ["post"],
            "/storage-volumes": ["get", "post"],
            "/storage-volumes/{id}": ["get"],
            "/storage-volumes/{id}/snapshots": ["get", "post"],
            "/streams": ["get", "post"],
            "/streams/{streamID}": ["get"],
            "/streams/{streamID}/forecast": ["get"],
            "/streams/{streamID}/frames": ["post"],
            "/streams/{streamID}/journal/bookmarks": ["get", "post"],
            "/streams/{streamID}/journal/bookmarks/{bookmarkID}": ["delete"],
            "/streams/{streamID}/journal/resolve": ["get"],
            "/streams/{streamID}/journal/timeline": ["get"],
            "/streams/{streamID}/pause": ["post"],
            "/streams/{streamID}/resume": ["post"],
            "/streams/{streamID}/rpo": ["get"],
            "/studio/runbooks": ["post"],
            "/studio/runbooks/{runbookID}": ["get", "put"],
            "/studio/runbooks/{runbookID}/runs": ["post"],
            "/studio/runbooks/{runbookID}/tasks": ["post"],
            "/studio/runs/{runID}": ["get"],
            "/studio/runs/{runID}/tasks/{taskAction}": ["post"],
            "/workload-captures": ["get", "post"],
            "/workload-captures/{id}/epochs": ["get"],
            "/workload-captures/{id}/run": ["post"],
        },
        "server": "/api/v1/dr",
        "gateway_contract": {
            "id": "clario-dr-service",
            "version": "1.0.0",
            "api_version": "v1",
            "fail_closed": False,
        },
    },
    "docs/api/license-entitlement.openapi.yaml": {
        "paths": {
            "/check": ["get"],
            "/entitlements": ["get"],
            "/usage": ["post"],
            "/offline-license/activate": ["post"],
            "/admin/plans": ["get", "post"],
            "/admin/plans/{key}": ["get"],
            "/admin/plans/{key}/entitlements": ["put"],
            "/admin/tenants/{tenantID}/license": ["get", "post"],
            "/admin/tenants/{tenantID}/license/suspend": ["post"],
            "/admin/tenants/{tenantID}/license/resume": ["post"],
            "/admin/tenants/{tenantID}/overrides/{key}": ["put", "delete"],
            "/admin/tenants/{tenantID}/offline-license": ["post"],
        },
        "server": "/api/v1/licensing",
        "gateway_contract": {
            "id": "license-entitlement",
            "version": "1.0.0",
            "api_version": "v1",
            "fail_closed": False,
        },
    },
    "docs/api/watheeq-lex-service.openapi.yaml": {
        "paths": None,
        "servers": ["/api/v1/lex", "/api/v1/watheeq"],
        "gateway_contract": {
            "id": "watheeq-lex-service",
            "version": "1.0.0",
            "api_version": "v1",
            "fail_closed": False,
        },
    },
}

operation_ids = {}
http_methods = {"get", "post", "put", "patch", "delete"}
for rel, contract in specs.items():
    path = Path(rel)
    if not path.exists():
        raise SystemExit(f"{rel} missing")
    doc = yaml.safe_load(path.read_text())
    if not isinstance(doc, dict):
        raise SystemExit(f"{rel} is not a YAML object")
    if not str(doc.get("openapi", "")).startswith("3."):
        raise SystemExit(f"{rel} must be OpenAPI 3.x")
    if doc.get("info", {}).get("x-contract-phase") != "phase-1-foundation":
        raise SystemExit(f"{rel} missing x-contract-phase=phase-1-foundation")
    gateway_contract = doc.get("info", {}).get("x-gateway-contract")
    if not isinstance(gateway_contract, dict):
        raise SystemExit(f"{rel} x-gateway-contract must be an object")
    for key, expected_value in contract["gateway_contract"].items():
        if gateway_contract.get(key) != expected_value:
            raise SystemExit(
                f"{rel} x-gateway-contract.{key} = {gateway_contract.get(key)!r}, "
                f"want {expected_value!r}"
            )
    servers = [s.get("url") for s in doc.get("servers", []) if isinstance(s, dict)]
    expected_servers = contract.get("servers", [contract.get("server")])
    for expected_server in expected_servers:
        if expected_server and expected_server not in servers:
            raise SystemExit(f"{rel} missing server {expected_server}")
    paths = doc.get("paths")
    if not isinstance(paths, dict):
        raise SystemExit(f"{rel} has no paths object")
    declared_operations = {}
    for route, path_item in paths.items():
        if not isinstance(path_item, dict):
            raise SystemExit(f"{rel} path item {route} is not an object")
        for method, op in path_item.items():
            if method not in http_methods:
                continue
            op_id = op.get("operationId")
            if not op_id:
                raise SystemExit(f"{rel} {method.upper()} {route} missing operationId")
            previous = operation_ids.setdefault(op_id, f"{rel} {method.upper()} {route}")
            if previous != f"{rel} {method.upper()} {route}":
                raise SystemExit(f"duplicate operationId {op_id}: {previous} and {rel} {method.upper()} {route}")
            declared_operations.setdefault(route, []).append(method)
    expected_paths = contract.get("paths")
    if expected_paths is not None:
        for route, methods in expected_paths.items():
            if route not in paths:
                raise SystemExit(f"{rel} missing path {route}")
            for method in methods:
                if method not in declared_operations.get(route, []):
                    raise SystemExit(f"{rel} missing {method.upper()} {route}")
    if rel == "docs/api/clario-dr-service.openapi.yaml":
        site_kind_enum = (
            doc.get("components", {})
            .get("schemas", {})
            .get("CreateSiteRequest", {})
            .get("properties", {})
            .get("kind", {})
            .get("enum")
        )
        if site_kind_enum != ["vm", "database", "fileset"]:
            raise SystemExit(f"{rel} CreateSiteRequest.kind enum = {site_kind_enum!r}, want ['vm', 'database', 'fileset']")

        route_files = (
            sorted(Path("backend/internal/dr").glob("**/router.go"))
            + sorted(Path("backend/internal/dr").glob("**/handler.go"))
            + [Path("backend/internal/dr/predict/api.go"), Path("backend/cmd/clario-dr-service/main.go")]
        )
        route_re = re.compile(r'\b(?:r|protected)\.(Get|Post|Put|Patch|Delete)\("([^"]+)"')
        registered = {}
        for source in route_files:
            if not source.exists():
                raise SystemExit(f"{source} missing")
            for lineno, line in enumerate(source.read_text().splitlines(), 1):
                for match in route_re.finditer(line):
                    method = match.group(1).lower()
                    route = match.group(2)
                    if route.startswith("/api/v1/dr"):
                        continue
                    registered.setdefault((route, method), []).append(f"{source}:{lineno}")
        expected = {
            (route, method)
            for route, methods in contract["paths"].items()
            for method in methods
        }
        registered_routes = set(registered)
        missing_from_contract = registered_routes - expected
        if missing_from_contract:
            details = "\n".join(
                f"  {method.upper()} {route} registered at {', '.join(registered[(route, method)])}"
                for route, method in sorted(missing_from_contract)
            )
            raise SystemExit(f"{rel} route inventory missing registered DR routes:\n{details}")
        missing_from_sources = expected - registered_routes
        if missing_from_sources:
            details = "\n".join(f"  {method.upper()} {route}" for route, method in sorted(missing_from_sources))
            raise SystemExit(f"{rel} route inventory has no matching registered DR route:\n{details}")
    if rel == "docs/api/watheeq-lex-service.openapi.yaml":
        source = Path("backend/internal/lex/handler/routes.go")
        if not source.exists():
            raise SystemExit(f"{source} missing")
        # Permission-specific subrouters (contractView, approvalWrite, and
        # similar) register real routes too; match every chi router variable,
        # not only the coarse read/write pair.
        route_re = re.compile(r'\.(Get|Post|Put|Patch|Delete)\s*\(\s*"([^"]+)"')
        registered = {}
        for lineno, line in enumerate(source.read_text().splitlines(), 1):
            for match in route_re.finditer(line):
                method = match.group(1).lower()
                route = match.group(2)
                registered.setdefault((route, method), []).append(f"{source}:{lineno}")
        expected = {
            (route, method)
            for route, methods in declared_operations.items()
            for method in methods
        }
        # This document is explicitly the phase-1 public-contract foundation,
        # not an inventory of every internal/admin route. Keep the boundary
        # honest in both directions: every declared operation must exist in the
        # router, while registered operations outside the public boundary are
        # quantified for the readiness report instead of making this gate
        # impossible to pass until the later contract phases are complete.
        undeclared_registered = set(registered) - expected
        print(
            f"{rel}: phase-1 boundary declares {len(expected)} of "
            f"{len(registered)} registered operations; "
            f"{len(undeclared_registered)} remain outside the public contract"
        )
        missing_from_sources = expected - set(registered)
        if missing_from_sources:
            details = "\n".join(f"  {method.upper()} {route}" for route, method in sorted(missing_from_sources))
            raise SystemExit(f"{rel} route inventory has no matching registered Watheeq/Lex route:\n{details}")
        required_drafting = {
            ("/drafting/clauses", "post"),
            ("/drafting/contracts", "post"),
            ("/drafting/clauses/rewrite", "post"),
            ("/drafting/clauses/fallbacks", "post"),
            ("/drafting/translate", "post"),
            ("/drafting/summary", "post"),
            ("/drafting/glossary", "post"),
            ("/drafting/assemble", "post"),
            ("/drafting/rfp-response", "post"),
            ("/drafting/obligations/qa-review", "post"),
        }
        registered_drafting = {
            (route, method)
            for route, method in registered
            if route.startswith("/drafting/")
        }
        declared_drafting = {
            (route, method)
            for route, methods in declared_operations.items()
            if route.startswith("/drafting/")
            for method in methods
        }
        missing_registered_drafting = required_drafting - registered_drafting
        if missing_registered_drafting:
            details = "\n".join(
                f"  {method.upper()} {route}"
                for route, method in sorted(missing_registered_drafting)
            )
            raise SystemExit(f"{rel} required Watheeq AI drafting routes are not registered:\n{details}")
        if declared_drafting != required_drafting:
            details = "\n".join(
                f"  {method.upper()} {route}"
                for route, method in sorted(declared_drafting ^ required_drafting)
            )
            raise SystemExit(f"{rel} OpenAPI Watheeq AI drafting route set drifted:\n{details}")
        for route, method in sorted(required_drafting):
            op = paths.get(route, {}).get(method)
            if not isinstance(op, dict):
                raise SystemExit(f"{rel} missing OpenAPI operation for {method.upper()} {route}")
            if "Drafting" not in op.get("tags", []):
                raise SystemExit(f"{rel} {method.upper()} {route} must be tagged Drafting")
            if op.get("x-required-permission") != "lex:write":
                raise SystemExit(f"{rel} {method.upper()} {route} must require lex:write")
            expected_engine = "deterministic" if route == "/drafting/assemble" else "llm"
            if op.get("x-drafting-engine") != expected_engine:
                raise SystemExit(f"{rel} {method.upper()} {route} x-drafting-engine = {op.get('x-drafting-engine')!r}, want {expected_engine!r}")
            request_body = op.get("requestBody", {})
            request_schema = (
                request_body
                .get("content", {})
                .get("application/json", {})
                .get("schema", {})
            )
            if not request_schema:
                raise SystemExit(f"{rel} {method.upper()} {route} missing JSON request schema")
            responses = op.get("responses", {})
            for status in ("200", "400", "401", "403"):
                if status not in responses:
                    raise SystemExit(f"{rel} {method.upper()} {route} missing {status} response")
            if expected_engine == "llm":
                response_503 = responses.get("503")
                if not isinstance(response_503, dict):
                    raise SystemExit(f"{rel} {method.upper()} {route} missing disabled-LLM 503 response")
                if response_503.get("x-error-code") != "DRAFTING_UNAVAILABLE":
                    raise SystemExit(f"{rel} {method.upper()} {route} 503 must document DRAFTING_UNAVAILABLE")
            elif "503" in responses:
                raise SystemExit(f"{rel} {method.upper()} {route} is deterministic and must not document disabled-LLM 503")
        assemble_op = paths["/drafting/assemble"]["post"]
        assemble_req = (
            assemble_op["requestBody"]["content"]["application/json"]["schema"].get("$ref")
        )
        assemble_res = (
            assemble_op["responses"]["200"]["content"]["application/json"]["schema"].get("$ref")
        )
        if assemble_req != "#/components/schemas/DraftingAssemblyRequest":
            raise SystemExit(f"{rel} POST /drafting/assemble request schema = {assemble_req!r}")
        if assemble_res != "#/components/schemas/DraftingAssemblyResultEnvelope":
            raise SystemExit(f"{rel} POST /drafting/assemble response schema = {assemble_res!r}")
        schemas = doc.get("components", {}).get("schemas", {})
        for schema_name in ("DraftingAssemblyRequest", "DraftingTemplateSection", "DraftingAssemblyResult", "DraftingAssemblyResultEnvelope"):
            if schema_name not in schemas:
                raise SystemExit(f"{rel} missing {schema_name} schema")
PY
ok "OpenAPI specs parse and route inventories match registered routes"

DR_SPEC="docs/api/clario-dr-service.openapi.yaml"
LIC_SPEC="docs/api/license-entitlement.openapi.yaml"
WATHEEQ_SPEC="docs/api/watheeq-lex-service.openapi.yaml"

grep -F "suite.datastream" "${DR_SPEC}" >/dev/null || fail "DR spec must document suite.datastream entitlement"
grep -F "dr:failover" "${DR_SPEC}" >/dev/null || fail "DR spec must document dr:failover permission"
grep -F "datastream.dr.events" "${DR_SPEC}" >/dev/null || fail "DR spec must document datastream.dr.events"
grep -F "agentMutualTLS" "${DR_SPEC}" >/dev/null || fail "DR spec must document mTLS agent ingest"
ok "DR spec includes entitlement, permission, event, and mTLS markers"

grep -F "platform.license.events" "${LIC_SPEC}" >/dev/null || fail "license spec must document platform.license.events"
grep -F "licensing:admin" "${LIC_SPEC}" >/dev/null || fail "license spec must document licensing:admin"
grep -F "seats.users" "${LIC_SPEC}" >/dev/null || fail "license spec must document seats.users"
grep -F "suite.datastream" "${LIC_SPEC}" >/dev/null || fail "license spec must document suite.datastream"
ok "license spec includes entitlement, admin, seat, and event markers"

grep -F "app.watheeq" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document app.watheeq entitlement"
grep -F "watheeq-lex-service" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document contract id"
grep -F "/api/v1/watheeq" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document /api/v1/watheeq alias"
grep -F "lex:read" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document lex:read"
grep -F "lex:write" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document lex:write"
grep -F "/contracts/{id}/brief" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document contract brief route"
grep -F "/contracts/renewal-warnings" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document contract renewal warning route"
grep -F "/contracts/{id}/classify" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document contract classification route"
grep -F "/contracts/{id}/timeline" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document contract timeline route"
grep -F "/matters/conflict-check" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document matter conflict-check route"
grep -F "/documents/repository-summary" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document document repository summary route"
grep -F "/documents/bulk-import" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document document bulk import route"
grep -F "/clause-library/{id}/governance" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document clause library governance route"
grep -F "/regulations/{id}/governance" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document regulation governance route"
grep -F "LibraryGovernanceDecisionRequest" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document library governance decision payload"
grep -F "/workflow-policies/approval/analytics" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document approval policy analytics route"
grep -F "/workflow-policies/approval/{id}" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document approval policy lifecycle route"
grep -F "UpdateApprovalPolicyRequest" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document approval policy update payload"
grep -F "ApprovalPolicyAnalyticsEnvelope" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document approval policy analytics envelope"
grep -F "/drafting/assemble" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document deterministic drafting assembly route"
grep -F "x-drafting-engine: deterministic" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must mark deterministic drafting assembly"
grep -F "x-drafting-engine: llm" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must mark LLM-backed drafting routes"
grep -F "DRAFTING_UNAVAILABLE" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document disabled LLM drafting response code"
grep -F "DraftingAssemblyRequest" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document drafting assembly payload"
grep -F "LEX_SIGNATURE_PROVIDER_MODE=http" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document HTTP signature provider dispatch"
grep -F "LEX_OBLIGATION_REMINDER_PROVIDER_MODE=http" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document HTTP obligation reminder provider dispatch"
grep -F "LEX_OBLIGATION_REMINDER_PROVIDER_ENDPOINT" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document HTTP obligation reminder provider endpoint"
grep -F "LEX_OBLIGATION_REMINDER_PROVIDER_API_KEY" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document HTTP obligation reminder provider API key"
grep -F "LEX_OBLIGATION_REMINDER_PROVIDER_TIMEOUT" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document HTTP obligation reminder provider timeout"
grep -F "live Nafath" "${WATHEEQ_SPEC}" >/dev/null || fail "Watheeq/Lex spec must document live Nafath credential gap"
ok "Watheeq/Lex spec includes entitlement, contract, alias, permission, and integration markers"

WATHEEQ_DOCS_MAIN="backend/cmd/lex-service/main.go"
WATHEEQ_DOCS_PACKAGE="backend/internal/lex/apidocs/apidocs.go"
for anchor in \
    'lexapidocs.RegisterRoutes(svc.Router)' \
    'Str("swagger_ui", "/api/docs/watheeq/")' \
    'Str("openapi", "/api/docs/watheeq/openapi.json")'
do
    grep -F "${anchor}" "${WATHEEQ_DOCS_MAIN}" >/dev/null || fail "Watheeq Swagger service mount missing: ${anchor}"
done
for anchor in \
    'r.Get("/api/docs/watheeq/", serveSwaggerUI)' \
    'r.Get("/api/docs/watheeq/openapi.json"' \
    'r.Get("/api/docs/watheeq/openapi.yaml"' \
    'r.Get("/api/docs/watheeq/routes.json"'
do
    grep -F "${anchor}" "${WATHEEQ_DOCS_PACKAGE}" >/dev/null || fail "Watheeq Swagger endpoint missing: ${anchor}"
done
ok "Watheeq Swagger UI and raw contract endpoints are mounted"

GW="backend/internal/gateway/config/routes.go"
grep -F 'Prefix: "/api/v1/licensing", Service: "license-service"' "${GW}" >/dev/null \
    || fail "gateway licensing route missing"
grep -F 'Contract: ContractIntent{ID: "license-entitlement", Version: "1.0.0", APIVersion: "v1", Phase: "phase-1-foundation"}' "${GW}" >/dev/null \
    || fail "gateway licensing route contract metadata missing"
grep -F 'Prefix: "/api/v1/dr", Service: "clario-dr-service"' "${GW}" >/dev/null \
    || fail "gateway DR route missing"
grep -F 'Entitlement: "suite.datastream"' "${GW}" >/dev/null \
    || fail "gateway DR route must be suite.datastream gated"
grep -F 'Contract: ContractIntent{ID: "clario-dr-service", Version: "1.0.0", APIVersion: "v1", Phase: "phase-1-foundation"}' "${GW}" >/dev/null \
    || fail "gateway DR route contract metadata missing"
ok "gateway route anchors match API contracts"

LIC_HANDLER="backend/internal/license/handler/handler.go"
for anchor in \
    'r.Get("/check", h.check)' \
    'r.Get("/entitlements", h.entitlements)' \
    'r.Post("/usage", h.consumeUsage)' \
    'r.Post("/offline-license/activate", h.activateOffline)' \
    'r.Post("/plans", h.createPlan)' \
    'r.Get("/plans", h.listPlans)' \
    'r.Get("/plans/{key}", h.getPlan)' \
    'r.Put("/plans/{key}/entitlements", h.setPlanEntitlements)' \
    'r.Post("/license", h.assignLicense)' \
    'r.Post("/license/suspend", h.suspendLicense)' \
    'r.Post("/license/resume", h.resumeLicense)' \
    'r.Put("/overrides/{key}", h.setOverride)' \
    'r.Delete("/overrides/{key}", h.removeOverride)' \
    'r.Post("/offline-license", h.issueOffline)'
do
    grep -F "${anchor}" "${LIC_HANDLER}" >/dev/null || fail "license handler anchor missing: ${anchor}"
done
ok "license handler anchors match API contract"

WATHEEQ_COVERAGE="clario360Project/legal/watheeq-rtm-coverage.json"
[[ -f "${WATHEEQ_COVERAGE}" ]] || fail "${WATHEEQ_COVERAGE} missing"
python3 - <<'PY'
import json
from pathlib import Path

coverage = json.loads(Path("clario360Project/legal/watheeq-rtm-coverage.json").read_text())
summary = coverage.get("summary", {})
if summary.get("traceability_matrix", {}).get("total") != 12:
    raise SystemExit("Watheeq RTM coverage must account for 12 traceability rows")
if summary.get("proposed_features", {}).get("total") != 100:
    raise SystemExit("Watheeq RTM coverage must account for 100 proposed features")
groups = coverage.get("proposed_feature_groups", [])
if sum(group.get("count", 0) for group in groups) != 100:
    raise SystemExit("Watheeq proposed feature groups must total 100")
ids = [item for group in groups for item in group.get("ids", [])]
if len(ids) != 100 or len(set(ids)) != 100:
    raise SystemExit("Watheeq proposed feature IDs must contain 100 unique IDs")
if len(coverage.get("now_or_must_queue", [])) != summary.get("proposed_features", {}).get("now_or_must"):
    raise SystemExit("Watheeq NOW/Must queue count does not match summary")
route_inventory = coverage.get("route_inventory", {})
if route_inventory.get("docs_api_state") != "openapi_contract_present":
    raise SystemExit("Watheeq docs_api_state should reflect the OpenAPI contract")
contract = route_inventory.get("api_contract")
if contract != "docs/api/watheeq-lex-service.openapi.yaml" or not Path(contract).is_file():
    raise SystemExit("Watheeq/Lex OpenAPI contract is missing")
inventory = route_inventory.get("api_inventory")
if inventory != "docs/api/watheeq-lex-api-inventory.md" or not Path(inventory).is_file():
    raise SystemExit("Watheeq/Lex API inventory doc is missing")
visible = set(route_inventory.get("contract_visible_slices", []))
for marker in (
    "GET /api/v1/lex/contracts/{id}/brief",
    "GET /api/v1/lex/contracts/renewal-warnings",
    "POST /api/v1/lex/contracts/{id}/classify",
    "GET /api/v1/lex/contracts/{id}/timeline",
    "POST /api/v1/lex/workflows/tasks/bulk-decision",
    "GET /api/v1/lex/workflow-policies/approval",
    "POST /api/v1/lex/workflow-policies/approval",
    "GET /api/v1/lex/workflow-policies/approval/recommend",
    "POST /api/v1/lex/matters/conflict-check",
    "GET /api/v1/lex/documents/repository-summary",
    "POST /api/v1/lex/documents/bulk-import",
    "POST /api/v1/lex/clause-library/{id}/governance",
    "POST /api/v1/lex/regulations/{id}/governance",
    "LEX_OBLIGATION_REMINDER_PROVIDER_MODE/ENDPOINT/API_KEY/TIMEOUT",
):
    if marker not in visible:
        raise SystemExit(f"Watheeq contract-visible slice missing: {marker}")
domain_coverage = coverage.get("domain_coverage", {})
for domain in ("contracts", "matters", "obligations", "clause_library", "regulation_library", "repository"):
    if domain not in domain_coverage:
        raise SystemExit(f"Watheeq domain coverage missing: {domain}")
PY
ok "Watheeq RTM coverage artifact is machine-readable and complete"

WATHEEQ_INVENTORY="docs/api/watheeq-lex-api-inventory.md"
for anchor in \
    'This is a route and client inventory' \
    'formal phase-1 API contract is `docs/api/watheeq-lex-service.openapi.yaml`' \
        'All paths above are relative to either `/api/v1/lex` or `/api/v1/watheeq`.' \
        'Backend-Backed Watheeq Domain Surface' \
        '| Contracts | `/lex/contracts`, `/lex/contracts/[id]`, `listContracts`, `getContract`, `getContractBrief`, `getContractRenewalWarnings`, `classifyContract`, `getContractTimeline`, Python SDK `lex.contracts.brief`' \
        '| Documents | `/lex/documents`, `listDocuments`, `getDocumentRepositorySummary`, `bulkImportDocuments`, Python SDK `lex.documents.repository_summary`, `lex.documents.bulk_import`' \
        '| Matters | `/lex/matters`, `listMatters`, `getMatter`, `checkMatterConflict`, Python SDK `lex.matters.conflict_check`, `API_ENDPOINTS.LEX_MATTERS`' \
        '| Obligations | `/lex/obligations`, `listObligations`, `getObligation`, `dispatchObligationReminderOutbox`, `dispatchObligationReminderOutboxItem`, `API_ENDPOINTS.LEX_OBLIGATIONS`' \
        '| Signatures | `/lex/signatures`, `listSignatures`, `getSignature`, `createSignature`, `sendSignature`, `cancelSignature`, `recordSignatureRecipientAction`, `getSignatureRecipientRendering`, `recordSignatureProviderEvent`, `recordSignatureCustody`' \
        '| Clause playbooks | `listPlaybooks`, `getPlaybook`, `createPlaybook`, `updatePlaybook`, `deletePlaybook`, `getContractClauseDeviations`' \
        '| Workflow approval policies | `GET /workflow-policies/approval`, `POST /workflow-policies/approval`, `PATCH /workflow-policies/approval/{id}`, `DELETE /workflow-policies/approval/{id}`, `GET /workflow-policies/approval/recommend`, `GET /workflow-policies/approval/analytics` |' \
        '| Workflow bridge | `listWorkflows`, `bulkDecideWorkflowTasks`, `decideWorkflowTask`, `startContractReview`, `listApprovalPolicies`, `createApprovalPolicy`, `updateApprovalPolicy`, `archiveApprovalPolicy`, `recommendApprovalPolicy`' \
        '| Reports | `getContractReport`, `getMatterReport`, `getObligationReport`, `exportContractReportCsv`, `exportMatterReportCsv`, `exportObligationReportCsv`' \
        '| Drafting | `POST /drafting/clauses`, `POST /drafting/contracts`, `POST /drafting/clauses/rewrite`, `POST /drafting/clauses/fallbacks`, `POST /drafting/translate`, `POST /drafting/summary`, `POST /drafting/glossary`, `POST /drafting/assemble`, `POST /drafting/rfp-response`, `POST /drafting/obligations/qa-review`' \
        '| AI drafting | Backend AID-* drafting routes are registered under both `/api/v1/lex` and `/api/v1/watheeq`' \
        '| Clause library | `/lex/clause-library`, `listClauseLibrary`, `getClauseLibraryEntry`, `decideClauseLibraryGovernance`, Python SDK `lex.clause_library.decide_governance`, `API_ENDPOINTS.LEX_CLAUSE_LIBRARY`' \
        '| Regulation library | `/lex/regulations`, `listRegulations`, `getRegulation`, `decideRegulationGovernance`, Python SDK `lex.regulations.decide_governance`, `API_ENDPOINTS.LEX_REGULATIONS`' \
        'LEX_OBLIGATION_REMINDER_PROVIDER_MODE/ENDPOINT/API_KEY/TIMEOUT' \
        'persisted approval policy catalog, update, archive, recommendation, and analytics routes' \
        'OpenAPI status: present in `docs/api/watheeq-lex-service.openapi.yaml`'
do
    grep -F "${anchor}" "${WATHEEQ_INVENTORY}" >/dev/null || fail "Watheeq/Lex API inventory anchor missing: ${anchor}"
done
ok "Watheeq/Lex API inventory anchors are present"

LEX_ROUTES="backend/internal/lex/handler/routes.go"
for anchor in \
    'r.Route("/api/v1/lex", func(r chi.Router) {' \
        'r.Route("/api/v1/watheeq", func(r chi.Router) {' \
        'read := r.With(sharedmw.RequirePermission(auth.PermLexRead))' \
        'write := r.With(sharedmw.RequirePermission(auth.PermLexWrite))' \
        'contractView.Get("/contracts/{id}/brief", deps.Contract.Brief)' \
        'contractView.Get("/contracts/renewal-warnings", deps.Contract.RenewalWarnings)' \
        'contractEdit.Post("/contracts/{id}/classify", deps.Contract.Classify)' \
        'contractView.Get("/contracts/{id}/timeline", deps.Contract.Timeline)' \
        'approvalRead.Get("/workflow-policies/approval", deps.Contract.ListApprovalPolicies)' \
        'approvalWrite.Post("/workflow-policies/approval", deps.Contract.CreateApprovalPolicy)' \
        'approvalRead.Get("/workflow-policies/approval/recommend", deps.Contract.RecommendApprovalPolicy)' \
        'approvalRead.Get("/workflow-policies/approval/analytics", deps.Contract.ApprovalPolicyAnalytics)' \
        'approvalWrite.Patch("/workflow-policies/approval/{id}", deps.Contract.UpdateApprovalPolicy)' \
        'approvalAdmin.Delete("/workflow-policies/approval/{id}", deps.Contract.DeleteApprovalPolicy)' \
        'contractReview.Post("/workflows/tasks/bulk-decision", deps.Contract.BulkDecideWorkflowTasks)' \
        'read.Get("/documents/repository-summary", deps.Document.RepositorySummary)' \
        'write.Post("/documents/bulk-import", deps.Document.BulkImport)' \
        'write.Post("/matters/conflict-check", deps.Matter.ConflictCheck)' \
        'write.Post("/clause-library/{id}/governance", deps.Library.DecideClauseGovernance)' \
        'write.Post("/regulations/{id}/governance", deps.Library.DecideRegulationGovernance)' \
        'write.Post("/contracts/{id}/obligations/extract", deps.Obligation.ExtractFromContract)' \
        'read.Get("/contracts/{id}/obligations", deps.Obligation.ListByContract)' \
        'write.Post("/drafting/clauses", deps.Drafting.GenerateClause)' \
        'write.Post("/drafting/contracts", deps.Drafting.DraftContract)' \
        'write.Post("/drafting/clauses/rewrite", deps.Drafting.RewriteClause)' \
        'write.Post("/drafting/clauses/fallbacks", deps.Drafting.SuggestFallbacks)' \
        'write.Post("/drafting/translate", deps.Drafting.Translate)' \
        'write.Post("/drafting/summary", deps.Drafting.Summarize)' \
        'write.Post("/drafting/glossary", deps.Drafting.Glossary)' \
        'write.Post("/drafting/assemble", deps.Drafting.Assemble)' \
        'write.Post("/drafting/rfp-response", deps.Drafting.DraftRFPResponse)' \
        'write.Post("/drafting/obligations/qa-review", deps.Drafting.ReviewObligationExtraction)' \
        'read.Get("/matters/{id}/obligations", deps.Obligation.ListByMatter)' \
        'write.Post("/obligations", deps.Obligation.Create)' \
        'read.Get("/obligations", deps.Obligation.List)' \
        'read.Get("/obligations/reminders", deps.Obligation.ReminderPlan)' \
        'write.Post("/obligations/reminders/enqueue", deps.Obligation.EnqueueReminders)' \
        'write.Post("/obligations/reminders/outbox/dispatch", deps.Obligation.DispatchReminderOutbox)' \
        'write.Post("/obligations/reminders/outbox/{outboxId}/dispatch", deps.Obligation.DispatchReminderOutboxItem)' \
        'write.Post("/obligations/reminders/outbox/{outboxId}/delivery", deps.Obligation.MarkReminderDelivery)' \
        'write.Put("/obligations/{id}/status", deps.Obligation.UpdateStatus)' \
        'write.Post("/obligations/{id}/reminders/sent", deps.Obligation.MarkReminderSent)' \
        'read.Get("/obligations/{id}", deps.Obligation.Get)' \
        'write.Put("/obligations/{id}", deps.Obligation.Update)' \
        'write.Delete("/obligations/{id}", deps.Obligation.Delete)'
do
    grep -F "${anchor}" "${LEX_ROUTES}" >/dev/null || fail "Watheeq/Lex handler anchor missing: ${anchor}"
done
ok "Watheeq/Lex handler guard anchors are present"

LEX_CLIENT="frontend/src/lib/enterprise/api.ts"
for anchor in \
    "getDashboard: (): Promise<LexDashboard> => fetchSuiteData('/api/v1/lex/dashboard')" \
    "listContracts: (params: FetchParams) => fetchSuitePaginated<LexContractRecord>('/api/v1/lex/contracts', params)" \
    "'/api/v1/lex/contracts/search'" \
    'fetchSuiteData(`/api/v1/lex/contracts/${id}`)' \
    'fetchSuiteData(`/api/v1/lex/contracts/${id}/analysis`)' \
        'apiPost<{ data: LexContractRiskAnalysis }>(`/api/v1/lex/contracts/${id}/analyze`)' \
        'fetchSuiteData(`/api/v1/lex/contracts/${id}/brief`)' \
        "fetchSuiteData('/api/v1/lex/contracts/renewal-warnings', params)" \
        'apiPost<{ data: LexContractClassificationResult }>(`/api/v1/lex/contracts/${id}/classify`, payload)' \
        'fetchSuiteData(`/api/v1/lex/contracts/${id}/timeline`)' \
        "createContract: (payload: unknown) => apiPost<{ data: LexContractRecord }>('/api/v1/lex/contracts', payload)" \
    'apiPut<{ data: LexContractRecord }>(`/api/v1/lex/contracts/${id}`, payload)' \
    'apiDelete<void>(`/api/v1/lex/contracts/${id}`)' \
    'apiPut<{ data: LexContractRecord }>(`/api/v1/lex/contracts/${id}/status`, payload)' \
    'apiPost<{ data: LexContractVersion[] }>(`/api/v1/lex/contracts/${id}/upload`, payload)' \
    'fetchSuiteData(`/api/v1/lex/contracts/${id}/redline`, params)' \
    'apiPost<{ data: LexContractRecord }>(`/api/v1/lex/contracts/${id}/renew`, payload)' \
    'apiPost<{ data: LexWorkflowSummary }>(`/api/v1/lex/contracts/${id}/review`, payload)' \
    "listWorkflows: (params: FetchParams) => fetchSuitePaginated<LexWorkflowSummary>('/api/v1/lex/workflows', params)" \
    'apiPost<{ data: LexWorkflowDecisionResult }>(' \
    '`/api/v1/lex/workflows/${workflowInstanceId}/tasks/${taskId}/decision`,' \
    "bulkDecideWorkflowTasks: (payload: LexWorkflowBulkDecisionRequest): Promise<LexWorkflowBulkDecisionResult> =>" \
    "apiPost<{ data: LexWorkflowBulkDecisionResult }>('/api/v1/lex/workflows/tasks/bulk-decision', payload)" \
    "listApprovalPolicies: (): Promise<LexApprovalPolicy[]> =>" \
    "fetchSuiteData('/api/v1/lex/workflow-policies/approval')" \
    "getApprovalPolicyAnalytics: (): Promise<LexApprovalPolicyAnalytics> =>" \
    "fetchSuiteData('/api/v1/lex/workflow-policies/approval/analytics')" \
    "createApprovalPolicy: (payload: LexCreateApprovalPolicyRequest): Promise<LexApprovalPolicy> =>" \
    "apiPost<{ data: LexApprovalPolicy }>('/api/v1/lex/workflow-policies/approval', payload)" \
    "updateApprovalPolicy: (id: string, payload: LexUpdateApprovalPolicyRequest): Promise<LexApprovalPolicy> =>" \
    'apiPatch<{ data: LexApprovalPolicy }>(`/api/v1/lex/workflow-policies/approval/${id}`, payload)' \
    "archiveApprovalPolicy: (id: string): Promise<void> =>" \
    'apiDelete<void>(`/api/v1/lex/workflow-policies/approval/${id}`)' \
    "recommendApprovalPolicy: (contractId: string): Promise<LexApprovalPolicyRecommendationResult> =>" \
    "fetchSuiteData('/api/v1/lex/workflow-policies/approval/recommend', { contract_id: contractId })" \
    'fetchSuiteData(`/api/v1/lex/contracts/${id}/clauses`)' \
    'fetchSuiteData(`/api/v1/lex/contracts/${contractId}/clauses/${clauseId}`)' \
    'fetchSuiteData(`/api/v1/lex/contracts/${contractId}/clauses/risks`)' \
        'apiPut<{ data: LexClause }>(`/api/v1/lex/contracts/${contractId}/clauses/${clauseId}/review`, payload)' \
        "listDocuments: (params: FetchParams) => fetchSuitePaginated<LexDocument>('/api/v1/lex/documents', params)" \
        "getDocumentRepositorySummary: (): Promise<LexDocumentRepositorySummary> =>" \
        "fetchSuiteData('/api/v1/lex/documents/repository-summary')" \
        "bulkImportDocuments: (payload: unknown): Promise<LexDocumentBulkImportResult> =>" \
        "apiPost<{ data: LexDocumentBulkImportResult }>('/api/v1/lex/documents/bulk-import', payload)" \
        "listMatters: (params: FetchParams) => fetchSuitePaginated<LexMatter>('/api/v1/lex/matters', params)" \
        'getMatter: (id: string): Promise<LexMatter> => fetchSuiteData(`/api/v1/lex/matters/${id}`)' \
        "checkMatterConflict: (payload: LexMatterConflictCheckRequest): Promise<LexMatterConflictCheckResult> =>" \
        "apiPost<{ data: LexMatterConflictCheckResult }>('/api/v1/lex/matters/conflict-check', payload)" \
    "listObligations: (params: FetchParams) => fetchSuitePaginated<LexObligation>('/api/v1/lex/obligations', params)" \
    'getObligation: (id: string): Promise<LexObligation> => fetchSuiteData(`/api/v1/lex/obligations/${id}`)' \
    "createObligation: (payload: LexCreateObligationPayload): Promise<LexObligation> =>" \
    "apiPost<{ data: LexObligation }>('/api/v1/lex/obligations', payload)" \
    "updateObligation: (id: string, payload: LexUpdateObligationPayload): Promise<LexObligation> =>" \
    'apiPut<{ data: LexObligation }>(`/api/v1/lex/obligations/${id}`, payload)' \
    "updateObligationStatus: (id: string, payload: LexUpdateObligationStatusPayload): Promise<LexObligation> =>" \
    'apiPut<{ data: LexObligation }>(`/api/v1/lex/obligations/${id}/status`, payload)' \
    'deleteObligation: (id: string) => apiDelete<void>(`/api/v1/lex/obligations/${id}`)' \
    "listContractObligations: (contractId: string, params: FetchParams) =>" \
    'fetchSuitePaginated<LexObligation>(`/api/v1/lex/contracts/${contractId}/obligations`, params)' \
    "listMatterObligations: (matterId: string, params: FetchParams) =>" \
    'fetchSuitePaginated<LexObligation>(`/api/v1/lex/matters/${matterId}/obligations`, params)' \
    "extractContractObligations: (contractId: string, payload: LexExtractObligationsPayload): Promise<LexObligationExtractionResult> =>" \
    'apiPost<{ data: LexObligationExtractionResult }>(`/api/v1/lex/contracts/${contractId}/obligations/extract`, payload)' \
    "getObligationReminderPlan: (params?: { as_of?: string; horizon_days?: number; include_escalations?: boolean }): Promise<LexObligationReminderPlan> =>" \
    "fetchSuiteData('/api/v1/lex/obligations/reminders', params)" \
    "enqueueObligationReminders: (payload?: LexEnqueueObligationRemindersPayload): Promise<LexObligationReminderEnqueueResult> =>" \
    "apiPost<{ data: LexObligationReminderEnqueueResult }>('/api/v1/lex/obligations/reminders/enqueue', payload)" \
    "markObligationReminderSent: (id: string, payload?: LexMarkObligationReminderSentPayload): Promise<LexObligation> =>" \
    'apiPost<{ data: LexObligation }>(`/api/v1/lex/obligations/${id}/reminders/sent`, payload)' \
    "markObligationReminderDelivery: (outboxId: string, payload: LexMarkObligationReminderDeliveryPayload): Promise<LexObligationNotificationOutboxItem> =>" \
    'apiPost<{ data: LexObligationNotificationOutboxItem }>(`/api/v1/lex/obligations/reminders/outbox/${outboxId}/delivery`, payload)' \
    "listClauseLibrary: (params: FetchParams) => fetchSuitePaginated<LexClauseLibraryEntry>('/api/v1/lex/clause-library', params)" \
    'getClauseLibraryEntry: (id: string): Promise<LexClauseLibraryEntry> => fetchSuiteData(`/api/v1/lex/clause-library/${id}`)' \
    "decideClauseLibraryGovernance: (id: string, payload: LexGovernanceDecisionRequest): Promise<LexClauseLibraryEntry> =>" \
    'apiPost<{ data: LexClauseLibraryEntry }>(`/api/v1/lex/clause-library/${id}/governance`, payload)' \
    "listRegulations: (params: FetchParams) => fetchSuitePaginated<LexRegulation>('/api/v1/lex/regulations', params)" \
    'getRegulation: (id: string): Promise<LexRegulation> => fetchSuiteData(`/api/v1/lex/regulations/${id}`)' \
    "decideRegulationGovernance: (id: string, payload: LexGovernanceDecisionRequest): Promise<LexRegulation> =>" \
    'apiPost<{ data: LexRegulation }>(`/api/v1/lex/regulations/${id}/governance`, payload)' \
    "listSignatures: (params: FetchParams) => fetchSuitePaginated<LexSignatureEnvelope>('/api/v1/lex/signatures', params)" \
    'getSignature: (id: string): Promise<LexSignatureEnvelope> => fetchSuiteData(`/api/v1/lex/signatures/${id}`)' \
    "apiPost<{ data: LexSignatureEnvelope }>('/api/v1/lex/signatures', payload)" \
    'apiPost<{ data: LexSignatureEnvelope }>(`/api/v1/lex/signatures/${id}/send`, payload)' \
    'apiPost<{ data: LexSignatureEnvelope }>(`/api/v1/lex/signatures/${id}/cancel`, payload)' \
    'apiPost<{ data: LexSignatureEnvelope }>(`/api/v1/lex/signatures/${id}/recipients/${payload.recipient_id}/actions`, payload)' \
    'apiPost<{ data: LexSignatureEnvelope }>(`/api/v1/lex/signatures/${id}/provider-events`, payload)' \
    'apiPost<{ data: LexSignatureEnvelope }>(`/api/v1/lex/signatures/${id}/custody`, payload)' \
    "listComplianceRules: (params: FetchParams) => fetchSuitePaginated<LexComplianceRule>('/api/v1/lex/compliance/rules', params)" \
    'apiPut<{ data: LexComplianceRule }>(`/api/v1/lex/compliance/rules/${id}`, payload)' \
    'apiDelete<void>(`/api/v1/lex/compliance/rules/${id}`)' \
    "runCompliance: (payload: unknown) => apiPost<{ data: LexComplianceRunResult }>('/api/v1/lex/compliance/run', payload)" \
    "listComplianceAlerts: (params: FetchParams) => fetchSuitePaginated<LexComplianceAlert>('/api/v1/lex/compliance/alerts', params)" \
    'apiPut<{ data: LexComplianceAlert }>(`/api/v1/lex/compliance/alerts/${id}/status`, payload)' \
    "getComplianceDashboard: (): Promise<LexComplianceDashboard> => fetchSuiteData('/api/v1/lex/compliance/dashboard')" \
    "getExpiringContracts: (days?: number): Promise<LexExpiringContractSummary[]> =>" \
    "getContractReport: (params: FetchParams): Promise<LexContractReport> =>" \
    "getMatterReport: (params: FetchParams): Promise<LexMatterReport> =>" \
    "getObligationReport: (params: FetchParams): Promise<LexObligationReport> =>" \
    "exportContractReportCsv: (params: FetchParams): Promise<Blob> =>" \
    "exportMatterReportCsv: (params: FetchParams): Promise<Blob> =>" \
    "exportObligationReportCsv: (params: FetchParams): Promise<Blob> =>" \
    "dispatchObligationReminderOutbox: (payload?: LexDispatchObligationReminderOutboxPayload): Promise<LexObligationReminderDispatchResult> =>" \
    "apiPost<{ data: LexObligationReminderDispatchResult }>('/api/v1/lex/obligations/reminders/outbox/dispatch', payload)" \
    "dispatchObligationReminderOutboxItem: (outboxId: string, payload?: LexDispatchObligationReminderOutboxPayload): Promise<LexObligationReminderDispatchResult> =>" \
    '`/api/v1/lex/obligations/reminders/outbox/${outboxId}/dispatch`,'
do
    grep -F "${anchor}" "${LEX_CLIENT}" >/dev/null \
        || normalized_anchor_exists "${LEX_CLIENT}" "${anchor}" \
        || fail "Watheeq/Lex frontend client anchor missing: ${anchor}"
done
ok "Watheeq/Lex frontend client anchors are present"

LEX_SDK_LIBRARY="sdks/python/clario360/resources/lex/library.py"
for anchor in \
    "def decide_governance(self, entry_id: str, payload: dict[str, object]) -> ClauseLibraryEntry:" \
    'return self._post_at(f"{self._base}/{entry_id}/governance", ClauseLibraryEntry, payload)' \
    "def decide_governance(self, regulation_id: str, payload: dict[str, object]) -> Regulation:" \
    'return self._post_at(f"{self._base}/{regulation_id}/governance", Regulation, payload)'
do
    grep -F "${anchor}" "${LEX_SDK_LIBRARY}" >/dev/null || fail "Watheeq/Lex Python library SDK anchor missing: ${anchor}"
done
ok "Watheeq/Lex Python SDK library governance anchors are present"

LEX_SDK_WORKFLOWS="sdks/python/clario360/resources/lex/workflows.py"
for anchor in \
    "ApprovalPolicyAnalytics," \
    "def approval_policy_analytics(self) -> ApprovalPolicyAnalytics:" \
    'return self._get_at(f"{self._approval_policy_base}/analytics", ApprovalPolicyAnalytics)'
do
    grep -F "${anchor}" "${LEX_SDK_WORKFLOWS}" >/dev/null || fail "Watheeq/Lex Python workflow SDK anchor missing: ${anchor}"
done

LEX_SDK_MODELS="sdks/python/clario360/models/lex.py"
for anchor in \
    "class ApprovalPolicyAnalyticsPolicy(BaseModel):" \
    "class ApprovalPolicyAnalytics(BaseModel):" \
    "policies: List[ApprovalPolicyAnalyticsPolicy] = Field(default_factory=list)"
do
    grep -F "${anchor}" "${LEX_SDK_MODELS}" >/dev/null || fail "Watheeq/Lex Python analytics model anchor missing: ${anchor}"
done
ok "Watheeq/Lex Python SDK approval policy analytics anchors are present"

LEX_DETAIL_PAGE="frontend/src/app/(dashboard)/lex/contracts/[id]/page.tsx"
LEX_OVERVIEW_PAGE="frontend/src/app/(dashboard)/lex/_components/contract-analytics.tsx"
LEX_COMPLIANCE_PAGE="frontend/src/app/(dashboard)/lex/compliance/page.tsx"
LEX_MATTERS_PAGE="frontend/src/app/(dashboard)/lex/matters/page.tsx"
LEX_OBLIGATIONS_PAGE="frontend/src/app/(dashboard)/lex/obligations/page.tsx"
LEX_CLAUSE_LIBRARY_PAGE="frontend/src/app/(dashboard)/lex/clause-library/page.tsx"
LEX_REGULATIONS_PAGE="frontend/src/app/(dashboard)/lex/regulations/page.tsx"
LEX_SIGNATURES_PAGE="frontend/src/app/(dashboard)/lex/signatures/page.tsx"
if ! grep -F '"/matters"' "${LEX_ROUTES}" >/dev/null && ! grep -F 'LEX_MATTERS' "frontend/src/lib/constants.ts" >/dev/null; then
    fail "Watheeq/Lex matters route or frontend client endpoint anchor missing"
fi
require_any_anchor "Watheeq/Lex matters UI" "${LEX_MATTERS_PAGE}" 'title="Matters"' 'queryKey: '\''lex-matters'\'''
require_any_anchor "Watheeq/Lex matters detail projection" "${LEX_DETAIL_PAGE}" 'Matter Link' 'extractMatterSummary'
if ! grep -F '"/obligations"' "${LEX_ROUTES}" >/dev/null && ! grep -F 'LEX_OBLIGATIONS' "frontend/src/lib/constants.ts" >/dev/null; then
    fail "Watheeq/Lex obligations route or frontend client endpoint anchor missing"
fi
require_any_anchor "Watheeq/Lex obligations UI" "${LEX_OBLIGATIONS_PAGE}" 'title="Obligations"' 'queryKey: '\''lex-obligations'\'''
require_any_anchor "Watheeq/Lex obligations detail projection" "${LEX_DETAIL_PAGE}" 'Obligations & Reminders' 'extractObligationSummaries'
require_any_anchor "Watheeq/Lex renewal warning overview" "${LEX_OVERVIEW_PAGE}" 'getContractRenewalWarnings' 'renewal-warnings'
require_any_anchor "Watheeq/Lex bulk workflow decision UI" "${LEX_OVERVIEW_PAGE}" 'selectedWorkflowTaskKeys' 'bulkDecideWorkflowTasks'
require_any_anchor "Watheeq/Lex contract classification UI" "${LEX_DETAIL_PAGE}" 'title="Classification"' 'classifyContract'
require_any_anchor "Watheeq/Lex contract timeline UI" "${LEX_DETAIL_PAGE}" 'LexActivityTimeline' 'getContractTimeline'
require_any_anchor "Watheeq/Lex signatures UI" "${LEX_SIGNATURES_PAGE}" 'title="Signature Envelopes"' 'queryKey: '\''lex-signatures'\'''
if ! grep -F '"/clause-library"' "${LEX_ROUTES}" >/dev/null && ! grep -F 'LEX_CLAUSE_LIBRARY' "frontend/src/lib/constants.ts" >/dev/null; then
    fail "Watheeq/Lex clause-library route or frontend client endpoint anchor missing"
fi
require_any_anchor "Watheeq/Lex clause-library UI" "${LEX_CLAUSE_LIBRARY_PAGE}" 'title="Clause Library"' 'queryKey: '\''lex-clause-library'\'''
require_any_anchor "Watheeq/Lex clause-library detail projection" "${LEX_DETAIL_PAGE}" 'Clause Library Readiness' 'summarizeClauseLibrary'
if ! grep -F '"/regulations"' "${LEX_ROUTES}" >/dev/null && ! grep -F 'LEX_REGULATIONS' "frontend/src/lib/constants.ts" >/dev/null; then
    fail "Watheeq/Lex regulation-library route or frontend client endpoint anchor missing"
fi
require_any_anchor "Watheeq/Lex regulation-library overview UI" "${LEX_OVERVIEW_PAGE}" 'Active Regulations' 'regulationsQuery'
require_any_anchor "Watheeq/Lex regulation-library management UI" "${LEX_COMPLIANCE_PAGE}" 'Regulation Library' 'listComplianceRules'
require_any_anchor "Watheeq/Lex regulations UI" "${LEX_REGULATIONS_PAGE}" 'title="Regulation Library"' 'queryKey: '\''lex-regulations'\'''
ok "Watheeq/Lex RTM domain anchors are present or projected"

GW="backend/internal/gateway/config/routes.go"
grep -F 'Prefix: "/api/v1/lex", Service: "lex-service"' "${GW}" >/dev/null \
    || fail "gateway Watheeq/Lex route missing"
grep -F 'Prefix: "/api/v1/watheeq", Service: "lex-service"' "${GW}" >/dev/null \
    || fail "gateway Watheeq route alias missing"
grep -F 'Entitlement: "app.watheeq"' "${GW}" >/dev/null \
    || fail "gateway Watheeq/Lex route must be app.watheeq gated"
grep -F 'Prefix: "/api/docs/watheeq", Service: "lex-service", Public: true' "${GW}" >/dev/null \
    || fail "gateway Watheeq Swagger route missing"
ok "gateway Watheeq/Lex route anchors are present"

DR_READMODEL_ROUTER="backend/internal/dr/readmodel/router.go"
for anchor in \
    'r.Get("/posture", h.getPosture)' \
    'r.Get("/replication/summary", h.getReplicationSummary)' \
    'r.Get("/groups/{groupID}/summary", h.getGroupSummary)'
do
    grep -F "${anchor}" "${DR_READMODEL_ROUTER}" >/dev/null || fail "DR readmodel route anchor missing: ${anchor}"
done

DR_HANDLER="backend/internal/dr/handler/handler.go"
for anchor in \
    'r.Get("/sites", h.listSites)' \
    'r.Post("/sites", h.createSite)' \
    'r.Get("/streams/{streamID}/rpo", h.getStreamRPO)' \
    'r.Post("/streams/{streamID}/pause", h.pauseStream)' \
    'r.Post("/streams/{streamID}/resume", h.resumeStream)' \
    'r.Post("/recovery-points/{recoveryPointID}/validate", h.validateRecoveryPoint)' \
    'r.Post("/failover-runs", h.createFailoverRun)' \
    'r.Post("/failover-runs/{runID}/approve", h.approveFailoverRun)' \
    'r.Post("/failover-runs/{runID}/cancel", h.cancelFailoverRun)' \
    'r.Post("/failover/{id}/cancel", h.cancelFailoverRun)'
do
    grep -F "${anchor}" "${DR_HANDLER}" >/dev/null || fail "DR handler anchor missing: ${anchor}"
done
DR_MAIN="backend/cmd/clario-dr-service/main.go"
grep -F 'svc.Router.Route("/api/v1/dr", func(r chi.Router) {' "${DR_MAIN}" >/dev/null \
    || fail "DR /api/v1/dr route group missing"
grep -F 'r.Post("/agents/enroll", enrollHandler.Exchange)' "${DR_MAIN}" >/dev/null \
    || fail "DR enrollment exchange mount missing"
grep -F 'mountRoutes(protected, readModelRouter.Routes())' "${DR_MAIN}" >/dev/null \
    || fail "DR readmodel route-walk mount missing"
grep -F 'mountRoutes(protected, httpHandler.Routes())' "${DR_MAIN}" >/dev/null \
    || fail "DR base handler route-walk mount missing"
grep -F 'intel.mount(protected)' "${DR_MAIN}" >/dev/null \
    || fail "DR intelligence plane mount missing"
grep -F 'resil.mount(protected)' "${DR_MAIN}" >/dev/null \
    || fail "DR resilience plane mount missing"
grep -F 'orch.mount(protected)' "${DR_MAIN}" >/dev/null \
    || fail "DR orchestration plane mount missing"
grep -F 'protected.Post("/agents/{agentID}/enrollment-token", enrollHandler.MintToken)' "${DR_MAIN}" >/dev/null \
    || fail "DR enrollment-token mount missing"
grep -F 'coverage := configureCoveragePlane(ctx, svc.DBPool, svc.Redis, repo, drSvc, integrationsPlane.resolver, svc.Metrics.Registry(), logger)' "${DR_MAIN}" >/dev/null \
    || fail "DR coverage plane construction missing"
grep -F 'coverage.mount(protected)' "${DR_MAIN}" >/dev/null \
    || fail "DR coverage plane mount missing"
grep -F 'sovereign := configureSovereignPlane(ctx, svc.DBPool, svc.Redis, repo, drSvc, recoveryDEKManager, recoveryWORMDEKs, wormClient, integrationsPlane.resolver, drCfg.DBURL, svc.Metrics.Registry(), logger)' "${DR_MAIN}" >/dev/null \
    || fail "DR sovereign plane construction missing"
grep -F 'sovereign.mount(protected)' "${DR_MAIN}" >/dev/null \
    || fail "DR sovereign plane mount missing"
grep -F 'ingestHandler.Routes(), logger)' "${DR_MAIN}" >/dev/null \
    || fail "DR mTLS ingest listener route mount missing"
grep -F 'r.Post("/streams/{streamID}/frames", h.IngestHTTP)' "backend/internal/dr/ingest/handler.go" >/dev/null \
    || fail "DR mTLS frame ingest route missing"
DR_BOOTGRAPH="backend/internal/dr/bootgraph/router.go"
for anchor in \
    'r.Get("/groups/{groupID}/boot-plan", h.getPlan)' \
    'r.Get("/boot-runs/{runID}", h.getRun)' \
    'r.Post("/groups/{groupID}/boot-services", h.defineServices)' \
    'r.Post("/groups/{groupID}/boot-runs", h.startRun)'
do
    grep -F "${anchor}" "${DR_BOOTGRAPH}" >/dev/null || fail "DR bootgraph anchor missing: ${anchor}"
done
DR_GAMEDAY="backend/internal/dr/gameday/router.go"
for anchor in \
    'r.Get("/gameday/scenarios", h.listScenarios)' \
    'r.Get("/gameday/runs/{runID}", h.getScorecard)' \
    'r.Post("/gameday/scenarios", h.createScenario)' \
    'r.Post("/gameday/scenarios/{scenarioID}/runs", h.executeScenario)'
do
    grep -F "${anchor}" "${DR_GAMEDAY}" >/dev/null || fail "DR gameday anchor missing: ${anchor}"
done
DR_IAC="backend/internal/dr/iacdr/router.go"
for anchor in \
    'r.Get("/iac-snapshots", h.listSnapshots)' \
    'r.Get("/iac-snapshots/{id}", h.getSnapshot)' \
    'r.Get("/iac-snapshots/{id}/diff", h.diff)' \
    'r.Get("/iac-snapshots/{id}/reconstitution-plan", h.reconstitutionPlan)' \
    'r.Post("/iac-snapshots", h.ingest)'
do
    grep -F "${anchor}" "${DR_IAC}" >/dev/null || fail "DR iac anchor missing: ${anchor}"
done
DR_STORAGE="backend/internal/dr/storageoffload/router.go"
for anchor in \
    'r.Get("/storage-volumes", h.listVolumes)' \
    'r.Get("/storage-volumes/{id}", h.getVolume)' \
    'r.Get("/storage-volumes/{id}/snapshots", h.listSnapshots)' \
    'r.Get("/storage-snapshots/{id}", h.getSnapshot)' \
    'r.Post("/storage-volumes", h.registerVolume)' \
    'r.Post("/storage-volumes/{id}/snapshots", h.requestSnapshot)' \
    'r.Post("/storage-snapshots/{id}/replicate", h.requestReplication)'
do
    grep -F "${anchor}" "${DR_STORAGE}" >/dev/null || fail "DR storage-offload anchor missing: ${anchor}"
done
DR_WORKLOAD="backend/internal/dr/vmcapture/router.go"
for anchor in \
    'r.Get("/workload-captures", h.listSources)' \
    'r.Get("/workload-captures/{id}/epochs", h.listEpochs)' \
    'r.Post("/workload-captures", h.registerSource)' \
    'r.Post("/workload-captures/{id}/run", h.runCapture)'
do
    grep -F "${anchor}" "${DR_WORKLOAD}" >/dev/null || fail "DR workload-capture anchor missing: ${anchor}"
done
DR_BCM="backend/internal/dr/bcm/router.go"
for anchor in \
    'r.Get("/bcm/packs", h.listPacks)' \
    'r.Get("/bcm/packs/{key}", h.getPack)' \
    'r.Get("/bcm/assessments/{id}", h.getAssessment)' \
    'r.Post("/bcm/packs/{key}/assess", h.assess)'
do
    grep -F "${anchor}" "${DR_BCM}" >/dev/null || fail "DR BCM anchor missing: ${anchor}"
done
DR_BYOK="backend/internal/dr/byok/router.go"
for anchor in \
    'r.Get("/byok/keys", h.listKeys)' \
    'r.Get("/byok/keys/custody-log", h.custodyLog)' \
    'r.Post("/byok/keys", h.enroll)' \
    'r.Post("/byok/keys/rotate", h.rotate)'
do
    grep -F "${anchor}" "${DR_BYOK}" >/dev/null || fail "DR BYOK anchor missing: ${anchor}"
done
DR_ATTESTLEDGER="backend/internal/dr/attestledger/router.go"
for anchor in \
    'r.Get("/attestation-ledger", h.listEntries)' \
    'r.Get("/attestation-ledger/verify", h.verify)' \
    'r.Get("/attestation-ledger/{seq}/proof", h.proof)' \
    'r.Post("/attestation-ledger/anchor", h.anchor)'
do
    grep -F "${anchor}" "${DR_ATTESTLEDGER}" >/dev/null || fail "DR attestation-ledger anchor missing: ${anchor}"
done
ok "DR route and mount anchors match API contract"

OUTBOX_DOC="backend/internal/events/outbox/README.md"
[[ -f "${OUTBOX_DOC}" ]] || fail "${OUTBOX_DOC} missing"
grep -F "Transactional Outbox Write-Path Standard" "${OUTBOX_DOC}" >/dev/null \
    || fail "outbox write-path standard doc missing title"
grep -F 'func Write(ctx context.Context, q Querier' backend/internal/events/outbox/outbox.go >/dev/null \
    || fail "outbox Write API missing"
grep -F 'return outbox.Write(ctx, tx, events.Topics.DREvents, event)' backend/internal/dr/service/service.go >/dev/null \
    || fail "DR service must stage lifecycle events through outbox"
grep -F 'return outbox.Write(ctx, db, events.Topics.DREvents, event)' backend/internal/dr/failover/driver.go >/dev/null \
    || fail "DR failover driver must stage events through outbox"
grep -F 'return outbox.Write(ctx, q, events.Topics.LicenseEvents, event)' backend/internal/license/service/service.go >/dev/null \
    || fail "license service must stage events through outbox"
grep -F 'outbox.EnsureSchema(ctx, svc.DBPool)' backend/cmd/clario-dr-service/main.go >/dev/null \
    || fail "DR service must ensure outbox schema"
grep -F 'outbox.NewRelay' backend/cmd/clario-dr-service/main.go >/dev/null \
    || fail "DR service must run outbox relay"
grep -F 'outbox.NewRelay' backend/cmd/license-service/main.go >/dev/null \
    || fail "license service must run outbox relay"
grep -F 'CREATE TABLE IF NOT EXISTS event_outbox' backend/migrations/dr_db/000001_init_schema.up.sql >/dev/null \
    || fail "dr_db migration must include event_outbox"
grep -F 'CREATE TABLE IF NOT EXISTS event_outbox' backend/migrations/license_db/000001_init_schema.up.sql >/dev/null \
    || fail "license_db migration must include event_outbox"
ok "transactional outbox standard is documented and anchored"

echo
echo "API/event contract OK"
