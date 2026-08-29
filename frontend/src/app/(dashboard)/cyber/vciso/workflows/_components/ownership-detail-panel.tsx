'use client';

import {
  User,
  Users,
  Calendar,
  Clock,
  Shield,
  FileText,
} from 'lucide-react';
import { DetailPanel } from '@/components/shared/detail-panel';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ownershipStatusConfig } from '@/lib/status-configs';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { VCISOControlOwnership } from '@/types/cyber';
import { useVcisoWorkflowLabels } from '../../_lib/vciso-i18n';

interface OwnershipDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownership: VCISOControlOwnership;
  onReassign: () => void;
  onMarkReviewed: () => void;
}

export function OwnershipDetailPanel({
  open,
  onOpenChange,
  ownership,
  onReassign,
  onMarkReviewed,
}: OwnershipDetailPanelProps) {
  const t = useVcisoWorkflowLabels().ownershipDetail;
  const isOverdue = new Date(ownership.next_review_date) < new Date();
  const canMarkReviewed = ownership.status !== 'reviewed';

  return (
    <DetailPanel
      open={open}
      onOpenChange={onOpenChange}
      title={ownership.control_name}
      description={t.subtitle(ownership.control_id, ownership.framework)}
      width="xl"
    >
      <div className="space-y-6">
        {/* Status & Actions */}
        <div className="flex items-center justify-between">
          <StatusBadge
            status={ownership.status}
            config={ownershipStatusConfig}
            size="lg"
          />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onReassign}>
              <Users className="me-1.5 h-3.5 w-3.5" />
              {t.reassign}
            </Button>
            {canMarkReviewed && (
              <Button size="sm" onClick={onMarkReviewed}>
                <Shield className="me-1.5 h-3.5 w-3.5" />
                {t.markReviewed}
              </Button>
            )}
          </div>
        </div>

        <Separator />

        {/* Control Information */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.controlInformation}
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.controlId}
              </p>
              <p className="text-sm font-medium">{ownership.control_id}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.framework}
              </p>
              <Badge variant="outline">{ownership.framework}</Badge>
            </div>
            <div className="col-span-2 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.controlName}
              </p>
              <p className="text-sm">{ownership.control_name}</p>
            </div>
          </div>
        </div>

        <Separator />

        {/* Owner & Delegate */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.ownership}
          </h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300">
                <User className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">{ownership.owner_name}</p>
                <p className="text-xs text-muted-foreground">{t.primaryOwner}</p>
              </div>
            </div>
            {ownership.delegate_name ? (
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">{ownership.delegate_name}</p>
                  <p className="text-xs text-muted-foreground">{t.delegate}</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-dashed p-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.noDelegate}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <Separator />

        {/* Review Timeline */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.reviewTimeline}
          </h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t.nextReview}</span>
              <span
                className={cn(
                  'font-medium',
                  isOverdue && 'text-status-error',
                )}
              >
                {formatDate(ownership.next_review_date)}
                {isOverdue && t.overdueSuffix}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t.lastReviewed}</span>
              <span className="font-medium">
                {ownership.last_reviewed_at
                  ? formatDateTime(ownership.last_reviewed_at)
                  : t.neverReviewed}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t.created}</span>
              <span className="font-medium">{formatDateTime(ownership.created_at)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t.updated}</span>
              <span className="font-medium">{formatDateTime(ownership.updated_at)}</span>
            </div>
          </div>
        </div>
      </div>
    </DetailPanel>
  );
}
