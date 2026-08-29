# ClarioDR / DataStream — Regulated Compliance Release Runbook

> **Purpose:** stand up the ClarioDR regulated posture — customer‑managed encryption (BYOK/KMS), compliance‑mode WORM object‑lock, data residency/sovereignty, tamper‑evident rehearsal‑proof signing, the associated `dr_db` schema (000044‑046), and the vendor gateway — **as one coordinated release**, without creating false compliance.
>
> **Audience:** the DR/DataStream release owner + a platform SRE + a security/key‑custodian. This is **not** a config‑flip a single engineer does mid‑deploy.
>
> **Golden rule:** never set a compliance flag whose real backing (object‑locked bucket, KMS key, signed proof) does not exist. A DR that *claims* WORM/BYOK it isn't actually backed by is worse than one that honestly claims neither.

---

## 0. Current state (verified on the shared box, 2026‑07‑01)

| Fact | Value | Implication |
|---|---|---|
| `dr_db` schema version | **41** | Migrations 000044‑046 are **not** applied |
| Local tree | has `dr_db` **000044‑046** (`byok_sealed_keystore`, `rehearsal_proof_store`, `stream_source_lag`) | Must ship **with the matching DR binary** — the running box binary is compiled for v41 |
| Vault | `clario360-prod-vault` present | KMS/transit foundation exists |
| MinIO | `clario360-prod-minio` present | **Existing buckets cannot gain object‑lock** — a *new* locked bucket is required |
| DR compliance env | **none set** | BYOK/WORM/residency/rehearsal all inactive today |
| Host | **shared** (Watheeq go‑live + DigiBit/BOA/CBA) | Compliance‑mode object‑lock here is high‑blast‑radius + **irreversible** |

**Environment decision (do this first):** the regulated posture SHOULD target a **dedicated regulated environment** (own Postgres `dr_db`, own MinIO with object‑lock, own Vault namespace, residency‑correct region), **not** the shared demo box. Compliance‑mode WORM on a shared host is a permanent commitment affecting every co‑tenant. The rest of this runbook assumes a dedicated regulated target unless you explicitly accept the shared‑host risk.

---

## 1. Env surface (what the DR service reads)

From `internal/dr/config/config.go`, `internal/dr/byok/sealed_provider.go`, `internal/dr/sovereignty/residency.go`, `cmd/clario-dr-service/{main,sovereign}.go`:

| Env var | Component | Notes |
|---|---|---|
| `DR_BYOK_KMS_ENDPOINT` | BYOK | KMS/transit endpoint (Vault transit URL) |
| `DR_BYOK_KMS_AUTH_HEADER` | BYOK | Auth header/token for the KMS call |
| `DR_BYOK_ROOT_KEY` | BYOK | Root/transit key reference — **key material / custody, not a guess** |
| `DR_BYOK_ROTATION` / `_INTERVAL` / `_BATCH` | BYOK | DEK re‑wrap rotation policy |
| `DR_WORM_BUCKET` | WORM | The **object‑lock‑enabled** bucket name |
| `DR_WORM_RETENTION_MODE` | WORM | `governance` (reversible by privileged users) or **`compliance` (IRREVERSIBLE)** |
| `DR_WORM_REQUIRE_EXPLICIT_REGION` | WORM/residency | Enforce the WORM bucket region matches residency |
| `DR_RESIDENCY` | Sovereignty | Region code (e.g. `me-central-1` / KSA) |
| `DR_REHEARSAL_PROOF_SIGNING_KEY_PEM` | Rehearsal proofs | Private signing key (PEM) — ideally HSM‑held |

> The DR service is designed to **fail closed / degrade** when these are unset (as `migrate-service` does for its own optional deps), so a non‑regulated deploy still boots. Setting them half‑way is the danger, not leaving them unset.

---

## 2. Coordinated release order (do NOT reorder)

```
[A] Provision dedicated regulated infra      (Vault namespace, MinIO+object-lock, region)
        │
[B] BYOK key ceremony in Vault transit        (create key; NEVER a fabricated root key)
        │
[C] Create the object-locked WORM bucket      (mc mb --with-lock; retention default)
        │
[D] Generate + custody the rehearsal signing key
        │
[E] Deploy the matching DR binary + dr_db 000044-046 TOGETHER  (code⇄schema in lockstep)
        │
[F] Set the DR_* env (BYOK/WORM/residency/rehearsal) + restart dr-service
        │
[G] Verify every component (§4) BEFORE flipping DR_WORM_RETENTION_MODE=compliance
        │
[H] Flip to compliance mode LAST, after a governance-mode dry run passes  (IRREVERSIBLE)
```

