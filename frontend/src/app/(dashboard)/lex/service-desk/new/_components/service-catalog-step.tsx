'use client';

/**
 * ServiceCatalogStep — the Step-1 service-catalog selector for the Watheeq / Lex
 * "New Legal Service Request" wizard. Restyled to the stakeholder mockup
 * (STEP 1 — Select Service): a responsive 3-column GRID of service cards, each
 * with a light-brand icon tile, a bold bilingual name, a 2-line description, and
 * a clear radio marker. Selecting a card is the existing
 * service-selection behaviour (sets `serviceId`, which drives the eligibility
 * check + banner rendered by the parent step container).
 *
 * Controlled + presentational: it receives the LIVE catalog as a prop and never
 * fetches. The PARENT owns the fetch loading/error state and the eligibility
 * banner; this component only renders the catalog it is given.
 *
 * Behaviour:
 *  - Each card is a single-select radio (`role="radio"`, `aria-checked`, roving
 *    tabindex, arrow-key navigation, Enter/Space to select). The whole card is
 *    the one focusable/clickable control, so there are no nested controls.
 *  - An optional "Recently used" group surfaces `recentlyUsedIds` (order kept)
 *    ahead of the main grid.
 *  - A search field appears only for large catalogs (> SEARCH_THRESHOLD services)
 *    so the standard eight-service catalog matches the clean mockup grid.
 *  - Card icons prefer the mockup's per-service lucide glyphs, falling back to the
 *    shared request-type config; the icon tile tone is a uniform brand tint.
 *
 * Logical-direction CSS only (`ps-*`, `pe-*`, `start-*`, `me-*`, `text-start`) so
 * it mirrors correctly under RTL. Bilingual: shared strings come from the local
 * `service-catalog-i18n` table; step-local copy lives in `STEP1_STRINGS` below.
 */

import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  FileCheck2,
  FileSignature,
  Gavel,
  Inbox,
  MessageSquareQuote,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IconBadge } from '@/components/shared/icon-badge';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils';
import type { AppLocale } from '@/lib/i18n';
import type { ServiceCatalogEntry } from '@/lib/lex/requests';
import { filterServices, orderByRecentlyUsed } from '../_lib/service-catalog-utils';
import { getServiceTypeConfig } from '../_lib/service-type-config';
import { resolveCatalogCopy } from '../_lib/service-catalog-i18n';

export interface ServiceCatalogStepProps {
  /** The catalog to render. The parent supplies (and pre-filters) this list. */
  services: ServiceCatalogEntry[];
  /** Currently selected service id. */
  value: string;
  /** Invoked with the chosen service id when a card is selected. */
  onChange: (serviceId: string) => void;
  /** Validation error to surface beneath the catalog (destructive). */
  error?: string;
  /** Ids to surface in a "Recently used" group at the top (order preserved). */
  recentlyUsedIds?: string[];
  /** When provided, renders a "Clone from a previous request" affordance. */
  onClone?: () => void;
}

/** Above this many services the catalog gains a filter box; the standard 8 do not. */
const SEARCH_THRESHOLD = 8;

/* -------------------------------------------------------------------------- *
 * Step-local bilingual copy (EN / MSA AR). New strings this step needs live
 * here so the shared `labels.ts` bundle is never edited (avoids collisions).
 * Arabic is Saudi MSA — flag for the localization gate/termbase review.
 * -------------------------------------------------------------------------- */

interface Step1Copy {
  en: string;
  ar: string;
}

const STEP1_STRINGS = {
  instruction: {
    en: 'Not sure which one to choose? Pick the closest match — Legal Intake can re-route it.',
    ar: 'لست متأكدًا من الخدمة؟ اختر الأقرب إلى حاجتك، ويمكن لفريق الاستقبال القانوني إعادة توجيهها.',
  },
  selectService: { en: 'Select Service', ar: 'اختيار الخدمة' },
  selectedService: { en: 'Selected', ar: 'محددة' },
  allServices: { en: 'All services', ar: 'جميع الخدمات' },
} satisfies Record<string, Step1Copy>;

function step1Copy(key: keyof typeof STEP1_STRINGS, locale: AppLocale): string {
  const entry = STEP1_STRINGS[key];
  return locale === 'ar' ? entry.ar : entry.en;
}

/* -------------------------------------------------------------------------- *
 * Per-service icon mapping (mockup STEP 1). The backend catalog carries no icon
 * field, so the card derives its glyph from the service's `request_type` / `code`
 * token, preferring the mockup's suggested lucide icon and falling back to the
 * shared request-type config icon for any unmapped token. Keys are normalized to
 * lowercase; both the canonical tokens and the tokens the live backend emits
 * (`consultation`, `litigation`, `enforcement`, `investigation`) are covered.
 * -------------------------------------------------------------------------- */

