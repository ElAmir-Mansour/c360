// Package catalog is the single source of truth that maps onboarding "suite"
// selections to license entitlement keys, and defines the set of
// self-serve-grantable keys.
//
// It exists to end the historical drift between three vocabularies that must
// agree but previously did not:
//   - onboarding wizard suite ids (tenant_onboarding.active_suites, validated in
//     internal/onboarding/service/common.go),
//   - the gateway route entitlement tags (internal/gateway/config/routes.go),
//   - the license entitlement keys (internal/license/model/keys.go).
//
// Notably the wizard ids "lex" and "visus" do NOT have their own entitlement
// keys; the gateway gates /api/v1/lex on app.watheeq and /api/v1/visus on
// app.bosalah. This package encodes those aliases so onboarding can translate a
// customer's product selection into the keys the gateway actually enforces.
package catalog

// Entitlement keys. These MUST stay in sync with
// internal/license/model/keys.go (EntitlementKeys) and the gateway route tags
// in internal/gateway/config/routes.go. A contract test should assert equality.
const (
	KeySuiteCyber            = "suite.cyber"
	KeySuiteData             = "suite.data"
	KeySuiteSIEM             = "suite.siem"
	KeySuiteDataStream       = "suite.datastream"
	KeyRespondMajorIncident  = "respond.major_incident"
	KeyMigrateCloudMigration = "migrate.cloud_migration"
	KeyAppActa               = "app.acta"
	KeyAppWatheeq            = "app.watheeq" // wizard id "lex"
	KeyAppBosalah            = "app.bosalah" // wizard id "visus"
	KeySeatsUsers            = "seats.users"
)

const (
	TrialPlanKey   = "trial"
	TrialSeatLimit = 5
	TrialDays      = 14
	TrialGraceDays = 7
)

type SelfServeProduct struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Description    string `json:"description"`
	EntitlementKey string `json:"entitlement_key"`
}

type SelfServePlan struct {
	Key             string   `json:"key"`
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	SelfServe       bool     `json:"self_serve"`
	Default         bool     `json:"default"`
	SeatLimit       int      `json:"seat_limit"`
	TrialDays       int      `json:"trial_days"`
	GraceDays       int      `json:"grace_days"`
	IncludedSuites  []string `json:"included_suites"`
	EntitlementKeys []string `json:"entitlement_keys"`
}

// suiteToKey maps an onboarding wizard suite id to the canonical entitlement
// key the gateway gates on.
var suiteToKey = map[string]string{
	"cyber":      KeySuiteCyber,
	"data":       KeySuiteData,
	"siem":       KeySuiteSIEM,
	"datastream": KeySuiteDataStream,
	"respond":    KeyRespondMajorIncident,
	"migrate":    KeyMigrateCloudMigration,
	"acta":       KeyAppActa,
	"lex":        KeyAppWatheeq,
	"visus":      KeyAppBosalah,
}

// SelfServeSuites is the ordered set of wizard suite ids a customer may select
// during self-serve onboarding. Keep in sync with onboarding ensureActiveSuites.
var SelfServeSuites = []string{"cyber", "data", "siem", "datastream", "respond", "migrate", "acta", "lex", "visus"}