**Never** flip `compliance` (H) before the bucket, keys, code, and migrations are all real and verified (A‑G).

---

## 3. Step‑by‑step

### [A] Dedicated regulated infra
- Stand up (or confirm) a Vault instance/namespace for DR, a MinIO deployment in the **correct residency region**, and a `dr_db` on region‑resident Postgres.
- If accepting the shared box against advice: at minimum use a **separate** MinIO bucket + a **separate** Vault mount for DR, and record the co‑tenant risk sign‑off.

### [B] BYOK key ceremony (Vault transit) — *security custodian*
```bash
# Enable transit + create the DR root key (exportable=false; never leaves Vault)
vault secrets enable -path=dr-transit transit
vault write -f dr-transit/keys/dr-root type=aes256-gcm96
# App auth: a scoped token/approle that can only encrypt/decrypt with dr-root
```
- Set:
  - `DR_BYOK_KMS_ENDPOINT` = the Vault transit encrypt/decrypt URL
  - `DR_BYOK_KMS_AUTH_HEADER` = `X-Vault-Token: <scoped-token>` (or AppRole)
  - `DR_BYOK_ROOT_KEY` = `dr-root` (the transit key name the sealed provider wraps DEKs with)
- **Confirm the exact `DR_BYOK_ROOT_KEY` semantics** against `internal/dr/byok/sealed_provider.go` (transit key name vs a wrapped key blob) before setting — the DR owner owns this contract.
- Rotation: set `DR_BYOK_ROTATION=true` + a sane `DR_BYOK_ROTATION_INTERVAL`/`_BATCH` only after the base path works.

> ❌ Do **not** set `DR_BYOK_ROOT_KEY` to an ad‑hoc/dev value: losing it makes ciphertext unrecoverable; a dummy makes "BYOK" a lie.

### [C] WORM object‑lock bucket (MinIO) — *SRE*
```bash
mc alias set drminio https://<minio> <key> <secret>
# Object-lock can ONLY be enabled at bucket creation:
mc mb --with-lock drminio/dr-recovery-points-regulated
# Default retention (start in GOVERNANCE for the dry run; compliance comes in [H]):
mc retention set --default GOVERNANCE 30d drminio/dr-recovery-points-regulated
```
- Set `DR_WORM_BUCKET=dr-recovery-points-regulated`, `DR_WORM_REQUIRE_EXPLICIT_REGION=true`, and (for now) `DR_WORM_RETENTION_MODE=governance`.