const SERVICE_ICON_BY_TOKEN: Record<string, LucideIcon> = {
  // 1. Legal Consultation
  legal_consultation: MessageSquareQuote,
  consultation: MessageSquareQuote,
  // 2. Contract Review
  contract_review: FileCheck2,
  // 3. Preliminary Study (= Legal Opinion)
  legal_opinion: BookOpen,
  preliminary_study: BookOpen,
  // 4. Litigation Case Study
  litigation_support: Scale,
  litigation: Scale,
  // 5. Execution Request (= Enforcement)
  enforcement: Gavel,
  execution: Gavel,
  // 6. Investigation (= Violation Study)
  investigation: ShieldAlert,
  violation_study: ShieldAlert,
  // 7. Field Inspection
  field_inspection: Video,
  inspection: Video,
  // 8. Power of Attorney
  power_of_attorney: FileSignature,
};

/** Resolve the card icon: mockup glyph by request_type → by code → config fallback. */
function resolveServiceIcon(service: ServiceCatalogEntry): LucideIcon {
  const byType = SERVICE_ICON_BY_TOKEN[service.request_type?.toLowerCase() ?? ''];
  if (byType) return byType;
  const byCode = SERVICE_ICON_BY_TOKEN[service.code?.toLowerCase() ?? ''];
  if (byCode) return byCode;
  return getServiceTypeConfig(service.request_type).icon;
}

/**
 * ServiceCatalogStep is the default export consumed by the wizard's step 1. It
 * is internally controlled by the `search` field and externally controlled by
 * `value` / `onChange`.
 */
export default function ServiceCatalogStep({
  services,
  value,
  onChange,
  error,
  recentlyUsedIds,
  onClone,
}: ServiceCatalogStepProps) {
  const { locale } = useLocaleOrDefault();
  const groupId = useId();

  const [search, setSearch] = useState('');

  const showSearch = services.length > SEARCH_THRESHOLD;

  const filtered = useMemo(
    () => (showSearch ? filterServices(services, search, locale) : services),
    [services, search, locale, showSearch],
  );

  const recentItems = useMemo(() => {
    if (!recentlyUsedIds || recentlyUsedIds.length === 0) {
      return [];
    }
    return orderByRecentlyUsed(filtered, recentlyUsedIds);
  }, [filtered, recentlyUsedIds]);

  const recentIds = useMemo(
    () => new Set(recentItems.map((item) => item.id)),
    [recentItems],
  );

  // Main grid = everything not already surfaced in the "Recently used" group,
  // in catalog order (flat grid per the mockup — no category sub-headers).
  const mainItems = useMemo(
    () => filtered.filter((service) => !recentIds.has(service.id)),
    [filtered, recentIds],
  );

  // Flat, in-render order list of all rendered cards — drives roving keyboard
  // navigation across the "Recently used" group boundary.
  const orderedIds = useMemo(
    () => [...recentItems, ...mainItems].map((service) => service.id),
    [recentItems, mainItems],
  );

  const handleArrow = (currentId: string, delta: number) => {
    if (orderedIds.length === 0) return;
    const index = orderedIds.indexOf(currentId);
    const base = index === -1 ? 0 : index;
    const nextIndex = (base + delta + orderedIds.length) % orderedIds.length;
    const nextId = orderedIds[nextIndex];
    if (nextId) {
      onChange(nextId);
      focusCard(groupId, nextId);
    }
  };

  const hasServices = services.length > 0;
  const hasResults = filtered.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {step1Copy('instruction', locale)}
        </p>
        {onClone ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClone}
            className="self-start text-primary"
          >
            <Copy className="me-1.5 h-4 w-4" aria-hidden />
            {resolveCatalogCopy('cloneAffordance', locale)}
          </Button>
        ) : null}
      </div>

      {/* Search — only surfaced for large catalogs. */}
      {showSearch ? (
        <div className="relative">
          <Search
            className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={resolveCatalogCopy('searchPlaceholder', locale)}
            aria-label={resolveCatalogCopy('searchLabel', locale)}
            className="ps-9"
          />
        </div>
      ) : null}

      {/* Catalog */}
      {!hasServices ? (
        <CatalogEmptyState
          icon={Inbox}
          title={resolveCatalogCopy('emptyCatalogTitle', locale)}
          hint={resolveCatalogCopy('emptyCatalog', locale)}
        />
      ) : !hasResults ? (
        <CatalogEmptyState
          icon={Search}
          title={resolveCatalogCopy('noMatchesTitle', locale)}
          hint={resolveCatalogCopy('noMatches', locale).replace('{query}', search.trim())}
        />
      ) : (
        <div
          role="radiogroup"
          aria-label={step1Copy('instruction', locale)}
          className="space-y-6"
        >
          {recentItems.length > 0 ? (
            <ServiceGroup
              heading={resolveCatalogCopy('recentlyUsed', locale)}
              items={recentItems}
              value={value}
              groupId={groupId}
              orderedIds={orderedIds}
              locale={locale}
              onChange={onChange}
              onArrow={handleArrow}
            />
          ) : null}

          <ServiceGroup
            heading={recentItems.length > 0 ? step1Copy('allServices', locale) : undefined}
            items={mainItems}
            value={value}
            groupId={groupId}
            orderedIds={orderedIds}
            locale={locale}
            onChange={onChange}
            onArrow={handleArrow}
          />
        </div>
      )}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * Internal pieces.
 * -------------------------------------------------------------------------- */

