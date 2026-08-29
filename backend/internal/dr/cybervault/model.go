package cybervault

import "time"

// VaultProvider identifies the vault technology whose posture is being scored.
type VaultProvider string

const (
	// VaultProviderGeneric is used when the caller has normalised a provider not
	// explicitly named below.
	VaultProviderGeneric VaultProvider = "generic"
	// VaultProviderAWSBackup covers AWS Backup vaults and logically equivalent
	// air-gapped backup vault deployments.
	VaultProviderAWSBackup VaultProvider = "aws_backup"
	// VaultProviderAzureBackup covers Azure Backup vaults.
	VaultProviderAzureBackup VaultProvider = "azure_backup"
	// VaultProviderGCPBackupDR covers Google Cloud Backup and DR vaults.
	VaultProviderGCPBackupDR VaultProvider = "gcp_backup_dr"
	// VaultProviderS3ObjectLock covers object-lock/WORM vaults built directly on
	// object storage.
	VaultProviderS3ObjectLock VaultProvider = "s3_object_lock"
)

// PostureVerdict is the aggregate or per-control evaluation outcome.
type PostureVerdict string

const (
	// VerdictSatisfied means the control is fully met, or the aggregate has no
	// unresolved findings.
	VerdictSatisfied PostureVerdict = "satisfied"
	// VerdictPartial means the control is partly met, or the aggregate has only
	// warning-grade findings.
	VerdictPartial PostureVerdict = "partial"
	// VerdictFailed means the control is unmet, or the aggregate has at least one
	// high-risk finding.
	VerdictFailed PostureVerdict = "failed"
)

// FindingSeverity is the remediation priority for a posture finding.
type FindingSeverity string

const (
	// SeverityWarning is used for gaps that weaken posture without immediately
	// invalidating the vault as a cyber-recovery target.
	SeverityWarning FindingSeverity = "warning"
	// SeverityHigh is used for gaps that can let attackers erase, administer, or
	// restore from the vault without enough resistance.
	SeverityHigh FindingSeverity = "high"
)

// ApprovalPolicy captures restore and destructive-operation approval gates.
type ApprovalPolicy struct {
	// RequireRestoreApproval requires an approval workflow before restore.
	RequireRestoreApproval bool `json:"require_restore_approval"`
	// RestoreApprovers is the number of distinct approvers required for restore.
	RestoreApprovers int `json:"restore_approvers"`
	// RequireDestructiveApproval requires approval before deleting backups,
	// shortening retention, disabling lock, or removing replicas.
	RequireDestructiveApproval bool `json:"require_destructive_approval"`
	// DestructiveApprovers is the number of distinct approvers required for
	// destructive operations.
	DestructiveApprovers int `json:"destructive_approvers"`
	// SeparationOfDuties requires approvers to be administratively separate from
	// the operator requesting the action.
	SeparationOfDuties bool `json:"separation_of_duties"`
}

// RetentionPolicy captures immutable retention requirements for vault points.
type RetentionPolicy struct {
	// MinimumDays is the configured minimum retention duration for protected
	// recovery points.
	MinimumDays int `json:"minimum_days"`
	// RequiredMinimumDays overrides DefaultRequiredRetentionDays when non-zero.
	RequiredMinimumDays int `json:"required_minimum_days,omitempty"`
}

// IsolationPolicy captures administrative isolation between production and the
// vault control plane.
type IsolationPolicy struct {
	// CrossAccount means the vault is in a separate account, subscription, or
	// project from the protected production estate.
	CrossAccount bool `json:"cross_account"`
	// DisjointAdmins means production administrators do not administer the vault.
	DisjointAdmins bool `json:"disjoint_admins"`
	// SourceAdminDenied means source-side principals cannot delete, unlock, or
	// shorten retention on vault contents.
	SourceAdminDenied bool `json:"source_admin_denied"`
}

// VaultPosture is the evidence bundle evaluated by this package. It intentionally
// stays provider-neutral while reflecting common immutable-vault controls.
type VaultPosture struct {
	ID       string        `json:"id,omitempty"`
	Name     string        `json:"name,omitempty"`
	Provider VaultProvider `json:"provider"`

	PrimaryRegion  string   `json:"primary_region,omitempty"`
	ReplicaRegions []string `json:"replica_regions,omitempty"`

	ImmutabilityEnabled bool `json:"immutability_enabled"`
	VaultLockEnabled    bool `json:"vault_lock_enabled"`

	EncryptionEnabled  bool `json:"encryption_enabled"`
	CustomerManagedKey bool `json:"customer_managed_key"`

	Approval  ApprovalPolicy  `json:"approval"`
	Retention RetentionPolicy `json:"retention"`
	Isolation IsolationPolicy `json:"isolation"`

	LastRestoreTestAt     time.Time `json:"last_restore_test_at,omitempty"`
	LastRestoreTestPassed bool      `json:"last_restore_test_passed"`
	// RestoreTestWindowDays overrides DefaultRestoreTestWindowDays when non-zero.
	RestoreTestWindowDays int `json:"restore_test_window_days,omitempty"`

	BreakGlassEnabled      bool      `json:"break_glass_enabled"`
	BreakGlassMFA          bool      `json:"break_glass_mfa"`
	BreakGlassLastTestedAt time.Time `json:"break_glass_last_tested_at,omitempty"`
	// BreakGlassTestWindowDays overrides DefaultBreakGlassTestWindowDays when
	// non-zero.
	BreakGlassTestWindowDays int `json:"break_glass_test_window_days,omitempty"`
}

// VaultFinding is one unmet posture control surfaced for remediation. Findings
// are returned in deterministic control order.
type VaultFinding struct {
	Code        string          `json:"code"`
	Title       string          `json:"title"`
	Verdict     PostureVerdict  `json:"verdict"`
	Severity    FindingSeverity `json:"severity"`
	Weight      int             `json:"weight"`
	Message     string          `json:"message"`
	Remediation string          `json:"remediation"`
}

// PostureAssessment is the scored result of evaluating a VaultPosture. Score is
// a weighted percentage over the fixed control set.
type PostureAssessment struct {
	VaultID       string         `json:"vault_id,omitempty"`
	Provider      VaultProvider  `json:"provider"`
	Score         float64        `json:"score"`
	Verdict       PostureVerdict `json:"verdict"`
	TotalControls int            `json:"total_controls"`
	Satisfied     int            `json:"satisfied"`
	Partial       int            `json:"partial"`
	Failed        int            `json:"failed"`
	Findings      []VaultFinding `json:"findings"`
	EvaluatedAt   time.Time      `json:"evaluated_at"`
}
