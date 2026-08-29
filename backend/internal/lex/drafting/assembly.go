package drafting

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// AID-08: smart template assembly with conditional clause logic. This is fully
// deterministic (no LLM): each section may carry a guard condition evaluated
// against the supplied variables, and {{placeholder}} tokens are substituted.

type TemplateSection struct {
	ID        string `json:"id"`
	Heading   string `json:"heading"`
	Body      string `json:"body"`
	Condition string `json:"condition,omitempty"` // e.g. "include_arbitration == true", "tier", "!is_draft"
}

type AssembleRequest struct {
	Sections  []TemplateSection `json:"sections"`
	Variables map[string]any    `json:"variables"`
}

type AssemblyResult struct {
	Document         string   `json:"document"`
	IncludedSections []string `json:"included_sections"`
	SkippedSections  []string `json:"skipped_sections"`
	UnresolvedVars   []string `json:"unresolved_vars"`
}

var placeholderRE = regexp.MustCompile(`\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}`)

// Assemble evaluates each section's condition, substitutes placeholders, and
// concatenates the surviving sections. It is pure and side-effect free.
func Assemble(req AssembleRequest) (*AssemblyResult, error) {
	if len(req.Sections) == 0 {
		return nil, fmt.Errorf("at least one section is required")
	}
	vars := req.Variables
	if vars == nil {
		vars = map[string]any{}
	}
	res := &AssemblyResult{}
	unresolved := map[string]struct{}{}
	var b strings.Builder
	for _, sec := range req.Sections {
		id := sec.ID
		if strings.TrimSpace(id) == "" {
			id = strings.TrimSpace(sec.Heading)
		}
		include, err := evalCondition(sec.Condition, vars)
		if err != nil {
			return nil, fmt.Errorf("section %q: %w", id, err)
		}
		if !include {
			res.SkippedSections = append(res.SkippedSections, id)
			continue
		}
		heading := substitute(sec.Heading, vars, unresolved)
		body := substitute(sec.Body, vars, unresolved)
		if strings.TrimSpace(heading) != "" {
			b.WriteString(heading)
			b.WriteString("\n")
		}
		b.WriteString(body)
		b.WriteString("\n\n")
		res.IncludedSections = append(res.IncludedSections, id)
	}
	res.Document = strings.TrimRight(b.String(), "\n")
	for k := range unresolved {
		res.UnresolvedVars = append(res.UnresolvedVars, k)
	}
	sort.Strings(res.UnresolvedVars)
	return res, nil
}

func substitute(text string, vars map[string]any, unresolved map[string]struct{}) string {
	return placeholderRE.ReplaceAllStringFunc(text, func(m string) string {
		key := strings.TrimSpace(placeholderRE.FindStringSubmatch(m)[1])
		if v, ok := vars[key]; ok {
			return fmt.Sprintf("%v", v)
		}
		unresolved[key] = struct{}{}
		return m // leave the placeholder visible so the gap is obvious
	})
}

// evalCondition supports a deliberately small, safe grammar:
//
//	""                -> always true
//	"var"             -> truthy(var)
//	"!var"            -> !truthy(var)
//	"var == value"    -> string-equal
//	"var != value"    -> not string-equal
func evalCondition(cond string, vars map[string]any) (bool, error) {
	cond = strings.TrimSpace(cond)
	if cond == "" {
		return true, nil
	}
	for _, op := range []string{"==", "!="} {
		if idx := strings.Index(cond, op); idx >= 0 {
			lhs := strings.TrimSpace(cond[:idx])
			rhs := strings.Trim(strings.TrimSpace(cond[idx+len(op):]), `"'`)
			actual := fmt.Sprintf("%v", vars[lhs])
			eq := actual == rhs
			if op == "==" {
				return eq, nil
			}
			return !eq, nil
		}
	}
	negate := false
	if strings.HasPrefix(cond, "!") {
		negate = true
		cond = strings.TrimSpace(cond[1:])
	}
	t := truthy(vars[cond])
	if negate {
		return !t, nil
	}
	return t, nil
}

func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		s := strings.ToLower(strings.TrimSpace(x))
		return s != "" && s != "false" && s != "0" && s != "no"
	case float64:
		return x != 0
	case int:
		return x != 0
	default:
		return true
	}
}
