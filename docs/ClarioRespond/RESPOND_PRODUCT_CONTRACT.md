# Clario Respond Product Contract

## Product identity

- Product id: `respond`
- Product name: `Clario Respond`
- Entitlement key: `respond.major_incident`
- Frontend suite route segment: `/respond`
- Frontend read permission: `respond:incident:read`

Respond is hidden from suite navigation unless the authenticated profile carries `respond:incident:read`. Backend routes enforce both tenant entitlement (`respond.major_incident`, at the gateway and product resolver) and incident RBAC; frontend permission checks are only the presentation layer.

## Product endpoint

`GET /api/v1/respond/product`

Returns the resolved product registration and tenant entitlement state.

```json
{
  "data": {
    "id": "respond",
    "name": "Clario Respond",
    "entitlement_key": "respond.major_incident",
    "entitlement_state": "licensed",
    "licensed": true,
    "capabilities": [
      {
        "id": "major-incident-command",
        "label": "Major incident command",
        "description": "Declare, coordinate, and review major incidents.",
        "entitlement_key": "respond.major_incident",
        "enabled": true
      }
    ]
  }
}
```

`entitlement_state` values consumed by the frontend: `licensed`, `unlicensed`, `trial`, `expired`.

## Route map

- `/respond` renders the product overview from `GET /api/v1/respond/product`.
- `/respond/incidents` renders the incident list from `GET /api/v1/respond/incidents`.
- `/respond/incidents/[id]` renders the command center from `GET /api/v1/respond/incidents/{id}/cockpit`.
- `/respond/stakeholder/[token]` renders the stakeholder-safe status page from `GET /api/v1/respond/stakeholder/{token}`.

The stakeholder token route is exempt from the frontend Respond entitlement layout so the token endpoint can be the server-side authority for scope, expiry, and revocation.

## Incident list endpoint

`GET /api/v1/respond/incidents?page=1&per_page=50&status=&severity=`

```json
{
  "data": {
    "incidents": [
      {
        "id": "uuid",
        "reference": "INC-2026-0001",
        "title": "Payments API unavailable",
        "severity": "SEV1",
        "status": "Declared",
        "declared_at": "2026-06-28T10:15:00Z",
        "detected_at": "2026-06-28T10:10:00Z",
        "mitigated_at": null,
        "resolved_at": null,
        "impacted_services": ["payments-api"],
        "commander_name": "A. Commander",
        "open_tasks": 4,
        "overdue_tasks": 0,
        "updated_at": "2026-06-28T10:20:00Z"
      }
    ],
    "total": 1,
    "page": 1,
    "per_page": 50
  }
}
```

The frontend renders an empty state when `incidents` is empty and an error state for non-2xx responses. It does not synthesize incident records.

## Cockpit aggregate endpoint

`GET /api/v1/respond/incidents/{id}/cockpit`

The aggregate must avoid client-side N+1 stitching and return the command-center read model.

```json
{
  "data": {
    "incident": {
      "id": "uuid",
      "reference": "INC-2026-0001",
      "title": "Payments API unavailable",
      "description": "Customer checkout failures across card rails.",
      "severity": "SEV1",
      "status": "Investigating",
      "declared_at": "2026-06-28T10:15:00Z",
      "detected_at": "2026-06-28T10:10:00Z",
      "mitigated_at": null,
      "resolved_at": null,
      "closed_at": null,
      "impacted_services": ["payments-api"]
    },
    "roles": [
      {
        "id": "uuid",
        "role": "Incident Commander",
        "user_id": "uuid",
        "display_name": "A. Commander",
        "acknowledgement_state": "acknowledged",
        "acknowledged_at": "2026-06-28T10:16:00Z"
      }
    ],
    "tasks": [
      {
        "id": "uuid",
        "title": "Confirm gateway error rate",
        "status": "in_progress",
        "owner_name": "Resolver Lead",
        "due_at": "2026-06-28T10:30:00Z",
        "blocked_by": []
      }
    ],
    "timeline": [
      {
        "id": "uuid",
        "event_type": "incident.declared",
        "actor_name": "A. Commander",
        "occurred_at": "2026-06-28T10:15:00Z",
        "summary": "Incident declared as SEV1."
      }
    ],
    "integrations": [
      {
        "provider": "servicenow",
        "external_reference": "INC0012345",
        "sync_state": "synced",
        "last_synced_at": "2026-06-28T10:17:00Z"
      }
    ],
    "quick_actions": [
      {
        "id": "transition-state",
        "label": "Advance state",
        "endpoint": "/api/v1/respond/incidents/uuid/transitions",
        "method": "POST",
        "payload": {
          "to": "Mitigating",
          "expected_version": 4
        },
        "enabled": true,
        "disabled_reason": null
      }
    ],
    "timeline_stream_url": "/api/v1/respond/incidents/uuid/timeline/stream"
  }
}
```

Frontend behavior:

- Computes the displayed MTTR duration from `detected_at || declared_at` to `resolved_at || mitigated_at || closed_at || render time`.
- Opens `timeline_stream_url` with `EventSource` when provided and refetches the cockpit aggregate on each message.
- Calls enabled quick action `endpoint` using the returned HTTP `method` and `payload` for `POST`, `PUT`, and `PATCH`; `DELETE` sends no body.
- Renders typed empty states when roles, tasks, timeline, integrations, or quick actions are empty.

## Stakeholder token endpoint

`GET /api/v1/respond/stakeholder/{token}`

The backend validates the hashed token, tenant scope, expiry, revocation state, and redaction policy before returning data. The raw token is only returned once from `POST /api/v1/respond/incidents/{id}/stakeholder-tokens`; only a SHA-256 hash is stored.

```json
{
  "data": {
    "incident_reference": "INC-2026-0001",
    "title": "Payments API unavailable",
    "severity": "SEV1",
    "status": "Investigating",
    "impact_summary": "Checkout card payments are degraded for EMEA customers.",
    "current_phase": "Investigation",
    "next_update_at": "2026-06-28T10:45:00Z",
    "last_update_at": "2026-06-28T10:30:00Z"
  }
}
```

The frontend displays only this response shape on the stakeholder route and never calls the internal cockpit endpoint with a stakeholder token.

## Frontend client functions

Defined in `frontend/src/lib/respond.ts`:

- `fetchRespondProduct()`
- `fetchRespondIncidents(params)`
- `fetchRespondCockpit(incidentID)`
- `fetchRespondStakeholderStatus(token)`
- `executeRespondQuickAction(action)`

All functions expect the shared `{ "data": ... }` envelope and surface backend errors through the existing API error interceptor.
