package metastore

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// metadataFingerprint is the canonical, order-independent projection of the
// drift-relevant metadata of an application. Two applications with the same
// fingerprint produce the same recovery runbook, so a change in any field here
// is exactly a change that should re-shape a populated runbook — and therefore
// constitutes drift. Scalar identity fields (name/description) and bookkeeping
// (revision/timestamps) are deliberately EXCLUDED: they do not change the
// runbook, so editing them must not flag drift.
type metadataFingerprint struct {
	RecoveryTier     string         `json:"recovery_tier"`
	RTOTargetSeconds int            `json:"rto_target_seconds"`
	Owners           []Owner        `json:"owners"`
	Environments     []Environment  `json:"environments"`
	Dependencies     []Dependency   `json:"dependencies"`
	CloudAccounts    []CloudAccount `json:"cloud_accounts"`
}

// canonicalFingerprint builds the deterministic fingerprint of an application's
// drift-relevant metadata: every multi-valued slice is sorted by a stable key
// so two semantically-equal metadata sets (differing only in row order) hash
// identically.
func canonicalFingerprint(app Application) metadataFingerprint {
	owners := append([]Owner(nil), app.Owners...)
	sort.Slice(owners, func(i, j int) bool {
		if owners[i].Role != owners[j].Role {
			return owners[i].Role < owners[j].Role
		}
		if owners[i].Name != owners[j].Name {
			return owners[i].Name < owners[j].Name
		}
		return owners[i].Contact < owners[j].Contact
	})

	envs := append([]Environment(nil), app.Environments...)
	sort.Slice(envs, func(i, j int) bool { return envs[i].Key < envs[j].Key })

	deps := append([]Dependency(nil), app.Dependencies...)
	sort.Slice(deps, func(i, j int) bool { return deps[i].DependsOnAppKey < deps[j].DependsOnAppKey })

	accounts := append([]CloudAccount(nil), app.CloudAccounts...)
	sort.Slice(accounts, func(i, j int) bool {
		if accounts[i].Provider != accounts[j].Provider {
			return accounts[i].Provider < accounts[j].Provider
		}
		return accounts[i].AccountRef < accounts[j].AccountRef
	})

	return metadataFingerprint{
		RecoveryTier:     app.RecoveryTier,
		RTOTargetSeconds: app.RTOTargetSeconds,
		Owners:           owners,
		Environments:     envs,
		Dependencies:     deps,
		CloudAccounts:    accounts,
	}
}

// MetadataHash computes a stable SHA-256 over an application's drift-relevant
// metadata. It is the value persisted as metadata_hash and compared on sync.
func MetadataHash(app Application) string {
	fp := canonicalFingerprint(app)
	b, err := json.Marshal(fp)
	if err != nil {
		// The fingerprint is always JSON-marshalable; on the impossible error use
		// a sentinel so a write still records a non-empty hash and a subsequent
		// compare treats it as different (forcing drift, the safe direction).
		b = []byte("<unmarshalable>")
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// diffMetadata computes the field-level differences between the metadata a
// runbook was populated FROM (source) and the application's CURRENT metadata. It
// is used to populate SyncResult.ChangedFields so an operator sees exactly WHAT
// drifted, not merely that something did. The comparison is over the canonical
// fingerprint, so row-order differences never register as drift.
func diffMetadata(source, current Application) []DriftField {
	var fields []DriftField
	srcFP := canonicalFingerprint(source)
	curFP := canonicalFingerprint(current)

	if srcFP.RecoveryTier != curFP.RecoveryTier {
		fields = append(fields, DriftField{
			Field:   "recovery_tier",
			Summary: fmt.Sprintf("recovery tier %s → %s", srcFP.RecoveryTier, curFP.RecoveryTier),
		})
	}
	if srcFP.RTOTargetSeconds != curFP.RTOTargetSeconds {
		fields = append(fields, DriftField{
			Field:   "rto_target_seconds",
			Summary: fmt.Sprintf("RTO target %ds → %ds", srcFP.RTOTargetSeconds, curFP.RTOTargetSeconds),
		})
	}
	if s := ownersSig(srcFP.Owners); s != ownersSig(curFP.Owners) {
		fields = append(fields, DriftField{Field: "owners", Summary: "owners changed"})
	}
	if s := envsSig(srcFP.Environments); s != envsSig(curFP.Environments) {
		fields = append(fields, DriftField{Field: "environments", Summary: "environments changed"})
	}
	if s := depsSig(srcFP.Dependencies); s != depsSig(curFP.Dependencies) {
		fields = append(fields, DriftField{Field: "dependencies", Summary: "dependencies changed"})
	}
	if s := accountsSig(srcFP.CloudAccounts); s != accountsSig(curFP.CloudAccounts) {
		fields = append(fields, DriftField{Field: "cloud_accounts", Summary: "cloud accounts changed"})
	}
	return fields
}

func ownersSig(owners []Owner) string {
	parts := make([]string, len(owners))
	for i, o := range owners {
		parts[i] = o.Role + "|" + o.Name + "|" + o.Contact
	}
	return strings.Join(parts, ";")
}

func envsSig(envs []Environment) string {
	parts := make([]string, len(envs))
	for i, e := range envs {
		parts[i] = fmt.Sprintf("%s|%s|%s|%t", e.Key, e.Kind, e.Region, e.IsRecoveryTarget)
	}
	return strings.Join(parts, ";")
}

func depsSig(deps []Dependency) string {
	parts := make([]string, len(deps))
	for i, d := range deps {
		parts[i] = d.DependsOnAppKey + "|" + d.Criticality
	}
	return strings.Join(parts, ";")
}

func accountsSig(accounts []CloudAccount) string {
	parts := make([]string, len(accounts))
	for i, a := range accounts {
		parts[i] = a.Provider + "|" + a.AccountRef + "|" + a.Region
	}
	return strings.Join(parts, ";")
}
