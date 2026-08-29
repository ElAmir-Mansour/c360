package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	appconfig "github.com/clario360/platform/internal/config"
)

type Config struct {
	HTTPPort   int
	AdminPort  int
	DBURL      string
	DBMinConns int
	DBMaxConns int

	DRDBURL          string
	MigrationsPath   string
	JWTPublicKeyPath string

	LicenseServiceURL   string
	EntitlementTimeout  time.Duration
	EntitlementFailOpen bool
	ConnectorTimeout    time.Duration

	// DRServiceURL is the internal base URL of clario-dr-service. When set, the
	// Migrate DR bridge generates/executes wave runbooks against the existing DR
	// Runbook Studio + Topology HTTP APIs. Empty disables runbook generation
	// (those endpoints fail closed with 503).
	DRServiceURL string
	// InternalToken is the service-token JWT used to authorize the dr:* scoped
	// studio/topology calls from migrate-service to dr-service.
	InternalToken string
	// DRBridgeTimeout bounds each cross-service DR call.
	DRBridgeTimeout time.Duration

	// WorkflowServiceURL is the internal base URL of the shared workflow engine
	// (cmd/workflow-engine). When set together with ApprovalWorkflowDefinitionID,
	// Migrate routes move-group / gate / rollback-plan approvals through a real
	// human-task approval workflow (Wave 5, H2) instead of the local status flip.
	// Empty disables the workflow-backed path: the guarded manual-override remains.
	WorkflowServiceURL string
	// ApprovalWorkflowDefinitionID is the workflow_db definition id (an active
	// approval workflow, e.g. "move-group-approval") Migrate instantiates for each
	// approval request. Referenced by id — never hardcoded into a seed here, since
	// definitions are per-tenant rows the workflow engine owns.
	ApprovalWorkflowDefinitionID string
	// ServiceToken guards the internal approval callback surface
	// (POST /internal/migrate/approve-callback) AND the connector-invocation webhook
	// (POST /internal/migrate/connectors/invoke). Empty leaves both off.
	ServiceToken string
	// WorkflowClientTimeout bounds each cross-service workflow-engine call.
	WorkflowClientTimeout time.Duration

	// SelfURL is migrate-service's OWN internal base URL, reachable by the DR
	// Runbook Studio engine's automated-task Executor (Wave 6, P10a). When set (with
	// a ConnectorWebhookToken) the wave/rollback runbook generator emits AUTOMATED
	// connector-invocation tasks whose automation_action is
	// SelfURL + /internal/migrate/connectors/invoke, so the DR engine invokes the
	// configured connectors during a real cutover/rollback run. Empty disables
	// connector tasks (the runbook is still generated, without them).
	SelfURL string
	// ConnectorWebhookToken is the shared secret the connector-invocation webhook
	// validates. Because the DR Executor's HTTP action runner posts only a JSON
	// body (no auth header), this token travels in the generated task's params and
	// the webhook compares it in constant time. Defaults to ServiceToken when unset
	// so a single internal secret configures the whole internal surface.
	ConnectorWebhookToken string
}

// ConnectorWebhookPath is the internal path the DR engine's Executor POSTs a
// generated connector task to. It is joined to SelfURL to form the task's
// automation_action.
const ConnectorWebhookPath = "/internal/migrate/webhook/connectors/invoke"

func Default() *Config {
	return &Config{
		HTTPPort:              8100,
		AdminPort:             9100,
		DBMinConns:            2,
		DBMaxConns:            10,
		MigrationsPath:        "migrations/migrate_db",
		LicenseServiceURL:     "http://localhost:8096",
		EntitlementTimeout:    3 * time.Second,
		ConnectorTimeout:      30 * time.Second,
		DRBridgeTimeout:       30 * time.Second,
		WorkflowClientTimeout: 15 * time.Second,
	}
}

