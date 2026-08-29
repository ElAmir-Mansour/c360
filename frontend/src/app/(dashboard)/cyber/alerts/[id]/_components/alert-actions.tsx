'use client';

import { useMemo, useState } from 'react';
import { ArrowUpCircle, CheckCircle2, Search, ShieldAlert, ThumbsUp, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { PermissionGate } from '@/components/auth/permission-gate';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { apiPost, apiPut } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { ALERT_STATUS_TRANSITIONS } from '@/lib/cyber-alerts';
import type { AlertStatus, CyberAlert } from '@/types/cyber';

import { AlertAssignDialog } from '../../_components/alert-assign-dialog';
import { AlertEscalateDialog } from '../../_components/alert-escalate-dialog';
import { AlertFalsePositiveDialog } from '../../_components/alert-false-positive-dialog';
import { AlertStatusDialog } from '../../_components/alert-status-dialog';
import { useAlertLabels } from '../../_lib/alerts-i18n';

type AlertActionLabels = ReturnType<typeof useAlertLabels>['actions'];

interface AlertActionsProps {
  alert: CyberAlert;
  onUpdated: () => void;
}

export function AlertActions({ alert, onUpdated }: AlertActionsProps) {
  const t = useAlertLabels();
  const [assignOpen, setAssignOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [falsePositiveOpen, setFalsePositiveOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusDialogTarget, setStatusDialogTarget] = useState<AlertStatus | undefined>(undefined);
  const [confirmStatus, setConfirmStatus] = useState<AlertStatus | null>(null);
  const [confirmTruePositive, setConfirmTruePositive] = useState(false);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  const allowed = useMemo(
    () => new Set(ALERT_STATUS_TRANSITIONS[alert.status] ?? []),
    [alert.status],
  );

  async function handleConfirmTransition() {
    if (!confirmStatus) {
      return;
    }
    await apiPut(API_ENDPOINTS.CYBER_ALERT_STATUS(alert.id), { status: confirmStatus });
    setConfirmStatus(null);
    onUpdated();
  }

  async function handleTruePositiveFeedback() {
    if (!alert.rule_id) return;
    setSubmittingFeedback(true);
    try {
      await apiPost(API_ENDPOINTS.CYBER_RULE_FEEDBACK(alert.rule_id), {
        alert_id: alert.id,
        feedback: 'true_positive',
      });
      toast.success(t.actions.truePositiveSubmitted);
      setConfirmTruePositive(false);
      onUpdated();
    } catch {
      toast.error(t.actions.truePositiveFailed);
    } finally {
      setSubmittingFeedback(false);
    }
  }

  const investigationLabel = alert.status === 'acknowledged' ? t.actions.startInvestigation : t.actions.reopen;

  return (
    <PermissionGate
      permission="cyber:write"
      fallback={(
        <p className="text-sm text-muted-foreground">
          {t.actions.readOnly}
        </p>
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {allowed.has('acknowledged') && (
          <Button size="sm" onClick={() => setConfirmStatus('acknowledged')}>
            <CheckCircle2 className="me-1.5 h-4 w-4" />
            {t.actions.acknowledge}
          </Button>
        )}

        {allowed.has('investigating') && (
          <Button variant="outline" size="sm" onClick={() => setConfirmStatus('investigating')}>
            <Search className="me-1.5 h-4 w-4" />
            {investigationLabel}
          </Button>
        )}

        {allowed.has('resolved') && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setStatusDialogTarget('resolved');
              setStatusDialogOpen(true);
            }}
          >
            {t.actions.resolve}
          </Button>
        )}

        {allowed.has('closed') && (
          <Button variant="outline" size="sm" onClick={() => setConfirmStatus('closed')}>
            {t.actions.close}
          </Button>
        )}

        {allowed.has('escalated') && (
          <Button variant="outline" size="sm" onClick={() => setEscalateOpen(true)}>
            <ArrowUpCircle className="me-1.5 h-4 w-4" />
            {t.actions.escalate}
          </Button>
        )}

        {allowed.has('false_positive') && (
          <Button variant="outline" size="sm" onClick={() => setFalsePositiveOpen(true)}>
            <ShieldAlert className="me-1.5 h-4 w-4" />
            {t.actions.markFalsePositive}
          </Button>
        )}

        {alert.rule_id && (
          <Button variant="outline" size="sm" onClick={() => setConfirmTruePositive(true)}>
            <ThumbsUp className="me-1.5 h-4 w-4" />
            {t.actions.confirmTruePositive}
          </Button>
        )}

        <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
          <UserCheck className="me-1.5 h-4 w-4" />
          {t.actions.assign}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setStatusDialogTarget(undefined);
            setStatusDialogOpen(true);
          }}
        >
          {t.actions.changeStatus}
        </Button>
      </div>

      <AlertAssignDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        alert={alert}
        onSuccess={onUpdated}
      />

      <AlertEscalateDialog
        open={escalateOpen}
        onOpenChange={setEscalateOpen}
        alert={alert}
        onSuccess={onUpdated}
      />

      <AlertFalsePositiveDialog
        open={falsePositiveOpen}
        onOpenChange={setFalsePositiveOpen}
        alert={alert}
        onSuccess={onUpdated}
      />

      <AlertStatusDialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        alert={alert}
        initialStatus={statusDialogTarget}
        onSuccess={onUpdated}
      />

      <ConfirmDialog
        open={confirmStatus !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmStatus(null);
          }
        }}
        title={confirmTitle(confirmStatus, t.actions)}
        description={confirmDescription(alert, confirmStatus, t.actions)}
        confirmLabel={confirmLabel(confirmStatus, t.actions)}
        onConfirm={handleConfirmTransition}
      />

      <ConfirmDialog
        open={confirmTruePositive}
        onOpenChange={setConfirmTruePositive}
        title={t.actions.confirmTpTitle}
        description={t.actions.confirmTpDescription(alert.title)}
        confirmLabel={submittingFeedback ? t.actions.submitting : t.actions.confirm}
        onConfirm={handleTruePositiveFeedback}
      />
    </PermissionGate>
  );
}

function confirmTitle(status: AlertStatus | null, labels: AlertActionLabels): string {
  switch (status) {
    case 'acknowledged':
      return labels.confirmTitleAck;
    case 'investigating':
      return labels.confirmTitleInvestigate;
    case 'closed':
      return labels.confirmTitleClose;
    default:
      return labels.confirmTitleDefault;
  }
}

function confirmLabel(status: AlertStatus | null, labels: AlertActionLabels): string {
  switch (status) {
    case 'acknowledged':
      return labels.confirmLabelAck;
    case 'investigating':
      return labels.confirmLabelInvestigate;
    case 'closed':
      return labels.confirmLabelClose;
    default:
      return labels.confirmLabelDefault;
  }
}

function confirmDescription(alert: CyberAlert, status: AlertStatus | null, labels: AlertActionLabels): string {
  switch (status) {
    case 'acknowledged':
      return labels.confirmDescAck(alert.title);
    case 'investigating':
      return labels.confirmDescInvestigate(alert.title);
    case 'closed':
      return labels.confirmDescClose(alert.title);
    default:
      return labels.confirmDescDefault(alert.title);
  }
}
