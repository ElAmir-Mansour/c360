'use client';

import { useMemo } from 'react';
import {
  Anchor,
  BadgeCheck,
  Lock,
  LayoutDashboard,
  Plug,
  Radar,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  ShieldHalf,
  Swords,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { PaletteCommand } from '@/stores/command-palette-store';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import type { DRCommandIntent } from './dr-command-intents';
import { resolveDRBilingual, type DRBilingual } from './dr-i18n';

/** Shape of the DR command-palette + hotkey copy (one full copy per locale). */
export interface DRCommandLabels {
  sections: {
    /** Group label for the jump-to-route commands. */
    navigation: string;
    /** Group label for the gated write actions. */
    actions: string;
  };
  nav: {
    overview: string;
    protect: string;
    recover: string;
    rehearse: string;
    prove: string;
    ledger: string;
    compliance: string;
    readiness: string;
    integrations: string;
    approvals: string;
    /** Deep link to the single in-flight recovery run (only when one exists). */
    activeRun: string;
  };
  actions: {
    declareFailover: string;
    rehearse: string;
    sealPoint: string;
    anchorLedger: string;
  };
}

/**
 * Bilingual copy for the DR command palette + hotkeys, resolved against the
 * active locale via {@link useDRCommandLabels} (React) or
 * {@link resolveDRCommandLabels} (pure). The "DR ·" prefix is a stable visual
 * namespace and is kept in both locales so the palette groups read consistently.
 */
export const drCommandLabels: DRBilingual<DRCommandLabels> = {
  en: {
    sections: {
      navigation: 'Recovery console',
      actions: 'Recovery actions',
    },
    nav: {
      overview: 'DR · Overview',
      protect: 'DR · Protect',
      recover: 'DR · Recover',
      rehearse: 'DR · Rehearse',
      prove: 'DR · Prove',
      ledger: 'DR · Attestation ledger',
      compliance: 'DR · Compliance',
      readiness: 'DR · Readiness',
      integrations: 'DR · Integrations',
      approvals: 'DR · Approvals',
      activeRun: 'DR · Open active recovery run',
    },
    actions: {
      declareFailover: 'Declare failover',
      rehearse: 'Rehearse (drill / game day)',
      sealPoint: 'Seal recovery point',
      anchorLedger: 'Anchor attestation ledger',
    },
  },
  ar: {
    sections: {
      navigation: 'وحدة التحكّم بالاسترداد',
      actions: 'إجراءات الاسترداد',
    },
    nav: {
      overview: 'الاسترداد · نظرة عامة',
      protect: 'الاسترداد · الحماية',
      recover: 'الاسترداد · الاسترداد',
      rehearse: 'الاسترداد · التمرين',
      prove: 'الاسترداد · الإثبات',
      ledger: 'الاسترداد · سجل الإثبات',
      compliance: 'الاسترداد · الامتثال',
      readiness: 'الاسترداد · الجاهزية',
      integrations: 'الاسترداد · التكاملات',
      approvals: 'الاسترداد · الموافقات',
      activeRun: 'الاسترداد · فتح عملية الاسترداد النشطة',
    },
    actions: {
      declareFailover: 'إعلان تجاوز الفشل',
      rehearse: 'التمرين (تدريب / يوم محاكاة)',
      sealPoint: 'ختم نقطة الاسترداد',
      anchorLedger: 'ترسية سجل الإثبات',
    },
  },
};

/** Pure resolver for the command labels; defaults to English (non-React/tests). */
export function resolveDRCommandLabels(locale: AppLocale = 'en'): DRCommandLabels {
  return resolveDRBilingual(drCommandLabels, locale === 'ar' ? 'ar' : 'en');
}

/**
 * React hook returning the command labels for the active locale (English under
 * the `renderWithQuery` `en` default), memoized by locale.
 */
export function useDRCommandLabels(): DRCommandLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRCommandLabels(locale), [locale]);
}

/** A static, navigation-only DR route entry (label resolved for a locale). */
interface DRNavRoute {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Extra match terms so an operator can find the route by its plain name. */
  keywords: string[];
}

/**
 * Locale-independent nav-route specs: everything except the user-facing label.
 * The label is resolved per-locale in {@link buildDRNavRoutes}.
 */
interface DRNavRouteSpec {
  id: string;
  /** Key into the resolved command labels' `nav` map. */
  labelKey: keyof DRCommandLabels['nav'];
  href: string;
  icon: LucideIcon;
  keywords: string[];
}

/**
 * The console routes a command-palette user can jump to. Mirrors the in-console
 * the DR operations console plus Recover lifecycle homes. Deep operational
 * routes that still live under `/dr` (approvals, active runs, readiness,
 * integrations) stay under `/dr`; lifecycle/product pages use their canonical
 * `/recover/it-dr/*` routes.
 */
