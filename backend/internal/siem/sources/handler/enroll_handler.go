package handler

import (
	"encoding/json"
	"net/http"

	"github.com/clario360/platform/internal/siem/sources/enroll"
)

// EnrollHandler hosts the two enrollment-token routes.
type EnrollHandler struct {
	d Deps
}

// NewEnrollHandler constructs an EnrollHandler.
func NewEnrollHandler(d Deps) *EnrollHandler { return &EnrollHandler{d: d} }

type enrollReq struct {
	Token  string `json:"token"`
	CSRPEM string `json:"csr_pem"`
}

// Enroll POST /api/v1/siem/sources/{id}/enroll
func (h *EnrollHandler) Enroll(w http.ResponseWriter, r *http.Request) {
	if h.d.Enroller == nil {
		writeErr(w, http.StatusServiceUnavailable, "enroll_disabled", "enrollment service not configured")
		return
	}
	var req enrollReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_json", err.Error())
		return
	}
	out, err := h.d.Enroller.Exchange(r.Context(), enroll.ExchangeInput{
		Token: req.Token, CSRPEM: req.CSRPEM, IP: clientIP(r),
	})
	if err != nil {
		writeServiceErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// RotateExchange POST /api/v1/siem/sources/{id}/rotate-cert/exchange
func (h *EnrollHandler) RotateExchange(w http.ResponseWriter, r *http.Request) {
	h.Enroll(w, r) // same Exchange pipeline; the JWT's `pur` claim distinguishes
}

func clientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Forwarded-For"); ip != "" {
		return ip
	}
	return r.RemoteAddr
}