var selfServeProducts = map[string]SelfServeProduct{
	"cyber": {
		ID:             "cyber",
		Name:           "Cybersecurity",
		Description:    "Threat detection, asset management, and SOC dashboards.",
		EntitlementKey: KeySuiteCyber,
	},
	"data": {
		ID:             "data",
		Name:           "Data Intelligence",
		Description:    "Data quality, lineage, pipeline orchestration, and analytics.",
		EntitlementKey: KeySuiteData,
	},
	"siem": {
		ID:             "siem",
		Name:           "SIEM",
		Description:    "Security event collection, correlation, detection, and response.",
		EntitlementKey: KeySuiteSIEM,
	},
	"datastream": {
		ID:             "datastream",
		Name:           "DataStream",
		Description:    "Resilience, migration, synchronization, and data warehouse operations.",
		EntitlementKey: KeySuiteDataStream,
	},
	"respond": {
		ID:             "respond",
		Name:           "Respond",
		Description:    "Major incident command center, response timeline, and stakeholder updates.",
		EntitlementKey: KeyRespondMajorIncident,
	},
	"migrate": {
		ID:             "migrate",
		Name:           "Migrate",
		Description:    "Cloud migration waves, dependency move groups, cutover windows, rollback, and evidence.",
		EntitlementKey: KeyMigrateCloudMigration,
	},
	"acta": {
		ID:             "acta",
		Name:           "Board Governance",
		Description:    "Meeting automation, minutes, action items, and governance evidence.",
		EntitlementKey: KeyAppActa,
	},
	"lex": {
		ID:             "lex",
		Name:           "Watheeq Legal Operations",
		Description:    "Contract management, clause analysis, matters, and legal workflows.",
		EntitlementKey: KeyAppWatheeq,
	},
	"visus": {
		ID:             "visus",
		Name:           "Executive Intelligence",
		Description:    "Cross-suite KPIs, executive dashboards, and reporting.",
		EntitlementKey: KeyAppBosalah,
	},
}

func SelfServeProducts() []SelfServeProduct {
	out := make([]SelfServeProduct, 0, len(SelfServeSuites))
	for _, id := range SelfServeSuites {
		out = append(out, selfServeProducts[id])
	}
	return out
}

func SelfServePlans() []SelfServePlan {
	return []SelfServePlan{
		{
			Key:             TrialPlanKey,
			Name:            "Trial",
			Description:     "14-day self-serve trial with selected products and up to 5 users.",
			SelfServe:       true,
			Default:         true,
			SeatLimit:       TrialSeatLimit,
			TrialDays:       TrialDays,
			GraceDays:       TrialGraceDays,
			IncludedSuites:  append([]string(nil), SelfServeSuites...),
			EntitlementKeys: append(SelfServeEntitlementKeys(), KeySeatsUsers),
		},
	}
}

// IsSelfServeSuite reports whether a wizard suite id is selectable in self-serve
// onboarding.
func IsSelfServeSuite(suite string) bool {
	_, ok := suiteToKey[suite]
	return ok
}

// EntitlementKeyForSuite returns the entitlement key for a wizard suite id.
func EntitlementKeyForSuite(suite string) (string, bool) {
	k, ok := suiteToKey[suite]
	return k, ok
}

// EntitlementKeysForSuites maps selected wizard suite ids to entitlement keys
// (deduped; unknown ids skipped).
func EntitlementKeysForSuites(suites []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(suites))
	for _, s := range suites {
		k, ok := suiteToKey[s]
		if !ok {
			continue
		}
		if _, dup := seen[k]; dup {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, k)
	}
	return out
}

// SelfServeEntitlementKeys is the full set of suite/app keys the shared trial
// plan grants (excluding the seat meter). The trial scopes a tenant by REVOKING
// the keys it did not select (see UnselectedEntitlementKeys).
func SelfServeEntitlementKeys() []string {
	out := make([]string, 0, len(SelfServeSuites))
	for _, s := range SelfServeSuites {
		out = append(out, suiteToKey[s])
	}
	return out
}

// UnselectedEntitlementKeys returns the self-serve entitlement keys NOT covered
// by the selected suites. The provisioner writes a Limit=0 revoke override for
// each so the shared trial plan is effectively scoped to the customer's
// selection (overrides cannot ADD grants, only revoke — hence grant-all-then-revoke).
func UnselectedEntitlementKeys(selectedSuites []string) []string {
	selected := map[string]struct{}{}
	for _, k := range EntitlementKeysForSuites(selectedSuites) {
		selected[k] = struct{}{}
	}
	out := make([]string, 0)
	for _, k := range SelfServeEntitlementKeys() {
		if _, ok := selected[k]; !ok {
			out = append(out, k)
		}
	}
	return out
}