const DR_NAV_ROUTE_SPECS: DRNavRouteSpec[] = [
  {
    id: 'dr-nav-overview',
    labelKey: 'overview',
    href: '/dr',
    icon: LayoutDashboard,
    keywords: ['overview', 'recovery', 'console', 'dr'],
  },
  {
    id: 'dr-nav-protect',
    labelKey: 'protect',
    href: '/dr/protect',
    icon: ShieldCheck,
    keywords: ['protect', 'replication', 'streams'],
  },
  {
    id: 'dr-nav-recover',
    labelKey: 'recover',
    href: '/recover/it-dr/recover',
    icon: Swords,
    keywords: ['recover', 'failover', 'runs'],
  },
  {
    id: 'dr-nav-rehearse',
    labelKey: 'rehearse',
    href: '/recover/it-dr/rehearse',
    icon: RotateCcw,
    keywords: ['rehearse', 'drill', 'game day', 'agents'],
  },
  {
    id: 'dr-nav-prove',
    labelKey: 'prove',
    href: '/recover/it-dr/prove',
    icon: BadgeCheck,
    keywords: ['prove', 'evidence', 'attestation', 'pir'],
  },
  {
    id: 'dr-nav-ledger',
    labelKey: 'ledger',
    href: '/recover/it-dr/prove/ledger',
    icon: ScrollText,
    keywords: ['ledger', 'attestation', 'inclusion proof'],
  },
  {
    id: 'dr-nav-compliance',
    labelKey: 'compliance',
    href: '/recover/it-dr/prove/compliance',
    icon: BadgeCheck,
    keywords: ['compliance', 'bcm', 'controls'],
  },
  {
    id: 'dr-nav-readiness',
    labelKey: 'readiness',
    href: '/dr/readiness',
    icon: Radar,
    keywords: ['readiness', 'sovereign', 'self-dr', 'byok'],
  },
  {
    id: 'dr-nav-integrations',
    labelKey: 'integrations',
    href: '/dr/integrations',
    icon: Plug,
    keywords: ['integrations', 'connectors'],
  },
  {
    id: 'dr-nav-approvals',
    labelKey: 'approvals',
    href: '/dr/approvals',
    icon: Workflow,
    keywords: ['approvals', 'gates', 'sign-off'],
  },
];

/** Resolve the nav routes' user-facing labels for the given command labels. */
export function buildDRNavRoutes(labels: DRCommandLabels): DRNavRoute[] {
  return DR_NAV_ROUTE_SPECS.map((spec) => ({
    id: spec.id,
    label: labels.nav[spec.labelKey],
    href: spec.href,
    icon: spec.icon,
    keywords: spec.keywords,
  }));
}

/**
 * English-resolved nav routes, kept as a stable named export for non-React /
 * test consumers that only need the route ids/hrefs/keywords (the user-facing
 * label here is English; React surfaces resolve per-locale via the hook).
 */
export const DR_NAV_ROUTES: DRNavRoute[] = buildDRNavRoutes(resolveDRCommandLabels('en'));

/** Inputs the registrar threads into the command builder. */
export interface BuildDRCommandsArgs {
  /** Resolved command-palette labels for the active locale. */
  labels: DRCommandLabels;
  /** Whether the operator holds `dr:write` (gates every action command). */
  canWrite: boolean;
  /** The single in-flight recovery run id, or `null` when nothing is live. */
  activeRunId: string | null;
  /** Raises a write-action intent for the command bar to fulfil. */
  requestIntent: (intent: DRCommandIntent) => void;
  /** Routes to a path (used by Declare failover to land on the overview). */
  navigate: (href: string) => void;
}

/** The route path for a recovery run's live war-room view. */
export function activeRunHref(runId: string): string {
  return `/dr/runs/${encodeURIComponent(runId)}`;
}

/**
 * Build the full set of DR commands to register into the global palette.
 *
 * Navigation commands are always present. The "open active recovery run" command
 * is included only while a run is live. Write actions are included only when the
 * operator holds `dr:write` (so they are hidden — not merely disabled — without
 * the permission), and each raises a real intent fulfilled by the command bar.
 */
export function buildDRCommands({
  labels,
  canWrite,
  activeRunId,
  requestIntent,
  navigate,
}: BuildDRCommandsArgs): PaletteCommand[] {
  const commands: PaletteCommand[] = buildDRNavRoutes(labels).map((route) => ({
    id: route.id,
    label: route.label,
    section: labels.sections.navigation,
    icon: route.icon,
    href: route.href,
    keywords: route.keywords,
  }));

  if (activeRunId) {
    commands.push({
      id: 'dr-nav-active-run',
      label: labels.nav.activeRun,
      section: labels.sections.navigation,
      icon: Swords,
      href: activeRunHref(activeRunId),
      keywords: ['run', 'war room', 'live', 'in-flight'],
    });
  }

  if (canWrite) {
    commands.push(
      {
        id: 'dr-action-declare-failover',
        label: labels.actions.declareFailover,
        section: labels.sections.actions,
        icon: Swords,
        keywords: ['failover', 'cutover', 'declare'],
        run: () => {
          // Land on the overview, then open the guided wizard via the command
          // bar (mounted on every route, so the wizard opens regardless).
          navigate('/dr');
          requestIntent('declare-failover');
        },
      },
      {
        id: 'dr-action-rehearse',
        label: labels.actions.rehearse,
        section: labels.sections.actions,
        icon: ShieldHalf,
        keywords: ['rehearse', 'drill', 'game day'],
        run: () => requestIntent('rehearse'),
      },
      {
        id: 'dr-action-seal-point',
        label: labels.actions.sealPoint,
        section: labels.sections.actions,
        icon: Lock,
        keywords: ['seal', 'recovery point', 'snapshot'],
        run: () => requestIntent('seal-recovery-point'),
      },
      {
        id: 'dr-action-anchor-ledger',
        label: labels.actions.anchorLedger,
        section: labels.sections.actions,
        icon: Anchor,
        keywords: ['anchor', 'ledger', 'attestation', 'checkpoint'],
        run: () => requestIntent('anchor-ledger'),
      },
    );
  }

  return commands;
}
