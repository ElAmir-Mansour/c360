package service

import (
	"context"
	"errors"
	"strings"
)

func isShutdownError(err error) bool {
	return errors.Is(err, context.Canceled) ||
		errors.Is(err, context.DeadlineExceeded) ||
		strings.Contains(err.Error(), "closed pool")
}
