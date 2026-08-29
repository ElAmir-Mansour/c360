import '@testing-library/jest-dom';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

configure({ asyncUtilTimeout: 30000 });

function createStorageMock(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear(): void {
      store.clear();
    },
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key) ?? null : null;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
  };
}

const localStorageMock = createStorageMock();
const sessionStorageMock = createStorageMock();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStorageMock,
});

Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: sessionStorageMock,
});

// Polyfill ResizeObserver for jsdom (required by Radix UI components)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Polyfill matchMedia for jsdom (required by next-themes' system-theme listener
// and any prefers-* media query checks).
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// Polyfill PointerEvent for Radix UI
if (!global.PointerEvent) {
  Object.defineProperty(globalThis, 'PointerEvent', {
    configurable: true,
    value: MouseEvent,
    writable: true,
  });
}

if (!global.IntersectionObserver) {
  class MockIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds = [0];

    disconnect(): void {}
    observe(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
    unobserve(): void {}
  }

  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: MockIntersectionObserver,
    writable: true,
  });
}

if (!HTMLElement.prototype.hasPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: () => false,
  });
}

if (!HTMLElement.prototype.setPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  });
}

if (!HTMLElement.prototype.releasePointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: () => undefined,
  });
}

if (!HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
}

// Radix dialogs and selects each install a FocusScope. jsdom dispatches focus
// transitions synchronously, so two nested scopes can try to focus each other
// recursively until the stack overflows. Browsers settle that transition
// without unbounded recursion. Guard only re-entrant calls; ordinary focus and
// user-event's focus patch still delegate to the native jsdom implementation.
const nativeFocus = HTMLElement.prototype.focus;
let focusTransitionInProgress = false;
Object.defineProperty(HTMLElement.prototype, 'focus', {
  configurable: true,
  writable: true,
  value(this: HTMLElement, options?: FocusOptions) {
    if (focusTransitionInProgress) return;
    focusTransitionInProgress = true;
    try {
      nativeFocus.call(this, options);
    } finally {
      focusTransitionInProgress = false;
    }
  },
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/',
  useParams: () => ({}),
  useSearchParams: () => ({
    get: (_key: string) => null,
    forEach: () => {},
  }),
  redirect: vi.fn(),
}));

vi.mock('@/hooks/use-oauth', () => ({
  useOAuthProviders: () => ({ data: [], isLoading: false, isError: false }),
  useOAuthConnections: () => ({ data: [], isLoading: false, isError: false }),
  useLinkOAuth: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlinkOAuth: () => ({ mutate: vi.fn(), isPending: false }),
  getOAuthAuthorizeUrl: (provider: string) => `http://localhost:8080/api/v1/auth/oauth/${provider}/authorize`,
}));

// Mock next/font/google
vi.mock('next/font/google', () => ({
  Fraunces: () => ({ className: 'mock-font', variable: 'mock-font-variable' }),
  Inter: () => ({ className: 'mock-font', variable: 'mock-font-variable' }),
}));

// Suppress console.error for expected React errors in tests
const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('Warning:') ||
      args[0].includes('Error: Not implemented') ||
      args[0].includes('Consider adding an error boundary'))
  ) {
    return;
  }
  originalError(...args);
};
