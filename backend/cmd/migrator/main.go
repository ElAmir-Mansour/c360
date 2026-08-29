package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/observability"
)

// All databases managed by the platform.
var allDatabases = []string{
	"platform_core",
	"cyber_db",
	"data_db",
	"acta_db",
	"lex_db",
	"visus_db",
	"audit_db",
	"notification_db",
	"license_db",
	"dr_db",
	"workflow_db",
	"automation_db",
	"migrate_db",
	// NOT listed (deliberate): siem_db and respond_db self-migrate at their
	// service's boot (see deploy/vps/deploy.sh: "siem_db self-migrates on siem
	// boot"), and their databases are not provisioned by scripts/start.sh —
	// listing them here would make `make migrate-up` fail on environments that
	// never create them.
}

func main() {
	direction := flag.String("direction", "up", "Migration direction: up or down")
	dbName := flag.String("db", "", "Specific database to migrate (comma-separated, default: all)")

	// Optional per-database DSN overrides. When set, the override is used
	// instead of the DSN built from the shared DATABASE_* config — this is how
	// the Helm migration Job injects each database's credentials from secrets.
	// Unset flags fall back to the config-derived DSN, preserving the
	// `make migrate` / local workflow. The map key is the migrations
	// subdirectory (== database) name.
	dbURLOverrides := map[string]*string{
		"platform_core":   flag.String("platform-db-url", "", "DSN override for platform_core"),
		"cyber_db":        flag.String("cyber-db-url", "", "DSN override for cyber_db"),
		"data_db":         flag.String("data-db-url", "", "DSN override for data_db"),
		"acta_db":         flag.String("acta-db-url", "", "DSN override for acta_db"),
		"lex_db":          flag.String("lex-db-url", "", "DSN override for lex_db"),
		"visus_db":        flag.String("visus-db-url", "", "DSN override for visus_db"),
		"audit_db":        flag.String("audit-db-url", "", "DSN override for audit_db"),
		"notification_db": flag.String("notification-db-url", "", "DSN override for notification_db"),
		"license_db":      flag.String("license-db-url", "", "DSN override for license_db"),
		"dr_db":           flag.String("dr-db-url", "", "DSN override for dr_db"),
		"workflow_db":     flag.String("workflow-db-url", "", "DSN override for workflow_db"),
		"automation_db":   flag.String("automation-db-url", "", "DSN override for automation_db"),
		"migrate_db":      flag.String("migrate-db-url", "", "DSN override for migrate_db"),
	}
	// IAM data lives in platform_core; the deployment passes --iam-db-url for
	// symmetry, so accept it (and apply it to platform_core if platform's own
	// override is unset) rather than failing on an undefined flag.
	iamDBURL := flag.String("iam-db-url", "", "DSN override for IAM data (stored in platform_core)")
	// The migrator does not use Kafka; accept the flag the Job passes so
	// flag parsing does not fail.
	_ = flag.String("kafka-brokers", "", "accepted for deployment compatibility; unused by the migrator")
	flag.Parse()

	if err := validateDirection(*direction); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
	databases, err := selectDatabases(*dbName)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
	basePath, err := findMigrationsPath()
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}

	if *iamDBURL != "" && *dbURLOverrides["platform_core"] == "" {
		dbURLOverrides["platform_core"] = iamDBURL
	}

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "loading config: %v\n", err)
		os.Exit(1)
	}

	logger := observability.NewLogger(
		cfg.Observability.LogLevel,
		cfg.Observability.LogFormat,
		"migrator",
	)

	logger.Info().
		Str("direction", *direction).
		Str("base_path", basePath).
		Strs("databases", databases).
		Msg("starting migrations")

	hasError := false
	for _, db := range databases {
		db = strings.TrimSpace(db)
		migrationsPath := filepath.Join(basePath, db)

		// Every selected database must have a migration directory. Missing
		// migrations are an incomplete deployment, never a successful no-op.
		if info, err := os.Stat(migrationsPath); err != nil || !info.IsDir() {
			logger.Error().Err(err).Str("database", db).Str("path", migrationsPath).Msg("migrations directory not found")
			hasError = true
			continue
		}

		// Use the per-database DSN override when provided (Helm Job path),
		// otherwise build the DSN from the shared DATABASE_* config.
		var dsn string
		if override, ok := dbURLOverrides[db]; ok && *override != "" {
			dsn = *override
		} else {
			dsn = fmt.Sprintf(
				"postgres://%s:%s@%s:%d/%s?sslmode=%s",
				cfg.Database.User,
				cfg.Database.Password,
				cfg.Database.Host,
				cfg.Database.Port,
				db,
				cfg.Database.SSLMode,
			)
		}

		logger.Info().
			Str("database", db).
			Str("direction", *direction).
			Str("path", migrationsPath).
			Msg("running migration")

		switch *direction {
		case "up":
			if err := database.RunMigrations(dsn, migrationsPath); err != nil {
				logger.Error().Err(err).Str("database", db).Msg("migration up failed")
				hasError = true
				continue
			}
			logger.Info().Str("database", db).Msg("migrations applied successfully")

		case "down":
			if err := database.RollbackMigration(dsn, migrationsPath); err != nil {
				logger.Error().Err(err).Str("database", db).Msg("migration down failed")
				hasError = true
				continue
			}
			logger.Info().Str("database", db).Msg("migration rolled back successfully")

		}
	}

	if hasError {
		logger.Error().Msg("some migrations failed — check errors above")
		os.Exit(1)
	}

	logger.Info().Msg("all migrations completed")
}

func validateDirection(direction string) error {
	if direction != "up" && direction != "down" {
		return fmt.Errorf("invalid migration direction %q: use up or down", direction)
	}
	return nil
}

func selectDatabases(selection string) ([]string, error) {
	if strings.TrimSpace(selection) == "" {
		return append([]string(nil), allDatabases...), nil
	}

	allowed := make(map[string]struct{}, len(allDatabases))
	for _, databaseName := range allDatabases {
		allowed[databaseName] = struct{}{}
	}

	seen := make(map[string]struct{})
	databases := make([]string, 0)
	for _, candidate := range strings.Split(selection, ",") {
		databaseName := strings.TrimSpace(candidate)
		if databaseName == "" {
			return nil, fmt.Errorf("database selection %q contains an empty name", selection)
		}
		if _, ok := allowed[databaseName]; !ok {
			return nil, fmt.Errorf("unknown database %q; allowed values: %s", databaseName, strings.Join(allDatabases, ", "))
		}
		if _, duplicate := seen[databaseName]; duplicate {
			continue
		}
		seen[databaseName] = struct{}{}
		databases = append(databases, databaseName)
	}
	return databases, nil
}

func findMigrationsPath() (string, error) {
	candidates := []string{
		"migrations",
		"backend/migrations",
		"../migrations",
		filepath.Join("..", "..", "migrations"),
	}
	return findExistingDirectory(candidates)
}

func findExistingDirectory(candidates []string) (string, error) {
	for _, candidate := range candidates {
		abs, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		if info, err := os.Stat(abs); err == nil && info.IsDir() {
			return abs, nil
		}
	}
	return "", fmt.Errorf("migrations directory not found; searched: %s", strings.Join(candidates, ", "))
}
