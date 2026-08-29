# ClarioDR service Vault policy
#
# Scope (minimum-grant):
#   - Transit: per-tenant DR DEK envelopes only
#   - PKI: DR agent root + per-tenant intermediate mounts + dr-agent-leaf role
#
# Anti-pattern self-check: NO globbed "*" grants beyond the necessary
# per-tenant DR prefixes. No KV/secret mount access is granted.

# Transit: per-tenant DR KEKs used by internal/dr WORM recovery-point sealing.
path "transit/keys/dr-tenant-*" {
  capabilities = ["create", "read", "update"]
}

path "transit/datakey/plaintext/dr-tenant-*" {
  capabilities = ["update"]
}

path "transit/decrypt/dr-tenant-*" {
  capabilities = ["update"]
}

# PKI mount discovery/creation for the DR root and per-tenant intermediates.
path "sys/mounts" {
  capabilities = ["read"]
}

path "sys/mounts/pki-dr-root" {
  capabilities = ["create", "read", "update", "sudo"]
}

path "sys/mounts/pki-dr-intermediate-*" {
  capabilities = ["create", "read", "update", "sudo"]
}

# DR root CA: read existing CA, generate root when absent, sign intermediates.
path "pki-dr-root/ca/pem" {
  capabilities = ["read"]
}

path "pki-dr-root/root/generate/internal" {
  capabilities = ["update"]
}

path "pki-dr-root/root/sign-intermediate" {
  capabilities = ["update"]
}

# DR tenant intermediates: CSR generation, signed-cert upload, role, issue, revoke.
path "pki-dr-intermediate-*/ca/pem" {
  capabilities = ["read"]
}

path "pki-dr-intermediate-*/intermediate/generate/internal" {
  capabilities = ["update"]
}

path "pki-dr-intermediate-*/intermediate/set-signed" {
  capabilities = ["update"]
}

path "pki-dr-intermediate-*/roles/dr-agent-leaf" {
  capabilities = ["create", "update"]
}

path "pki-dr-intermediate-*/sign/dr-agent-leaf" {
  capabilities = ["update"]
}

path "pki-dr-intermediate-*/revoke" {
  capabilities = ["update"]
}
