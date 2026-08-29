'use client';

/**
 * CAP-094..125 — Contract Review Desk tab.
 *
 * Surfaces the backend-only contract review REQUEST journey in the UI:
 *   • intake receipt → acknowledge → route-to-Legal → distribute (referral authority)
 *   • named-slot required-document upload (Othaim PRD §9.1 five-document set)
 *   • completeness check + return / deficiency notice
 *   • append-only correspondence thread
 *   • hand-off to the existing recommendation + final-version ceremony
 *
 * All copy is bilingual AR/EN + RTL via `useReviewDeskLabels`; the auto-generated
 * intake reference number is surfaced prominently on open. Reuses the existing
 * RecommendationDialog / FinalVersionModal for the decision hand-off.
 */

import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileUp,
  Loader2,
  MailPlus,
  Send,
  Trash2,
  Undo2,
  UploadCloud,
} from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { showApiError, showSuccess } from '@/lib/toast';
import { formatBytes } from '@/lib/format';
import { FinalVersionModal } from './final-version-modal';
import { RecommendationDialog } from './recommendation-dialog';
import { useReviewDeskLabels, type ReviewDeskLabels } from './review-desk-labels';
import {
  PRD_ATTACHMENT_SLOTS,
  PRD_SLOT_REQUIRED_DEFAULTS,
  type ContractAttachment,
  type ContractAttachmentRequirement,
  type ContractAttachmentSlot,
  type ContractCorrespondenceKind,
  type ContractIntake,
  type ContractIntakeStatus,
  type ContractReviewDeskView,
} from './review-desk-api';
import {
  useAcknowledgeIntake,
  useAddCorrespondence,
  useCheckCompleteness,
  useDeleteAttachment,
  useDistributeContract,
  useOpenIntake,
  useReturnToRequester,
  useReviewDeskCorrespondence,
  useReviewDeskOverview,
  useRouteToLegal,
  useUploadAttachment,
} from './use-review-desk';

interface ReviewDeskTabProps {
  contractId: string;
  canPrepare: boolean;
}

type SlotRow = {
  slot: ContractAttachmentSlot;
  label: string;
  required: boolean;
  attachment: ContractAttachment | null;
};

const INTAKE_STATUS_TONE: Record<ContractIntakeStatus, 'success' | 'warning' | 'secondary' | 'destructive'> = {
  received: 'secondary',
  acknowledged: 'secondary',
  routed_to_legal: 'warning',
  under_review: 'warning',
  returned: 'destructive',
  completed: 'success',
};

export function ReviewDeskTab({ contractId, canPrepare }: ReviewDeskTabProps) {
  const t = useReviewDeskLabels();
  const { direction } = useLocale();
  const { hasPermission, hasAnyPermission } = useAuth();
  const canWrite = hasAnyPermission(['lex:contract:edit', 'lex:write']);
  const canDistribute = hasPermission('lex:contract:distribute');
  const canRecordRecommendation = hasAnyPermission(['lex:approval:write', 'lex:write']);

  const overviewQuery = useReviewDeskOverview(contractId);
  const openIntake = useOpenIntake(contractId);

  if (overviewQuery.isLoading) {
    return (
      <div dir={direction} className="space-y-4">
        <div role="status" aria-busy="true" aria-live="polite" className="space-y-3">
          <Skeleton variant="card" />
          <Skeleton variant="card" />
          <span className="sr-only">Loading…</span>
        </div>
      </div>
    );
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <div dir={direction}>
        <ErrorState message={t.loadError} onRetry={() => void overviewQuery.refetch()} />
      </div>
    );
  }

  const view = overviewQuery.data;
  const intake = view.intake ?? null;

  if (!intake) {
    return (
      <div dir={direction}>
        <SectionCard title={t.title} description={t.description}>
          <div className="space-y-4">
            <EmptyState
              icon={ClipboardCheck}
              title={t.noIntakeTitle}
              description={t.noIntakeDescription}
            />
            {canPrepare ? (
              <div className="flex justify-center">
                <Button
                  onClick={() =>
                    openIntake.mutate(
                      {},
                      {
                        onSuccess: (created) => {
                          showSuccess(
                            t.toast.intakeOpenedTitle,
                            t.toast.intakeOpened(created.reference_number),
                          );
                        },
                        onError: showApiError,
                      },
                    )
                  }
                  disabled={openIntake.isPending}
                >
                  {openIntake.isPending ? (
                    <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <ClipboardCheck className="me-1.5 h-4 w-4" />
                  )}
                  {openIntake.isPending ? t.opening : t.openIntake}
                </Button>
              </div>
            ) : null}
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <ReviewDeskBody
      contractId={contractId}
      view={view}
      intake={intake}
      labels={t}
      canWrite={canWrite}
      canPrepare={canPrepare}
      canDistribute={canDistribute}
      canRecordRecommendation={canRecordRecommendation}
    />
  );
}

