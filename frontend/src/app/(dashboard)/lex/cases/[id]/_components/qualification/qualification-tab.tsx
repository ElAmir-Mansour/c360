'use client';

/**
 * Case Qualification & Evidence tab (تأهيل القضية والأدلة).
 *
 * Composes the legal-fitness checklist + case-file readiness (persisted in
 * `metadata.qualification` via {@link useCaseQualification}), the case-strength
 * posture (derived from the assessed risk matrix), and read-only summaries of
 * the real evidence documents, witnesses (parties role=witness) and expert
 * reports — each deep-linking into its full tab. Every value is backed by a real
 * endpoint; nothing is fabricated.
 */

import { useState } from 'react';
import {
  CheckCircle2,
  FileText,
  FolderOpen,
  Gavel,
  Loader2,
  Plus,
  ScrollText,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useLexFormat } from '@/lib/lex/ksa';
import type { CaseDocumentLink, LegalCase, LegalExpertAssignment, CaseParty } from '@/lib/lex/cases';
import {
  QUALIFICATION_CRITERIA,
  useQualificationLabels,
  type PositionBand,
  type QualificationLabels,
} from './qualification-i18n';
import { useCaseQualification } from './use-case-qualification';

interface QualificationTabProps {
  legalCase: LegalCase;
  caseId: string;
  canWrite: boolean;
  onChanged: () => Promise<void> | void;
  onOpenTab: (tab: string) => void;
}