func Load(base *appconfig.Config) (*Config, error) {
	cfg := Default()
	var err error
	if cfg.HTTPPort, err = intEnv("MIGRATE_HTTP_PORT", cfg.HTTPPort); err != nil {
		return nil, err
	}
	if cfg.AdminPort, err = intEnv("MIGRATE_ADMIN_PORT", cfg.AdminPort); err != nil {
		return nil, err
	}
	cfg.DBURL = strings.TrimSpace(os.Getenv("MIGRATE_DATABASE_URL"))
	if cfg.DBURL == "" {
		derived := base.Database
		derived.Name = "migrate_db"
		cfg.DBURL = derived.DSN()
	}
	cfg.DRDBURL = strings.TrimSpace(os.Getenv("MIGRATE_DR_DATABASE_URL"))
	if cfg.DRDBURL == "" {
		derived := base.Database
		derived.Name = "dr_db"
		cfg.DRDBURL = derived.DSN()
	}
	if cfg.DBMinConns, err = intEnv("MIGRATE_DB_MIN_CONNS", cfg.DBMinConns); err != nil {
		return nil, err
	}
	if cfg.DBMaxConns, err = intEnv("MIGRATE_DB_MAX_CONNS", cfg.DBMaxConns); err != nil {
		return nil, err
	}
	if v := strings.TrimSpace(os.Getenv("MIGRATE_MIGRATIONS_PATH")); v != "" {
		cfg.MigrationsPath = v
	}
	cfg.JWTPublicKeyPath = strings.TrimSpace(os.Getenv("MIGRATE_JWT_PUBLIC_KEY_PATH"))
	if v := strings.TrimSpace(os.Getenv("MIGRATE_LICENSE_SERVICE_URL")); v != "" {
		cfg.LicenseServiceURL = v
	}
	if v := strings.TrimSpace(os.Getenv("MIGRATE_ENTITLEMENT_TIMEOUT")); v != "" {
		cfg.EntitlementTimeout, err = time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("invalid MIGRATE_ENTITLEMENT_TIMEOUT %q: %w", v, err)
		}
	}
	if v := strings.TrimSpace(os.Getenv("MIGRATE_CONNECTOR_TIMEOUT")); v != "" {
		cfg.ConnectorTimeout, err = time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("invalid MIGRATE_CONNECTOR_TIMEOUT %q: %w", v, err)
		}
	}
	if v := strings.TrimSpace(os.Getenv("MIGRATE_ENTITLEMENT_FAIL_OPEN")); v != "" {
		cfg.EntitlementFailOpen, err = strconv.ParseBool(v)
		if err != nil {
			return nil, fmt.Errorf("invalid MIGRATE_ENTITLEMENT_FAIL_OPEN %q: %w", v, err)
		}
	}
	cfg.DRServiceURL = strings.TrimSpace(os.Getenv("MIGRATE_DR_SERVICE_URL"))
	cfg.InternalToken = strings.TrimSpace(os.Getenv("MIGRATE_INTERNAL_TOKEN"))
	if v := strings.TrimSpace(os.Getenv("MIGRATE_DR_BRIDGE_TIMEOUT")); v != "" {
		cfg.DRBridgeTimeout, err = time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("invalid MIGRATE_DR_BRIDGE_TIMEOUT %q: %w", v, err)
		}
	}
	cfg.WorkflowServiceURL = strings.TrimSpace(os.Getenv("MIGRATE_WORKFLOW_SERVICE_URL"))
	cfg.ApprovalWorkflowDefinitionID = strings.TrimSpace(os.Getenv("MIGRATE_APPROVAL_WORKFLOW_DEFINITION_ID"))
	cfg.ServiceToken = strings.TrimSpace(os.Getenv("MIGRATE_SERVICE_TOKEN"))
	cfg.SelfURL = strings.TrimSpace(os.Getenv("MIGRATE_SELF_URL"))
	cfg.ConnectorWebhookToken = strings.TrimSpace(os.Getenv("MIGRATE_CONNECTOR_WEBHOOK_TOKEN"))
	if cfg.ConnectorWebhookToken == "" {
		cfg.ConnectorWebhookToken = cfg.ServiceToken
	}
	if v := strings.TrimSpace(os.Getenv("MIGRATE_WORKFLOW_CLIENT_TIMEOUT")); v != "" {
		cfg.WorkflowClientTimeout, err = time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("invalid MIGRATE_WORKFLOW_CLIENT_TIMEOUT %q: %w", v, err)
		}
	}
	return cfg, cfg.Validate()
}

// ConnectorWebhookURL returns the full URL the generated connector tasks call, or
// "" when SelfURL is unset. It is SelfURL + ConnectorWebhookPath.
func (c *Config) ConnectorWebhookURL() string {
	self := strings.TrimRight(strings.TrimSpace(c.SelfURL), "/")
	if self == "" {
		return ""
	}
	return self + ConnectorWebhookPath
}

func (c *Config) Validate() error {
	if c.HTTPPort < 1 || c.HTTPPort > 65535 {
		return fmt.Errorf("MIGRATE_HTTP_PORT must be in [1,65535], got %d", c.HTTPPort)
	}
	if c.AdminPort < 1 || c.AdminPort > 65535 {
		return fmt.Errorf("MIGRATE_ADMIN_PORT must be in [1,65535], got %d", c.AdminPort)
	}
	if c.DBMaxConns < c.DBMinConns {
		return fmt.Errorf("MIGRATE_DB_MAX_CONNS (%d) must be >= MIGRATE_DB_MIN_CONNS (%d)", c.DBMaxConns, c.DBMinConns)
	}
	if strings.TrimSpace(c.DBURL) == "" {
		return fmt.Errorf("MIGRATE_DATABASE_URL is required")
	}
	if strings.TrimSpace(c.LicenseServiceURL) == "" {
		return fmt.Errorf("MIGRATE_LICENSE_SERVICE_URL is required")
	}
	if c.EntitlementTimeout <= 0 {
		return fmt.Errorf("MIGRATE_ENTITLEMENT_TIMEOUT must be positive")
	}
	if c.ConnectorTimeout <= 0 {
		return fmt.Errorf("MIGRATE_CONNECTOR_TIMEOUT must be positive")
	}
	if c.DRBridgeTimeout <= 0 {
		return fmt.Errorf("MIGRATE_DR_BRIDGE_TIMEOUT must be positive")
	}
	if c.WorkflowClientTimeout <= 0 {
		return fmt.Errorf("MIGRATE_WORKFLOW_CLIENT_TIMEOUT must be positive")
	}
	// The workflow-backed approval path requires BOTH an engine URL and a
	// definition id; configuring one without the other is a misconfiguration that
	// would silently fall back to the manual-override bypass.
	if (c.WorkflowServiceURL != "") != (c.ApprovalWorkflowDefinitionID != "") {
		return fmt.Errorf("MIGRATE_WORKFLOW_SERVICE_URL and MIGRATE_APPROVAL_WORKFLOW_DEFINITION_ID must be set together")
	}
	return nil
}

func intEnv(key string, fallback int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("invalid %s %q: %w", key, raw, err)
	}
	return value, nil
}
