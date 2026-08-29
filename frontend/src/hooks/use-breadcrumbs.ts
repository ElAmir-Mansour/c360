'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { isUUID, segmentToLabel } from '@/config/breadcrumb-map';
import {
  findNavLocation,
  familyOf,
  resolveNavText,
  NAV_SEGMENT_LABELS,
  SUITES,
  type NavSection,
  type SuiteEntry,
} from '@/config/navigation';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { readMessage, type AppMessages, type MessageKey } from '@/lib/i18n/messages';

export interface Breadcrumb {
  label: string;
  href: string;
  isLast: boolean;
  isDynamic: boolean;
}

function readCatalogLabel(messages: AppMessages, key: string, fallback: string): string {
  const value = readMessage(messages, key as MessageKey);
  return value === key ? fallback : value;
}

/** `nav.<id>` catalog label with a config-string fallback (same as the sidebar). */
function navIdLabel(messages: AppMessages, id: string, fallback: string): string {
  return readCatalogLabel(messages, `nav.${id}`, fallback);
}

function localizedSegmentLabel(
  messages: AppMessages,
  locale: string,
  segments: string[],
  index: number,
): string {
  const segment = segments[index];
  const ids = [
    segments.slice(0, index + 1).join('-'),
    `${segments[0]}-${segment}`,
    segment,
  ];

  for (const id of ids) {
    const key = `nav.${id}`;
    const value = readMessage(messages, key as MessageKey);
    if (value !== key) {
      return value;
    }
  }

  const mapped = NAV_SEGMENT_LABELS[segment];
  if (mapped) return resolveNavText(mapped, locale);

  return segmentToLabel(segment);
}

/** Dynamic route params (record ids) collapse to a localized “Details” crumb. */
function isDynamicSegment(segment: string): boolean {
  return isUUID(segment) || /^\d+$/.test(segment);
}

/** Suite display name: catalog `nav.<segment>` → segment labels map → config label. */
function suiteLabel(messages: AppMessages, locale: string, suite: SuiteEntry): string {
  const key = `nav.${suite.segment}`;
  const catalog = readMessage(messages, key as MessageKey);
  if (catalog !== key) return catalog;
  const mapped = NAV_SEGMENT_LABELS[suite.segment];
  if (mapped) return resolveNavText(mapped, locale);
  return suite.label;
}

/**
 * Nav-item crumb label ladder: `nav.<id>` catalog entry → bilingual
 * `NAV_SEGMENT_LABELS` for the item's terminal segment → config label. Keeps
 * Arabic coverage for items the message catalog has not localized yet.
 */
function itemCrumbLabel(
  messages: AppMessages,
  locale: string,
  id: string,
  href: string,
  fallback: string,
): string {
  const key = `nav.${id}`;
  const catalog = readMessage(messages, key as MessageKey);
  if (catalog !== key) return catalog;
  const terminalSegment = href.split('/').filter(Boolean).pop() ?? '';
  const mapped = NAV_SEGMENT_LABELS[terminalSegment];
  if (mapped) return resolveNavText(mapped, locale);
  return fallback;
}

/**
 * A section crumb only adds information when its name is distinct from the
 * suite's (e.g. Cyber → “Threat intelligence”). Sections that restate the suite
 * (“Watheeq”, “Recover · Application recovery”, “Migrate · …”) are skipped.
 */
function sectionAddsContext(section: NavSection, suite: SuiteEntry): boolean {
  if (!section.label) return false;
  const normalized = section.label.toLowerCase();
  const suiteName = suite.label.toLowerCase();
  return normalized !== suiteName && !normalized.startsWith(suiteName);
}

/**
 * Breadcrumb trail for the current route, derived from the navigation config so
 * every suite renders a consistent `suite > section > page > detail` path:
 *
 *  - Suite routes anchor on the suite entry (family-aware: `/dr/*` resolves to
 *    Recover), then the owning nav section, then the matched item (and its
 *    parent group when nested), then any remaining segments.
 *  - Non-suite routes (admin, platform, workspace, console) walk the segments
 *    with the same label-resolution ladder: nav-config item ids → the bilingual
 *    `NAV_SEGMENT_LABELS` map → the `nav.*` message catalog → title-cased slug.
 *  - Dynamic id segments (UUIDs / numeric ids) render as a localized “Details”.
 *
 * Crumb hrefs are unique by construction (duplicates are dropped), so the trail
 * is safe to key by href.
 */