function ReviewDeskBody({
  contractId,
  view,
  intake,
  labels: t,
  canWrite,
  canPrepare,
  canDistribute,
  canRecordRecommendation,
}: {
  contractId: string;
  view: ContractReviewDeskView;
  intake: ContractIntake;
  labels: ReviewDeskLabels;
  canWrite: boolean;
  canPrepare: boolean;
  canDistribute: boolean;
  canRecordRecommendation: boolean;
}) {
  const { direction } = useLocale();
  const f = useLexFormat();

  const acknowledge = useAcknowledgeIntake(contractId);
  const routeToLegal = useRouteToLegal(contractId);
  const distribute = useDistributeContract(contractId);
  const checkCompleteness = useCheckCompleteness(contractId);

  const [reviewerName, setReviewerName] = useState('');
  const [notes, setNotes] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [correspondenceOpen, setCorrespondenceOpen] = useState(false);
  const [recommendationOpen, setRecommendationOpen] = useState(false);
  const [finalVersionOpen, setFinalVersionOpen] = useState(false);

  const statusTone = INTAKE_STATUS_TONE[intake.status] ?? 'secondary';
  const routePayload = () => ({
    assigned_reviewer_name: reviewerName.trim() || undefined,
    notes: notes.trim() || undefined,
  });

  const acknowledged = Boolean(intake.acknowledged_at);
  const routed = Boolean(intake.routed_to_legal_at);
  const completeness = view.completeness ?? null;

  return (
    <div dir={direction} className="space-y-4">
      {/* Reference-number banner — the auto-generated review reference (CAP-100). */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
        <div className="min-w-0">
          <p className="text-overline font-semibold uppercase text-muted-foreground">
            {t.referenceNumber}
          </p>
          <p className="font-mono text-lg font-semibold text-primary">{intake.reference_number}</p>
        </div>
        <Badge variant={statusTone}>{t.statusLabels[intake.status] ?? intake.status}</Badge>
      </div>

      {/* Intake lifecycle actions. */}
      <SectionCard title={t.intakeTitle} description={t.intakeDescription}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetaRow label={t.receivedAt} value={f.formatDual(intake.received_at)} />
            <MetaRow
              label={t.assignedReviewer}
              value={intake.assigned_reviewer_name || t.unassigned}
            />
            <MetaRow
              label={t.acknowledgedAt}
              value={intake.acknowledged_at ? f.formatDual(intake.acknowledged_at) : '—'}
            />
          </div>

          {intake.status === 'returned' && intake.return_reason ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
              <p className="font-medium text-destructive">
                {t.returnedAt}: {intake.returned_at ? f.formatDual(intake.returned_at) : '—'}
              </p>
              <p className="mt-1 text-muted-foreground">
                {t.returnReasonShown}: {intake.return_reason}
              </p>
              {intake.deficiency_notice ? (
                <p className="mt-1 text-muted-foreground">
                  {t.deficiencyNotice}: {intake.deficiency_notice}
                </p>
              ) : null}
            </div>
          ) : null}

          {canWrite ? (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="review-desk-reviewer">{t.reviewerLabel}</Label>
                  <Input
                    id="review-desk-reviewer"
                    value={reviewerName}
                    onChange={(event) => setReviewerName(event.target.value)}
                    placeholder={t.reviewerPlaceholder}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="review-desk-notes">{t.notesLabel}</Label>
                  <Input
                    id="review-desk-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder={t.notesPlaceholder}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={acknowledged || acknowledge.isPending}
                  onClick={() =>
                    acknowledge.mutate(notes.trim() || undefined, {
                      onSuccess: () => {
                        showSuccess(t.toast.acknowledgedTitle, t.toast.acknowledgedBody);
                        setNotes('');
                      },
                      onError: showApiError,
                    })
                  }
                >
                  {acknowledge.isPending ? (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="me-1.5 h-3.5 w-3.5" />
                  )}
                  {acknowledged ? t.acknowledged : t.acknowledge}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={routeToLegal.isPending}
                  onClick={() =>
                    routeToLegal.mutate(routePayload(), {
                      onSuccess: () => {
                        showSuccess(t.toast.routedTitle, t.toast.routedBody);
                        setReviewerName('');
                        setNotes('');
                      },
                      onError: showApiError,
                    })
                  }
                >
                  {routeToLegal.isPending ? (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="me-1.5 h-3.5 w-3.5" />
                  )}
                  {t.routeToLegal}
                </Button>

                {canDistribute ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={distribute.isPending}
                    title={t.distributeHint}
                    onClick={() =>
                      distribute.mutate(routePayload(), {
                        onSuccess: () => {
                          showSuccess(t.toast.distributedTitle, t.toast.distributedBody);
                          setReviewerName('');
                          setNotes('');
                        },
                        onError: showApiError,
                      })
                    }
                  >
                    {distribute.isPending ? (
                      <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="me-1.5 h-3.5 w-3.5" />
                    )}
                    {t.distribute}
                  </Button>
                ) : null}

                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setReturnOpen(true)}
                >
                  <Undo2 className="me-1.5 h-3.5 w-3.5" />
                  {t.returnToRequester}
                </Button>
              </div>
              {canDistribute ? (
                <p className="text-xs text-muted-foreground">{t.distributeHint}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </SectionCard>

      {/* Required documents (named-slot uploads). */}
      <AttachmentsSection
        contractId={contractId}
        requirements={view.requirements}
        attachments={view.attachments}
        labels={t}
        canWrite={canPrepare}
      />

      {/* Completeness check. */}
      <SectionCard title={t.completenessTitle} description={t.completenessDescription}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={!canWrite || checkCompleteness.isPending}
              onClick={() =>
                checkCompleteness.mutate(undefined, {
                  onSuccess: (result) => {
                    if (result.complete) {
                      showSuccess(
                        t.toast.completenessTitle,
                        t.toast.completenessComplete,
                      );
                    } else {
                      showSuccess(
                        t.toast.completenessTitle,
                        t.toast.completenessIncomplete(result.missing_slots.length),
                      );
                    }
                  },
                  onError: showApiError,
                })
              }
            >
              {checkCompleteness.isPending ? (
                <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ClipboardCheck className="me-1.5 h-3.5 w-3.5" />
              )}
              {checkCompleteness.isPending ? t.checking : t.runCompleteness}
            </Button>
            <span className="text-xs text-muted-foreground">
              {intake.last_checked_at ? t.lastChecked(f.formatDual(intake.last_checked_at)) : t.neverChecked}
            </span>
          </div>

          {completeness ? (
            completeness.complete ? (
              <div className="flex items-center gap-2 rounded-md border border-success-300/60 bg-success-50 px-3 py-2 text-sm text-success-700 dark:border-success-700/60 dark:bg-success-700/15 dark:text-success-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                {t.completeYes}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-warning-300/60 bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:border-warning-700/60 dark:bg-warning-700/15 dark:text-warning-300">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                {t.completeNo(completeness.missing_slots.length)}
              </div>
            )
          ) : null}
        </div>
      </SectionCard>

      {/* Correspondence thread. */}
      <CorrespondenceSection
        contractId={contractId}
        labels={t}
        canWrite={canWrite}
        onAdd={() => setCorrespondenceOpen(true)}
      />

      {/* Recommendation + final version hand-off. */}
      <SectionCard title={t.decisionTitle} description={t.decisionDescription}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t.recommendationOutcome}:</span>
            {view.recommendation ? (
              <Badge variant={view.recommendation.outcome === 'approved' ? 'success' : 'warning'}>
                {t.outcomeLabels[view.recommendation.outcome] ?? view.recommendation.outcome}
              </Badge>
            ) : (
              <span className="text-muted-foreground">{t.noRecommendation}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canRecordRecommendation ? (
              <Button variant="outline" size="sm" onClick={() => setRecommendationOpen(true)}>
                <ClipboardCheck className="me-1.5 h-3.5 w-3.5" />
                {t.recordRecommendation}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setFinalVersionOpen(true)}>
              <FileUp className="me-1.5 h-3.5 w-3.5" />
              {t.uploadFinalVersion}
            </Button>
          </div>
        </div>
      </SectionCard>

      <ReturnDialog
        contractId={contractId}
        open={returnOpen}
        onOpenChange={setReturnOpen}
        labels={t}
      />
      <CorrespondenceDialog
        contractId={contractId}
        open={correspondenceOpen}
        onOpenChange={setCorrespondenceOpen}
        labels={t}
      />
      <RecommendationDialog
        contractId={contractId}
        open={recommendationOpen}
        onOpenChange={setRecommendationOpen}
      />
      <FinalVersionModal
        contractId={contractId}
        open={finalVersionOpen}
        onOpenChange={setFinalVersionOpen}
      />
    </div>
  );
}

/* ── Attachments (named-slot uploads) ─────────────────────────────────────── */

function buildSlotRows(
  requirements: ContractAttachmentRequirement[],
  attachments: ContractAttachment[],
  labels: ReviewDeskLabels,
): SlotRow[] {
  const requirementBySlot = new Map<ContractAttachmentSlot, ContractAttachmentRequirement>();
  for (const req of requirements) {
    requirementBySlot.set(req.slot, req);
  }
  // Latest live (non-superseded) attachment per slot.
  const attachmentBySlot = new Map<ContractAttachmentSlot, ContractAttachment>();
  for (const att of attachments) {
    if (att.superseded || att.deleted_at) continue;
    const existing = attachmentBySlot.get(att.slot);
    if (!existing || att.version > existing.version) {
      attachmentBySlot.set(att.slot, att);
    }
  }

  // Ordered union: PRD slots first (canonical §9.1 set), then any extra backend
  // requirement/attachment slots (legacy seeds) so nothing is hidden.
  const seen = new Set<ContractAttachmentSlot>();
  const ordered: ContractAttachmentSlot[] = [];
  for (const slot of PRD_ATTACHMENT_SLOTS) {
    ordered.push(slot);
    seen.add(slot);
  }
  const extras = [...requirementBySlot.keys(), ...attachmentBySlot.keys()].filter(
    (slot) => !seen.has(slot),
  );
  for (const slot of extras) {
    if (!seen.has(slot)) {
      ordered.push(slot);
      seen.add(slot);
    }
  }

  return ordered.map((slot) => {
    const req = requirementBySlot.get(slot);
    // Pre-intake preview (no stored requirement row yet): mirror the backend seed
    // so power_of_attorney and addendum_prior_docs render Optional. Once an intake
    // opens, the real requirement row (req) drives the badge.
    const defaultRequired = slot in PRD_SLOT_REQUIRED_DEFAULTS
      ? PRD_SLOT_REQUIRED_DEFAULTS[slot as keyof typeof PRD_SLOT_REQUIRED_DEFAULTS]
      : false;
    return {
      slot,
      label: req?.label || labels.slotLabels[slot] || slot,
      required: req ? req.required : defaultRequired,
      attachment: attachmentBySlot.get(slot) ?? null,
    };
  });
}

function AttachmentsSection({
  contractId,
  requirements,
  attachments,
  labels: t,
  canWrite,
}: {
  contractId: string;
  requirements: ContractAttachmentRequirement[];
  attachments: ContractAttachment[];
  labels: ReviewDeskLabels;
  canWrite: boolean;
}) {
  const f = useLexFormat();
  const upload = useUploadAttachment(contractId);
  const remove = useDeleteAttachment(contractId);
  const [pendingSlot, setPendingSlot] = useState<ContractAttachmentSlot | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ContractAttachment | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const rows = useMemo(
    () => buildSlotRows(requirements, attachments, t),
    [requirements, attachments, t],
  );

  const triggerUpload = (slot: ContractAttachmentSlot, file: File | null) => {
    if (!file) return;
    setPendingSlot(slot);
    upload.mutate(
      { slot, file },
      {
        onSuccess: () => {
          showSuccess(t.toast.uploadedTitle, t.toast.uploadedBody);
          setPendingSlot(null);
        },
        onError: (error) => {
          showApiError(error);
          setPendingSlot(null);
        },
      },
    );
  };

  return (
    <SectionCard title={t.attachmentsTitle} description={t.attachmentsDescription}>
      <ul className="space-y-2">
        {rows.map((row) => {
          const uploading = upload.isPending && pendingSlot === row.slot;
          const has = Boolean(row.attachment);
          return (
            <li
              key={row.slot}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.label}</span>
                  <Badge variant={row.required ? 'outline' : 'secondary'}>
                    {row.required ? t.requiredBadge : t.optionalBadge}
                  </Badge>
                  <Badge variant={has ? 'success' : row.required ? 'warning' : 'secondary'}>
                    {has ? t.satisfied : t.missing}
                  </Badge>
                </div>
                {row.attachment ? (
                  <p className="text-xs text-muted-foreground">
                    {row.attachment.file_name}
                    {' • '}
                    {formatBytes(row.attachment.file_size_bytes)}
                    {' • '}
                    {t.uploadedVersion(row.attachment.version)}
                    {' • '}
                    {f.formatDual(row.attachment.created_at)}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t.noFileYet}</p>
                )}
              </div>

              {canWrite ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={(el) => {
                      inputs.current[row.slot] = el;
                    }}
                    type="file"
                    className="hidden"
                    accept=".pdf,.docx,.txt,.xlsx,.pptx,.jpg,.jpeg,.png"
                    onChange={(event) => {
                      triggerUpload(row.slot, event.target.files?.[0] ?? null);
                      event.target.value = '';
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={uploading}
                    onClick={() => inputs.current[row.slot]?.click()}
                  >
                    {uploading ? (
                      <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <UploadCloud className="me-1.5 h-3.5 w-3.5" />
                    )}
                    {uploading ? t.uploading : has ? t.replaceFile : t.uploadFile}
                  </Button>
                  {row.attachment ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setRemoveTarget(row.attachment)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={t.removeConfirmTitle}
        description={t.removeConfirmDescription(removeTarget?.file_name ?? '')}
        confirmLabel={t.remove}
        cancelLabel={t.cancel}
        variant="destructive"
        loading={remove.isPending}
        onConfirm={async () => {
          if (!removeTarget) return;
          try {
            await remove.mutateAsync(removeTarget.id);
            showSuccess(t.toast.removedTitle, '');
            setRemoveTarget(null);
          } catch (error) {
            showApiError(error);
          }
        }}
      />
    </SectionCard>
  );
}

/* ── Correspondence thread ────────────────────────────────────────────────── */

function CorrespondenceSection({
  contractId,
  labels: t,
  canWrite,
  onAdd,
}: {
  contractId: string;
  labels: ReviewDeskLabels;
  canWrite: boolean;
  onAdd: () => void;
}) {
  const f = useLexFormat();
  const query = useReviewDeskCorrespondence(contractId);
  const entries = query.data?.data ?? [];

  return (
    <SectionCard
      title={t.correspondenceTitle}
      description={t.correspondenceDescription}
      actions={
        canWrite ? (
          <Button variant="outline" size="sm" onClick={onAdd}>
            <MailPlus className="me-1.5 h-3.5 w-3.5" />
            {t.addEntry}
          </Button>
        ) : undefined
      }
    >
      {query.isLoading ? (
        <div role="status" aria-busy="true" aria-live="polite" className="space-y-3">
          <Skeleton variant="list-item" />
          <Skeleton variant="list-item" />
          <span className="sr-only">Loading…</span>
        </div>
      ) : query.isError ? (
        <ErrorState message={t.loadError} onRetry={() => void query.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={MailPlus}
          title={t.emptyThreadTitle}
          description={t.emptyThreadDescription}
        />
      ) : (
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-lg border px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={entry.kind === 'auto_return' ? 'destructive' : 'secondary'}
                  >
                    {t.kindLabels[entry.kind] ?? entry.kind}
                  </Badge>
                  <span className="font-medium">{entry.subject}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {entry.author_name || t.systemAuthor} • {f.formatDual(entry.created_at)}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground">
                {entry.body}
              </p>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

/* ── Dialogs ──────────────────────────────────────────────────────────────── */

function ReturnDialog({
  contractId,
  open,
  onOpenChange,
  labels: t,
}: {
  contractId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: ReviewDeskLabels;
}) {
  const mutation = useReturnToRequester(contractId);
  const [reason, setReason] = useState('');
  const [deficiency, setDeficiency] = useState('');

  const reset = () => {
    setReason('');
    setDeficiency('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.returnTitle}</DialogTitle>
          <DialogDescription>{t.returnDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="return-reason">
              {t.returnReason} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="return-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t.returnReasonPlaceholder}
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="return-deficiency">{t.deficiencyNotice}</Label>
            <Textarea
              id="return-deficiency"
              value={deficiency}
              onChange={(event) => setDeficiency(event.target.value)}
              placeholder={t.deficiencyPlaceholder}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!reason.trim() || mutation.isPending}
            onClick={() =>
              mutation.mutate(
                {
                  reason: reason.trim(),
                  deficiency_notice: deficiency.trim() || undefined,
                },
                {
                  onSuccess: () => {
                    showSuccess(t.toast.returnedTitle, t.toast.returnedBody);
                    reset();
                    onOpenChange(false);
                  },
                  onError: showApiError,
                },
              )
            }
          >
            {mutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {t.confirmReturn}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CORRESPONDENCE_KINDS: ContractCorrespondenceKind[] = ['internal', 'clarification'];

function CorrespondenceDialog({
  contractId,
  open,
  onOpenChange,
  labels: t,
}: {
  contractId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: ReviewDeskLabels;
}) {
  const mutation = useAddCorrespondence(contractId);
  const [kind, setKind] = useState<ContractCorrespondenceKind>('internal');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const reset = () => {
    setKind('internal');
    setSubject('');
    setBody('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.addEntryTitle}</DialogTitle>
          <DialogDescription>{t.correspondenceDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="correspondence-kind">{t.kindLabel}</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as ContractCorrespondenceKind)}>
              <SelectTrigger id="correspondence-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CORRESPONDENCE_KINDS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t.kindLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="correspondence-subject">
              {t.subjectLabel} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="correspondence-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder={t.subjectPlaceholder}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="correspondence-body">
              {t.bodyLabel} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="correspondence-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t.bodyPlaceholder}
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            disabled={!subject.trim() || !body.trim() || mutation.isPending}
            onClick={() =>
              mutation.mutate(
                {
                  kind,
                  direction: kind === 'clarification' ? 'outbound' : 'internal',
                  subject: subject.trim(),
                  body: body.trim(),
                },
                {
                  onSuccess: () => {
                    showSuccess(t.toast.correspondenceTitle, t.toast.correspondenceBody);
                    reset();
                    onOpenChange(false);
                  },
                  onError: showApiError,
                },
              )
            }
          >
            {mutation.isPending ? (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
            ) : null}
            {mutation.isPending ? t.posting : t.postEntry}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-overline font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm">{value}</p>
    </div>
  );
}
