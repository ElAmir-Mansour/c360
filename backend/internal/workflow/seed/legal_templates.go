// Package seed provides data-driven workflow template catalog content. The
// golden legal templates live as versioned JSON (legal_templates.json) and are
// loaded into the engine's catalog/table rather than hard-coded in Go.
package seed

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"sort"

	"github.com/clario360/platform/internal/workflow/model"
)

// legalTemplatesFS embeds the golden legal_templates.json (which pins the JSON
// schema) AND the legal_templates/ directory of template packs (pack-*.json).
// Each pack is a bare JSON array of catalog entries; the golden file is an
// object with a `templates` array. loadCatalogEntries normalizes both shapes.
//
//go:embed legal_templates.json legal_templates
var legalTemplatesFS embed.FS

// catalogFile is the on-disk shape of legal_templates.json: a list of catalog
// entries, each carrying bilingual display strings plus a WorkflowDefinition
// blueprint under `definition`.
type catalogFile struct {
	Templates []catalogEntry `json:"templates"`
}

type catalogEntry struct {
	ID              string            `json:"id"`
	TenantID        string            `json:"tenant_id"`
	Category        string            `json:"category"`
	Icon            string            `json:"icon"`
	Tags            []string          `json:"tags"`
	NameI18n        map[string]string `json:"name_i18n"`
	DescriptionI18n map[string]string `json:"description_i18n"`
	// Definition is the raw WorkflowDefinition blueprint. It is kept as
	// json.RawMessage so it can be stored verbatim as the template's
	// definition_json, and separately parsed to validate against the engine.
	Definition json.RawMessage `json:"definition"`
}

// loadCatalogEntries reads the golden legal_templates.json and every pack-*.json
// under the embedded legal_templates/ directory, normalizing the two on-disk
// shapes (object-with-`templates`, or bare array) into a single catalog list.
// Entries are deduped by template id (first occurrence wins) and the files are
// read in a deterministic (sorted) order so the merge is stable.
func loadCatalogEntries() ([]catalogEntry, error) {
	// Collect the set of JSON files: the golden file plus the pack directory.
	files := []string{"legal_templates.json"}

	dirEntries, err := fs.ReadDir(legalTemplatesFS, "legal_templates")
	if err != nil {
		return nil, fmt.Errorf("reading legal_templates dir: %w", err)
	}
	var packs []string
	for _, de := range dirEntries {
		name := de.Name()
		if de.IsDir() || len(name) < 5 || name[len(name)-5:] != ".json" {
			continue
		}
		packs = append(packs, "legal_templates/"+name)
	}
	sort.Strings(packs)
	files = append(files, packs...)

	seen := make(map[string]bool)
	var out []catalogEntry
	for _, path := range files {
		raw, err := legalTemplatesFS.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("reading %s: %w", path, err)
		}
		entries, err := parseCatalogShape(raw)
		if err != nil {
			return nil, fmt.Errorf("parsing %s: %w", path, err)
		}
		for _, e := range entries {
			if e.ID != "" && seen[e.ID] {
				continue // dedupe by template id; first occurrence wins.
			}
			if e.ID != "" {
				seen[e.ID] = true
			}
			out = append(out, e)
		}
	}
	return out, nil
}

// parseCatalogShape accepts either the object shape ({"templates":[...]}) used by
// the golden file or a bare JSON array of catalog entries used by the packs.
func parseCatalogShape(raw []byte) ([]catalogEntry, error) {
	trimmed := raw
	for len(trimmed) > 0 && (trimmed[0] == ' ' || trimmed[0] == '\n' || trimmed[0] == '\t' || trimmed[0] == '\r') {
		trimmed = trimmed[1:]
	}
	if len(trimmed) > 0 && trimmed[0] == '[' {
		var arr []catalogEntry
		if err := json.Unmarshal(raw, &arr); err != nil {
			return nil, err
		}
		return arr, nil
	}
	var file catalogFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return nil, err
	}
	return file.Templates, nil
}

// LegalTemplates parses the embedded legal_templates.json into catalog-ready
// WorkflowTemplate values. The flat Name/Description fields are populated from
// the bilingual maps (English preferred) for back-compat with the in-process
// catalog consumers; the bilingual maps are retained for the data-driven path.
func LegalTemplates() ([]*model.WorkflowTemplate, error) {
	entries, err := loadCatalogEntries()
	if err != nil {
		return nil, err
	}

	out := make([]*model.WorkflowTemplate, 0, len(entries))
	for _, e := range entries {
		if e.ID == "" {
			return nil, fmt.Errorf("legal template missing id")
		}
		if len(e.Definition) == 0 {
			return nil, fmt.Errorf("legal template %q missing definition", e.ID)
		}
		tmpl := &model.WorkflowTemplate{
			ID:              e.ID,
			TenantScope:     e.TenantID, // empty == global
			NameI18n:        e.NameI18n,
			DescriptionI18n: e.DescriptionI18n,
			Name:            preferEN(e.NameI18n),
			Description:     preferEN(e.DescriptionI18n),
			Category:        e.Category,
			Icon:            e.Icon,
			Tags:            e.Tags,
			Version:         1,
			DefinitionJSON:  []byte(e.Definition),
		}
		out = append(out, tmpl)
	}
	return out, nil
}

// LegalTemplateDefinitions parses each entry's `definition` into a concrete
// WorkflowDefinition. Used by the seed-smoke test to assert every catalog
// template passes the engine's ValidateDefinition before it ships.
func LegalTemplateDefinitions() (map[string]*model.WorkflowDefinition, error) {
	entries, err := loadCatalogEntries()
	if err != nil {
		return nil, err
	}

	out := make(map[string]*model.WorkflowDefinition, len(entries))
	for _, e := range entries {
		var def model.WorkflowDefinition
		if err := json.Unmarshal(e.Definition, &def); err != nil {
			return nil, fmt.Errorf("parsing definition for template %q: %w", e.ID, err)
		}
		out[e.ID] = &def
	}
	return out, nil
}

// preferEN returns the en value, falling back to ar, then any present value.
func preferEN(m map[string]string) string {
	if m == nil {
		return ""
	}
	if v := m["en"]; v != "" {
		return v
	}
	if v := m["ar"]; v != "" {
		return v
	}
	for _, v := range m {
		if v != "" {
			return v
		}
	}
	return ""
}
