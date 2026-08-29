# Clario360 API Contracts

This directory is the contract home for gateway-routed service APIs and
event/write-path standards. The specs describe existing service surfaces.

## Specs

- `clario-dr-service.openapi.yaml`: ClarioDR tenant control plane, enrollment,
  and the mTLS agent ingest surface.
- `license-entitlement.openapi.yaml`: Licensing, entitlement enforcement,
  metered usage, admin plan/license lifecycle, and offline license activation.
- `watheeq-lex-service.openapi.yaml`: Watheeq legal contract lifecycle,
  matters, obligations, signatures, legal workflow decisions, clause library,
  regulation library, compliance, reports, and dashboard API on `/api/v1/lex`
  plus the `/api/v1/watheeq` alias.
- `watheeq-lex-api-inventory.md`: Companion route/client inventory and RTM
  readout for the current Watheeq/Lex surface.

## Watheeq / Lex Status

Watheeq currently runs through the incumbent Lex service route, `/api/v1/lex`,
and the public Watheeq alias, `/api/v1/watheeq`, with gateway entitlement
`app.watheeq`.

There are two related documentation artifacts:

- `watheeq-lex-service.openapi.yaml` is the reviewed contract. Its operations
  have precise request and response schemas.
- The runtime developer document merges that reviewed contract with the
  generated Chi route inventory. It exposes every direct and mounted
  Watheeq/Lex operation, including SSO and SCIM. Operations awaiting detailed
  schema review are visibly marked `x-documentation-status:
  inventory-generated` and link back to their Go handler/source.

The lightweight implementation inventory remains available at
`docs/api/watheeq-lex-api-inventory.md`. The RTM coverage lives next to the
source workbook:

- `clario360Project/legal/watheeq-rtm-coverage.md`
- `clario360Project/legal/watheeq-rtm-coverage.json`

## Swagger UI and raw contracts

With the local stack running, frontend developers can use:

- Frontend same-origin Swagger UI: `http://localhost:3002/api/docs/watheeq`
- Gateway Swagger UI (ecosystem local): `http://localhost:8092/api/docs/watheeq/`
- Direct Lex Swagger UI: `http://localhost:8088/api/docs/watheeq/`
- OpenAPI JSON: `/api/docs/watheeq/openapi.json`
- OpenAPI YAML: `/api/docs/watheeq/openapi.yaml`
- Route/source inventory: `/api/docs/watheeq/routes.json`

Swagger is enabled by default outside production. Production requires the
explicit opt-in `LEX_SWAGGER_ENABLED=true`; set it to `false` to disable the
surface in any environment. The UI loads Swagger UI v5 assets from jsDelivr,
while the JSON, YAML, and inventory endpoints are served entirely by
`lex-service`.

Browser calls use the normal IAM bearer JWT. The gateway derives the tenant
from that JWT, so clients must not send `X-Tenant-ID`. The Swagger request
interceptor supplies `X-Request-ID` and `X-Locale`. Same-origin mutating calls
made by the application still use the shared frontend transport's CSRF
handling. SCIM and service-to-service operations show their separate
credentials in the generated document.

## Frontend type generation

From the repository root:

```sh
make generate-sdk
make check-sdk-drift
```

`make generate-sdk` refreshes the route inventory and writes
`frontend/src/types/watheeq-api.generated.ts` from the schema-reviewed contract.
The inventory-generated operations remain available in Swagger, but are not
emitted as misleading `unknown`-heavy frontend types until their DTO contracts
are reviewed. Frontend developers can also run `npm run api:generate` from
`frontend/`. Generated files are checked into the repository so CI can reject
route or type drift.

## Validation

Run:

```sh
make validate-api
./scripts/check-api-contracts.sh
make check-sdk-drift
```

These checks lint the reviewed specs, prove the complete runtime document covers
the generated direct and mounted route inventory, verify the public
Swagger/gateway mounts, and reject stale frontend types. The write-path standard
is documented in `backend/internal/events/outbox/README.md`.

## Gateway Contract Metadata

Phase 2 gateway scaffolding records contract intent for proxied requests without
changing existing route behavior. Specs that are gateway-enforced declare
`info.x-gateway-contract` with a contract `id`, contract `version`, route
`api_version`, and `fail_closed` posture. The gateway forwards trusted internal
headers to downstream services:

- `X-Gateway-Contract-ID`
- `X-Gateway-Contract-Version`
- `X-Gateway-Contract-Phase`
- `X-Gateway-API-Version`
- `X-Gateway-Route-Prefix`
- `X-Gateway-Route-Service`

Clients may send `X-API-Version`; routes with `fail_closed: false` record
missing or unsupported versions but continue proxying. A spec may also declare
profile-specific posture such as `fail_closed_profiles.regulated: true`; this
documents runtime fail-closed startup/readiness validation without changing the
default local-development route behavior. Routes only reject version or
audit-tap failures when their gateway route config explicitly sets
`Contract.FailClosed`.
