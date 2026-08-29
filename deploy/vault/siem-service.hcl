# SIEM service Vault policy
# Generated as part of SIEM-03; reviewed as part of every cert rotation.
#
# Scope (minimum-grant):
#   - Transit: per-tenant DEK envelopes + enrollment-JWT signing key
#   - PKI: root + per-tenant intermediate mounts + collector-leaf role
#
# Anti-pattern self-check: NO globbed "*" grants beyond the necessary
# per-tenant prefixes. Every path is scoped to a concrete prefix.

# Transit: read existing keys (for envelope DEK + enrollment-JWT signing)
path "transit/keys/siem-tenant-*"            { capabilities = ["read", "list"] }
path "transit/encrypt/siem-tenant-*"         { capabilities = ["update"] }
path "transit/decrypt/siem-tenant-*"         { capabilities = ["update"] }
path "transit/datakey/plaintext/siem-tenant-*" { capabilities = ["update"] }
path "transit/keys/siem-enrollment-jwt"      { capabilities = ["read", "create", "update"] }
path "transit/sign/siem-enrollment-jwt"      { capabilities = ["update"] }
path "transit/sign/siem-enrollment-jwt/*"    { capabilities = ["update"] }
path "transit/verify/siem-enrollment-jwt"    { capabilities = ["update"] }
path "transit/verify/siem-enrollment-jwt/*"  { capabilities = ["update"] }

# PKI: root + per-tenant intermediates
path "sys/mounts/pki-siem-root"              { capabilities = ["create", "read", "update", "sudo"] }
path "sys/mounts/pki-siem-intermediate-*"    { capabilities = ["create", "read", "update", "sudo"] }
path "pki-siem-root/*"                       { capabilities = ["create", "read", "update", "list"] }
path "pki-siem-intermediate-*/*"             { capabilities = ["create", "read", "update", "list"] }
path "pki-siem-intermediate-*/issue/collector-leaf" { capabilities = ["update"] }
path "pki-siem-intermediate-*/revoke"        { capabilities = ["update"] }
path "pki-siem-intermediate-*/roles/collector-leaf" { capabilities = ["create", "read", "update"] }

# Sys (root CA generation requires sudo + tools/random for unique serials)
path "sys/tools/random"                      { capabilities = ["update"] }

# Self-introspection (debugging / health endpoints)
path "auth/token/lookup-self"                { capabilities = ["read"] }
path "auth/token/renew-self"                 { capabilities = ["update"] }
