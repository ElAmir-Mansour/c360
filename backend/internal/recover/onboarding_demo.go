package recover

import "github.com/clario360/platform/internal/recover/metastore"

// DemoAppKeyPrefix namespaces every demo application's stable app_key. It is the
// authoritative marker that a Metastore application (and the runbook populated
// from it) is demo content: the seed flow only ever creates app_keys with this
// prefix, the seed ledger records them, and the "remove demo data" action
// removes exactly the ledgered entities. The prefix also makes demo content
// obvious in any list (every demo app_key reads "demo-...").
const DemoAppKeyPrefix = "demo-"

// demoApplicationTemplate is a realistic demo application blueprint for one
// sub-solution. It is NOT canned UI data: each blueprint is fed through the REAL
// metastore.DefaultRegistry.CreateApplication path (the same path a tenant uses
// by hand) to produce a real, persisted application, and then through the REAL
// populate path (which composes Runbook Studio) to produce a real runbook —
// exactly the records the dashboards and analytics read. The blueprint only
// supplies realistic field values; all server-owned ids/revisions/timestamps are
// assigned by the registry.
type demoApplicationTemplate struct {
	// SubSolution is the Recover sub-solution this demo app showcases; it scopes
	// the seed ledger so a tenant who activates only some sub-solutions seeds only
	// the matching demo content.
	SubSolution string
	Input       metastore.ApplicationInput
}

// demoTemplates returns the demo application blueprints for one sub-solution.
// Each sub-solution gets exactly one realistic application whose metadata drives
// a real demo runbook (app-failover for IT DR, region-failover for Cloud DR,
// clean-room recovery for Cyber Recovery) when populated. Every app_key is
// DemoAppKeyPrefix-namespaced and every name is tagged "[DEMO]" so the content
// is unmistakably demo and the removal is precise.
func demoTemplates(subSolution string) []demoApplicationTemplate {
	switch subSolution {
	case SubSolutionITDR:
		return []demoApplicationTemplate{{
			SubSolution: SubSolutionITDR,
			Input: metastore.ApplicationInput{
				AppKey:           DemoAppKeyPrefix + "it-dr-core-banking",
				Name:             "[DEMO] Core Banking Ledger",
				Description:      "Demo IT DR application: on-prem core banking ledger with an app-failover runbook to the DR data centre.",
				RecoveryTier:     metastore.TierMissionCritical,
				RTOTargetSeconds: 3600,
				Owners: []metastore.Owner{
					{Role: metastore.OwnerBusiness, Name: "Layla Al-Rashid", Contact: "layla.alrashid@demo.clario"},
					{Role: metastore.OwnerTechnical, Name: "Omar Haddad", Contact: "omar.haddad@demo.clario"},
					{Role: metastore.OwnerApprover, Name: "Faisal Noor", Contact: "faisal.noor@demo.clario"},
				},
				Environments: []metastore.Environment{
					{Key: "prod-ryd", Kind: metastore.EnvProduction, Region: "ksa-riyadh-dc1", IsRecoveryTarget: false},
					{Key: "dr-jed", Kind: metastore.EnvDisasterRecovery, Region: "ksa-jeddah-dc2", IsRecoveryTarget: true},
				},
				Dependencies: []metastore.Dependency{
					{DependsOnAppKey: DemoAppKeyPrefix + "it-dr-identity", Criticality: metastore.DependencyHard},
					{DependsOnAppKey: DemoAppKeyPrefix + "it-dr-messaging", Criticality: metastore.DependencySoft},
				},
				CloudAccounts: []metastore.CloudAccount{
					{Provider: metastore.ProviderOnPrem, AccountRef: "ryd-dc1-vsphere", Region: "ksa-riyadh-dc1"},
				},
			},
		}}
	case SubSolutionCloudDR:
		return []demoApplicationTemplate{{
			SubSolution: SubSolutionCloudDR,
			Input: metastore.ApplicationInput{
				AppKey:           DemoAppKeyPrefix + "cloud-dr-payments-api",
				Name:             "[DEMO] Payments API",
				Description:      "Demo Cloud DR application: cloud-native payments API with a region-failover runbook to the secondary region.",
				RecoveryTier:     metastore.TierOne,
				RTOTargetSeconds: 1800,
				Owners: []metastore.Owner{
					{Role: metastore.OwnerBusiness, Name: "Nora Sami", Contact: "nora.sami@demo.clario"},
					{Role: metastore.OwnerTechnical, Name: "Yusuf Karim", Contact: "yusuf.karim@demo.clario"},
				},
				Environments: []metastore.Environment{
					{Key: "primary-mec1", Kind: metastore.EnvProduction, Region: "me-central-1", IsRecoveryTarget: false},
					{Key: "secondary-mec2", Kind: metastore.EnvDisasterRecovery, Region: "me-central-2", IsRecoveryTarget: true},
				},
				Dependencies: []metastore.Dependency{
					{DependsOnAppKey: DemoAppKeyPrefix + "cloud-dr-postgres", Criticality: metastore.DependencyHard},
				},
				CloudAccounts: []metastore.CloudAccount{
					{Provider: metastore.ProviderAWS, AccountRef: "920371650011", Region: "me-central-1"},
					{Provider: metastore.ProviderAWS, AccountRef: "920371650011", Region: "me-central-2"},
				},
			},
		}}
	case SubSolutionCyberRecovery:
		return []demoApplicationTemplate{{
			SubSolution: SubSolutionCyberRecovery,
			Input: metastore.ApplicationInput{
				AppKey:           DemoAppKeyPrefix + "cyber-erp",
				Name:             "[DEMO] ERP / Financials",
				Description:      "Demo Cyber Recovery application: ERP recovered to a clean-room from the last-known-good clean point, gated on an integrity check before return-to-production.",
				RecoveryTier:     metastore.TierMissionCritical,
				RTOTargetSeconds: 7200,
				Owners: []metastore.Owner{
					{Role: metastore.OwnerBusiness, Name: "Huda Mansour", Contact: "huda.mansour@demo.clario"},
					{Role: metastore.OwnerTechnical, Name: "Khalid Aziz", Contact: "khalid.aziz@demo.clario"},
					{Role: metastore.OwnerApprover, Name: "Salem Othman", Contact: "salem.othman@demo.clario"},
				},
				Environments: []metastore.Environment{
					{Key: "prod-erp", Kind: metastore.EnvProduction, Region: "ksa-riyadh-dc1", IsRecoveryTarget: false},
					{Key: "cleanroom", Kind: metastore.EnvTest, Region: "ksa-isolated-vault", IsRecoveryTarget: true},
				},
				Dependencies: []metastore.Dependency{
					{DependsOnAppKey: DemoAppKeyPrefix + "cyber-directory", Criticality: metastore.DependencyHard},
				},
				CloudAccounts: []metastore.CloudAccount{
					{Provider: metastore.ProviderOnPrem, AccountRef: "isolated-recovery-vault", Region: "ksa-isolated-vault"},
				},
			},
		}}
	default:
		return nil
	}
}
