# ClarioDR Live Provider Wiring

ClarioDR recovery provider mode is fail-closed. In regulated deployments, do not
use `verify` or unconfigured command hooks for workload recovery.

## Kubernetes Direct Mode

Use Kubernetes mode when the DR service can reach the recovery cluster API.

Required environment:

```bash
DR_RECOVERY_DRIVER=provider
DR_RECOVERY_PROVIDER=kubernetes
DR_RECOVERY_PROVIDER_ENDPOINT=https://kubernetes.default.svc
DR_RECOVERY_PROVIDER_CREDENTIAL_REF=vault:dr/kubernetes/recovery
DR_RECOVERY_PROVIDER_CLUSTER=prod-dr
DR_RECOVERY_PROVIDER_TOKEN=...
DR_RECOVERY_PROVIDER_NAMESPACE_PREFIX=clario-dr
DR_RECOVERY_PROVIDER_IMAGE=registry.example.com/clario/dr-recover:2026.07
```

The adapter creates an idempotent recovery namespace, writes recovery metadata
and payload into a Kubernetes Secret, and starts a recovery Job when an image is
configured. Set `DR_RECOVERY_PROVIDER_DELETE_NAMESPACE_ON_TEARDOWN=true` only
when rehearsal namespaces are disposable.

## vSphere, Cloud, and NetApp Gateway Mode

For vSphere, AWS/Azure/GCP, and NetApp ONTAP, ClarioDR calls a configured
provider gateway. That gateway owns the heavy vendor SDKs, network placement,
credential resolution, and platform-specific restore logic.

Required environment:

```bash
DR_RECOVERY_DRIVER=provider
DR_RECOVERY_PROVIDER=vsphere # or cloud, netapp
DR_RECOVERY_PROVIDER_ENDPOINT=https://dr-provider-gateway.internal
DR_RECOVERY_PROVIDER_CREDENTIAL_REF=vault:dr/provider/prod
DR_RECOVERY_PROVIDER_TOKEN=...
```

Provider-specific fields:

```bash
# vSphere
DR_RECOVERY_PROVIDER_DATACENTER=ksa-dc1

# cloud
DR_RECOVERY_PROVIDER_REGION=me-central-1
DR_RECOVERY_PROVIDER_PROJECT=government-dr

# NetApp
DR_RECOVERY_PROVIDER_STORAGE_VM=svm-dr
```

Default gateway operations:

```text
POST /api/v1/dr/provider/ensure
POST /api/v1/dr/provider/teardown
```

Override paths with:

```bash
DR_RECOVERY_PROVIDER_SETTINGS='{"ensure_path":"/restore/ensure","teardown_path":"/restore/teardown"}'
```

The gateway receives a JSON envelope with `provider`, `operation`,
`credential_ref`, provider config, and the idempotent recovery request. It should
return either `{ "data": { "external_id": "...", "metadata": {} } }` or a direct
`{ "external_id": "...", "metadata": {} }` payload.
