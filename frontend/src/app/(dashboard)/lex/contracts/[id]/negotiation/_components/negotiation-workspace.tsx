'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, X } from 'lucide-react';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  negotiationLabels,
  type NegotiationLabels,
} from '../_lib/negotiation-labels';

type ChangeId = 'financial' | 'intellectual-property';
type Decision = 'pending' | 'accepted' | 'rejected';
type Decisions = Record<ChangeId, Decision>;

const INITIAL_DECISIONS: Decisions = {
  financial: 'pending',
  'intellectual-property': 'pending',
};

interface NegotiationWorkspaceProps {
  contractId: string;
  contractRef: string;
  contractTitle: string;
}

export function NegotiationWorkspace({
  contractId,
  contractRef,
  contractTitle,
}: NegotiationWorkspaceProps) {
  const { locale, direction } = useLocaleOrDefault();
  const labels = negotiationLabels[locale];
  const [decisions, setDecisions] = useState<Decisions>(INITIAL_DECISIONS);
  const [announcement, setAnnouncement] = useState('');

  const decide = (changeId: ChangeId, decision: Exclude<Decision, 'pending'>) => {
    setDecisions((current) => ({ ...current, [changeId]: decision }));
    setAnnouncement(decision === 'accepted' ? labels.accepted : labels.rejected);
  };

  const decideAll = (decision: Exclude<Decision, 'pending'>) => {
    setDecisions({
      financial: decision,
      'intellectual-property': decision,
    });
    setAnnouncement(decision === 'accepted' ? labels.allAccepted : labels.allRejected);
  };

  const summary = (
    <SummaryMetrics labels={labels} arabic={locale === 'ar'} />
  );
  const actions = (
    <SummaryActions
      labels={labels}
      decisions={decisions}
      onDecideAll={decideAll}
    />
  );

  return (
    <section
      dir={direction}
      lang={locale}
      aria-labelledby="negotiation-summary-title"
      className="-mt-2 min-w-0 text-clario-ink"
      data-testid="negotiation-workspace"
    >
      <NegotiationBreadcrumbs
        contractId={contractId}
        contractRef={contractRef}
        contractTitle={contractTitle}
        labels={labels}
        locale={locale}
      />

      <div
        dir="ltr"
        className="flex flex-col gap-4 pb-6 md:flex-row md:items-center md:justify-between"
      >
        {locale === 'ar' ? (
          <>
            <div className="order-2 md:order-1">{actions}</div>
            <div className="order-1 md:order-2">{summary}</div>
          </>
        ) : (
          <>
            <div className="order-1">{summary}</div>
            <div className="order-2">{actions}</div>
          </>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {locale === 'ar' ? (
        <ArabicComparison
          labels={labels}
          decisions={decisions}
          onDecide={decide}
        />
      ) : (
        <EnglishComparison
          labels={labels}
          decisions={decisions}
          onDecide={decide}
        />
      )}
    </section>
  );
}

function NegotiationBreadcrumbs({
  contractId,
  contractRef,
  contractTitle,
  labels,
  locale,
}: {
  contractId: string;
  contractRef: string;
  contractTitle: string;
  labels: NegotiationLabels;
  locale: 'en' | 'ar';
}) {
  const contractIdentity =
    contractRef === contractTitle ? contractRef : `${contractRef} — ${contractTitle}`;
  const crumbs = useMemo(
    () => [
      { label: labels.breadcrumbHome, href: '/lex' },
      { label: labels.breadcrumbContracts, href: '/lex/contracts' },
      {
        label: contractIdentity,
        href: `/lex/contracts/${encodeURIComponent(contractId)}`,
      },
      { label: labels.breadcrumbCurrent },
    ],
    [contractId, contractIdentity, labels],
  );

  return (
    <nav
      aria-label={locale === 'ar' ? 'مسار التنقل' : 'Breadcrumb'}
      className="overflow-x-auto py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ol dir="ltr" className="flex min-w-max items-center gap-2 text-[13px]">
        {crumbs.map((crumb, index) => (
          <li key={`${crumb.label}-${index}`} className="flex items-center gap-2">
            {crumb.href ? (
              <Link
                href={crumb.href}
                dir={locale === 'ar' ? 'rtl' : 'ltr'}
                className="rounded-sm text-clario-muted outline-none transition-colors hover:text-clario-primary focus-visible:ring-2 focus-visible:ring-clario-primary"
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                dir={locale === 'ar' ? 'rtl' : 'ltr'}
                aria-current="page"
                className="font-semibold text-clario-ink"
              >
                {crumb.label}
              </span>
            )}
            {index < crumbs.length - 1 ? (
              <ChevronRight
                aria-hidden
                className="h-3 w-3 shrink-0 text-clario-muted"
              />
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function SummaryMetrics({
  labels,
  arabic,
}: {
  labels: NegotiationLabels;
  arabic: boolean;
}) {
  return (
    <div
      dir={arabic ? 'rtl' : 'ltr'}
      className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2"
    >
      <h1
        id="negotiation-summary-title"
        className="text-[18px] font-bold leading-[1.2] text-clario-ink"
      >
        {labels.summaryTitle}
      </h1>
      <Metric
        label={labels.additions}
        className="bg-success-50 text-success-700 dark:bg-success-700/20 dark:text-success-300"
        dot={arabic ? 'bg-success-700 dark:bg-success-300' : undefined}
      />
      <Metric
        label={labels.deletions}
        className="bg-error-50 text-error-700 dark:bg-error-700/20 dark:text-error-300"
        dot={arabic ? 'bg-error-700 dark:bg-error-300' : undefined}
      />
      <Metric
        label={labels.modifications}
        className="bg-warning-50 text-warning-800 dark:bg-warning-700/20 dark:text-warning-300"
        dot={arabic ? 'bg-warning-800 dark:bg-warning-300' : undefined}
      />
    </div>
  );
}

function Metric({
  label,
  className,
  dot,
}: {
  label: string;
  className: string;
  dot?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-[13px] font-bold leading-[1.2]',
        className,
      )}
    >
      {dot ? <span aria-hidden className={cn('h-2 w-2 rounded-full', dot)} /> : null}
      {label}
    </span>
  );
}

function SummaryActions({
  labels,
  decisions,
  onDecideAll,
}: {
  labels: NegotiationLabels;
  decisions: Decisions;
  onDecideAll: (decision: Exclude<Decision, 'pending'>) => void;
}) {
  const allAccepted = Object.values(decisions).every((value) => value === 'accepted');
  const allRejected = Object.values(decisions).every((value) => value === 'rejected');

  return (
    <div className="flex flex-wrap items-center gap-3" dir="ltr">
      <Button
        type="button"
        variant="outline"
        aria-pressed={allRejected}
        onClick={() => onDecideAll('rejected')}
        className={cn(
          'h-auto min-h-10 rounded-lg border-error-600 bg-error-50 px-5 py-2.5 text-[14px] font-bold leading-[1.2] text-error-700',
          'hover:border-error-700 hover:bg-error-100 hover:text-error-700 focus-visible:ring-error-700 dark:border-error-300 dark:bg-error-700/20 dark:text-error-300 dark:hover:bg-error-700/30 dark:hover:text-error-300',
          allRejected && 'bg-error-700 text-white hover:bg-error-600 hover:text-white dark:bg-error-300 dark:text-clario-ink dark:hover:bg-error-100 dark:hover:text-clario-ink',
        )}
      >
        {labels.rejectAll}
      </Button>
      <Button
        type="button"
        aria-pressed={allAccepted}
        onClick={() => onDecideAll('accepted')}
        className={cn(
          'h-auto min-h-10 rounded-lg bg-success-700 px-5 py-2.5 text-[14px] font-bold leading-[1.2] text-white',
          'hover:bg-success-600 focus-visible:ring-success-700 dark:bg-success-300 dark:text-clario-ink dark:hover:bg-success-100',
          allAccepted && 'ring-2 ring-clario-ink ring-offset-2',
        )}
      >
        {labels.acceptAll}
      </Button>
    </div>
  );
}

function EnglishComparison({
  labels,
  decisions,
  onDecide,
}: ComparisonProps) {
  return (
    <div dir="ltr" className="grid min-w-0 gap-6 pb-10 lg:grid-cols-2">
      <section aria-labelledby="original-draft-heading" className="min-w-0">
        <h2
          id="original-draft-heading"
          className="mb-4 text-[15px] font-bold leading-[1.2] text-clario-muted"
        >
          {labels.originalDraft}
        </h2>
        <article className="rounded-2xl border border-outline bg-card p-4 sm:p-6">
          <ClauseBlock title={labels.financialTitle}>
            <p>{labels.originalFinancialText}</p>
          </ClauseBlock>
          <Divider />
          <ClauseBlock title={labels.intellectualPropertyTitle}>
            <div className="rounded-lg bg-error-50 p-3 text-error-700 line-through dark:bg-error-700/20 dark:text-error-300">
              {labels.originalIntellectualPropertyText}
            </div>
          </ClauseBlock>
        </article>
      </section>

      <section aria-labelledby="modified-proposal-heading" className="min-w-0">
        <h2
          id="modified-proposal-heading"
          className="mb-4 text-[15px] font-bold leading-[1.2] text-success-700 dark:text-success-300"
        >
          {labels.modifiedProposal}
        </h2>
        <article className="rounded-2xl border border-outline bg-card p-4 sm:p-6">
          <ClauseBlock
            title={labels.financialTitle}
            actions={
              <TextDecisionControls
                labels={labels}
                decision={decisions.financial}
                onDecide={(decision) => onDecide('financial', decision)}
              />
            }
          >
            <div
              className={cn(
                'rounded-lg bg-warning-50 p-3 transition-opacity dark:bg-warning-700/20',
                decisions.financial === 'rejected' && 'opacity-55',
              )}
            >
              {labels.modifiedFinancialPrefix}
              <strong className="font-bold text-warning-800 dark:text-warning-300">
                {labels.modifiedFinancialAmount}
              </strong>
              {labels.modifiedFinancialMiddle}
              <strong className="font-bold text-warning-800 dark:text-warning-300">
                {labels.modifiedFinancialInstallments}
              </strong>
              {labels.modifiedFinancialSuffix}
            </div>
          </ClauseBlock>
          <Divider />
          <ClauseBlock
            title={labels.intellectualPropertyTitle}
            actions={
              <TextDecisionControls
                labels={labels}
                decision={decisions['intellectual-property']}
                onDecide={(decision) => onDecide('intellectual-property', decision)}
              />
            }
          >
            <div
              className={cn(
                'rounded-lg bg-success-50 p-3 text-success-700 transition-opacity dark:bg-success-700/20 dark:text-success-300',
                decisions['intellectual-property'] === 'rejected' && 'opacity-55',
              )}
            >
              {labels.modifiedIntellectualPropertyText}
            </div>
          </ClauseBlock>
        </article>
      </section>
    </div>
  );
}

function ArabicComparison({
  labels,
  decisions,
  onDecide,
}: ComparisonProps) {
  return (
    <div dir="ltr" className="grid min-w-0 gap-6 pb-10 lg:grid-cols-2">
      <section
        dir="rtl"
        aria-labelledby="modified-version-heading"
        className="order-2 min-w-0 lg:order-1"
      >
        <article className="rounded-2xl border border-outline bg-card p-4 sm:p-6">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-outline pb-3">
            <h2
              id="modified-version-heading"
              className="text-[16px] font-bold leading-[1.2]"
            >
              {labels.modifiedVersion}
            </h2>
            <span className="rounded-md bg-success-50 px-3 py-1 text-[12px] font-bold text-success-700 dark:bg-success-700/20 dark:text-success-300">
              {labels.proposedChange}
            </span>
          </header>

          <ArabicChangeCard
            tone="addition"
            title={labels.recentlyAdded}
            decision={decisions['intellectual-property']}
            labels={labels}
            onDecide={(decision) => onDecide('intellectual-property', decision)}
          >
            {labels.newClauseText}
          </ArabicChangeCard>

          <ArabicChangeCard
            tone="modification"
            title={labels.modifiedClause}
            decision={decisions.financial}
            labels={labels}
            onDecide={(decision) => onDecide('financial', decision)}
          >
            {labels.warrantyPrefix}
            <strong className="font-bold text-warning-800 dark:text-warning-300">
              {labels.warrantyDuration}
            </strong>
            {labels.warrantySuffix}
          </ArabicChangeCard>
        </article>
      </section>

      <section
        dir="rtl"
        aria-labelledby="original-version-heading"
        className="order-1 min-w-0 lg:order-2"
      >
        <article className="rounded-2xl border border-outline bg-card p-4 sm:p-6">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2
              id="original-version-heading"
              className="text-[16px] font-bold leading-[1.2]"
            >
              {labels.originalVersion}
            </h2>
            <p className="text-[14px] leading-[1.2] text-clario-muted">
              {labels.reviewDate}
            </p>
          </header>
          <div className="flex min-h-28 items-center justify-center rounded-xl border border-outline bg-surface-sunken p-4 text-center text-[13px] text-neutral-700 dark:text-neutral-300">
            {labels.noPreviousText}
          </div>
          <div className="mt-4 rounded-xl border border-error-300 bg-error-50 p-4 dark:border-error-700/50 dark:bg-error-700/20">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <strong className="text-[13px] font-bold text-error-700 dark:text-error-300">
                {labels.oldText}
              </strong>
              <span className="text-[11px] text-neutral-700 dark:text-neutral-300">
                {labels.duplicateClause}
              </span>
            </div>
            <p className="text-[14px] leading-[1.2] text-neutral-800 line-through dark:text-neutral-200">
              {labels.deletedWarrantyText}
            </p>
          </div>
        </article>
      </section>
    </div>
  );
}

interface ComparisonProps {
  labels: NegotiationLabels;
  decisions: Decisions;
  onDecide: (changeId: ChangeId, decision: Exclude<Decision, 'pending'>) => void;
}

function ClauseBlock({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 text-[14px] leading-[1.2]">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[16px] font-bold leading-[1.2]">{title}</h3>
        {actions}
      </header>
      {children}
    </section>
  );
}

function Divider() {
  return <div aria-hidden className="my-4 h-px w-full bg-outline" />;
}

function TextDecisionControls({
  labels,
  decision,
  onDecide,
}: {
  labels: NegotiationLabels;
  decision: Decision;
  onDecide: (decision: Exclude<Decision, 'pending'>) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={decision === 'rejected'}
        onClick={() => onDecide('rejected')}
        className={cn(
          'h-auto min-h-7 rounded bg-error-50 px-2.5 py-1 text-[11px] font-semibold leading-[1.2] text-error-700',
          'hover:bg-error-100 hover:text-error-700 focus-visible:ring-error-700 dark:bg-error-700/20 dark:text-error-300 dark:hover:bg-error-700/30 dark:hover:text-error-300',
          decision === 'rejected' && 'bg-error-700 text-white hover:bg-error-600 hover:text-white dark:bg-error-300 dark:text-clario-ink dark:hover:bg-error-100 dark:hover:text-clario-ink',
        )}
      >
        {labels.reject}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={decision === 'accepted'}
        onClick={() => onDecide('accepted')}
        className={cn(
          'h-auto min-h-7 rounded bg-success-50 px-2.5 py-1 text-[11px] font-semibold leading-[1.2] text-success-700',
          'hover:bg-success-100 hover:text-success-700 focus-visible:ring-success-700 dark:bg-success-700/20 dark:text-success-300 dark:hover:bg-success-700/30 dark:hover:text-success-300',
          decision === 'accepted' && 'bg-success-700 text-white hover:bg-success-600 hover:text-white dark:bg-success-300 dark:text-clario-ink dark:hover:bg-success-100 dark:hover:text-clario-ink',
        )}
      >
        {labels.accept}
      </Button>
    </div>
  );
}

function ArabicChangeCard({
  tone,
  title,
  labels,
  decision,
  onDecide,
  children,
}: {
  tone: 'addition' | 'modification';
  title: string;
  labels: NegotiationLabels;
  decision: Decision;
  onDecide: (decision: Exclude<Decision, 'pending'>) => void;
  children: React.ReactNode;
}) {
  const addition = tone === 'addition';

  return (
    <section
      className={cn(
        'mt-3 rounded-xl border p-4 text-[14px] leading-[1.2] transition-opacity',
        addition
          ? 'border-success-600 bg-success-50 dark:border-success-300 dark:bg-success-700/20'
          : 'border-warning-500 bg-warning-50 dark:border-warning-500/60 dark:bg-warning-700/20',
        decision === 'rejected' && 'opacity-55',
      )}
    >
      <header className="mb-2 flex flex-wrap-reverse items-center justify-between gap-2">
        <strong
          className={cn(
            'text-[13px] font-bold',
            addition
              ? 'text-success-700 dark:text-success-300'
              : 'text-warning-800 dark:text-warning-300',
          )}
        >
          {title}
        </strong>
        <IconDecisionControls
          labels={labels}
          decision={decision}
          onDecide={onDecide}
        />
      </header>
      <p>{children}</p>
    </section>
  );
}

function IconDecisionControls({
  labels,
  decision,
  onDecide,
}: {
  labels: NegotiationLabels;
  decision: Decision;
  onDecide: (decision: Exclude<Decision, 'pending'>) => void;
}) {
  return (
    <div dir="ltr" className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={labels.reject}
        title={labels.reject}
        aria-pressed={decision === 'rejected'}
        onClick={() => onDecide('rejected')}
        className={cn(
          'h-7 min-h-7 w-7 min-w-7 rounded-md border-outline bg-card p-0 text-error-700 dark:text-error-300',
          'hover:border-error-700 hover:bg-error-50 hover:text-error-700 focus-visible:ring-error-700 dark:hover:border-error-300 dark:hover:bg-error-700/20 dark:hover:text-error-300',
          decision === 'rejected' && 'border-error-700 bg-error-700 text-white hover:text-white dark:border-error-300 dark:bg-error-300 dark:text-clario-ink dark:hover:text-clario-ink',
        )}
      >
        <X aria-hidden className="h-3.5 w-3.5" strokeWidth={2.4} />
      </Button>
      <Button
        type="button"
        size="icon"
        aria-label={labels.accept}
        title={labels.accept}
        aria-pressed={decision === 'accepted'}
        onClick={() => onDecide('accepted')}
        className={cn(
          'h-7 min-h-7 w-7 min-w-7 rounded-md bg-success-700 p-0 text-white',
          'hover:bg-success-600 focus-visible:ring-success-700 focus-visible:ring-offset-1 dark:bg-success-300 dark:text-clario-ink dark:hover:bg-success-100',
          decision === 'accepted' && 'ring-2 ring-clario-ink ring-offset-1',
        )}
      >
        <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={2.4} />
      </Button>
    </div>
  );
}
