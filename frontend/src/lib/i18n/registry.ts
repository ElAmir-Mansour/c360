/**
 * i18n namespace registry — the unification layer between the app's TWO
 * historical i18n systems:
 *
 *  1. The GLOBAL catalog (`src/lib/i18n/messages.ts`) consumed via `useT()` and
 *     dot-path `MessageKey`s ("shell.search").
 *  2. The 46 PER-MODULE bilingual bundles (`*-i18n.ts` files shaped
 *     `{ en: T, ar: T }`) consumed via `useLocaleOrDefault()` + a resolver such
 *     as `resolveLexBilingual` / `resolveCyberBilingual`.
 *
 * A module bundle calls {@link registerMessages}('cyber', { en, ar }) once at
 * module scope; every string leaf then becomes resolvable through the
 * namespaced translator returned by `useT('cyber')` (see
 * `components/providers/locale-provider.tsx`) with this resolution order:
 *
 *     namespace bundle  →  global catalog  →  the key itself
 *
 * BOTH legacy patterns keep working unchanged:
 *  - `useT()` (no namespace) still resolves the global catalog with the exact
 *    same typed `MessageKey` contract.
 *  - Module bundles keep their typed `{ en, ar }` constants and hooks; the
 *    generic {@link resolveBilingualBundle} (and the `useBilingual` hook in the
 *    locale provider) replace the per-suite copy-pasted resolvers.
 *
 * Registered trees may contain string leaves, `(args) => string` function
 * leaves (interpolating label factories) and string arrays. Only STRING leaves
 * are resolvable through the translator; function/array leaves remain
 * accessible through the module's own typed bundle.
 *
 * Pure and SSR-safe: no React, no DOM, no `Date.now()` at module scope, so it
 * can be consumed from server code (`createTranslator`-style) and unit tests.
 */

import { DEFAULT_LOCALE, normalizeLocale, type AppLocale } from '../i18n';
import { getMessages, readMessage, type AppMessages, type MessageKey } from './messages';

/** Values allowed at the leaves of a registered message tree. */
export type MessageLeaf = string | ReadonlyArray<string> | ((...args: never[]) => string);

/** A nested message tree (what a module bundle's `en` / `ar` side looks like). */
export type MessageTree = { [key: string]: MessageLeaf | MessageTree };

/** Interpolation parameters for `{placeholder}` tokens inside a message. */
export type MessageParams = Record<string, string | number>;

/**
 * A namespaced translator: resolves a dot-path key against the namespace
 * bundle, then the global catalog, then falls back to the key itself.
 * `params` interpolate `{name}` tokens in the resolved string.
 */
export type NamespacedTranslator = (key: string, params?: MessageParams) => string;

interface RegisteredBundle {
  en: unknown;
  ar: unknown;
}

/**
 * Module-scope registry. Re-registration (e.g. dev HMR re-evaluating a module)
 * deep-merges over the previous registration, so it is idempotent for
 * unchanged bundles and multiple files may contribute to one namespace
 * (the way several data-table components share the 'table' namespace).
 */
const registry = new Map<string, RegisteredBundle>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeTree(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = key in merged ? mergeTree(merged[key], value) : value;
  }
  return merged;
}

/**
 * Register (or extend) a namespace with a bilingual bundle. `T` is the module's
 * own typed label shape — both locale sides MUST be the same shape (the
 * established `LexBilingual` / `CyberBilingual` contract).
 */
export function registerMessages<T extends object>(
  namespace: string,
  bundle: { readonly en: T; readonly ar: T },
): void {
  const existing = registry.get(namespace);
  if (!existing) {
    registry.set(namespace, { en: bundle.en, ar: bundle.ar });
    return;
  }
  registry.set(namespace, {
    en: mergeTree(existing.en, bundle.en),
    ar: mergeTree(existing.ar, bundle.ar),
  });
}

/** True when a namespace has been registered. */
export function hasNamespace(namespace: string): boolean {
  return registry.has(namespace);
}

/** All registered namespace names (sorted, for tooling/coverage reports). */
export function listNamespaces(): string[] {
  return [...registry.keys()].sort();
}

/**
 * The raw registered `{ en, ar }` bundle for a namespace, typed by the caller.
 * Returns `undefined` when the namespace is unknown.
 */
export function getNamespaceBundle<T extends object = MessageTree>(
  namespace: string,
): { en: T; ar: T } | undefined {
  const bundle = registry.get(namespace);
  return bundle ? { en: bundle.en as T, ar: bundle.ar as T } : undefined;
}

/**
 * Generic bilingual resolver — the single implementation behind the per-suite
 * `resolveLexBilingual` / `resolveCyberBilingual` copies. Arabic resolves the
 * `ar` side; anything else resolves `en`.
 */
export function resolveBilingualBundle<T>(
  bundle: { readonly en: T; readonly ar: T },
  locale: AppLocale | string | null | undefined,
): T {
  return (normalizeLocale(typeof locale === 'string' ? locale : null) ?? DEFAULT_LOCALE) === 'ar'
    ? bundle.ar
    : bundle.en;
}

function readPath(tree: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((current, segment) => {
    if (!isPlainObject(current)) return undefined;
    return current[segment];
  }, tree);
}

/**
 * Interpolate `{name}` tokens in `template` from `params`. Unknown tokens are
 * left verbatim so a missing param is visible instead of silently vanishing.
 */
export function formatMessage(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (token, name: string) => {
    const value = params[name];
    return value === undefined ? token : String(value);
  });
}

/**
 * Resolve a dot-path key against ONE namespace for a locale. String leaves
 * only; falls back to the other locale side (mirroring `resolveLocalized`'s
 * cross-locale fallback) and returns `undefined` when the key is absent so
 * callers can continue down the resolution chain.
 */
export function readNamespaceMessage(
  namespace: string,
  locale: AppLocale | string | null | undefined,
  key: string,
): string | undefined {
  const bundle = registry.get(namespace);
  if (!bundle) return undefined;

  const resolved = normalizeLocale(typeof locale === 'string' ? locale : null) ?? DEFAULT_LOCALE;
  const primary = readPath(resolved === 'ar' ? bundle.ar : bundle.en, key);
  if (typeof primary === 'string' && primary.length > 0) {
    return primary;
  }
  const fallback = readPath(resolved === 'ar' ? bundle.en : bundle.ar, key);
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : undefined;
}

/**
 * Build a namespaced translator for a locale. Resolution order:
 *   1. the namespace bundle (string leaves, with cross-locale fallback);
 *   2. the GLOBAL catalog (so `useT('cyber')` can still resolve
 *      "shell.search" etc. without a second hook);
 *   3. the key itself (matching `readMessage`'s missing-key behaviour).
 *
 * Non-React contexts (route handlers, tests) can call this directly; React
 * components use `useT(namespace)` from the locale provider.
 */
export function createNamespacedTranslator(
  namespace: string,
  locale: AppLocale | string | null | undefined,
  messages?: AppMessages,
): NamespacedTranslator {
  const resolvedLocale =
    normalizeLocale(typeof locale === 'string' ? locale : null) ?? DEFAULT_LOCALE;
  const catalog = messages ?? getMessages(resolvedLocale);

  return (key, params) => {
    const fromNamespace = readNamespaceMessage(namespace, resolvedLocale, key);
    if (fromNamespace !== undefined) {
      return formatMessage(fromNamespace, params);
    }
    const fromGlobal = readMessage(catalog, key as MessageKey);
    if (fromGlobal !== key) {
      return formatMessage(fromGlobal, params);
    }
    return key;
  };
}