### [D] Rehearsal‑proof signing key
```bash
# Ed25519 (or RSA-3072 if the verifier requires it — confirm in internal/dr):
openssl genpkey -algorithm ed25519 -out dr-rehearsal-signing.pem
chmod 600 dr-rehearsal-signing.pem
```
- Set `DR_REHEARSAL_PROOF_SIGNING_KEY_PEM` to the PEM **content** (not a path — match the platform's PEM‑as‑content convention).
- **Custody:** for full regulatory trust the private key belongs in Vault/HSM and signing happens there; a file‑based key is *functional* but note it as a gap in the compliance attestation.

### [E] DR code + `dr_db` 000044‑046, in lockstep — *DR owner*
- This is the crux: the box's DR binary is **v41‑matched**. Apply 000044‑046 **only** alongside the DR binary built from the same commit that introduced them.
```bash
# On the regulated target, from the matching DR release commit:
GOWORK=off go build -o /opt/clario360/bin/clario-dr-service ./cmd/clario-dr-service
GOWORK=off go build -o /opt/clario360/bin/migrator ./cmd/migrator
DATABASE_HOST=... DATABASE_PORT=... DATABASE_USER=... DATABASE_PASSWORD=... \
  /opt/clario360/bin/migrator -direction up   # brings dr_db 41 -> 46
# Confirm: SELECT version FROM schema_migrations;  -> 46 (not dirty)
```
- ❌ Do **not** run these migrations against a `dr_db` whose service binary is still v41 — the schema/code mismatch breaks the running DR service.

### [F] Apply env + restart
- Write the `DR_*` vars into the regulated env file (`clario360.env` / the ecosystem env for `clario-dr-service`).
- Reload so the env is picked up (`pm2 delete clario-dr-service && pm2 start <ecosystem> --only clario-dr-service --update-env` — a plain `pm2 restart` does **not** re‑read ecosystem env).

### [G] Verify (see §4) in **governance** mode first. A full DR rehearsal + recovery‑point write + proof verify must pass end‑to‑end.

### [H] Flip to compliance — **IRREVERSIBLE, last, with sign‑off**
```bash
mc retention set --default COMPLIANCE <legal-retention> drminio/dr-recovery-points-regulated
# then set DR_WORM_RETENTION_MODE=compliance and reload dr-service
```
- Requires: written approval, correct legal retention period, and a passing governance‑mode dry run. **Cannot be undone** — objects become undeletable until retention expiry.

---

## 4. Verification / acceptance (per component)

| Component | Check | Pass condition |
|---|---|---|
| BYOK | Write a recovery point; inspect the sealed DEK; kill Vault access and confirm decrypt **fails** | Ciphertext unwrappable **only** via the Vault key; no plaintext DEK at rest |
| WORM | `mc retention info` on an object; attempt `mc rm` | Delete **denied**; retention present |
| Residency | Force a write with a mismatched region + `DR_WORM_REQUIRE_EXPLICIT_REGION=true` | Rejected; only the residency region accepted |
| Rehearsal proof | Run a rehearsal; verify the proof signature with the **public** key | Signature verifies; tamper → verify fails |
| Migrations | `SELECT version, dirty FROM schema_migrations` on `dr_db` | `46`, `dirty=false`; dr‑service healthy |
| Vendor gateway | A sandbox cutover call to the vendor | Real vendor response, not a stub |

---

## 5. Rollback & irreversibility

- **Reversible:** governance‑mode WORM, env vars, code/migration (down migrations 000044‑046 exist), rehearsal key rotation, residency change (before data lands).
- **IRREVERSIBLE — no rollback:** `DR_WORM_RETENTION_MODE=compliance` on written objects; loss of the BYOK root key (→ permanent data loss). Treat both as one‑way doors gated by explicit sign‑off.
- Keep the previous DR binary + a `dr_db` backup immediately before [E] so a *code/schema* rollback is possible **before** any compliance‑locked object is written.

---

## 6. Vendor gateway
- The vendor migration/DR gateway is a **real integration** (vendor API creds, network egress, mapping). Scope it separately: sandbox creds → conformance test → production creds. Do **not** represent it as wired until a sandbox call returns a real vendor response.

---

## 7. Pre‑flight checklist (all must be YES before [H])
- [ ] Dedicated regulated environment (or explicit shared‑host risk sign‑off)
- [ ] Vault transit key created; DR can encrypt/decrypt; root key in custody (not fabricated)
- [ ] New **object‑lock** bucket created (`--with-lock`); governance retention set
- [ ] Rehearsal signing key generated + custodied; public key distributed to verifiers
- [ ] Matching DR binary built from the same commit as 000044‑046
- [ ] `dr_db` migrated to 46, not dirty, dr‑service healthy
- [ ] Residency region set + enforced
- [ ] End‑to‑end rehearsal + recovery‑point + proof verify pass in **governance** mode
- [ ] Legal retention period + written approval for compliance flip
- [ ] Vendor gateway validated against sandbox (or explicitly out of scope)

---

## 8. What is safe to do *today* (no coordinated release needed)
1. **Generate + set `DR_REHEARSAL_PROOF_SIGNING_KEY_PEM`** (real keypair; note HSM‑custody gap).
2. **Set `DR_RESIDENCY`** once the region is confirmed (KSA / `me-central-1`?).
3. **Wire `DR_BYOK_*` to the existing Vault** via the transit ceremony in [B] — deliberate, not fabricated.

Everything else (000044‑046 + matching binary, compliance‑mode WORM, vendor gateway) is a **coordinated regulated release** owned by the DR track, ideally on a dedicated environment — captured above so it can be executed safely rather than improvised.
