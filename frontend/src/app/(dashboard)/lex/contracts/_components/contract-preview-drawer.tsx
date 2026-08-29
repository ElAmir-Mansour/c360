/**
 * ContractPreviewDrawer — Feature 3: quick-preview slide-over for the contracts
 * list (`/lex/contracts`).
 *
 * Opening the drawer lazily fetches the application-generated contract brief
 * (`enterpriseApi.lex.getContractBrief`) and renders a condensed, read-only
 * snapshot that reuses the detail-page presentational primitives — the
 * lifecycle stepper, key-dates strip, risk panel, renewal banner, and the
 * actionable findings list — without leaving the list. A header/footer link
 * escalates to the full contract detail console.
 *
 * Bilingual (EN + MSA) and RTL-aware: drawer-local labels follow the canonical
 * `LexBilingual<T>` contract, and shared brief/risk/date tokens are reused from
 * `useContractDetailLabels()` so the wording stays identical to the detail page.
 */

'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { differenceInCalendarDays, isValid, parseISO } from 'date-fns';
import { ExternalLink } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { enterpriseApi } from '@/lib/enterprise/api';
import { titleCase } from '@/lib/format';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import { useLocale } from '@/components/providers/locale-provider';
import {
  type LexBilingual,
  resolveLexBilingual,
} from '../../_lib/lex-i18n';
import type { LexContractBrief, LexRiskLevel } from '@/types/suites';

import { WATHEEQ_LIFECYCLE_STAGES } from '@/lib/lex-watheeq';
import {
  ContractLifecycleStepper,
  type ContractLifecycleStage,
} from '../[id]/_components/contract-lifecycle-stepper';
import { KeyDatesStrip } from '../[id]/_components/key-dates-strip';
import { ContractRiskPanel } from '../[id]/_components/contract-risk-panel';
import { RenewalAlertBanner } from '../[id]/_components/renewal-alert-banner';
import {
  RiskFindingsList,
  type RiskFinding,
} from '../[id]/_components/risk-findings-list';
import { toIndicatorSeverity } from '../[id]/_components/risk-severity';
import {
  useContractDetailLabels,
  useContractRiskLabels,
  useContractStatusTokenLabels,
  useContractTypeLabels,
} from '../_lib/contracts-labels';
import {
  localizeContractBriefRisk,
  localizeContractGeneratedText,
  localizeRiskLevelToken,
  type ContractValueFormatters,
} from '../_lib/contract-value-localization';

export interface ContractPreviewDrawerProps {
  /** Contract id to preview. `null` keeps the drawer dormant (no fetch). */
  contractId: string | null;
  /** Controlled open state. */
  open: boolean;
  /** Controlled open-state setter. */
  onOpenChange: (open: boolean) => void;
}

/* ------------------------------------------------------------------------- *
 * Drawer-local bilingual labels. Shared brief/date/risk wording is reused from
 * `useContractDetailLabels()`; only the few preview-specific chrome strings live
 * here.
 * ------------------------------------------------------------------------- */

interface PreviewDrawerLabels {
  openDetail: string;
  sectionLifecycle: string;
  sectionDates: string;
  sectionRisk: string;
  sectionFindings: string;
  counterparty: string;
  owner: string;
  value: string;
}

const previewDrawerLabels: LexBilingual<PreviewDrawerLabels> = {
  en: {
    openDetail: 'Open full detail',
    sectionLifecycle: 'Lifecycle',
    sectionDates: 'Key dates',
    sectionRisk: 'Risk',
    sectionFindings: 'Top risks',
    counterparty: 'Counterparty',
    owner: 'Owner',
    value: 'Value',
  },
  ar: {
    openDetail: 'فتح التفاصيل الكاملة',
    sectionLifecycle: 'دورة الحياة',
    sectionDates: 'التواريخ الرئيسية',
    sectionRisk: 'المخاطر',
    sectionFindings: 'أبرز المخاطر',
    counterparty: 'الطرف المقابل',
    owner: 'المالك',
    value: 'القيمة',
  },
};

