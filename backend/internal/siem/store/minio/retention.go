package minio

import (
	"fmt"
	"time"

	"github.com/clario360/platform/internal/siem/store/storetypes"
)

// DefaultRetentionYears returns the regulator-mandated retention floor for
// each known data class. Unknown classes fall back to 7 years (the NDPA
// default for personal data records).
func DefaultRetentionYears(class storetypes.DataClass) int {
	switch class {
	case storetypes.DataClassSwift, storetypes.DataClassRTGS:
		return 10
	case storetypes.DataClassPII, storetypes.DataClassCardholder:
		return 7
	case storetypes.DataClassInternal:
		return 3
	case storetypes.DataClassPublic:
		return 1
	default:
		return 7
	}
}

// EffectiveRetention returns the retention period to apply. callerYears may
// only extend the class default — never shorten. Returns ErrRetentionTooShort
// if callerYears > 0 and callerYears < default.
func EffectiveRetention(class storetypes.DataClass, callerYears int) (time.Duration, int, error) {
	def := DefaultRetentionYears(class)
	if callerYears > 0 && callerYears < def {
		return 0, 0, fmt.Errorf("%w: class=%s caller_years=%d default=%d",
			ErrRetentionTooShort, class, callerYears, def)
	}
	years := def
	if callerYears > def {
		years = callerYears
	}
	return time.Duration(years) * 365 * 24 * time.Hour, years, nil
}
