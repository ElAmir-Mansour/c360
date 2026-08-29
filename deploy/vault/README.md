# Vault policies

This directory contains the Vault policies applied to service tokens used by
the Clario360 platform. Policies are versioned alongside the code; every PR
that changes a policy must include a `vault policy write` invocation in its
deploy notes.

## SIEM service (`siem-service.hcl`)

Minimum-grant policy attached to the SIEM service's Vault token (either
static dev token or AppRole-derived child token in prod). Grants:

- Transit:
  - per-tenant DEK envelopes (`transit/keys/siem-tenant-*` + encrypt/decrypt/datakey)
  - enrollment-token signing key `siem-enrollment-jwt` (sign/verify)
- PKI:
  - root mount `pki-siem-root` (read/sudo for `root/generate/internal`)
  - per-tenant intermediates `pki-siem-intermediate-{tenant_id}` (lazy-create,
    sign-intermediate, set-signed)
  - leaf role `collector-leaf` (create/update; issue; revoke)

### Apply

Dev:

```bash
vault policy write siem-service deploy/vault/siem-service.hcl
```

Then attach to the SIEM AppRole (or set on the dev token):

```bash
vault write auth/approle/role/siem-service token_policies=siem-service
```

### Verify

```bash
vault policy read siem-service
```

### Bootstrap PKI engines

After the policy is in place, the SIEM service will lazily mount and configure
the PKI engines on startup. To pre-create them manually for ops verification:

```bash
# Root CA (10 years)
vault secrets enable -path=pki-siem-root -default-lease-ttl=87600h -max-lease-ttl=87600h pki
vault write -field=certificate pki-siem-root/root/generate/internal \
  common_name="Clario360 SIEM Root CA" ttl=87600h

# Enrollment JWT signing key
vault write -f transit/keys/siem-enrollment-jwt type=ed25519
```

Per-tenant intermediates are lazy-created by the SIEM service the first time a
source is onboarded for that tenant.

## ClarioDR service (`clario-dr-service.hcl`)

Minimum-grant policy attached to the `clario-dr-service` Vault token or
AppRole-derived child token. Grants:

- Transit:
  - per-tenant DR DEK envelopes (`transit/keys/dr-tenant-*`,
    `datakey/plaintext`, and `decrypt`) used by recovery-point WORM sealing
- PKI:
  - root mount `pki-dr-root`
  - per-tenant intermediates `pki-dr-intermediate-{tenant_id}`
  - leaf role `dr-agent-leaf` for DR agent enrollment certificates

No generic KV/secret mount access is granted; the enrollment JWT private key is
provided through Kubernetes/container secrets, not Vault Transit.

### Apply

Dev:

```bash
vault policy write clario-dr-service deploy/vault/clario-dr-service.hcl
```

Then attach to the DR AppRole (or set on the dev token):

```bash
vault write auth/approle/role/clario-dr-service token_policies=clario-dr-service
```

### Verify

```bash
vault policy read clario-dr-service
```

### Bootstrap PKI engines

After the policy is in place, `clario-dr-service` will lazily mount and
configure the PKI engines and `dr-tenant-*` Transit keys on first use. To
pre-create the root manually for ops verification:

```bash
vault secrets enable -path=pki-dr-root -default-lease-ttl=87600h -max-lease-ttl=87600h pki
vault write -field=certificate pki-dr-root/root/generate/internal \
  common_name="Clario360 DR Root CA" ttl=87600h
```
