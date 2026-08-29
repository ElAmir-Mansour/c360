'use client';

import { useState, type ReactNode } from 'react';

import {
  EscalationPanel,
  EscalationPanelState,
} from '@/app/(dashboard)/lex/_components/role-dashboard/widgets/escalation-panel';
import {
  LegalDomainsGrid,
  LegalDomainsGridError,
  LegalDomainsGridLoading,
} from '@/app/(dashboard)/lex/_components/role-dashboard/widgets/legal-domains-grid';
import {
  ResolutionRatePanel,
  ResolutionRatePanelError,
  ResolutionRatePanelLoading,
} from '@/app/(dashboard)/lex/_components/role-dashboard/widgets/resolution-rate-panel';
import {
  ServiceRequestDonut,
  ServiceRequestDonutState,
} from '@/app/(dashboard)/lex/_components/role-dashboard/widgets/service-request-donut';
import type { DomainTile as DomainTileRecord } from '@/app/(dashboard)/lex/_components/role-dashboard/widgets/domain-tile';
import { useLegalDirectorDashboardLabels } from '@/app/(dashboard)/lex/_lib/role-dashboards/legal-director-i18n';
import { LocaleProvider } from '@/components/providers/locale-provider';
import type { AppDirection, AppLocale } from '@/lib/i18n';
import { getMessages } from '@/lib/i18n/messages';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';

interface PanelSpecimensProps {
  locale: AppLocale;
  name: string;
  populated: ReactNode;
  loading: ReactNode;
  empty: ReactNode;
  error: ReactNode;
  zero: ReactNode;
  partial: ReactNode;
  wide?: boolean;
}

const DEV_COPY = {
  locales: {
    en: 'English · LTR',
    ar: 'العربية · من اليمين إلى اليسار',
  },
  states: {
    populated: 'Populated',
    loading: 'Loading',
    empty: 'Empty',
    error: 'Error with retry',
    zero: 'Zero',
    partial: 'Partial and overflow',
  },
  panels: {
    escalations: 'Escalation panel',
    serviceRequests: 'Service Request Donut',
    resolutionRate: 'Resolution Rate panel',
    legalDomains: 'Legal Domains Grid',
  },
  retryCount: (count: number) => `Step 4 retry interactions: ${count}`,
  overflowCategory: {
    en: 'A deliberately long category label that must wrap safely',
    ar: 'تسمية فئة طويلة عمدًا يجب أن تلتف بأمان',
  },
} as const;

const LOCALES: { locale: AppLocale; direction: AppDirection }[] = [
  { locale: 'en', direction: 'ltr' },
  { locale: 'ar', direction: 'rtl' },
];

const DOMAIN_FIXTURES = [
  { key: 'litigation_cases', href: '/lex/cases', count: 3 },
  { key: 'service_desk', href: '/lex/service-desk', count: 7 },
  { key: 'matters', href: '/lex/matters', count: 4 },
  { key: 'consultations', href: '/lex/consultations', count: 6 },
  { key: 'investigations', href: '/lex/investigations', count: 2 },
  { key: 'settlements', href: '/lex/settlements', count: 1 },
  { key: 'contracts', href: '/lex/contracts', count: 8 },
  { key: 'obligations', href: '/lex/obligations', count: 5 },
  { key: 'documents', href: '/lex/documents', count: 9 },
  { key: 'clause_library', href: '/lex/clause-library', count: 4 },
  { key: 'playbooks', href: '/lex/playbooks', count: 2 },
  { key: 'regulations', href: '/lex/regulations', count: 3 },
  { key: 'signatures', href: '/lex/signatures', count: 6 },
  { key: 'workflow_policies', href: '/lex/workflow-policies', count: 1 },
  { key: 'compliance', href: '/lex/compliance', count: 7 },
  { key: 'drafting', href: '/lex/drafting', count: null },
  { key: 'reports', href: '/lex/reports', count: null },
  { key: 'admin', href: '/lex/admin', count: null },
] as const;

function slug(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/(^-|-$)/g, '');
}

