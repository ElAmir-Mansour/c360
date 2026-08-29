/**
 * Marketing shell — navigation model (types + default ClarioDR IA).
 * ================================================================
 *
 * The marketing shell is fully **content-driven**: every label, description,
 * href and icon is supplied via these typed props so the same components render
 * bilingual (en/ar) copy and any future white-label IA without code changes.
 *
 * The exported `clarioDrNavModel` / `clarioDrFooterModel` etc. are ORIGINAL
 * ClarioDR content (DR / runbook / RTO themes) used for Storybook/gallery
 * defaults and the eventual Phase-4 proof pages. They contain NO third-party
 * product names, logos, copy or customer marks.
 */

import type { ComponentType, SVGProps } from 'react';
import {
  Activity,
  BookOpenCheck,
  Building2,
  FileCheck2,
  Fingerprint,
  Globe2,
  Layers,
  Network,
  PlayCircle,
  Plug,
  ScrollText,
  ShieldCheck,
  Siren,
  Workflow,
} from 'lucide-react';

/** A lucide-react (or compatible) icon component. */
export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** A single link inside a mega-menu / mobile column. */
export interface NavLink {
  /** Stable identity for keys + roving-tabindex bookkeeping. */
  id: string;
  /** Visible, translatable label. */
  label: string;
  /** Short supporting descriptor (one line). Optional. */
  description?: string;
  /** Destination. */
  href: string;
  /** Optional leading icon. */
  icon?: NavIcon;
  /** Marks an external link (adds rel/target + an accessible hint). */
  external?: boolean;
}

/** A headed group of links — renders as one column in the mega-menu panel. */
export interface NavColumn {
  id: string;
  /** Column heading (e.g. "Products"). */
  heading: string;
  /** Optional one-line column descriptor. */
  description?: string;
  links: NavLink[];
}

/**
 * A top-level navigation item.
 *
 * - With `columns`, it opens a multi-column mega-menu panel.
 * - With only `href`, it is a plain top-level link (e.g. "Pricing").
 */
export interface NavItem {
  id: string;
  label: string;
  href?: string;
  columns?: NavColumn[];
  /**
   * Optional promoted callout shown alongside the columns (e.g. a featured
   * solution or a "what's new" card). Original ClarioDR content only.
   */
  featured?: {
    eyebrow: string;
    title: string;
    description: string;
    href: string;
    cta: string;
    icon?: NavIcon;
  };
}

/** The complete primary navigation model. */
export type NavModel = NavItem[];

/** A footer link (flat). */
export interface FooterLink {
  id: string;
  label: string;
  href: string;
  external?: boolean;
}

/** A headed group of footer links. */
export interface FooterColumn {
  id: string;
  heading: string;
  links: FooterLink[];
}

// ---------------------------------------------------------------------------
// Default ClarioDR content (original; en).  Consumers pass their own (e.g. ar).
// ---------------------------------------------------------------------------

/**
 * Original ClarioDR information architecture, organised by buyer mental model:
 *
 *  - Solutions — by outcome (regulated / sovereign / ransomware / audit-ready).
 *  - Products  — by surface  (orchestrator / replication / failover / evidence).
 *  - Platform  — by capability (control plane / integrations / ledger / access).
 */