interface ServiceGroupProps {
  /** Optional section header (only the "Recently used" group carries one). */
  heading?: string;
  items: ServiceCatalogEntry[];
  value: string;
  groupId: string;
  orderedIds: string[];
  locale: AppLocale;
  onChange: (serviceId: string) => void;
  onArrow: (currentId: string, delta: number) => void;
}

function ServiceGroup({
  heading,
  items,
  value,
  groupId,
  orderedIds,
  locale,
  onChange,
  onArrow,
}: ServiceGroupProps) {
  if (items.length === 0) return null;

  // Whether a card owns the single tab stop for the whole radiogroup: if nothing
  // is selected, the very first rendered card across all groups owns it.
  const firstId = orderedIds[0];
  return (
    <section className="space-y-3">
      {heading ? (
        <h3 className="text-xs font-semibold uppercase tracking-caps-wide text-muted-foreground">
          {heading}
        </h3>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((service) => {
          const selected = service.id === value;
          const tabStop = value ? selected : service.id === firstId;
          return (
            <ServiceCard
              key={service.id}
              service={service}
              selected={selected}
              tabStop={tabStop}
              groupId={groupId}
              locale={locale}
              onSelect={() => onChange(service.id)}
              onArrow={(delta) => onArrow(service.id, delta)}
            />
          );
        })}
      </div>
    </section>
  );
}

interface ServiceCardProps {
  service: ServiceCatalogEntry;
  selected: boolean;
  tabStop: boolean;
  groupId: string;
  locale: AppLocale;
  onSelect: () => void;
  onArrow: (delta: number) => void;
}

function ServiceCard({
  service,
  selected,
  tabStop,
  groupId,
  locale,
  onSelect,
  onArrow,
}: ServiceCardProps) {
  const name = resolveLocalized(service.name, locale);
  const description = resolveLocalized(service.description, locale);
  const icon = resolveServiceIcon(service);
  const approvalRequired =
    service.requester_approval_required || service.provider_approval_required;

  // ArrowRight/ArrowLeft report the PHYSICAL key regardless of layout direction,
  // so under RTL (ar) they are swapped to follow visual order (WAI-ARIA APG).
  // ArrowDown/ArrowUp advance in logical order and are never swapped.
  const isRtl = locale === 'ar';
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case ' ':
      case 'Enter':
        event.preventDefault();
        onSelect();
        break;
      case 'ArrowDown':
        event.preventDefault();
        onArrow(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        onArrow(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        onArrow(isRtl ? -1 : 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        onArrow(isRtl ? 1 : -1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      id={cardDomId(groupId, service.id)}
      role="radio"
      aria-checked={selected}
      aria-label={`${name}. ${step1Copy(selected ? 'selectedService' : 'selectService', locale)}`}
      tabIndex={tabStop ? 0 : -1}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      className={cn(
        'group flex h-full cursor-pointer flex-col rounded-2xl border bg-card p-4 text-start transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        selected
          ? 'border-primary bg-primary/[0.05] shadow-elevation-2 ring-1 ring-primary'
          : 'border-border/70 hover:border-primary/40 hover:shadow-elevation-2',
      )}
    >
      {/* Header: icon tile + name (+ approval hint) + selected check. */}
      <div className="flex items-start gap-3">
        <IconBadge icon={icon} tone="primary" size="lg" />
        <div className="min-w-0 flex-1 space-y-1">
          {/* break-words so long unbroken service codes (e.g. PW_UI_APPROVAL_…)
              wrap inside the card instead of overflowing into the next column;
              line-clamp-2 keeps card headers uniform. */}
          <p
            className="line-clamp-2 break-words font-semibold leading-snug text-foreground"
            title={name}
          >
            {name}
          </p>
          {approvalRequired ? (
            <span className="inline-flex items-center gap-1 text-caption font-medium text-warning-700 dark:text-warning-300">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              {resolveCatalogCopy('approvalRequired', locale)}
            </span>
          ) : null}
        </div>
        <span
          className={cn(
            'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors',
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card text-transparent group-hover:border-primary/60',
          )}
          aria-hidden
        >
          <Check className="h-4 w-4" />
        </span>
      </div>

      {/* 2-line description (min-height keeps card footers aligned across a row). */}
      {description ? (
        <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
          {description}
        </p>
      ) : (
        <div className="mt-3 min-h-[2.5rem]" aria-hidden />
      )}

    </div>
  );
}

/**
 * CatalogEmptyState — a centered icon + title + hint block for both the
 * empty-catalog and no-matches states. The icon is decorative; copy is supplied
 * by the caller (already localized).
 */
function CatalogEmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Search;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-muted/30 px-4 py-10 text-center">
      <span
        className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden
      >
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * Small internal helpers.
 * -------------------------------------------------------------------------- */

function cardDomId(groupId: string, serviceId: string): string {
  return `${groupId}-svc-${serviceId}`;
}

function focusCard(groupId: string, serviceId: string): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(cardDomId(groupId, serviceId));
  el?.focus();
}
