package model

// Entitlement key kinds. A suite key grants a whole product suite, an app key
// grants a single application, and a seat key meters per-user seat licensing.
const (
	EntitlementKindSuite = "suite"
	EntitlementKindApp   = "app"
	EntitlementKindSeat  = "seat"
	// EntitlementKindMeter is a metered consumption key (like a seat, but for a
	// non-seat resource such as AI tokens): its plan/override limit is a monthly
	// quota tracked in usage_counters via the Consume path.
	EntitlementKindMeter = "meter"
)

// EntitlementKey is one canonical entitlement key the platform recognises,
// with a human label and its kind. This is the single source of truth that
// previously lived duplicated across the gateway route table and seeds
// (gateway/config/routes.go: suite.cyber / suite.siem / suite.datastream /
// app.acta / app.watheeq / app.bosalah).
type EntitlementKey struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Kind  string `json:"kind"`
}

// EntitlementKeys is the canonical registry of every entitlement key the
// licensing engine and gateway gate on. Keep this in sync with the gateway
// route Entitlement values; this slice is the authoritative set.
var EntitlementKeys = []EntitlementKey{
	{Key: "suite.cyber", Label: "Cyber Suite", Kind: EntitlementKindSuite},
	{Key: "suite.data", Label: "Data Suite", Kind: EntitlementKindSuite},
	{Key: "suite.siem", Label: "SIEM Suite", Kind: EntitlementKindSuite},
	{Key: "suite.datastream", Label: "DataStream Suite", Kind: EntitlementKindSuite},
	{Key: "app.acta", Label: "Acta", Kind: EntitlementKindApp},
	{Key: "app.watheeq", Label: "Watheeq", Kind: EntitlementKindApp},
	{Key: "app.bosalah", Label: "Bosalah", Kind: EntitlementKindApp},
	// Clario Recover — one product, three sub-solutions. Each sub-solution is a
	// separately licensable suite key resolved by the same entitlement engine as
	// every other key above; the Recover product (internal/recover) gates its
	// sub-solution surfaces on these and never on a hardcoded "all enabled".
	{Key: RecoverITDRKey, Label: "Recover — IT Disaster Recovery", Kind: EntitlementKindSuite},
	{Key: RecoverCloudDRKey, Label: "Recover — Cloud Disaster Recovery", Kind: EntitlementKindSuite},
	{Key: RecoverCyberRecoveryKey, Label: "Recover — Cyber Recovery", Kind: EntitlementKindSuite},
	{Key: RespondMajorIncidentKey, Label: "Respond — Major Incident Command", Kind: EntitlementKindSuite},
	{Key: MigrateCloudMigrationKey, Label: "Migrate — Cloud Migration Orchestration", Kind: EntitlementKindSuite},
	{Key: AITokensKey, Label: "AI Tokens (millions/month)", Kind: EntitlementKindMeter},
	{Key: SeatsKey, Label: "User Seats", Kind: EntitlementKindSeat},
}

// Clario Recover entitlement keys. These are the single source of truth for the
// three Recover sub-solutions; internal/recover references them rather than
// re-declaring string literals, and they appear in EntitlementKeys above so the
// gateway and licensing admin surface recognise them like any other suite key.
const (
	RecoverITDRKey          = "recover.it_dr"
	RecoverCloudDRKey       = "recover.cloud_dr"
	RecoverCyberRecoveryKey = "recover.cyber_recovery"
)

const RespondMajorIncidentKey = "respond.major_incident"

const MigrateCloudMigrationKey = "migrate.cloud_migration"

// SeatsKey is the reserved entitlement key for seat licensing. The license's
// seats field, when positive, takes precedence over any plan or override limit
// for this key, so per-tenant seat counts need no override rows.
const SeatsKey = "seats.users"

// AITokensKey is the reserved metered entitlement key for AI token allowance.
// Its limit is the monthly allowance in MILLIONS of tokens: the capped pricing
// tiers grant ai_allowance_millions * units, and Customized grants an uncapped
// (NULL-limit) dedicated allowance. The commercial loop sets a per-tenant
// override on this key from the accepted quote's tier so metering knows the
// tenant's monthly AI allowance.
const AITokensKey = "ai.tokens"
