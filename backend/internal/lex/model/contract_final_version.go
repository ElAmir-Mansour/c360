package model

import (
	"time"

	"github.com/google/uuid"
)

// ContractFinalVersionResult is the outcome of the review-desk final-version
// ceremony (CAP-117): the newly written current version, the new contract status
// (active), and the stamp recorded on contracts.final_uploaded_at. Prior
// contract_versions are superseded by ordering — the returned version is the new
// current (highest) version.
type ContractFinalVersionResult struct {
	ContractID      uuid.UUID        `json:"contract_id"`
	Version         *ContractVersion `json:"version"`
	PreviousStatus  ContractStatus   `json:"previous_status"`
	Status          ContractStatus   `json:"status"`
	FinalUploadedAt time.Time        `json:"final_uploaded_at"`
}
