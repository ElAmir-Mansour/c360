'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  DEFAULT_LOCALE,
  getLocaleDirection,
  type AppDirection,
  type AppLocale,
} from '@/lib/i18n';
import {
  getMessages,
  readMessage,
  type AppMessages,
  type MessageKey,
} from '@/lib/i18n/messages';
import {
  createNamespacedTranslator,
  resolveBilingualBundle,
  type NamespacedTranslator,
} from '@/lib/i18n/registry';

interface LocaleContextValue {
  locale: AppLocale;
  direction: AppDirection;
  messages: AppMessages;
  t: (key: MessageKey) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

interface LocaleProviderProps {
  locale: AppLocale;
  direction: AppDirection;
  messages: AppMessages;
  children: ReactNode;
}

export function LocaleProvider({
  locale,
  direction,
  messages,
  children,
}: LocaleProviderProps) {
  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      direction,
      messages,
      t: (key) => readMessage(messages, key),
    }),
    [direction, locale, messages],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used within LocaleProvider');
  }

  return context;
}

/**
 * useT — the app's translator hook, in two forms:
 *
 *  - `useT()` (no argument) — UNCHANGED legacy contract: the typed global
 *    translator `(key: MessageKey) => string`. Throws without a
 *    LocaleProvider, exactly as before.
 *
 *  - `useT(namespace)` — the unified form: resolves a dot-path key against the
 *    namespace's registered bundle (see `registerMessages` in
 *    `@/lib/i18n/registry`), then the global catalog, then falls back to the
 *    key itself. Supports `{param}` interpolation via the second argument.
 *    Like `useLocaleOrDefault` (the convention module bundles already follow),
 *    the namespaced form does NOT throw without a provider — it resolves the
 *    default locale so isolated unit tests keep working.
 */
export function useT(): (key: MessageKey) => string;
export function useT(namespace: string): NamespacedTranslator;
export function useT(namespace?: string): ((key: MessageKey) => string) | NamespacedTranslator {
  const context = useContext(LocaleContext);
  if (!context && namespace === undefined) {
    throw new Error('useT must be used within LocaleProvider');
  }

  const locale = context?.locale ?? DEFAULT_LOCALE;
  const messages = context?.messages;

  return useMemo(() => {
    if (namespace === undefined) {
      // context is guaranteed above for the namespace-less form.
      return context!.t;
    }
    return createNamespacedTranslator(namespace, locale, messages ?? getMessages(locale));
  }, [context, namespace, locale, messages]);
}

/**
 * useBilingual — the single, canonical hook behind the per-module
 * `use<Feature>Labels()` pattern. Resolves a `{ en, ar }` bundle against the
 * active locale (default locale when no provider is mounted) and memoizes the
 * result, replacing the hand-rolled `useLocaleOrDefault` + `resolve*Bilingual`
 * body copy-pasted across the 46 `*-i18n.ts` files.
 */
export function useBilingual<T>(bundle: { readonly en: T; readonly ar: T }): T {
  const context = useContext(LocaleContext);
  const locale = context?.locale ?? DEFAULT_LOCALE;
  return useMemo(() => resolveBilingualBundle(bundle, locale), [bundle, locale]);
}

/**
 * useLocaleOrDefault is a non-throwing variant of useLocale. When no
 * LocaleProvider is mounted (e.g. an isolated unit test rendering a single form
 * field) it returns the configured default locale/direction/messages instead of
 * throwing, so components that only need the active locale for bilingual label
 * resolution stay testable in isolation.
 */
export function useLocaleOrDefault(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (context) {
    return context;
  }
  const locale = DEFAULT_LOCALE;
  const messages = getMessages(locale);
  return {
    locale,
    direction: getLocaleDirection(locale),
    messages,
    t: (key) => readMessage(messages, key),
  };
}
