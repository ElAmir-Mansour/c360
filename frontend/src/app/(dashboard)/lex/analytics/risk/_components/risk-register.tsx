'use client';

/**
 * Risk Register — the relationship core of the Risk Portfolio page.
 *
 * One row per risk-bearing record across ALL Lex domains (contracts, cases,
 * requests, investigations, consultations, settlements), with the explicit
 * relationship counts inline — "3 obligations (1 overdue) · 7 controls
 * (2 failing) · compliance at-risk" — and an expandable drill-in that reveals the
 * two PARALLEL legs (Obligations | Controls) as deep-linkable rows. Records whose
 * domain has no real downstream links render an honest empty leg rather than a
 * fabricated relationship. Everything lives on one page; no tab-hopping.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronRight,
  ClipboardList,
  FileText,
  Gauge,
  Layers,
  ListChecks,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useLexFormat } from '@/lib/lex/ksa';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/suites/section-card';
import { useRiskLabels } from '../_lib/risk-labels';
import {
  useRiskRegister,
  type ComplianceStatus,
  type RiskDomain,
  type RiskRecord,
  type RiskRelationLink,
  type RiskSeverity,
} from '../_lib/use-risk-register';

const DOMAIN_ORDER: readonly RiskDomain[] = [
  'contract', 'case', 'request', 'investigation', 'consultation', 'settlement',
];
const SEVERITY_ORDER: readonly RiskSeverity[] = ['critical', 'high', 'medium', 'low', 'none'];

type DomainFilter = 'all' | RiskDomain;
type SeverityFilter = 'all' | RiskSeverity;

export function RiskRegisterSection() {
  const labels = useRiskLabels();
  const f = useLexFormat();
  const R = labels.register;
  const { records, summary, isLoading, isError, refetch } = useRiskRegister();

  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState<DomainFilter>('all');
  const [severity, setSeverity] = useState<SeverityFilter>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      if (domain !== 'all' && r.domain !== domain) return false;
      if (severity !== 'all' && r.severity !== severity) return false;
      if (q && !(`${r.title} ${r.reference ?? ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [records, query, domain, severity]);

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" aria-hidden />
          {R.title}
        </span>
      }
      description={R.description}
      className="border-border/70 shadow-elevation-1"
      headerToolbar={
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex min-w-[12rem] flex-1 items-center">
            <Search className="pointer-events-none absolute start-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={R.searchPlaceholder}
              aria-label={R.searchPlaceholder}
              className="h-8 w-full rounded-lg border border-border/70 bg-background ps-8 pe-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            />
          </label>
          <Segmented
            value={domain}
            onChange={setDomain}
            options={[
              { value: 'all', label: R.filterAll },
              ...DOMAIN_ORDER.map((d) => ({
                value: d,
                label: `${R.domains[d]}${summary ? ` ${f.formatNumber(summary.byDomain[d])}` : ''}`,
              })),
            ]}
          />
          <Segmented
            value={severity}
            onChange={setSeverity}
            options={[
              { value: 'all', label: R.filterAll },
              ...SEVERITY_ORDER.filter((s) => s !== 'none').map((s) => ({ value: s, label: R.severity[s] })),
            ]}
          />
        </div>
      }
    >
      {isLoading ? (
        <RegisterSkeleton />
      ) : isError ? (
        <EmptyRow icon={ShieldAlert} title={R.empty} hint={R.emptyHint} onRetry={() => refetch()} retryLabel={labels.page.refresh} />
      ) : filtered.length === 0 ? (
        <EmptyRow icon={ListChecks} title={R.empty} hint={R.emptyHint} />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[52rem]">
            {/* Header */}
            <div className="grid grid-cols-[minmax(0,2.4fr)_7rem_8rem_8rem_7rem_1.5rem] items-center gap-3 border-b border-border/60 px-3 pb-2 text-caption font-medium uppercase tracking-label text-muted-foreground">
              <span>{R.colRecord}</span>
              <span>{R.colSeverity}</span>
              <span>{R.colObligations}</span>
              <span>{R.colControls}</span>
              <span>{R.colCompliance}</span>
              <span className="sr-only">{R.expand}</span>
            </div>
            <ul className="divide-y divide-border/50">
              {filtered.map((rec) => (
                <RegisterRow key={rec.key} rec={rec} labels={labels} f={f} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------- *
 * Row
 * ------------------------------------------------------------------------- */

function RegisterRow({
  rec,
  labels,
  f,
}: {
  rec: RiskRecord;
  labels: ReturnType<typeof useRiskLabels>;
  f: ReturnType<typeof useLexFormat>;
}) {
  const [open, setOpen] = useState(false);
  const R = labels.register;

  const toggle = () => setOpen((v) => !v);

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
        aria-expanded={open}
        className="grid w-full cursor-pointer grid-cols-[minmax(0,2.4fr)_7rem_8rem_8rem_7rem_1.5rem] items-center gap-3 px-3 py-2.5 text-start transition-colors hover:bg-muted/30 focus:outline-none focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {/* Record */}
        <span className="flex min-w-0 items-center gap-2.5">
          <DomainChip domain={rec.domain} labels={labels} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{rec.title}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {rec.reference ?? R.domains[rec.domain]}
              {rec.value ? ` · ${f.formatCurrencyCompact(rec.value)}` : ''}
            </span>
          </span>
        </span>

        {/* Severity */}
        <span>
          <SeverityPill severity={rec.severity} labels={labels} />
        </span>

        {/* Obligations */}
        <RelationCell
          available={rec.relationsAvailable}
          primary={rec.relationsAvailable ? `${f.formatNumber(rec.obligationOpen)} ${R.obligationsLabel}` : '—'}
          detail={rec.obligationOverdue > 0 ? `${f.formatNumber(rec.obligationOverdue)} ${R.overdueLabel}` : undefined}
          detailTone="danger"
        />

        {/* Controls */}
        <RelationCell
          available={rec.relationsAvailable}
          primary={rec.relationsAvailable ? `${f.formatNumber(rec.controlCount)} ${R.controlsLabel}` : '—'}
          detail={rec.failingCount > 0 ? `${f.formatNumber(rec.failingCount)} ${R.failingLabel}` : undefined}
          detailTone="danger"
        />

        {/* Compliance */}
        <span>
          {rec.relationsAvailable ? (
            <ComplianceChip status={rec.compliance} labels={labels} />
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </span>

        {/* Chevron */}
        <ChevronRight
          className={cn('h-4 w-4 justify-self-end text-muted-foreground transition-transform rtl:-scale-x-100', open && 'rotate-90 rtl:-rotate-90')}
          aria-hidden
        />
      </div>

      {open ? <RelationDrilldown rec={rec} labels={labels} f={f} /> : null}
    </li>
  );
}

/* ------------------------------------------------------------------------- *
 * Expanded two-leg relationship panel (fan-out, not a linear chain)
 * ------------------------------------------------------------------------- */

function RelationDrilldown({
  rec,
  labels,
  f,
}: {
  rec: RiskRecord;
  labels: ReturnType<typeof useRiskLabels>;
  f: ReturnType<typeof useLexFormat>;
}) {
  const R = labels.register;

  // The explicit relationship summary the user asked for, rendered honestly.
  const summaryLine = rec.relationsAvailable
    ? `${f.formatNumber(rec.obligationOpen)} ${R.obligationsLabel}${
        rec.obligationOverdue > 0 ? ` (${f.formatNumber(rec.obligationOverdue)} ${R.overdueLabel})` : ''
      } · ${f.formatNumber(rec.controlCount)} ${R.controlsLabel}${
        rec.failingCount > 0 ? ` (${f.formatNumber(rec.failingCount)} ${R.failingLabel})` : ''
      } · ${R.compliance[rec.compliance]}`
    : R.derivedNote;

  return (
    <div className="border-t border-border/40 bg-muted/15 px-3 py-3">
      <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Gauge className="h-3.5 w-3.5 text-primary" aria-hidden />
        <span className="font-medium text-foreground">{rec.title}</span>
        <ChevronRight className="h-3 w-3 rtl:-scale-x-100" aria-hidden />
        <span>{summaryLine}</span>
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <RelationLeg
          icon={ListChecks}
          title={`${R.relationsObligations}${rec.relationsAvailable ? ` · ${f.formatNumber(rec.obligationOpen)}` : ''}`}
          links={rec.obligations}
          empty={rec.relationsAvailable ? R.noObligations : R.noLegsForDomain}
        />
        <RelationLeg
          icon={ShieldAlert}
          title={`${R.relationsControls}${rec.relationsAvailable ? ` · ${f.formatNumber(rec.controlCount)}` : ''}`}
          links={rec.controls}
          empty={
            rec.relationsAvailable
              ? rec.failingCount === 0
                ? R.noFailingControls
                : R.noControls
              : R.noLegsForDomain
          }
        />
      </div>

      {rec.href ? (
        <Link
          href={rec.href}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {R.openRecord}
          <ChevronRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

function RelationLeg({
  icon: Icon,
  title,
  links,
  empty,
}: {
  icon: typeof ListChecks;
  title: string;
  links: RiskRelationLink[];
  empty: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-3">
      <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-label text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
        {title}
      </h4>
      {links.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {links.map((l) => (
            <li key={l.id}>
              <RelationLinkRow link={l} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RelationLinkRow({ link }: { link: RiskRelationLink }) {
  const body = (
    <span className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-border/60 hover:bg-muted/40">
      <span
        className={cn(
          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
          link.overdue ? 'bg-error-50 text-error-600 dark:bg-error-700/20 dark:text-error-300' : 'bg-primary/10 text-primary',
        )}
      >
        <FileText className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{link.label}</span>
        {link.sub ? <span className="block truncate text-[11px] text-muted-foreground">{link.sub}</span> : null}
      </span>
      {link.status ? (
        <span className="shrink-0 rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {link.status}
        </span>
      ) : null}
      {link.href ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:-scale-x-100" aria-hidden /> : null}
    </span>
  );
  return link.href ? (
    <Link href={link.href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
      {body}
    </Link>
  ) : (
    body
  );
}

/* ------------------------------------------------------------------------- *
 * Presentational primitives (token-styled, self-contained)
 * ------------------------------------------------------------------------- */

const SEVERITY_CLASSES: Record<RiskSeverity, string> = {
  critical: 'border-error-300/70 bg-error-50 text-error-700 dark:border-error-700/60 dark:bg-error-700/15 dark:text-error-200',
  high: 'border-warning-300/70 bg-warning-50 text-warning-800 dark:border-warning-700/60 dark:bg-warning-700/15 dark:text-warning-200',
  medium: 'border-amber-300/70 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-700/15 dark:text-amber-200',
  low: 'border-success-300/70 bg-success-50 text-success-800 dark:border-success-700/60 dark:bg-success-700/15 dark:text-success-200',
  none: 'border-border/70 bg-muted/30 text-muted-foreground',
};

function SeverityPill({ severity, labels }: { severity: RiskSeverity; labels: ReturnType<typeof useRiskLabels> }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        SEVERITY_CLASSES[severity],
      )}
    >
      {labels.register.severity[severity]}
    </span>
  );
}

const COMPLIANCE_CLASSES: Record<ComplianceStatus, string> = {
  healthy: 'border-success-300/70 bg-success-50 text-success-800 dark:border-success-700/60 dark:bg-success-700/15 dark:text-success-200',
  watch: 'border-warning-300/70 bg-warning-50 text-warning-800 dark:border-warning-700/60 dark:bg-warning-700/15 dark:text-warning-200',
  at_risk: 'border-error-300/70 bg-error-50 text-error-700 dark:border-error-700/60 dark:bg-error-700/15 dark:text-error-200',
  none: 'border-border/70 bg-muted/30 text-muted-foreground',
};

function ComplianceChip({ status, labels }: { status: ComplianceStatus; labels: ReturnType<typeof useRiskLabels> }) {
  const Icon = status === 'healthy' ? ShieldCheck : ShieldAlert;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', COMPLIANCE_CLASSES[status])}>
      <Icon className="h-3 w-3" aria-hidden />
      {labels.register.compliance[status]}
    </span>
  );
}

const DOMAIN_ICONS: Record<RiskDomain, typeof FileText> = {
  contract: FileText,
  case: ClipboardList,
  request: ListChecks,
  investigation: ShieldAlert,
  consultation: Layers,
  settlement: Gauge,
};

function DomainChip({ domain, labels }: { domain: RiskDomain; labels: ReturnType<typeof useRiskLabels> }) {
  const Icon = DOMAIN_ICONS[domain];
  return (
    <span
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
      title={labels.register.domains[domain]}
      aria-label={labels.register.domains[domain]}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </span>
  );
}

function RelationCell({
  available,
  primary,
  detail,
  detailTone,
}: {
  available: boolean;
  primary: string;
  detail?: string;
  detailTone?: 'danger';
}) {
  return (
    <span className="flex flex-col">
      <span className={cn('text-sm', available ? 'text-foreground' : 'text-muted-foreground')}>{primary}</span>
      {detail ? (
        <span className={cn('text-[11px] font-medium', detailTone === 'danger' ? 'text-error-600 dark:text-error-300' : 'text-muted-foreground')}>
          {detail}
        </span>
      ) : null}
    </span>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border/70 bg-muted/20 p-0.5">
      {options.map((o) => (
        <Button
          key={o.value}
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(o.value)}
          className={cn(
            'h-7 rounded-md px-2 text-xs font-medium',
            value === o.value
              ? 'bg-card text-foreground shadow-elevation-1'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function EmptyRow({
  icon: Icon,
  title,
  hint,
  onRetry,
  retryLabel,
}: {
  icon: typeof ListChecks;
  title: string;
  hint: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/10 px-6 py-10 text-center">
      <Icon className="h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-md text-xs text-muted-foreground">{hint}</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-1">
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

function RegisterSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-12 w-full rounded-lg skeleton-shimmer" />
      ))}
    </div>
  );
}
