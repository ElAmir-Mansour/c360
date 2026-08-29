/**
 * Single source of truth for the Watheeq Legal-Affairs command-center DOMAIN
 * TILES (18). Every tile in the `/lex` landing page is rendered from this
 * ordered list so the grid, the count fan-out
 * ({@link import('./use-lex-command-center').useLexDomainCounts}), and the
 * permission gating all stay in lockstep with one declaration.
 *
 * `labelKey` indexes the i18n bundle under `domains.<id>` (resolved by the
 * suite's `useLexLabels()` — owned by `lex-i18n.ts`, integrated by the page
 * builder, NOT this file). `icon` is a lucide-react component (each distinct —
 * no duplicate `Scale`). `hasCount` flags whether the domain exposes a numeric
 * badge (drafting/reports/admin are navigational only).
 *
 * Order: active work first, then library/knowledge, then ops/governance.
 */

import {
  BarChart3,
  BookMarked,
  BookText,
  File,
  FileCheck2,
  FileText,
  Gavel,
  Handshake,
  Inbox,
  ListChecks,
  MessagesSquare,
  Scale,
  ShieldCheck,
  ShieldQuestion,
  Settings2,
  Sparkles,
  Workflow,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';

/** Restrained categorical palette used to distinguish domain families. */
export type LexDomainTone =
  | 'primary'
  | 'info'
  | 'success'
  | 'warning'
  | 'neutral';

/** A single legal-affairs domain tile descriptor. */
export interface LexDomain {
  /** Stable identifier; also the count map key + i18n leaf (`domains.<id>`). */
  id: string;
  /** i18n label key into the lex bundle (`domains.<id>`). */
  labelKey: string;
  /** Destination route for the tile. */
  href: string;
  /** lucide-react icon component (distinct per domain). */
  icon: LucideIcon;
  /** RBAC permission required to see the tile + fetch its count. */
  permission: string;
  /** Whether this domain surfaces a numeric count badge. */
  hasCount: boolean;
  /** Categorical visual accent for the command-center tile. */
  tone: LexDomainTone;
}

const PERM_READ = 'lex:read';
const PERM_WRITE = 'lex:write';

/**
 * The 18 domain tiles in display order. The `id` MUST match the keys produced
 * by {@link import('./use-lex-command-center').useLexDomainCounts}, and the
 * order matches `LEGAL_DOMAIN_ORDER` in the Legal Director domains grid.
 */
export const LEX_DOMAINS: LexDomain[] = [
  // --- Active work -------------------------------------------------------
  {
    id: 'litigation_cases',
    labelKey: 'domains.litigation_cases',
    href: '/lex/cases',
    icon: Gavel,
    permission: PERM_READ,
    hasCount: true,
    tone: 'primary',
  },
  {
    id: 'service_desk',
    labelKey: 'domains.service_desk',
    href: '/lex/service-desk',
    icon: Inbox,
    permission: PERM_READ,
    hasCount: true,
    tone: 'info',
  },
  {
    id: 'matters',
    labelKey: 'domains.matters',
    href: '/lex/matters',
    icon: Scale,
    permission: PERM_READ,
    hasCount: true,
    tone: 'warning',
  },
  {
    id: 'consultations',
    labelKey: 'domains.consultations',
    href: '/lex/consultations',
    icon: MessagesSquare,
    permission: PERM_READ,
    hasCount: true,
    tone: 'success',
  },
  {
    id: 'investigations',
    labelKey: 'domains.investigations',
    href: '/lex/investigations',
    icon: ShieldQuestion,
    permission: PERM_READ,
    hasCount: true,
    tone: 'info',
  },
  {
    id: 'settlements',
    labelKey: 'domains.settlements',
    href: '/lex/settlements',
    icon: Handshake,
    permission: PERM_READ,
    hasCount: true,
    tone: 'success',
  },
  {
    id: 'contracts',
    labelKey: 'domains.contracts',
    href: '/lex/contracts',
    icon: FileText,
    permission: PERM_READ,
    hasCount: true,
    tone: 'primary',
  },
  {
    id: 'obligations',
    labelKey: 'domains.obligations',
    href: '/lex/obligations',
    icon: ListChecks,
    permission: PERM_READ,
    hasCount: true,
    tone: 'warning',
  },
  // --- Library / knowledge ----------------------------------------------
  {
    id: 'documents',
    labelKey: 'domains.documents',
    href: '/lex/documents',
    icon: File,
    permission: PERM_READ,
    hasCount: true,
    tone: 'info',
  },
  {
    id: 'clause_library',
    labelKey: 'domains.clause_library',
    href: '/lex/clause-library',
    icon: BookMarked,
    permission: PERM_READ,
    hasCount: true,
    tone: 'primary',
  },
  {
    id: 'playbooks',
    labelKey: 'domains.playbooks',
    href: '/lex/playbooks',
    icon: ClipboardList,
    permission: PERM_READ,
    hasCount: true,
    tone: 'success',
  },
  {
    id: 'regulations',
    labelKey: 'domains.regulations',
    href: '/lex/regulations',
    icon: BookText,
    permission: PERM_READ,
    hasCount: true,
    tone: 'warning',
  },
  {
    id: 'signatures',
    labelKey: 'domains.signatures',
    href: '/lex/signatures',
    icon: FileCheck2,
    permission: PERM_READ,
    hasCount: true,
    tone: 'success',
  },
  // --- Ops / governance --------------------------------------------------
  {
    id: 'workflow_policies',
    labelKey: 'domains.workflow_policies',
    href: '/lex/workflow-policies',
    icon: Workflow,
    permission: PERM_READ,
    hasCount: true,
    tone: 'info',
  },
  {
    id: 'compliance',
    labelKey: 'domains.compliance',
    href: '/lex/compliance',
    icon: ShieldCheck,
    permission: PERM_READ,
    hasCount: true,
    tone: 'success',
  },
  {
    id: 'drafting',
    labelKey: 'domains.drafting',
    href: '/lex/drafting',
    icon: Sparkles,
    permission: PERM_WRITE,
    hasCount: false,
    tone: 'warning',
  },
  {
    id: 'reports',
    labelKey: 'domains.reports',
    href: '/lex/reports',
    icon: BarChart3,
    permission: PERM_READ,
    hasCount: false,
    tone: 'info',
  },
  {
    id: 'admin',
    labelKey: 'domains.admin',
    href: '/lex/admin',
    icon: Settings2,
    permission: PERM_READ,
    hasCount: false,
    tone: 'neutral',
  },
];