export const clarioDrNavModel: NavModel = [
  {
    id: 'solutions',
    label: 'Solutions',
    columns: [
      {
        id: 'solutions-by-outcome',
        heading: 'By outcome',
        description: 'Recovery programmes mapped to your obligation.',
        links: [
          {
            id: 'sol-regulated-dr',
            label: 'Regulated disaster recovery',
            description: 'Provable RTO/RPO for financial and critical sectors.',
            href: '/solutions/regulated-dr',
            icon: ShieldCheck,
          },
          {
            id: 'sol-sovereign',
            label: 'Sovereign & air-gapped recovery',
            description: 'Recover inside isolated, in-country environments.',
            href: '/solutions/sovereign-recovery',
            icon: Globe2,
          },
          {
            id: 'sol-ransomware',
            label: 'Ransomware recovery readiness',
            description: 'Rehearsed clean-room failover and reconstitution.',
            href: '/solutions/ransomware-readiness',
            icon: Siren,
          },
          {
            id: 'sol-audit',
            label: 'DR for SAMA, NCA & PDPL audits',
            description: 'Evidence packs auditors accept on the first pass.',
            href: '/solutions/audit-ready-dr',
            icon: FileCheck2,
          },
        ],
      },
      {
        id: 'solutions-by-team',
        heading: 'By team',
        description: 'Each role gets the surface it needs.',
        links: [
          {
            id: 'sol-resilience-leaders',
            label: 'Resilience leaders',
            description: 'Portfolio RTO posture at a glance.',
            href: '/solutions/resilience-leaders',
            icon: Activity,
          },
          {
            id: 'sol-recovery-teams',
            label: 'Recovery & operations teams',
            description: 'Run failover from a single live runbook.',
            href: '/solutions/recovery-teams',
            icon: Workflow,
          },
          {
            id: 'sol-risk-audit',
            label: 'Risk, audit & compliance',
            description: 'Tamper-evident attestation on every exercise.',
            href: '/solutions/risk-and-audit',
            icon: ScrollText,
          },
        ],
      },
    ],
    featured: {
      eyebrow: 'Featured',
      title: 'The 15-minute failover standard',
      description:
        'See how teams rehearse a full regional failover and produce audit-ready evidence in one sitting.',
      href: '/solutions/fifteen-minute-failover',
      cta: 'Explore the approach',
      icon: PlayCircle,
    },
  },
  {
    id: 'products',
    label: 'Products',
    columns: [
      {
        id: 'products-suite',
        heading: 'ClarioDR suite',
        description: 'Resilience, migration and replication on one control plane.',
        links: [
          {
            id: 'prod-clariodr',
            label: 'ClarioDR',
            description: 'Runbook-driven recovery orchestration and failover.',
            href: '/products/clariodr',
            icon: Workflow,
          },
          {
            id: 'prod-clariomigration',
            label: 'ClarioMigration',
            description: 'Plan and execute cutovers with zero-surprise rehearsals.',
            href: '/products/clariomigration',
            icon: Layers,
          },
          {
            id: 'prod-clariosync',
            label: 'ClarioSync',
            description: 'Continuous replication and coverage assurance.',
            href: '/products/clariosync',
            icon: Network,
          },
        ],
      },
      {
        id: 'products-capabilities',
        heading: 'Core capabilities',
        description: 'The building blocks behind every recovery.',
        links: [
          {
            id: 'cap-orchestrator',
            label: 'Runbook Orchestrator',
            description: 'Automated, human and approval-gate steps in one flow.',
            href: '/products/runbook-orchestrator',
            icon: Workflow,
          },
          {
            id: 'cap-failover',
            label: 'Failover Control',
            description: 'One-click, governed failover and failback.',
            href: '/products/failover-control',
            icon: PlayCircle,
          },
          {
            id: 'cap-attestation',
            label: 'Attestation & Evidence',
            description: 'Immutable proof for every recovery decision.',
            href: '/products/attestation-evidence',
            icon: BookOpenCheck,
          },
        ],
      },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    columns: [
      {
        id: 'platform-capabilities',
        heading: 'Platform capabilities',
        description: 'The sovereign foundation under every product.',
        links: [
          {
            id: 'plat-control-plane',
            label: 'Sovereign control plane',
            description: 'Run in SaaS, on-premises or fully air-gapped.',
            href: '/platform/control-plane',
            icon: Globe2,
          },
          {
            id: 'plat-integrations',
            label: 'Integrations',
            description: 'Connect cloud, storage and orchestration estates.',
            href: '/platform/integrations',
            icon: Plug,
          },
          {
            id: 'plat-ledger',
            label: 'Audit & attestation ledger',
            description: 'Append-only, hash-chained recovery evidence.',
            href: '/platform/audit-ledger',
            icon: ScrollText,
          },
          {
            id: 'plat-security',
            label: 'Security & access',
            description: 'MFA, WebAuthn and least-privilege by default.',
            href: '/platform/security-access',
            icon: Fingerprint,
          },
        ],
      },
    ],
  },
  {
    id: 'industries',
    label: 'Industries',
    href: '/industries',
  },
  {
    id: 'pricing',
    label: 'Pricing',
    href: '/pricing',
  },
];

/** Original ClarioDR footer IA (en). Consumers pass their own for ar. */
export const clarioDrFooterModel: FooterColumn[] = [
  {
    id: 'footer-product',
    heading: 'Product',
    links: [
      { id: 'f-clariodr', label: 'ClarioDR', href: '/products/clariodr' },
      { id: 'f-clariomigration', label: 'ClarioMigration', href: '/products/clariomigration' },
      { id: 'f-clariosync', label: 'ClarioSync', href: '/products/clariosync' },
      { id: 'f-orchestrator', label: 'Runbook Orchestrator', href: '/products/runbook-orchestrator' },
      { id: 'f-attestation', label: 'Attestation & Evidence', href: '/products/attestation-evidence' },
    ],
  },
  {
    id: 'footer-company',
    heading: 'Company',
    links: [
      { id: 'f-about', label: 'About ClarioDR', href: '/company/about' },
      { id: 'f-careers', label: 'Careers', href: '/company/careers' },
      { id: 'f-partners', label: 'Partners', href: '/company/partners' },
      { id: 'f-contact', label: 'Contact', href: '/company/contact' },
    ],
  },
  {
    id: 'footer-resources',
    heading: 'Resources',
    links: [
      { id: 'f-docs', label: 'Documentation', href: '/resources/docs' },
      { id: 'f-runbook-library', label: 'Runbook library', href: '/resources/runbook-library' },
      { id: 'f-rto-guide', label: 'RTO readiness guide', href: '/resources/rto-readiness' },
      { id: 'f-status', label: 'Trust & status', href: '/resources/trust' },
    ],
  },
  {
    id: 'footer-legal',
    heading: 'Legal',
    links: [
      { id: 'f-privacy', label: 'Privacy', href: '/legal/privacy' },
      { id: 'f-terms', label: 'Terms of service', href: '/legal/terms' },
      { id: 'f-dpa', label: 'Data processing', href: '/legal/dpa' },
      { id: 'f-sub', label: 'Subprocessors', href: '/legal/subprocessors' },
    ],
  },
];

/** Brand identity for the shell header/footer (content-driven). */
export interface ShellBrand {
  /** Wordmark / product name (rendered as text; no third-party logos). */
  name: string;
  /** Destination for the brand link (usually the marketing home). */
  href: string;
  /** Accessible label for the home link (e.g. "ClarioDR — home"). */
  homeLabel: string;
  /** Optional short tagline rendered under the wordmark in the footer. */
  tagline?: string;
}

export const clarioDrBrand: ShellBrand = {
  name: 'ClarioDR',
  href: '/',
  homeLabel: 'ClarioDR — home',
  tagline: 'Sovereign disaster recovery, rehearsed and proven.',
};