/** Parse an ISO date string defensively, returning `null` on absence/invalid. */
function parseIso(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

export function ContractPreviewDrawer({
  contractId,
  open,
  onOpenChange,
}: ContractPreviewDrawerProps) {
  const router = useRouter();
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const detailLabels = useContractDetailLabels();
  const statusTokenLabels = useContractStatusTokenLabels();
  const typeLabels = useContractTypeLabels();
  const riskTokenLabels = useContractRiskLabels();
  const labels = useMemo(
    () => resolveLexBilingual(previewDrawerLabels, locale),
    [locale],
  );

  const briefQuery = useQuery<LexContractBrief>({
    queryKey: ['lex', 'contract', contractId, 'brief'],
    queryFn: () => enterpriseApi.lex.getContractBrief(contractId as string),
    enabled: open && Boolean(contractId),
    staleTime: 60_000,
  });

  const brief = briefQuery.data;
  const valueFormatters = useMemo<ContractValueFormatters>(
    () => ({
      formatDate: f.formatDate,
      formatNumber: (value) => f.formatNumber(value),
    }),
    [f],
  );

  // Mirror the detail page's lifecycle mapping so the stepper highlights the
  // same stage and uses the same localized status labels.
  const lifecycleStages: ContractLifecycleStage[] = useMemo(
    () =>
      WATHEEQ_LIFECYCLE_STAGES.map((stage) => ({
        key: stage,
        label: statusTokenLabels[stage] ?? titleCase(stage),
      })),
    [statusTokenLabels],
  );
  const activeStageIndex = brief
    ? WATHEEQ_LIFECYCLE_STAGES.indexOf(brief.status)
    : -1;

  // Renewal-window mapping. The brief carries only `renewal_date` (no
  // notice-window / auto-renew fields), so derive overdue/upcoming days directly
  // from the calendar diff; the banner self-hides when neither applies.
  const renewalDate = parseIso(brief?.renewal_date);
  const renewalDiff = renewalDate
    ? differenceInCalendarDays(renewalDate, new Date())
    : null;
  const renewalOverdueDays =
    renewalDiff != null && renewalDiff < 0 ? Math.abs(renewalDiff) : undefined;
  const renewalUpcomingDays =
    renewalDiff != null && renewalDiff >= 0 ? renewalDiff : undefined;

  // Fold the brief's top risks into the actionable findings list.
  const riskFindings: RiskFinding[] = useMemo(
    () =>
      (brief?.top_risks ?? []).map<RiskFinding>((risk) => {
        const localized = localizeContractBriefRisk(
          risk,
          locale,
          riskTokenLabels,
          valueFormatters,
        );
        return {
          title: localized.title,
          severity: localized.severity,
          severityLabel: localizeRiskLevelToken(localized.severity, locale, riskTokenLabels),
          description: localized.description,
          recommendation: localized.recommendation ?? undefined,
          clauseType: localized.clause_type ?? undefined,
          id: localized.clause_reference ?? `${localized.title}-${localized.severity}`,
        };
      }),
    [brief?.top_risks, locale, riskTokenLabels, valueFormatters],
  );

  const typeLabel = brief ? typeLabels[brief.type] ?? titleCase(brief.type) : '';
  const statusLabel = brief
    ? statusTokenLabels[brief.status] ?? titleCase(brief.status)
    : '';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        dir={direction}
        className="flex h-full w-[calc(100vw-1rem)] flex-col overflow-y-auto p-0 sm:max-w-2xl"
      >
        {briefQuery.isLoading ? (
          <PreviewLoading />
        ) : briefQuery.isError ? (
          <div className="flex flex-1 items-center justify-center px-6 py-10">
            <ErrorState
              message={detailLabels.brief.loadError}
              onRetry={() => void briefQuery.refetch()}
              error={briefQuery.error}
            />
          </div>
        ) : brief ? (
          <>
            <div className="border-b border-border/70 px-6 py-5">
              <SheetHeader className="space-y-3 text-start">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{statusLabel}</Badge>
                  <Badge variant="outline">{typeLabel}</Badge>
                  <span className="inline-flex items-center gap-1.5">
                    <SeverityIndicator
                      severity={toIndicatorSeverity(brief.risk_level)}
                      showLabel={false}
                      size="sm"
                    />
                    <span className="text-overline font-medium text-muted-foreground">
                      {localizeRiskLevelToken(brief.risk_level, locale, riskTokenLabels)}
                    </span>
                  </span>
                </div>
                <div>
                  <SheetTitle className="pe-8 text-xl leading-tight">
                    {brief.title || detailLabels.brief.notSet}
                  </SheetTitle>
                  <SheetDescription className="mt-1">
                    {brief.counterparty || detailLabels.brief.undisclosed}
                  </SheetDescription>
                </div>
                <Button asChild variant="link" className="h-auto justify-start p-0">
                  <Link href={`/lex/contracts/${brief.contract_id}`}>
                    {labels.openDetail}
                    <ExternalLink className="ms-1.5 h-3.5 w-3.5" aria-hidden />
                  </Link>
                </Button>
              </SheetHeader>
            </div>

            <div className="flex-1 space-y-6 px-6 py-5">
              {/* Renewal banner — renders only when overdue / within window. */}
              <RenewalAlertBanner
                renewalDate={brief.renewal_date}
                daysOverdue={renewalOverdueDays}
                daysUntil={renewalUpcomingDays}
                onRenewHref={`/lex/contracts/${brief.contract_id}`}
              />

              {/* Snapshot facts. */}
              <div className="grid gap-3 sm:grid-cols-3">
                <PreviewFact label={labels.counterparty} value={brief.counterparty || detailLabels.brief.undisclosed} />
                <PreviewFact label={labels.owner} value={brief.owner || detailLabels.brief.unassigned} />
                <PreviewFact
                  label={labels.value}
                  value={
                    brief.value != null
                      ? f.formatCurrency(brief.value, { currency: brief.currency ?? 'SAR' })
                      : detailLabels.brief.undisclosed
                  }
                />
              </div>

              {/* Lifecycle stepper (always present — the pipeline is static). */}
              <PreviewSection title={labels.sectionLifecycle}>
                <ContractLifecycleStepper
                  stages={lifecycleStages}
                  currentIndex={activeStageIndex}
                  ariaLabel={detailLabels.stepper.title}
                />
              </PreviewSection>

              {/* Key dates strip — render only when at least one date exists. */}
              {brief.effective_date || brief.renewal_date || brief.expiry_date ? (
                <PreviewSection title={labels.sectionDates}>
                  <KeyDatesStrip
                    effective={brief.effective_date}
                    renewal={brief.renewal_date}
                    expiry={brief.expiry_date}
                    overdue={renewalOverdueDays != null}
                  />
                </PreviewSection>
              ) : null}

              {/* Risk panel — render when a score or summary is available. */}
              {brief.risk_score != null || brief.risk_summary ? (
                <PreviewSection title={labels.sectionRisk}>
                  <ContractRiskPanel
                    score={brief.risk_score}
                    severity={brief.risk_level}
                    severityLabel={localizeRiskLevelToken(brief.risk_level, locale, riskTokenLabels)}
                    labels={detailLabels.riskPanel}
                    summary={localizeContractGeneratedText(
                      brief.risk_summary,
                      locale,
                      riskTokenLabels,
                      valueFormatters,
                    )}
                    onOpenScore={() => {
                      onOpenChange(false);
                      router.push(`/lex/contracts/${brief.contract_id}?tab=analysis#contract-analysis-risk-summary`);
                    }}
                    onOpenClauses={() => {
                      onOpenChange(false);
                      router.push(`/lex/contracts/${brief.contract_id}?tab=analysis#contract-analysis-risk-summary`);
                    }}
                    onOpenMissingClauses={() => {
                      onOpenChange(false);
                      router.push(`/lex/contracts/${brief.contract_id}?tab=analysis#contract-analysis-flags`);
                    }}
                    onOpenComplianceFlags={() => {
                      onOpenChange(false);
                      router.push(`/lex/contracts/${brief.contract_id}?tab=analysis#contract-analysis-flags`);
                    }}
                  />
                </PreviewSection>
              ) : null}

              {/* Actionable findings — render only when the brief carries risks. */}
              {riskFindings.length > 0 ? (
                <PreviewSection title={labels.sectionFindings}>
                  <RiskFindingsList
                    findings={riskFindings}
                    contractId={brief.contract_id}
                    emptyLabel={detailLabels.findings.empty}
                    labels={{
                      recommendationPrefix: detailLabels.findings.recommendationPrefix,
                      addClause: detailLabels.findings.addClause,
                      draftWithAi: detailLabels.findings.draftWithAi,
                      view: detailLabels.findings.view,
                    }}
                  />
                </PreviewSection>
              ) : null}
            </div>

            <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border/70 bg-background/95 px-6 py-4">
              <Button asChild>
                <Link href={`/lex/contracts/${brief.contract_id}`}>
                  {labels.openDetail}
                  <ExternalLink className="ms-2 h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function PreviewLoading() {
  return (
    <div className="flex flex-1 flex-col gap-5 px-6 py-6">
      <LoadingSkeleton variant="text" count={2} />
      <LoadingSkeleton variant="card" count={1} />
      <LoadingSkeleton variant="list-item" count={3} />
    </div>
  );
}

function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-caps-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function PreviewFact({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-xl border border-border/70 bg-card/50 px-3 py-3')}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 truncate text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

/** Re-exported for callers that prefer the explicit risk-level token type. */
export type ContractPreviewRiskLevel = LexRiskLevel;
