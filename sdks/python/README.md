# Clario 360 Python SDK

The official Python SDK for the Clario 360 Enterprise AI Platform.

## Install

```bash
pip install clario360
```

Optional extras:

```bash
pip install "clario360[async]"
pip install "clario360[cli]"
pip install "clario360[notebooks]"
```

## Quickstart

```python
from clario360 import Clario360

client = Clario360(
    api_url="http://localhost:8080",
    email="admin@clario.dev",
    password="Cl@rio360Dev!",
)

alerts = client.cyber.alerts.list(severity="critical", per_page=10)
for alert in alerts:
    print(alert.title, alert.status, alert.confidence_score)

risk = client.cyber.risk.score()
print(risk.overall_score, risk.grade)
```

## Authentication

The SDK supports:

- API key authentication via `api_key=...`
- Username/password authentication via `email=...` and `password=...`
- Pre-issued bearer tokens via `access_token=...`
- Environment discovery via:
  - `CLARIO360_API_URL`
  - `CLARIO360_API_KEY`
  - `CLARIO360_ACCESS_TOKEN`
  - `CLARIO360_REFRESH_TOKEN`
  - `CLARIO360_EMAIL`
  - `CLARIO360_PASSWORD`

## Highlights

- Fully typed request and response models with Pydantic
- Sync and async request paths
- Automatic retry for `429` and `5xx`
- Automatic refresh-token retry flow for JWT sessions
- Pagination helpers with `list()` and `list_all()`
- Jupyter-friendly `.to_dataframe()` helpers
- Click-based CLI for common SOC and data operations

## Implemented namespaces

- `client.auth`
- `client.cyber.assets`
- `client.cyber.alerts`
- `client.cyber.rules`
- `client.cyber.threats`
- `client.cyber.ctem`
- `client.cyber.remediation`
- `client.cyber.dspm`
- `client.cyber.ueba`
- `client.cyber.vciso`
- `client.cyber.mitre`
- `client.cyber.risk`
- `client.cyber.dashboard`
- `client.data.sources`
- `client.data.pipelines`
- `client.data.quality`
- `client.data.contradictions`
- `client.data.lineage`
- `client.data.dark_data`
- `client.data.analytics`
- `client.acta.committees`
- `client.acta.meetings`
- `client.acta.action_items`
- `client.lex.contracts`
- `client.lex.documents`
- `client.lex.workflows`
- `client.lex.reports`
- `client.lex.dashboard`
- `client.lex.matters`
- `client.lex.obligations`
- `client.lex.clause_library`
- `client.lex.regulations`
- `client.lex.signatures`
- `client.lex.compliance`
- `client.watheeq` (Watheeq-named alias for the same legal API surface)
- `client.visus.dashboards`
- `client.visus.kpis`
- `client.visus.reports`
- `client.ai.models`
- `client.ai.predictions`
- `client.ai.lifecycle`

## Notes

Watheeq is the public product name for the legal API. `client.lex` remains available for
backward compatibility on `/api/v1/lex`; `client.watheeq` uses the `/api/v1/watheeq` alias
documented in `docs/api/watheeq-lex-service.openapi.yaml`.
