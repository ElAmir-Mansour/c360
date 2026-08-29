// Tests for the CROSS-TAB serialization layer of session-refresh.
//
// jsdom has no navigator.locks, so the integration suite only ever exercises
// the no-lock fallback. Here we install a faithful FIFO fake and — crucially —
// import the module TWICE via vi.resetModules() to simulate two tabs: each
// "tab" has its own in-tab promise chain, so any mutual exclusion observed
// between them is provided by the Web Lock alone.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type SessionRefreshModule = typeof import('@/lib/session-refresh');

/** Minimal Web Locks fake: exclusive FIFO queue per lock name, released when
 *  the callback's promise settles — the semantics the production code relies on. */
class FakeLockManager {
  private queues = new Map<string, Promise<unknown>>();

  request<T>(name: string, cb: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(name) ?? Promise.resolve();
    const run = prev.then(cb, cb);
    this.queues.set(
      name,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }
}

function installFakeLocks(): FakeLockManager {
  const manager = new FakeLockManager();
  Object.defineProperty(navigator, 'locks', {
    value: manager,
    configurable: true,
  });
  return manager;
}

function removeLocks(): void {
  Object.defineProperty(navigator, 'locks', {
    value: undefined,
    configurable: true,
  });
}

async function importTwoTabs(): Promise<[SessionRefreshModule, SessionRefreshModule]> {
  vi.resetModules();
  const tabA = (await import('@/lib/session-refresh')) as SessionRefreshModule;
  vi.resetModules();
  const tabB = (await import('@/lib/session-refresh')) as SessionRefreshModule;
  return [tabA, tabB];
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('session-refresh cross-tab lock', () => {
  beforeEach(() => {
    installFakeLocks();
  });
  afterEach(() => {
    removeLocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('two tabs never overlap a session op: the lock is held until the op settles', async () => {
    const [tabA, tabB] = await importTwoTabs();

    const events: string[] = [];
    const gateA = deferred<void>();

    // Tab A's op enters and blocks until we release it.
    const opA = tabA.serializeSessionOp(async () => {
      events.push('A:enter');
      await gateA.promise;
      events.push('A:exit');
    });
    // Give A's lock request a chance to be granted first.
    await Promise.resolve();

    // Tab B's op — a DIFFERENT module instance, so only the fake Web Lock can
    // order it behind A.
    const opB = tabB.serializeSessionOp(async () => {
      events.push('B:enter');
      events.push('B:exit');
    });

    // B must not have entered while A holds the lock.
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(['A:enter']);

    gateA.resolve();
    await Promise.all([opA, opB]);
    expect(events).toEqual(['A:enter', 'A:exit', 'B:enter', 'B:exit']);
  });

  it('a lock-request rejection maps to a transient result, never a logout', async () => {
    // locks.request itself can reject (document torn down / bfcache).
    Object.defineProperty(navigator, 'locks', {
      value: {
        request: () => Promise.reject(new DOMException('InvalidStateError')),
      },
      configurable: true,
    });
    vi.resetModules();
    const mod = (await import('@/lib/session-refresh')) as SessionRefreshModule;

    // fetch must never be reached; guard against it resolving the op anyway.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('fetch should not be called'))),
    );

    const result = await mod.refreshAccessToken(true);
    expect(result).toEqual({ status: 'transient' });
  });

  it('without navigator.locks the op still runs (fallback path)', async () => {
    removeLocks();
    vi.resetModules();
    const mod = (await import('@/lib/session-refresh')) as SessionRefreshModule;

    let ran = false;
    await mod.serializeSessionOp(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
