'use client';

/**
 * CAP-107 — Clause-by-clause review · right-hand review panel.
 *
 * Renders the selected clause for review:
 *   - clause body via the shared <DocumentViewer/> (extracted-text mode),
 *   - a risk badge + extraction-confidence meter header (LexKpiStrip),
 *   - recommendation / compliance-flag chips,
 *   - a `review_status` segmented control + notes Textarea,
 *   - Save → PUT …/review (optimistic via useUpdateClauseReview).
 *
 * Per the cross-cap frontend contract it also mounts the sibling
 * <ClauseComments/> (CAP-110) and <ClauseAmendments/> (CAP-111) for the
 * selected clause. Reuses shared lex primitives (status-chip) + KSA formatting.
 */

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ShieldAlert, Sparkles } from 'lucide-react';
import { DocumentViewer } from '@/components/shared/document-viewer';
import { LexKpiStrip } from '@/components/lex/kpi-strip';
import { LexStatusChip } from '@/components/lex/status-chip';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { titleCase } from '@/lib/format';
import type { LexClause, LexClauseReviewStatus } from '@/types/suites';
import { resolveLexBilingual, type LexBilingual } from '../../../../_lib/lex-i18n';
import { useUpdateClauseReview } from './use-clauses';
import { ClauseComments } from './clause-comments';
import { ClauseAmendments } from './clause-amendments';

const REVIEW_STATUSES: LexClauseReviewStatus[] = [
  'pending',
  'reviewed',
  'flagged',
  'accepted',
  'rejected',
];

interface ClauseReviewPanelProps {
  contractId: string;
  clause: LexClause;
}

