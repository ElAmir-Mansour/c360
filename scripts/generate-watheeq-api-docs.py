#!/usr/bin/env python3
"""Generate the embedded Watheeq/Lex Swagger inputs.

The reviewed phase-1 OpenAPI contract remains the source for precise schemas.
The generated route inventory adds every registered Chi operation, including
the SSO and SCIM subrouters mounted by the main Lex router, so Swagger exposes
newer/internal frontend-facing endpoints while they await schema enrichment.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PHASE1_SOURCE = ROOT / "docs/api/watheeq-lex-service.openapi.yaml"
ROUTES_SOURCE = ROOT / "backend/internal/lex/handler/routes.go"
SSO_ROUTES_SOURCE = ROOT / "backend/internal/lex/handler/sso_handler.go"
SCIM_ROUTES_SOURCE = ROOT / "backend/internal/lex/service/integration/scim_server.go"
EMBED_DIR = ROOT / "backend/internal/lex/apidocs"
EMBED_PHASE1 = EMBED_DIR / "phase1.openapi.yaml"
EMBED_INVENTORY = EMBED_DIR / "routes.generated.json"

ROUTE_RE = re.compile(
    r"\.\s*(?P<method>Get|Post|Put|Patch|Delete)"
    r'\s*\(\s*"(?P<path>[^"]+)"\s*,\s*(?P<handler>[A-Za-z0-9_.]+)'
)
ROUTE_BLOCK_RE = re.compile(
    r'\b[A-Za-z_][A-Za-z0-9_]*\.Route\(\s*"(?P<path>[^"]+)"\s*,'
    r"\s*func\([^)]*\)\s*\{"
)

SUITE_PREFIXES = ("/api/v1/lex", "/api/v1/watheeq")
ROOT_SCOPES = ("/webhooks/", "/internal/", "/scim/")
PUBLIC_SUFFIXES = (
    "/auth/sso",
    "/intake/email/webhook",
    "/editor/guest-portal",
)


def join_route(*segments: str) -> str:
    route = "/" + "/".join(segment.strip("/") for segment in segments if segment.strip("/"))
    return route


def route_block_intervals(source: str) -> list[tuple[int, int, str]]:
    """Return source intervals covered by nested chi Route blocks."""
    intervals: list[tuple[int, int, str]] = []
    for match in ROUTE_BLOCK_RE.finditer(source):
        opening_brace = source.find("{", match.start(), match.end())
        if opening_brace < 0:
            continue
        depth = 0
        for index in range(opening_brace, len(source)):
            if source[index] == "{":
                depth += 1
            elif source[index] == "}":
                depth -= 1
                if depth == 0:
                    intervals.append((opening_brace, index, match.group("path")))
                    break
    return intervals


def discovered_operations(
    source_path: Path,
    *,
    mount_prefix: str = "",
    aliases: tuple[str, ...] = (),
    public: bool | None = None,
) -> list[dict[str, object]]:
    source = source_path.read_text()
    blocks = route_block_intervals(source)
    discovered: list[dict[str, object]] = []
    for match in ROUTE_RE.finditer(source):
        nested_prefixes = [
            (start, prefix)
            for start, end, prefix in blocks
            if start < match.start() < end
        ]
        nested_prefixes.sort()
        original_path = join_route(
            mount_prefix,
            *(prefix for _, prefix in nested_prefixes),
            match.group("path"),
        )
        path, scope, alias = canonical_route(original_path)
        operation_aliases = list(aliases)
        if alias and alias not in operation_aliases:
            operation_aliases.append(alias)
        discovered.append(
            {
                "method": match.group("method").lower(),
                "path": path,
                "scope": scope,
                "public": is_public(original_path) if public is None else public,
                "authentication": authentication_for(original_path, public),
                "handler": match.group("handler"),
                "source": (
                    f"{source_path.relative_to(ROOT)}:"
                    f"{source.count(chr(10), 0, match.start()) + 1}"
                ),
                "aliases": operation_aliases,
            }
        )
    return discovered


def canonical_route(path: str) -> tuple[str, str, str | None]:
    for prefix in SUITE_PREFIXES:
        if path == prefix:
            return "/", "suite", prefix
        if path.startswith(prefix + "/"):
            return path[len(prefix) :], "suite", prefix
    if path.startswith(ROOT_SCOPES):
        return path, "root", None
    return path, "suite", None


def is_public(original_path: str) -> bool:
    if original_path.startswith("/webhooks/"):
        return True
    return any(
        original_path.startswith(prefix + suffix)
        for prefix in SUITE_PREFIXES
        for suffix in PUBLIC_SUFFIXES
    )


def authentication_for(original_path: str, public: bool | None) -> str:
    if original_path.startswith("/internal/"):
        return "service_token"
    if original_path.startswith("/scim/"):
        return "scim_bearer"
    if original_path.startswith("/webhooks/") or original_path.endswith("/intake/email/webhook"):
        return "webhook_signature"
    if public is True or is_public(original_path):
        return "public"
    return "platform_bearer"


def build_inventory() -> dict[str, object]:
    operations: dict[tuple[str, str], dict[str, object]] = {}
    discovered = [
        *discovered_operations(ROUTES_SOURCE),
        *discovered_operations(
            SSO_ROUTES_SOURCE,
            mount_prefix="/auth/sso",
            aliases=SUITE_PREFIXES,
            public=True,
        ),
        *discovered_operations(
            SCIM_ROUTES_SOURCE,
            mount_prefix="/scim/v2",
            public=False,
        ),
    ]
    for item in discovered:
        method = str(item["method"])
        path = str(item["path"])
        key = (path, method)
        operation = operations.setdefault(
            key,
            {
                "method": method,
                "path": path,
                "scope": item["scope"],
                "public": item["public"],
                "authentication": item["authentication"],
                "handlers": [],
                "sources": [],
                "aliases": [],
            },
        )
        handler = str(item["handler"])
        source = str(item["source"])
        if handler not in operation["handlers"]:
            operation["handlers"].append(handler)
        if source not in operation["sources"]:
            operation["sources"].append(source)
        for alias in item["aliases"]:
            if alias not in operation["aliases"]:
                operation["aliases"].append(alias)
        operation["public"] = bool(operation["public"]) or bool(item["public"])
        if operation["authentication"] != item["authentication"]:
            raise RuntimeError(
                f"conflicting authentication for {method.upper()} {path}: "
                f"{operation['authentication']} and {item['authentication']}"
            )

    ordered = sorted(operations.values(), key=lambda item: (item["path"], item["method"]))
    return {
        "schema_version": 1,
        "source": [
            str(ROUTES_SOURCE.relative_to(ROOT)),
            str(SSO_ROUTES_SOURCE.relative_to(ROOT)),
            str(SCIM_ROUTES_SOURCE.relative_to(ROOT)),
        ],
        "suite_prefixes": list(SUITE_PREFIXES),
        "raw_registered_operations": len(discovered),
        "canonical_operations": len(ordered),
        "operations": ordered,
    }


def expected_files() -> dict[Path, bytes]:
    phase1 = PHASE1_SOURCE.read_bytes()
    inventory = json.dumps(build_inventory(), indent=2, ensure_ascii=False).encode() + b"\n"
    return {
        EMBED_PHASE1: phase1,
        EMBED_INVENTORY: inventory,
    }


def check() -> int:
    stale: list[Path] = []
    for path, expected in expected_files().items():
        if not path.exists() or path.read_bytes() != expected:
            stale.append(path)
    if stale:
        print("Watheeq API docs are stale; run:", file=sys.stderr)
        print("  python3 scripts/generate-watheeq-api-docs.py", file=sys.stderr)
        for path in stale:
            print(f"  - {path.relative_to(ROOT)}", file=sys.stderr)
        return 1
    inventory = build_inventory()
    print(
        "Watheeq API docs are current: "
        f"{inventory['canonical_operations']} canonical operations "
        f"from {inventory['raw_registered_operations']} source registrations."
    )
    return 0


def generate() -> int:
    for path, content in expected_files().items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        print(f"generated {path.relative_to(ROOT)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail when generated inputs are stale")
    args = parser.parse_args()
    return check() if args.check else generate()


if __name__ == "__main__":
    raise SystemExit(main())