function Specimen({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <article id={id} className="min-w-0 space-y-2 scroll-mt-6">
      <p className="text-caption font-semibold uppercase tracking-label text-muted-foreground">
        {label}
      </p>
      {children}
    </article>
  );
}

function PanelSpecimens({
  locale,
  name,
  populated,
  loading,
  empty,
  error,
  zero,
  partial,
  wide = false,
}: PanelSpecimensProps) {
  const componentSlug = slug(name);
  const specimen = (state: string) =>
    `legal-director-panels-${locale}-${componentSlug}-${slug(state)}`;

  return (
    <section
      aria-labelledby={`${specimen('section')}-title`}
      data-panel-gallery={componentSlug}
      className="space-y-4"
    >
      <h4 id={`${specimen('section')}-title`} className="text-body font-semibold text-foreground">
        {name}
      </h4>
      <div className={cn('grid gap-5', !wide && 'xl:grid-cols-2')}>
        <Specimen id={specimen('populated')} label={DEV_COPY.states.populated}>
          {populated}
        </Specimen>
        <Specimen id={specimen('loading')} label={DEV_COPY.states.loading}>
          {loading}
        </Specimen>
        <Specimen id={specimen('empty')} label={DEV_COPY.states.empty}>
          {empty}
        </Specimen>
        <Specimen id={specimen('error')} label={DEV_COPY.states.error}>
          {error}
        </Specimen>
        <Specimen id={specimen('zero')} label={DEV_COPY.states.zero}>
          {zero}
        </Specimen>
        <Specimen id={specimen('partial')} label={DEV_COPY.states.partial}>
          {partial}
        </Specimen>
      </div>
    </section>
  );
}