export function useBreadcrumbs(): Breadcrumb[] {
  const pathname = usePathname();
  const currentPath = pathname ?? '/dashboard';
  const { messages, locale } = useLocaleOrDefault();

  return useMemo(() => {
    const segments = currentPath.split('/').filter(Boolean);
    const homeLabel = readCatalogLabel(messages, 'shell.home', 'Home');
    const detailsLabel = readCatalogLabel(messages, 'shell.details', 'Details');

    if (segments.length === 0) {
      return [{ label: homeLabel, href: '/dashboard', isLast: true, isDynamic: false }];
    }

    const crumbs: Breadcrumb[] = [
      { label: homeLabel, href: '/dashboard', isLast: false, isDynamic: false },
    ];
    const push = (label: string, href: string, isDynamic = false) => {
      if (!label || crumbs.some((crumb) => crumb.href === href)) return;
      crumbs.push({ label, href, isLast: false, isDynamic });
    };

    const firstSegment = segments[0];
    const suite = SUITES.find((s) => s.segment === familyOf(firstSegment)) ?? null;

    // Index of segments already represented by config-driven crumbs; the
    // remaining (deeper) segments are appended with the per-segment ladder.
    let coveredDepth = 0;

    if (suite && firstSegment !== 'dashboard') {
      // ── Suite route: suite > section > (group >) page from the nav config ──
      // On the suite's own landing page the suite crumb restates "you are here"
      // (e.g. "Home › WatheeqTech" while already on /lex) — skip it there so
      // only "Home" remains and the bar collapses via Breadcrumbs' own
      // `crumbs.length <= 1` guard. Deeper suite pages are unaffected.
      const isSuiteRoot = currentPath === suite.href;
      if (!isSuiteRoot) {
        push(suiteLabel(messages, locale, suite), suite.href);
      }
      coveredDepth = 1;

      const location = findNavLocation(currentPath);
      if (location) {
        if (!isSuiteRoot) {
          if (sectionAddsContext(location.section, suite)) {
            const sectionHref = location.section.items[0]?.href;
            // The section crumb borrows its first item's route; drop it when that
            // collides with the page (or its parent group) to keep hrefs unique.
            if (
              sectionHref &&
              sectionHref !== location.item.href &&
              sectionHref !== location.parent?.href
            ) {
              push(
                navIdLabel(messages, location.section.id, location.section.label),
                sectionHref,
              );
            }
          }
          if (location.parent) {
            push(
              itemCrumbLabel(
                messages,
                locale,
                location.parent.id,
                location.parent.href,
                location.parent.label,
              ),
              location.parent.href,
            );
          }
          push(
            itemCrumbLabel(
              messages,
              locale,
              location.item.id,
              location.item.href,
              location.item.label,
            ),
            location.item.href,
          );
        }
        coveredDepth = Math.max(
          coveredDepth,
          location.item.href.split('/').filter(Boolean).length,
        );
      }
    }

    // ── Segment walk: non-suite routes entirely, suite routes past the match ──
    for (let i = coveredDepth; i < segments.length; i++) {
      const segment = segments[i];
      const accumulatedPath = '/' + segments.slice(0, i + 1).join('/');

      // Skip adding a "Dashboard" crumb when path starts with /dashboard
      // — the "Home" crumb already points there.
      if (accumulatedPath === '/dashboard') continue;

      if (isDynamicSegment(segment)) {
        push(detailsLabel, accumulatedPath, true);
        continue;
      }

      // Exact nav-config match for this depth (e.g. /workflows → “Workflows”,
      // /admin/ai-governance → “AI Governance”), localized like the sidebar.
      const location = findNavLocation(accumulatedPath);
      if (location && location.item.href === accumulatedPath) {
        // Root landing items ("Overview"-style ids) label the AREA crumb poorly;
        // prefer the area's own label for the first segment in that case.
        const mapped = NAV_SEGMENT_LABELS[segment];
        if (i === 0 && mapped) {
          push(resolveNavText(mapped, locale), accumulatedPath);
          continue;
        }
        push(
          itemCrumbLabel(
            messages,
            locale,
            location.item.id,
            location.item.href,
            location.item.label,
          ),
          accumulatedPath,
        );
        continue;
      }

      push(localizedSegmentLabel(messages, locale, segments, i), accumulatedPath);
    }

    // Ensure the last crumb is marked correctly after filtering.
    if (crumbs.length > 0) {
      crumbs[crumbs.length - 1].isLast = true;
    }

    return crumbs;
  }, [currentPath, messages, locale]);
}