export function ClauseReviewPanel({ contractId, clause }: ClauseReviewPanelProps) {
  const { locale, direction } = useLocaleOrDefault();
  const { hasPermission } = useAuth();
  // §9 — clause review is a contract edit.
  const canWrite = hasPermission('lex:contract:edit');
  const t = useMemo(() => resolveLexBilingual(clausePanelLabels, locale), [locale]);

  const [status, setStatus] = useState<LexClauseReviewStatus>(clause.review_status);
  const [notes, setNotes] = useState<string>(clause.review_notes ?? '');

  // Reset the draft whenever the selected clause changes.
  useEffect(() => {
    setStatus(clause.review_status);
    setNotes(clause.review_notes ?? '');
  }, [clause.id, clause.review_status, clause.review_notes]);

  const reviewMutation = useUpdateClauseReview(contractId);

  const dirty = status !== clause.review_status || notes.trim() !== (clause.review_notes ?? '').trim();

  const save = () => {
    if (!canWrite || reviewMutation.isPending) return;
    reviewMutation.mutate(
      { clauseId: clause.id, payload: { status, notes: notes.trim() } },
      {
        onSuccess: () => showSuccess(t.toastSaved),
        onError: showApiError,
      },
    );
  };

  const confidencePct = Math.round((clause.extraction_confidence ?? 0) * 100);

  return (
    <div className="space-y-4" dir={direction} lang={locale}>
      <SectionCard
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate">{clause.title || t.untitledClause}</span>
            <Badge variant="outline">{titleCase(clause.clause_type)}</Badge>
            <LexSeverityBadge level={clause.risk_level} />
          </span>
        }
        description={clause.section_reference || t.noSectionReference}
      >
        <div className="space-y-4">
          {/* Risk + confidence + status header. */}
          <LexKpiStrip
            columns={3}
            items={[
              {
                label: t.riskScore,
                value: clause.risk_score,
                icon: ShieldAlert,
                theme: 'red',
                onAction: () => document.getElementById('contract-clause-review-workspace')?.scrollIntoView({ behavior: 'smooth' }),
              },
              {
                label: t.confidence,
                value: confidencePct,
                unit: '%',
                icon: Sparkles,
                theme: 'primary',
                progress: confidencePct,
                progressLabel: t.confidence,
                onAction: () => document.getElementById('contract-clause-review-workspace')?.scrollIntoView({ behavior: 'smooth' }),
              },
              {
                label: t.reviewStatus,
                value: t.statusValues[clause.review_status] ?? titleCase(clause.review_status),
                icon: CheckCircle2,
                theme: 'emerald',
                onAction: () => document.getElementById('contract-clause-review-workspace')?.scrollIntoView({ behavior: 'smooth' }),
              },
            ]}
          />

          {/* Clause body. */}
          <div id="contract-clause-review-workspace" />
          <div className="space-y-2">
            <p className="text-sm font-medium">{t.clauseBody}</p>
            <DocumentViewer
              extractedText={clause.content || t.noContent}
              height={280}
              dir={direction}
            />
          </div>

          {/* Recommendations. */}
          {clause.recommendations.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t.recommendations}</p>
              <div className="flex flex-wrap gap-2">
                {clause.recommendations.map((recommendation, index) => (
                  <Badge key={`${recommendation}-${index}`} variant="secondary">
                    {recommendation}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {/* Compliance flags. */}
          {clause.compliance_flags.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t.complianceFlags}</p>
              <div className="flex flex-wrap gap-2">
                {clause.compliance_flags.map((flag, index) => (
                  <Badge key={`${flag}-${index}`} variant="warning">
                    {flag}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {/* Review controls. */}
          <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">{t.setStatus}</p>
              <div
                role="radiogroup"
                aria-label={t.setStatus}
                className="inline-flex flex-wrap gap-1 rounded-lg border bg-background p-1"
              >
                {REVIEW_STATUSES.map((value) => {
                  const active = status === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={!canWrite}
                      onClick={() => setStatus(value)}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted disabled:hover:bg-transparent',
                        !canWrite && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      {t.statusValues[value] ?? titleCase(value)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t.notes}</p>
              <Textarea
                value={notes}
                rows={3}
                placeholder={t.notesPlaceholder}
                aria-label={t.notes}
                disabled={!canWrite}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>

            {canWrite ? (
              <div className="flex items-center justify-end">
                <Button
                  size="sm"
                  onClick={save}
                  disabled={!dirty || reviewMutation.isPending}
                >
                  {reviewMutation.isPending ? t.saving : t.save}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </SectionCard>

      {/* CAP-110 — clause comments thread. */}
      <ClauseComments contractId={contractId} clauseId={clause.id} />

      {/* CAP-111 — propose / decide clause amendments (redline). */}
      <ClauseAmendments contractId={contractId} clauseId={clause.id} />
    </div>
  );
}

/** Risk-level badge mapping the lex risk vocabulary to a tone-coloured chip. */
function LexSeverityBadge({ level }: { level: LexClause['risk_level'] }) {
  return <LexStatusChip domain="generic" value={level} size="sm" />;
}

/* ------------------------------------------------------------------------- *
 * Self-contained bilingual labels (English + Modern Standard Arabic).
 * ------------------------------------------------------------------------- */

interface ClausePanelLabels {
  untitledClause: string;
  noSectionReference: string;
  riskScore: string;
  confidence: string;
  reviewStatus: string;
  clauseBody: string;
  noContent: string;
  recommendations: string;
  complianceFlags: string;
  setStatus: string;
  notes: string;
  notesPlaceholder: string;
  save: string;
  saving: string;
  toastSaved: string;
  statusValues: Record<LexClauseReviewStatus, string>;
}

const clausePanelLabels: LexBilingual<ClausePanelLabels> = {
  en: {
    untitledClause: 'Untitled clause',
    noSectionReference: 'No section reference',
    riskScore: 'Risk score',
    confidence: 'Extraction confidence',
    reviewStatus: 'Review status',
    clauseBody: 'Clause text',
    noContent: 'No clause text was extracted.',
    recommendations: 'Recommendations',
    complianceFlags: 'Compliance flags',
    setStatus: 'Set review status',
    notes: 'Review notes',
    notesPlaceholder: 'Add reviewer notes for this clause…',
    save: 'Save review',
    saving: 'Saving…',
    toastSaved: 'Clause review saved.',
    statusValues: {
      pending: 'Pending',
      reviewed: 'Reviewed',
      flagged: 'Flagged',
      accepted: 'Accepted',
      rejected: 'Rejected',
    },
  },
  ar: {
    untitledClause: 'بند بدون عنوان',
    noSectionReference: 'لا يوجد مرجع للقسم',
    riskScore: 'درجة المخاطر',
    confidence: 'ثقة الاستخراج',
    reviewStatus: 'حالة المراجعة',
    clauseBody: 'نص البند',
    noContent: 'لم يُستخرج نص لهذا البند.',
    recommendations: 'التوصيات',
    complianceFlags: 'مؤشرات الامتثال',
    setStatus: 'تحديد حالة المراجعة',
    notes: 'ملاحظات المراجعة',
    notesPlaceholder: 'أضف ملاحظات المُراجع على هذا البند…',
    save: 'حفظ المراجعة',
    saving: 'جارٍ الحفظ…',
    toastSaved: 'تم حفظ مراجعة البند.',
    statusValues: {
      pending: 'قيد الانتظار',
      reviewed: 'تمت المراجعة',
      flagged: 'مُعلَّم',
      accepted: 'مقبول',
      rejected: 'مرفوض',
    },
  },
};
