package service

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/auth"
)

// RoleMatrixPersonaReader implements PersonaRoleReader against the platform_core
// pool (where the roles table lives). It surfaces the caller's activated-import
// roles — custom roles as new personas, deactivated roles as tombstones — so
// the /lex/me persona contract matches what the enforcement overlay actually
// enforces. Reserved platform slugs are never returned (the import pipeline
// cannot create them, and the persona layer must not offer them as legal
// personas).
type RoleMatrixPersonaReader struct {
	pool *pgxpool.Pool
}

// NewRoleMatrixPersonaReader binds the reader to the platform_core pool.
func NewRoleMatrixPersonaReader(pool *pgxpool.Pool) *RoleMatrixPersonaReader {
	return &RoleMatrixPersonaReader{pool: pool}
}

func (r *RoleMatrixPersonaReader) ImportRoles(ctx context.Context, tenantID uuid.UUID, heldSlugs []string) ([]PersonaImportRole, error) {
	if r == nil || r.pool == nil || len(heldSlugs) == 0 {
		return nil, nil
	}
	// Normalize held slugs to the hyphen form used by import slugs (the JWT may
	// carry underscore-normalized slugs; import role slugs are always hyphenated
	// per the validator), so an underscore-form held slug still matches its
	// import row — mirroring the built-in persona path's normalizePersonaSlug.
	normalized := make([]string, 0, len(heldSlugs))
	seen := make(map[string]bool, len(heldSlugs))
	for _, s := range heldSlugs {
		n := strings.ReplaceAll(strings.TrimSpace(s), "_", "-")
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		normalized = append(normalized, n)
	}
	if len(normalized) == 0 {
		return nil, nil
	}
	rows, err := r.pool.Query(ctx, `
SELECT slug, name, metadata, active
FROM roles
WHERE tenant_id = $1 AND source = 'import' AND matrix_version IS NOT NULL AND slug = ANY($2)`,
		tenantID, normalized)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]PersonaImportRole, 0)
	for rows.Next() {
		var (
			slug, name string
			metaJSON   []byte
			active     bool
		)
		if err := rows.Scan(&slug, &name, &metaJSON, &active); err != nil {
			return nil, err
		}
		// Defence in depth: never surface a reserved platform slug as a legal
		// persona (the import pipeline rejects them, but honour the contract).
		if auth.IsReservedRoleSlug(slug) {
			continue
		}
		var meta struct {
			NameAR          string `json:"name_ar"`
			Tier            string `json:"tier"`
			OrgUnit         string `json:"org_unit"`
			EscalationLevel int    `json:"escalation_level"`
		}
		if len(metaJSON) > 0 {
			_ = json.Unmarshal(metaJSON, &meta) // metadata is best-effort display data
		}
		out = append(out, PersonaImportRole{
			Slug:            slug,
			NameEN:          name,
			NameAR:          meta.NameAR,
			Tier:            meta.Tier,
			OrgUnit:         meta.OrgUnit,
			EscalationLevel: meta.EscalationLevel,
			Active:          active,
		})
	}
	return out, rows.Err()
}
