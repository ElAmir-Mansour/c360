'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Shield,
  Calendar,
  RefreshCw,
} from 'lucide-react';
import { useDspmLabels } from '../_lib/dspm-i18n';
import type { DSPMRiskException } from '@/types/cyber';

interface ExceptionApprovalCardProps {
  exception: DSPMRiskException;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
}

const APPROVAL_BADGE: Record<string, { class: string; icon: typeof CheckCircle2 }> = {
  pending: { class: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300', icon: Clock },
  approved: { class: 'bg-primary/15 text-primary', icon: CheckCircle2 },
  rejected: { class: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300', icon: XCircle },
  expired: { class: 'bg-secondary text-foreground', icon: Clock },
};

function getRiskColor(score: number): string {
  if (score >= 80) return 'text-status-error';
  if (score >= 60) return 'text-severity-high';
  if (score >= 40) return 'text-warning-700 dark:text-warning-300';
  return 'text-primary';
}

function getRiskBg(score: number): string {
  if (score >= 80) return 'bg-error-50 dark:bg-error-700/20';
  if (score >= 60) return 'bg-orange-50 dark:bg-orange-950/20';
  if (score >= 40) return 'bg-warning-50 dark:bg-warning-800/20';
  return 'bg-primary/10 dark:bg-brand-primary-800/20';
}

function formatDate(ts?: string): string {
  if (!ts) return '---';
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatExceptionType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ExceptionApprovalCard({ exception, onApprove, onReject }: ExceptionApprovalCardProps) {
  const t = useDspmLabels().exceptionCard;
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const statusLabels: Record<string, string> = {
    pending: t.statusPending,
    approved: t.statusApproved,
    rejected: t.statusRejected,
    expired: t.statusExpired,
  };
  const badge = APPROVAL_BADGE[exception.approval_status] ?? APPROVAL_BADGE.pending;
  const badgeLabel = statusLabels[exception.approval_status] ?? t.statusPending;
  const BadgeIcon = badge.icon;

  const handleReject = () => {
    if (!rejectReason.trim()) return;
    onReject(exception.id, rejectReason.trim());
    setShowRejectInput(false);
    setRejectReason('');
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">{formatExceptionType(exception.exception_type)}</CardTitle>
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.class}`}>
            <BadgeIcon className="h-3 w-3" />
            {badgeLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Risk Score */}
        <div className={`flex items-center gap-3 rounded-lg p-3 ${getRiskBg(exception.risk_score)}`}>
          <Shield className={`h-5 w-5 ${getRiskColor(exception.risk_score)}`} />
          <div>
            <p className="text-xs text-muted-foreground">{t.riskScore}</p>
            <p className={`text-lg font-bold tabular-nums ${getRiskColor(exception.risk_score)}`}>
              {exception.risk_score}/100
            </p>
          </div>
          <Badge variant="outline" className="ms-auto capitalize">{exception.risk_level}</Badge>
        </div>

        {/* Details */}
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-medium text-muted-foreground">{t.justification}</p>
            <p className="mt-0.5">{exception.justification}</p>
          </div>

          {exception.business_reason && (
            <div>
              <p className="font-medium text-muted-foreground">{t.businessReason}</p>
              <p className="mt-0.5">{exception.business_reason}</p>
            </div>
          )}

          {exception.compensating_controls && (
            <div>
              <p className="font-medium text-muted-foreground">{t.compensatingControls}</p>
              <p className="mt-0.5">{exception.compensating_controls}</p>
            </div>
          )}

          <div>
            <p className="font-medium text-muted-foreground">{t.requestedBy}</p>
            <p className="mt-0.5">{exception.requested_by}</p>
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{t.expires}</span>
            <span className="font-medium">{formatDate(exception.expires_at)}</span>
          </div>
          {exception.next_review_at && (
            <div className="flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">{t.nextReview}</span>
              <span className="font-medium">{formatDate(exception.next_review_at)}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{t.reviews}</span>
            <span className="font-medium">{exception.review_count}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{t.interval}</span>
            <span className="font-medium">{t.intervalDays(exception.review_interval_days)}</span>
          </div>
        </div>

        {/* Approved info */}
        {exception.approval_status === 'approved' && exception.approved_by && (
          <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm dark:border-primary dark:bg-brand-primary-800/20">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <span className="font-medium text-primary dark:text-primary">{t.approved}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t.approvedBy(exception.approved_by, formatDate(exception.approved_at))}
            </p>
          </div>
        )}

        {/* Rejected info */}
        {exception.approval_status === 'rejected' && (
          <div className="rounded-lg border border-error-100 bg-error-50 p-3 text-sm dark:border-error-700 dark:bg-error-700/20">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-status-error" />
              <span className="font-medium text-error-600 dark:text-error-300">{t.rejected}</span>
            </div>
            {exception.rejection_reason && (
              <p className="mt-1 text-xs text-muted-foreground">{exception.rejection_reason}</p>
            )}
          </div>
        )}

        {/* Expired info */}
        {exception.approval_status === 'expired' && (
          <div className="rounded-lg border bg-muted/50 p-3 text-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-muted-foreground">{t.exceptionExpired}</span>
            </div>
          </div>
        )}

        {/* Approval actions */}
        {exception.approval_status === 'pending' && (
          <div className="space-y-3 border-t pt-3">
            {showRejectInput ? (
              <div className="space-y-2">
                <Label htmlFor="reject-reason" className="text-xs">{t.rejectionReasonLabel}</Label>
                <Input
                  id="reject-reason"
                  placeholder={t.rejectionReasonPlaceholder}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={!rejectReason.trim()}
                    onClick={handleReject}
                  >
                    {t.confirmReject}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => { setShowRejectInput(false); setRejectReason(''); }}
                  >
                    {t.cancel}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onApprove(exception.id)}
                >
                  <CheckCircle2 className="me-1.5 h-3.5 w-3.5" />
                  {t.approve}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => setShowRejectInput(true)}
                >
                  <XCircle className="me-1.5 h-3.5 w-3.5" />
                  {t.reject}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
