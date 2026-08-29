'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  DEFAULT_MARKETING_LOCALE,
  getMarketingDirection,
  getMarketingMessages,
  readMarketingLocaleFromCookie,
  serializeMarketingLocaleCookie,
  type MarketingDirection,
  type MarketingLocale,
  type MarketingMessages,
} from '@/lib/marketing/messages';

interface MarketingLocaleContextValue {
  locale: MarketingLocale;
  dir: MarketingDirection;
  messages: MarketingMessages;
  setLocale: (locale: MarketingLocale) => void;
  toggleLocale: () => void;
}

const MarketingLocaleContext = createContext<MarketingLocaleContextValue | null>(
  null,
);

/**
 * Provides the marketing locale to the shell + home tree.
 *
 * SSR-safe: the first client render uses `initialLocale` (passed from the server
 * cookie read), matching the server output exactly — no hydration mismatch. A
 * post-mount effect then reconciles against the live cookie so pages that did
 * NOT thread the server value (interior pages) still honour a persisted Arabic
 * preference, swapping after hydration rather than mismatching during it.
 */
export function MarketingLocaleProvider({
  initialLocale = DEFAULT_MARKETING_LOCALE,
  children,
}: {
  initialLocale?: MarketingLocale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<MarketingLocale>(initialLocale);

  // Reconcile with the persisted cookie once mounted (covers pages that render
  // the shell without a server-resolved locale). Runs after hydration, so it
  // cannot cause a mismatch.
  useEffect(() => {
    const persisted = readMarketingLocaleFromCookie(
      typeof document === 'undefined' ? null : document.cookie,
    );
    if (persisted && persisted !== locale) {
      setLocaleState(persisted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback((next: MarketingLocale) => {
    if (typeof document !== 'undefined') {
      document.cookie = serializeMarketingLocaleCookie(next);
    }
    setLocaleState(next);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'ar' ? 'en' : 'ar');
  }, [locale, setLocale]);

  const value = useMemo<MarketingLocaleContextValue>(
    () => ({
      locale,
      dir: getMarketingDirection(locale),
      messages: getMarketingMessages(locale),
      setLocale,
      toggleLocale,
    }),
    [locale, setLocale, toggleLocale],
  );

  return (
    <MarketingLocaleContext.Provider value={value}>
      {children}
    </MarketingLocaleContext.Provider>
  );
}

export function useMarketingLocale(): MarketingLocaleContextValue {
  const ctx = useContext(MarketingLocaleContext);
  if (!ctx) {
    throw new Error(
      'useMarketingLocale must be used within a MarketingLocaleProvider',
    );
  }
  return ctx;
}
