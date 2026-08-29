'use client';

import { Calendar, User, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { DetailPanel } from '@/components/shared/detail-panel';
import { StatusBadge } from '@/components/shared/status-badge';
import { obligationStatusConfig } from '@/lib/status-configs';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { VCISORegulatoryObligation } from '@/types/cyber';
import { useVcisoGovLabels } from '../../_lib/vciso-i18n';

interface ObligationDetailPanelProps {
  obligation: VCISORegulatoryObligation;
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
}

export function ObligationDetailPanel({
  obligation,
  open,
  onClose,
  onEdit,
}: ObligationDetailPanelProps) {
  const labels = useVcisoGovLabels().compliance;
  const t = labels.obligationDetail;
  const typeLabels = labels.obligationTypes as Record<string, () => string>;
  const typeLabel = typeLabels[obligation.type]?.() ?? obligation.type;

  const isReviewOverdue = new Date(obligation.review_date) < new Date();
  const compliancePercent =
    obligation.total_requirements > 0
      ? Math.round(
          (obligation.met_requirements / obligation.total_requirements) * 100,
        )
      : 0;

  return (
    <DetailPanel
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={obligation.name}
      description={t.subtitle(typeLabel, obligation.jurisdiction)}
      width="xl"
    >
      <div className="space-y-6">
        {/* Status and Actions */}
        <div className="flex items-center justify-between">
          <StatusBadge
            status={obligation.status}
            config={obligationStatusConfig}
            size="lg"
          />
          <Button variant="outline" size="sm" onClick={onEdit}>
            {t.edit}
          </Button>
        </div>

        <Separator />

        {/* Metadata Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t.type}
            </p>
            <Badge variant="outline">{typeLabel}</Badge>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t.jurisdiction}
            </p>
            <div className="flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-sm">{obligation.jurisdiction}</p>
            </div>
          </div>

          {obligation.owner_name && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t.owner}
              </p>
              <div className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-sm">{obligation.owner_name}</p>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t.mappedControls}
            </p>
            <p className="text-sm font-medium">{obligation.mapped_controls}</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t.effectiveDate}
            </p>
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-sm">{formatDate(obligation.effective_date)}</p>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t.reviewDate}
            </p>
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <p
                className={cn(
                  'text-sm',
                  isReviewOverdue && 'text-status-error font-medium',
                )}
              >
                {formatDate(obligation.review_date)}
                {isReviewOverdue && t.overdueSuffix}
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t.created}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatDate(obligation.created_at)}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t.lastUpdated}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatDate(obligation.updated_at)}
            </p>
          </div>
        </div>

        <Separator />

        {/* Description */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{t.description}</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {obligation.description}
          </p>
        </div>

        <Separator />

        {/* Compliance Progress */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            {t.complianceProgress}
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t.requirementsMet}</span>
              <span className="font-medium">
                {obligation.met_requirements} / {obligation.total_requirements}
              </span>
            </div>
            <Progress value={compliancePercent} className="h-2" />
            <p className="text-xs text-muted-foreground text-end">
              {t.percentComplete(compliancePercent)}
            </p>
          </div>
        </div>

        {/* Requirements List */}
        {obligation.requirements && obligation.requirements.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                {t.requirements(obligation.requirements.length)}
              </h3>
              <div className="space-y-2">
                {obligation.requirements.map((req, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                      {index + 1}
                    </span>
                    <p className="text-sm leading-relaxed">{req}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </DetailPanel>
  );
}
