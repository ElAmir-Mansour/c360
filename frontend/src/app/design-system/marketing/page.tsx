'use client';

/**
 * ClarioDR design-system marketing PROOF PAGE (now served at
 * /design-system/marketing — /design-system itself is the living catalog).
 *
 * Renders the Phase-1 tokens + Phase-2 marketing/shell grammar with original
 * ClarioDR content so the adopted design system is viewable end-to-end. This is
 * the landing proof screen pulled forward from Phase 4 — it composes the
 * committed, token-driven, RTL-first components; it hardcodes nothing.
 */

import Link from 'next/link';
import {
  Activity,
  ClipboardCheck,
  GitBranch,
  Network,
  ShieldCheck,
  Timer,
} from 'lucide-react';

import {
  MarketingShell,
  MarketingFooter,
  clarioDrBrand,
  clarioDrNavModel,
  clarioDrFooterModel,
} from '@/components/marketing/shell';
import {
  Hero,
  BenefitStrip,
  FeatureBlockList,
  CardGridFeatureRow,
  AbstractVisual,
} from '@/components/marketing/blocks';
import { CtaBand } from '@/components/marketing/sections/cta-band';
import { FaqAccordion } from '@/components/marketing/sections/faq-accordion';
import { ThemeLocaleSwitcher } from '@/components/layout/theme-locale-switcher';

const shellLabels = {
  skipToContent: 'Skip to content',
  navAriaLabel: 'Main navigation',
  mobileOpenLabel: 'Open menu',
  mobileCloseLabel: 'Close menu',
  mobileTitle: 'Menu',
  externalLinkLabel: '(opens in a new tab)',
};

const announcement = {
  id: 'ds-preview',
  message: 'ClarioDR design system — live preview of the adopted UI/UX system.',
  link: { label: 'Recovery dashboard', href: '/dr' },
  dismissLabel: 'Dismiss announcement',
};

function HeaderActions() {
  return (
    <>
      <Link
        href="/sign-in"
        className="inline-flex h-10 items-center rounded-button px-3 text-body-sm font-semibold text-content-secondary transition-colors duration-fast ease-standard hover:text-content-primary"
      >
        Sign in
      </Link>
      <Link
        href="/get-started"
        className="inline-flex h-10 items-center rounded-button bg-brand-primary-600 px-4 text-body-sm font-semibold text-content-on-primary shadow-elevation-1 transition-shadow duration-fast ease-standard hover:shadow-elevation-2"
      >
        Start free
      </Link>
      <ThemeLocaleSwitcher />
    </>
  );
}

export default function DesignSystemPreviewPage() {
  return (
    <MarketingShell
      brand={clarioDrBrand}
      nav={clarioDrNavModel}
      labels={shellLabels}
      announcement={announcement}
      headerActions={<HeaderActions />}
      footer={
        <MarketingFooter
          brand={clarioDrBrand}
          columns={clarioDrFooterModel}
          copyright={`© ${new Date().getFullYear()} ClarioDR. All rights reserved.`}
          ariaLabel="Footer"
          externalLinkLabel={shellLabels.externalLinkLabel}
          switcherSlot={<ThemeLocaleSwitcher />}
        />
      }
    >
      <Hero
        eyebrow="Sovereign disaster recovery"
        headline="Rehearse failover. Prove recovery. Pass the audit."
        subcopy="ClarioDR turns disaster-recovery runbooks into governed, evidence-backed failovers your regulators accept on the first pass — with replication, gated failover, and an immutable attestation trail in one sovereign platform."
        primaryAction={{ label: 'Start free', href: '/get-started' }}
        secondaryAction={{ label: 'View recovery dashboard', href: '/dr' }}
        visual={<AbstractVisual tone="primary" label="Recovery posture" />}
      />

      <BenefitStrip
        ariaLabel="Why teams choose ClarioDR"
        items={[
          { icon: ShieldCheck, label: 'Ransomware-safe points', description: 'Immutable, clean-room-validated recovery points.' },
          { icon: Timer, label: 'RTO you can prove', description: 'Measured RTO-vs-RTA on every drill and event.' },
          { icon: ClipboardCheck, label: 'Audit on first pass', description: 'Tamper-evident, NCA-ready attestation trail.' },
          { icon: Network, label: 'Sovereign by design', description: 'On-prem, air-gapped, or sovereign cloud.' },
        ]}
      />

      <FeatureBlockList
        items={[
          {
            id: 'runbooks',
            eyebrow: 'Automated runbooks',
            headline: 'Sequenced failover, with the critical path made visible',
            body: 'Author recovery runbooks with dependencies, owners, and timing. ClarioDR runs them gated — validate, approve, execute, attest — so nothing skips a control.',
            bullets: ['Dependency-aware boot order', 'Human approval gates', 'Live critical-path tracking'],
            action: { label: 'Explore runbooks', href: '/dr' },
            visualTone: 'teal',
          },
          {
            id: 'rto',
            eyebrow: 'Dashboards & analytics',
            headline: 'RTO vs RTA, tracked live across every event',
            body: 'A real-time recovery dashboard shows runbook progress, replication lag, and recovery objectives against actuals — one screen, many concurrent events.',
            bullets: ['Real-time RPO/RTO', 'Multi-runbook view', 'Drill drift detection'],
            action: { label: 'See the dashboard', href: '/dr' },
            visualTone: 'gold',
          },
        ]}
      />

      <CardGridFeatureRow
        eyebrow="Platform"
        heading="Recovery, end to end"
        description="Every capability is token-driven, sovereign, and evidence-backed."
        ariaLabel="Platform capabilities"
        cards={[
          { id: 'replication', icon: Activity, title: 'Continuous replication', description: 'Database, VM, and Kubernetes replication with any-point-in-time recovery.', href: '/dr', linkLabel: 'Learn more' },
          { id: 'failover', icon: GitBranch, title: 'Gated failover', description: 'Validate → Approve → Execute → Attest, with app-level verification before attestation.', href: '/dr', linkLabel: 'Learn more' },
          { id: 'attest', icon: ClipboardCheck, title: 'Attestation ledger', description: 'A tamper-evident, hash-chained trail your auditors can verify cryptographically.', href: '/dr', linkLabel: 'Learn more' },
        ]}
      />

      <FaqAccordion
        eyebrow="FAQ"
        heading="Common questions"
        items={[
          { id: 'q1', question: 'Does ClarioDR run air-gapped?', answer: 'Yes — the same signed artifact set deploys to sovereign cloud, on-prem, or fully air-gapped environments.' },
          { id: 'q2', question: 'How is recovery proven?', answer: 'Every drill and failover produces a measured RTO-vs-RTA attestation, sealed to a tamper-evident ledger and exportable as an NCA-ready report.' },
          { id: 'q3', question: 'Is the platform bilingual?', answer: 'Yes — first-class Arabic/English with full RTL, switchable live from the header.' },
        ]}
      />

      <CtaBand
        eyebrow="Ready when you are"
        headline="Make your next failover a rehearsal, not a crisis."
        subcopy="Stand up ClarioDR and run a governed drill this week."
        primaryAction={{ label: 'Start free', href: '/get-started' }}
        secondaryAction={{ label: 'Talk to us', href: '/contact' }}
      />
    </MarketingShell>
  );
}