function LocalePanelGallery({ locale, onRetry }: { locale: AppLocale; onRetry: () => void }) {
  const labels = useLegalDirectorDashboardLabels();
  const format = useLexFormat();

  const serviceSegments = [
    { key: 'contracts' as const, label: labels.serviceRequestCategories.contracts, value: 4, href: '/lex/contracts' },
    {
      key: 'consultations' as const,
      label: labels.serviceRequestCategories.consultations,
      value: 3,
      href: '/lex/consultations',
    },
    { key: 'litigations' as const, label: labels.serviceRequestCategories.litigations, value: 2, href: '/lex/cases' },
    {
      key: 'investigation' as const,
      label: labels.serviceRequestCategories.investigation,
      value: 1,
      href: '/lex/investigations',
    },
    { key: 'other' as const, label: labels.serviceRequestCategories.other, value: 0, href: '/lex/reports/analytics' },
  ];
  const zeroServiceSegments = serviceSegments.map((segment) => ({ ...segment, value: 0 }));

  const domains: DomainTileRecord[] = DOMAIN_FIXTURES.map((domain) => ({
    ...domain,
    label: labels.domains[domain.key],
  }));

  return (
    <div className="space-y-10">
      <PanelSpecimens
        locale={locale}
        name={DEV_COPY.panels.escalations}
        populated={
          <EscalationPanel
            levels={[
              { level: 'critical', count: 3, href: '/lex/inbox?severity=critical' },
              { level: 'high', count: 7, href: '/lex/inbox?severity=high' },
              { level: 'medium', count: 1, href: '/lex/inbox?severity=medium' },
            ]}
            totalLabel={labels.values.warnings(format.formatNumber(11), false)}
          />
        }
        loading={<EscalationPanelState state="loading" />}
        empty={<EscalationPanel levels={[]} totalLabel={labels.values.warnings('0', false)} />}
        error={<EscalationPanelState state="error" onRetry={onRetry} />}
        zero={
          <EscalationPanel
            levels={[
              { level: 'critical', count: 0, href: '/lex/inbox?severity=critical' },
              { level: 'high', count: 0, href: '/lex/inbox?severity=high' },
              { level: 'medium', count: 0, href: '/lex/inbox?severity=medium' },
            ]}
            totalLabel={labels.values.warnings(format.formatNumber(0), false)}
          />
        }
        partial={
          <EscalationPanel
            levels={[{ level: 'high', count: 123456789, href: '/lex/inbox?severity=high' }]}
            totalLabel={labels.values.warnings(format.formatNumber(123456789), false)}
          />
        }
      />

      <PanelSpecimens
        locale={locale}
        name={DEV_COPY.panels.serviceRequests}
        populated={<ServiceRequestDonut total={10} segments={serviceSegments} />}
        loading={<ServiceRequestDonutState state="loading" />}
        empty={<ServiceRequestDonut total={0} segments={[]} />}
        error={<ServiceRequestDonutState state="error" onRetry={onRetry} />}
        zero={<ServiceRequestDonut total={0} segments={zeroServiceSegments} />}
        partial={
          <ServiceRequestDonut
            total={2}
            segments={[
              {
                key: 'other',
                label: DEV_COPY.overflowCategory[locale],
                value: 2,
                href: '/lex/reports/analytics',
              },
            ]}
          />
        }
      />

      <PanelSpecimens
        locale={locale}
        name={DEV_COPY.panels.resolutionRate}
        populated={
          <ResolutionRatePanel
            bars={[
              { label: labels.serviceRequestCategories.contracts, ratePct: 52, href: '/lex/contracts' },
              { label: labels.serviceRequestCategories.consultations, ratePct: 6, href: '/lex/consultations' },
              { label: labels.serviceRequestCategories.litigations, ratePct: 21, href: '/lex/cases' },
              { label: labels.serviceRequestCategories.investigation, ratePct: 19, href: '/lex/investigations' },
            ]}
          />
        }
        loading={<ResolutionRatePanelLoading />}
        empty={<ResolutionRatePanel bars={[]} />}
        error={<ResolutionRatePanelError onRetry={onRetry} />}
        zero={
          <ResolutionRatePanel
            bars={[{ label: labels.serviceRequestCategories.contracts, ratePct: 0, href: '/lex/contracts' }]}
          />
        }
        partial={
          <ResolutionRatePanel
            bars={[{ label: DEV_COPY.overflowCategory[locale], ratePct: 112, href: '/lex/reports/analytics' }]}
          />
        }
      />

      <PanelSpecimens
        locale={locale}
        name={DEV_COPY.panels.legalDomains}
        populated={<LegalDomainsGrid domains={domains} />}
        loading={<LegalDomainsGridLoading />}
        empty={<LegalDomainsGrid domains={[]} />}
        error={<LegalDomainsGridError onRetry={onRetry} />}
        zero={<LegalDomainsGrid domains={[{ ...domains[0], count: 0 }]} />}
        partial={
          <LegalDomainsGrid
            domains={[
              ...domains.slice(0, 2),
              {
                key: 'gallery_overflow_domain',
                label: DEV_COPY.overflowCategory[locale],
                count: 1,
                href: '/ui-gallery',
              },
            ]}
          />
        }
        wide
      />
    </div>
  );
}

/** Internal Step 4 story surface. Fixtures never participate in production data wiring. */
export function LegalDirectorPanelsGallery() {
  const [retryCount, setRetryCount] = useState(0);

  return (
    <div className="space-y-12" data-legal-director-panels-gallery="">
      <p aria-live="polite" className="text-caption text-muted-foreground">
        {DEV_COPY.retryCount(retryCount)}
      </p>
      {LOCALES.map(({ locale, direction }) => (
        <section
          key={locale}
          aria-labelledby={`legal-director-panels-${locale}-title`}
          className="space-y-6"
        >
          <h3
            id={`legal-director-panels-${locale}-title`}
            className="text-[length:var(--wt-font-size-panel-title)] font-bold leading-[var(--wt-line-height-panel-title)] text-foreground"
          >
            {DEV_COPY.locales[locale]}
          </h3>
          <LocaleProvider
            locale={locale}
            direction={direction}
            messages={getMessages(locale)}
          >
            <div dir={direction} lang={locale}>
              <LocalePanelGallery
                locale={locale}
                onRetry={() => setRetryCount((current) => current + 1)}
              />
            </div>
          </LocaleProvider>
        </section>
      ))}
    </div>
  );
}
