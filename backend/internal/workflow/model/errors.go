package model

import "errors"

var (
	ErrNotFound         = errors.New("not found")
	ErrConflict         = errors.New("already exists")
	ErrConcurrencyConfl = errors.New("concurrency conflict: row was modified by another process")
	ErrTaskNotClaimable = errors.New("task is not in a claimable state")
	ErrTaskNotOwned     = errors.New("task is not owned by this user")

	// ErrNoOpenIncident is returned when an operator action targets an instance
	// that has no open incident to act on.
	ErrNoOpenIncident = errors.New("instance has no open incident")
	// ErrOverrideNotPending is returned when an approve/reject targets an override
	// that is not in the pending state.
	ErrOverrideNotPending = errors.New("override is not in a pending state")
	// ErrSameActorOverride is returned, fail-closed, when the operator approving a
	// sensitive override is the same actor that requested it (maker == checker),
	// violating separation of duties.
	ErrSameActorOverride = errors.New("separation-of-duties: the operator who requested an override may not approve it")
	// ErrOverrideRequired is returned when a sensitive operator action (skip /
	// modify-variables) is attempted without an approved maker-checker override.
	ErrOverrideRequired = errors.New("this operation requires an approved maker-checker override")
)