function formatBytes(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

const BAND_BAR: Record<PositionBand, string> = {
  very_strong: 'bg-success-500',
  strong: 'bg-brand-primary-600',
  moderate: 'bg-warning-500',
  weak: 'bg-error-500',
};
const BAND_TEXT: Record<PositionBand, string> = {
  very_strong: 'text-success-600 dark:text-success-400',
  strong: 'text-brand-primary-700 dark:text-brand-primary-400',
  moderate: 'text-warning-600 dark:text-warning-400',
  weak: 'text-error-600 dark:text-error-400',
};

export function QualificationTab({
  legalCase,
  caseId,
  canWrite,
  onChanged,
  onOpenTab,
}: QualificationTabProps) {
  const t = useQualificationLabels();
  const f = useLexFormat();
  const q = useCaseQualification({ legalCase, caseId, canWrite, onChanged, labels: t });
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div id="qualification-criteria" className="scroll-mt-24">
            <FitnessChecklist
              checked={q.record.criteria}
              onToggle={q.toggleCriterion}
              canWrite={canWrite}
              saving={q.saving}
              t={t}
            />
          </div>
          <div id="qualification-evidence" className="scroll-mt-24">
            <EvidencePanel
              documents={q.documents}
              loading={q.documentsLoading}
              onManage={() => onOpenTab('documents')}
              t={t}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <WitnessesPanel
              witnesses={q.witnesses}
              onManage={() => onOpenTab('parties')}
              t={t}
            />
            <ExpertReportsPanel
              experts={q.experts}
              loading={q.expertsLoading}
              onManage={() => onOpenTab('experts')}
              t={t}
            />
          </div>
        </div>

        <div className="space-y-4">
          <StrengthCenter
            legalCase={legalCase}
            posture={q.posture}
            strongPoints={q.record.strong_points}
            weakPoints={q.record.weak_points}
            canWrite={canWrite}
            onSetPoints={q.setPoints}
            t={t}
          />
          <ReadinessCard
            metCount={q.metCount}
            totalCount={q.totalCount}
            readinessPct={q.readinessPct}
            evidenceCount={q.documents.length}
            isComplete={q.isComplete}
            allCriteriaMet={q.allCriteriaMet}
            completedAt={q.record.completed_at}
            saving={q.saving}
            requesting={q.requesting}
            canWrite={canWrite}
            onComplete={() => setConfirmOpen(true)}
            onReopen={q.reopen}
            onRequestDocs={q.requestDocs}
            f={f}
            t={t}
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t.confirmComplete.title}
        description={t.confirmComplete.description}
        confirmLabel={t.confirmComplete.confirm}
        cancelLabel={t.confirmComplete.cancel}
        onConfirm={() => {
          q.complete();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Legal-fitness checklist
 * ------------------------------------------------------------------------- */

function FitnessChecklist({
  checked,
  onToggle,
  canWrite,
  saving,
  t,
}: {
  checked: Partial<Record<(typeof QUALIFICATION_CRITERIA)[number], boolean>>;
  onToggle: (c: (typeof QUALIFICATION_CRITERIA)[number], v: boolean) => void;
  canWrite: boolean;
  saving: boolean;
  t: QualificationLabels;
}) {
  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-primary" aria-hidden />
          {t.checklist.title}
        </span>
      }
      description={t.checklist.description}
      actions={saving ? <SavingChip label={t.checklist.savingHint} /> : undefined}
    >
      <ul className="space-y-2.5">
        {QUALIFICATION_CRITERIA.map((criterion) => {
          const isChecked = Boolean(checked[criterion]);
          const id = `qualification-${criterion}`;
          return (
            <li key={criterion}>
              <label
                htmlFor={id}
                className={cn(
                  'flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors',
                  isChecked
                    ? 'border-success-200 bg-success-50/60 dark:border-success-800/50 dark:bg-success-900/15'
                    : 'border-border bg-card',
                  canWrite ? 'cursor-pointer hover:bg-muted/40' : 'cursor-default',
                )}
              >
                <Checkbox
                  id={id}
                  checked={isChecked}
                  disabled={!canWrite}
                  onCheckedChange={(v) => onToggle(criterion, v === true)}
                  className="mt-0.5"
                />
                <span className="text-body-sm text-foreground">{t.checklist.criteria[criterion]}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------- *
 * Evidence & attached documents
 * ------------------------------------------------------------------------- */

function EvidencePanel({
  documents,
  loading,
  onManage,
  t,
}: {
  documents: CaseDocumentLink[];
  loading: boolean;
  onManage: () => void;
  t: QualificationLabels;
}) {
  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-primary" aria-hidden />
          {t.evidence.title}
        </span>
      }
      description={t.evidence.description}
      actions={
        <div className="flex items-center gap-2">
          {documents.length > 0 ? (
            <Badge variant="secondary" className="tabular-nums">
              {t.evidence.onFile(String(documents.length))}
            </Badge>
          ) : null}
          <Button size="sm" variant="outline" onClick={onManage}>
            {t.evidence.manage}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <EmptyState icon={FileText} title={t.evidence.empty} />
      ) : (
        <ul className="space-y-2">
          {documents.slice(0, 6).map((link) => {
            const doc = link.document ?? null;
            const name = doc?.title?.trim() || doc?.file_name?.trim() || link.notes?.trim() || t.evidence.uncategorized;
            const category = link.category?.trim() || doc?.category?.trim() || null;
            const size = formatBytes(doc?.file_size_bytes);
            return (
              <li
                key={link.id}
                className="flex items-center gap-3 rounded-xl border border-border/70 bg-card px-3.5 py-2.5"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FileText className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-sm font-medium text-foreground" dir="auto">
                    {name}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {category ? <span className="capitalize">{category}</span> : t.evidence.uncategorized}
                    {size ? <span> · {size}</span> : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------- *
 * Witnesses (parties role = witness)
 * ------------------------------------------------------------------------- */

function WitnessesPanel({
  witnesses,
  onManage,
  t,
}: {
  witnesses: CaseParty[];
  onManage: () => void;
  t: QualificationLabels;
}) {
  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" aria-hidden />
          {t.witnesses.title}
        </span>
      }
      description={t.witnesses.description}
      actions={
        <Button size="sm" variant="outline" onClick={onManage}>
          {t.witnesses.manage}
        </Button>
      }
    >
      {witnesses.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">{t.witnesses.empty}</p>
      ) : (
        <ul className="space-y-2">
          {witnesses.map((w) => (
            <li key={w.id} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-caption font-semibold text-muted-foreground">
                {w.name.trim().charAt(0).toUpperCase() || '?'}
              </span>
              <div className="min-w-0">
                <p className="truncate text-body-sm font-medium text-foreground" dir="auto">
                  {w.name}
                </p>
                <p className="truncate text-caption text-muted-foreground" dir="auto">
                  {w.contact?.trim() || w.identifier?.trim() || t.witnesses.noContact}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------- *
 * Technical expert reports
 * ------------------------------------------------------------------------- */

const EXPERT_STATUS_TONE: Record<string, 'secondary' | 'warning' | 'success' | 'destructive'> = {
  requested: 'secondary',
  appointed: 'warning',
  report_received: 'success',
  closed: 'secondary',
  cancelled: 'destructive',
};

function ExpertReportsPanel({
  experts,
  loading,
  onManage,
  t,
}: {
  experts: LegalExpertAssignment[];
  loading: boolean;
  onManage: () => void;
  t: QualificationLabels;
}) {
  const f = useLexFormat();
  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <Gavel className="h-4 w-4 text-primary" aria-hidden />
          {t.experts.title}
        </span>
      }
      description={t.experts.description}
      actions={
        <Button size="sm" variant="outline" onClick={onManage}>
          {t.experts.manage}
        </Button>
      }
    >
      {loading ? (
        <div className="h-14 animate-pulse rounded-xl bg-muted/50" />
      ) : experts.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">{t.experts.empty}</p>
      ) : (
        <ul className="space-y-2">
          {experts.map((expert) => (
            <li key={expert.id} className="rounded-xl border border-border/70 bg-card px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-body-sm font-medium text-foreground" dir="auto">
                    {expert.expert_name}
                  </p>
                  {expert.specialization ? (
                    <p className="truncate text-caption text-muted-foreground" dir="auto">
                      {expert.specialization}
                    </p>
                  ) : null}
                </div>
                <Badge variant={EXPERT_STATUS_TONE[expert.status] ?? 'secondary'} className="shrink-0">
                  {t.experts.statuses[expert.status] ?? expert.status}
                </Badge>
              </div>
              {expert.report_received_at ? (
                <p className="mt-1 text-caption text-muted-foreground">
                  {t.experts.receivedOn(f.formatDate(expert.report_received_at))}
                </p>
              ) : expert.report_due_date ? (
                <p className="mt-1 text-caption text-muted-foreground">
                  {t.experts.dueOn(f.formatDate(expert.report_due_date))}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------- *
 * Strength center (position posture derived from the risk matrix)
 * ------------------------------------------------------------------------- */

function StrengthCenter({
  legalCase,
  posture,
  strongPoints,
  weakPoints,
  canWrite,
  onSetPoints,
  t,
}: {
  legalCase: LegalCase;
  posture: { pct: number | null; band: PositionBand | null };
  strongPoints: string[];
  weakPoints: string[];
  canWrite: boolean;
  onSetPoints: (kind: 'strong_points' | 'weak_points', points: string[]) => void;
  t: QualificationLabels;
}) {
  const f = useLexFormat();
  const strengthLabel =
    legalCase.strength === 'strong'
      ? t.strength.strong
      : legalCase.strength === 'weak'
        ? t.strength.weak
        : t.strength.strengthUnset;
  const riskLabel = legalCase.risk_rating
    ? // risk_rating tokens are low|medium|high|critical — surface via band words as a compact read
      legalCase.risk_rating
    : t.strength.riskUnset;

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
          {t.strength.title}
        </span>
      }
      description={t.strength.description}
    >
      <div className="space-y-4">
        {/* Overall position-strength meter */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-caption uppercase tracking-label text-muted-foreground">
              {t.strength.overall}
            </span>
            {posture.pct !== null && posture.band ? (
              <span className={cn('text-body-sm font-bold tabular-nums', BAND_TEXT[posture.band])}>
                {t.strength.bands[posture.band]} · {f.formatNumber(posture.pct)}%
              </span>
            ) : (
              <span className="text-caption font-medium text-muted-foreground">
                {t.strength.notAssessed}
              </span>
            )}
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted">
            {posture.pct !== null && posture.band ? (
              <div
                className={cn('h-full rounded-full transition-[width] duration-500', BAND_BAR[posture.band])}
                style={{ width: `${posture.pct}%` }}
              />
            ) : null}
          </div>
          {posture.pct === null ? (
            <p className="mt-1.5 text-caption text-muted-foreground">{t.strength.assessHint}</p>
          ) : null}
        </div>

        {/* Real signals */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          <Signal label={t.strength.companyStatus} value={legalCase.company_status === 'plaintiff' ? t.strength.plaintiff : t.strength.defendant} />
          <Signal label={t.strength.strengthCall} value={strengthLabel} />
          <Signal label={t.strength.riskRating} value={riskLabel} capitalize />
          {legalCase.risk_exposure_value != null ? (
            <Signal
              label={t.strength.exposure}
              value={f.formatCurrency(legalCase.risk_exposure_value, {
                currency: legalCase.risk_exposure_currency ?? undefined,
              })}
            />
          ) : null}
        </dl>

        {legalCase.risk_rationale?.trim() ? (
          <div>
            <p className="text-caption uppercase tracking-label text-muted-foreground">{t.strength.rationale}</p>
            <p className="mt-1 whitespace-pre-line text-body-sm text-muted-foreground" dir="auto">
              {legalCase.risk_rationale}
            </p>
          </div>
        ) : null}

        <PointsEditor
          heading={t.strength.strongPoints}
          tone="strong"
          points={strongPoints}
          empty={t.strength.noStrongPoints}
          canWrite={canWrite}
          onChange={(next) => onSetPoints('strong_points', next)}
          t={t}
        />
        <PointsEditor
          heading={t.strength.weakPoints}
          tone="weak"
          points={weakPoints}
          empty={t.strength.noWeakPoints}
          canWrite={canWrite}
          onChange={(next) => onSetPoints('weak_points', next)}
          t={t}
        />
      </div>
    </SectionCard>
  );
}

function Signal({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-caption uppercase tracking-label text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-body-sm font-semibold text-foreground', capitalize && 'capitalize')} dir="auto">
        {value}
      </dd>
    </div>
  );
}

function PointsEditor({
  heading,
  tone,
  points,
  empty,
  canWrite,
  onChange,
  t,
}: {
  heading: string;
  tone: 'strong' | 'weak';
  points: string[];
  empty: string;
  canWrite: boolean;
  onChange: (next: string[]) => void;
  t: QualificationLabels;
}) {
  const [draft, setDraft] = useState('');
  const dot = tone === 'strong' ? 'bg-success-500' : 'bg-warning-500';

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...points, value]);
    setDraft('');
  };

  return (
    <div>
      <p className="text-caption uppercase tracking-label text-muted-foreground">{heading}</p>
      {points.length === 0 ? (
        <p className="mt-1 text-body-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {points.map((point, index) => (
            <li key={`${index}-${point}`} className="flex items-start gap-2">
              <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', dot)} aria-hidden />
              <span className="flex-1 text-body-sm text-foreground" dir="auto">
                {point}
              </span>
              {canWrite ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onChange(points.filter((_, i) => i !== index))}
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-error-600"
                  aria-label={t.strength.removePoint}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <div className="mt-2 flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder={t.strength.pointPlaceholder}
            className="h-8"
          />
          <Button type="button" size="sm" variant="outline" onClick={add} disabled={!draft.trim()}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Case-file readiness card
 * ------------------------------------------------------------------------- */

function ReadinessCard({
  metCount,
  totalCount,
  readinessPct,
  evidenceCount,
  isComplete,
  allCriteriaMet,
  completedAt,
  saving,
  requesting,
  canWrite,
  onComplete,
  onReopen,
  onRequestDocs,
  f,
  t,
}: {
  metCount: number;
  totalCount: number;
  readinessPct: number;
  evidenceCount: number;
  isComplete: boolean;
  allCriteriaMet: boolean;
  completedAt?: string;
  saving: boolean;
  requesting: boolean;
  canWrite: boolean;
  onComplete: () => void;
  onReopen: () => void;
  onRequestDocs: () => void;
  f: ReturnType<typeof useLexFormat>;
  t: QualificationLabels;
}) {
  return (
    <SectionCard
      title={t.readiness.title}
      actions={
        isComplete ? (
          <Badge variant="success" className="gap-1">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            {t.readiness.completedBadge}
          </Badge>
        ) : (
          <Badge variant="secondary">{t.readiness.pendingBadge}</Badge>
        )
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <QualificationMetric label={t.readiness.criteriaLabel} value={t.readiness.criteriaMet(f.formatNumber(metCount), f.formatNumber(totalCount))} onAction={() => scrollToQualification('qualification-criteria')} />
          <QualificationMetric label={t.readiness.evidenceLabel} value={t.readiness.evidenceValue(f.formatNumber(evidenceCount))} onAction={() => scrollToQualification('qualification-evidence')} />
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-caption uppercase tracking-label text-muted-foreground">
              {t.readiness.readinessLabel}
            </span>
            <span className="text-body-sm font-bold tabular-nums text-foreground">
              {f.formatNumber(readinessPct)}%
            </span>
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-500',
                readinessPct === 100 ? 'bg-success-500' : 'bg-brand-primary-600',
              )}
              style={{ width: `${readinessPct}%` }}
            />
          </div>
        </div>

        {completedAt ? (
          <p className="text-caption text-muted-foreground">
            {t.readiness.completedBy('—', f.formatDate(completedAt))}
          </p>
        ) : null}

        {canWrite ? (
          <div className="space-y-2 pt-1">
            {isComplete ? (
              <Button variant="outline" className="w-full" onClick={onReopen} disabled={saving}>
                {saving ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
                {t.reopenCta}
              </Button>
            ) : (
              <>
                <Button
                  className="w-full"
                  onClick={onComplete}
                  disabled={!allCriteriaMet || saving}
                >
                  {saving ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="me-1.5 h-4 w-4" aria-hidden />}
                  {saving ? t.readiness.completing : t.readiness.completeCta}
                </Button>
                {!allCriteriaMet ? (
                  <p className="text-caption text-muted-foreground">{t.readiness.completeBlocked}</p>
                ) : null}
              </>
            )}
            <Button variant="outline" className="w-full" onClick={onRequestDocs} disabled={requesting}>
              {requesting ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : <FileText className="me-1.5 h-4 w-4" aria-hidden />}
              {requesting ? t.readiness.requesting : t.readiness.requestDocsCta}
            </Button>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

function QualificationMetric({ label, value, onAction }: { label: string; value: string; onAction: () => void }) {
  return (
    <Button type="button" variant="ghost" onClick={onAction} className="h-auto flex-col items-stretch rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 text-start font-normal transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="block text-caption uppercase tracking-label text-muted-foreground">{label}</span>
      <span className="mt-0.5 block text-h4 font-bold tabular-nums text-foreground">{value}</span>
    </Button>
  );
}

function scrollToQualification(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function SavingChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      {label}
    </span>
  );
}
