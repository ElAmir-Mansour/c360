package dto

import "github.com/clario360/platform/internal/cyber/dspm/intelligence/model"

// FinancialRunResponse is returned by POST /dspm/financial/run. It carries the
// run record (with computed_at) plus the freshly-recomputed portfolio result
// that the GET endpoints now read.
type FinancialRunResponse struct {
	Run       model.FinancialRun   `json:"run"`
	Portfolio *model.PortfolioRisk `json:"portfolio"`
}

// FinancialImpactListParams controls financial impact queries.
type FinancialImpactListParams struct {
	MinBreachCost *float64 `json:"min_breach_cost,omitempty"`
	Regulation    *string  `json:"regulation,omitempty"`
	Sort          string   `json:"sort"`
	Order         string   `json:"order"`
	Page          int      `json:"page"`
	PerPage       int      `json:"per_page"`
}

// SetDefaults applies default values to financial impact list params.
func (p *FinancialImpactListParams) SetDefaults() {
	if p.Page < 1 {
		p.Page = 1
	}
	if p.PerPage < 1 || p.PerPage > 100 {
		p.PerPage = 25
	}
	if p.Sort == "" {
		p.Sort = "annual_expected_loss"
	}
	if p.Order == "" {
		p.Order = "desc"
	}
}
