package service

import "sync"

// instanceLockMap is a keyed mutex: it hands out one mutex per instance id so the
// engine can hold a short, in-process critical section around a single instance's
// state transition. It is the in-process half of the hot-path serialization
// (gap 3); the cross-process half is a Postgres advisory lock (see
// InstanceRepository.SerializeInstance).
//
// Mutexes are reference-counted so idle entries are reclaimed and the map does not
// grow without bound over the lifetime of a long-running engine.
type instanceLockMap struct {
	mu    sync.Mutex
	locks map[string]*refCountedMutex
}

type refCountedMutex struct {
	mu   sync.Mutex
	refs int
}

func newInstanceLockMap() *instanceLockMap {
	return &instanceLockMap{locks: make(map[string]*refCountedMutex)}
}

// lock acquires the mutex for key and returns an unlock function. The returned
// function MUST be called exactly once (typically via defer).
func (m *instanceLockMap) lock(key string) func() {
	m.mu.Lock()
	rc, ok := m.locks[key]
	if !ok {
		rc = &refCountedMutex{}
		m.locks[key] = rc
	}
	rc.refs++
	m.mu.Unlock()

	rc.mu.Lock()

	return func() {
		rc.mu.Unlock()

		m.mu.Lock()
		rc.refs--
		if rc.refs == 0 {
			delete(m.locks, key)
		}
		m.mu.Unlock()
	}
}
