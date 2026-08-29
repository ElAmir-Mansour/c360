package main

import (
	"testing"
	"time"

	auditcfg "github.com/clario360/platform/internal/audit/config"
	"github.com/clario360/platform/internal/config"
)

func TestBuildAuditPoolConfigUsesAuditDSN(t *testing.T) {
	cfg := &config.Config{}
	cfg.Database.ConnMaxLifetime = 42 * time.Minute
	auditCfg := &auditcfg.Config{
		DBMinConns: 3,
		DBMaxConns: 17,
	}
	auditDSN := "postgres://audit:secret@db.internal:5432/audit_db?sslmode=require"

	poolCfg := buildAuditPoolConfig(cfg, auditCfg, auditDSN)

	if poolCfg.URL != auditDSN {
		t.Fatalf("pool URL = %q, want audit DSN %q", poolCfg.URL, auditDSN)
	}
	if poolCfg.MinConns != auditCfg.DBMinConns {
		t.Fatalf("min conns = %d, want %d", poolCfg.MinConns, auditCfg.DBMinConns)
	}
	if poolCfg.MaxConns != auditCfg.DBMaxConns {
		t.Fatalf("max conns = %d, want %d", poolCfg.MaxConns, auditCfg.DBMaxConns)
	}
	if poolCfg.MaxConnLife != cfg.Database.ConnMaxLifetime {
		t.Fatalf("max conn life = %s, want %s", poolCfg.MaxConnLife, cfg.Database.ConnMaxLifetime)
	}
}
