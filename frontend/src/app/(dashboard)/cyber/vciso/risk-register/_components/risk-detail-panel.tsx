'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Shield,
  Calendar,
  User,
  Building2,
  Tag,
  FileText,
  CheckCircle,
  Clock,
  Edit,
  Save,
  X,
} from 'lucide-react';
import { DetailPanel } from '@/components/shared/detail-panel';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { riskStatusConfig, riskTreatmentConfig } from '@/lib/status-configs';
import type {
  VCISORiskEntry,
  RiskLikelihood,
  RiskImpact,
  RiskStatus,
  RiskTreatment,
} from '@/types/cyber';
import { useVcisoGovLabels } from '../../_lib/vciso-i18n';

interface RiskDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  risk: VCISORiskEntry;
  onUpdated: () => void;
}

const LEVEL_VALUES = ['low', 'medium', 'high', 'critical'] as const;
const STATUS_VALUES = ['open', 'mitigated', 'accepted', 'closed'] as const;
const TREATMENT_VALUES = ['mitigate', 'transfer', 'accept', 'avoid'] as const;

function scoreColor(score: number): string {
  if (score <= 30) return 'text-primary';
  if (score <= 60) return 'text-warning-700 dark:text-warning-300';
  return 'text-status-error';
}

export function RiskDetailPanel({
  open,
  onOpenChange,
  risk,
  onUpdated,
}: RiskDetailPanelProps) {
  const labels = useVcisoGovLabels().risk;
  const t = labels.detail;
  const levelLabels = labels.options.level as Record<string, string>;
  const statusLabels = labels.options.status as Record<string, string>;
  const treatmentLabels = labels.options.treatment as Record<string, string>;

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    title: risk.title,
    description: risk.description,
    category: risk.category,
    likelihood: risk.likelihood,
    impact: risk.impact,
    status: risk.status,
    treatment: risk.treatment,
    department: risk.department,
    treatment_plan: risk.treatment_plan,
    business_services: risk.business_services.join(', '),
    controls: risk.controls.join(', '),
    review_date: risk.review_date ? risk.review_date.split('T')[0] : '',
  });

  const updateMutation = useApiMutation<VCISORiskEntry, Record<string, unknown>>(
    'put',
    `${API_ENDPOINTS.CYBER_VCISO_RISKS}/${risk.id}`,
    {
      successMessage: t.updatedToast,
      invalidateKeys: ['vciso-risks', API_ENDPOINTS.CYBER_VCISO_RISKS_STATS],
      onSuccess: () => {
        setIsEditing(false);
        onUpdated();
      },
    },
  );

  const handleSave = () => {
    if (!editForm.title.trim()) {
      toast.error(t.titleRequired);
      return;
    }

    updateMutation.mutate({
      title: editForm.title.trim(),
      description: editForm.description.trim(),
      category: editForm.category.trim(),
      likelihood: editForm.likelihood,
      impact: editForm.impact,
      status: editForm.status,
      treatment: editForm.treatment,
      department: editForm.department.trim(),
      treatment_plan: editForm.treatment_plan.trim(),
      business_services: editForm.business_services
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      controls: editForm.controls
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      review_date: editForm.review_date || undefined,
      // Preserve fields not exposed in the edit form
      inherent_score: risk.inherent_score,
      residual_score: risk.residual_score,
      owner_id: risk.owner_id || undefined,
      owner_name: risk.owner_name,
      tags: risk.tags,
      acceptance_rationale: risk.acceptance_rationale || undefined,
      acceptance_expiry: risk.acceptance_expiry || undefined,
    });
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditForm({
      title: risk.title,
      description: risk.description,
      category: risk.category,
      likelihood: risk.likelihood,
      impact: risk.impact,
      status: risk.status,
      treatment: risk.treatment,
      department: risk.department,
      treatment_plan: risk.treatment_plan,
      business_services: risk.business_services.join(', '),
      controls: risk.controls.join(', '),
      review_date: risk.review_date ? risk.review_date.split('T')[0] : '',
    });
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setIsEditing(false);
    }
    onOpenChange(o);
  };

  return (
    <DetailPanel
      open={open}
      onOpenChange={handleOpenChange}
      title={isEditing ? t.editTitle : risk.title}
      description={isEditing ? t.editDescription : risk.category}
      width="xl"
    >
      <div className="space-y-6">
        {/* Action bar */}
        <div className="flex items-center justify-end gap-2">
          {isEditing ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={updateMutation.isPending}
              >
                <X className="me-1.5 h-4 w-4" />
                {t.cancel}
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={updateMutation.isPending}
              >
                <Save className="me-1.5 h-4 w-4" />
                {updateMutation.isPending ? t.saving : t.save}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
              <Edit className="me-1.5 h-4 w-4" />
              {t.edit}
            </Button>
          )}
        </div>

        {isEditing ? (
          /* ── Edit form ────────────────────────────────────────── */
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-title">{t.titleLabel}</Label>
              <Input
                id="edit-title"
                value={editForm.title}
                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                placeholder={t.titlePlaceholder}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">{t.descriptionLabel}</Label>
              <Textarea
                id="edit-description"
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                placeholder={t.descriptionPlaceholder}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-category">{t.category}</Label>
                <Input
                  id="edit-category"
                  value={editForm.category}
                  onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder={t.categoryPlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-department">{t.department}</Label>
                <Input
                  id="edit-department"
                  value={editForm.department}
                  onChange={(e) => setEditForm((f) => ({ ...f, department: e.target.value }))}
                  placeholder={t.departmentPlaceholder}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t.likelihood}</Label>
                <Select
                  value={editForm.likelihood}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, likelihood: v as RiskLikelihood }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVEL_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {levelLabels[value] ?? value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t.impact}</Label>
                <Select
                  value={editForm.impact}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, impact: v as RiskImpact }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVEL_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {levelLabels[value] ?? value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t.status}</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, status: v as RiskStatus }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {statusLabels[value] ?? value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t.treatment}</Label>
                <Select
                  value={editForm.treatment}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, treatment: v as RiskTreatment }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TREATMENT_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {treatmentLabels[value] ?? value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-review-date">{t.reviewDate}</Label>
              <Input
                id="edit-review-date"
                type="date"
                value={editForm.review_date}
                onChange={(e) => setEditForm((f) => ({ ...f, review_date: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-treatment-plan">{t.treatmentPlan}</Label>
              <Textarea
                id="edit-treatment-plan"
                value={editForm.treatment_plan}
                onChange={(e) => setEditForm((f) => ({ ...f, treatment_plan: e.target.value }))}
                placeholder={t.treatmentPlanPlaceholder}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-controls">{t.controls}</Label>
              <Textarea
                id="edit-controls"
                value={editForm.controls}
                onChange={(e) => setEditForm((f) => ({ ...f, controls: e.target.value }))}
                placeholder="AC-1, AC-2, AC-3"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-services">{t.businessServices}</Label>
              <Textarea
                id="edit-services"
                value={editForm.business_services}
                onChange={(e) => setEditForm((f) => ({ ...f, business_services: e.target.value }))}
                placeholder={t.businessServicesPlaceholder}
                rows={2}
              />
            </div>
          </div>
        ) : (
          /* ── Read-only view ───────────────────────────────────── */
          <>
            {/* Overview section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t.overview}
              </h3>
              <p className="text-sm text-foreground leading-relaxed">
                {risk.description || t.noDescription}
              </p>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={risk.status} config={riskStatusConfig} />
                <StatusBadge status={risk.treatment} config={riskTreatmentConfig} />
                <Badge variant="outline">{risk.category}</Badge>
              </div>
            </div>

            <Separator />

            {/* Scores section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t.riskScores}
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">{t.inherentScore}</p>
                  <p className={cn('text-2xl font-bold', scoreColor(risk.inherent_score))}>
                    {risk.inherent_score}
                  </p>
                </div>
                <div className="rounded-xl border p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">{t.residualScore}</p>
                  <p className={cn('text-2xl font-bold', scoreColor(risk.residual_score))}>
                    {risk.residual_score}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{t.likelihoodLabel}</span>
                  <span className="font-medium">{levelLabels[risk.likelihood] ?? risk.likelihood}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{t.impactLabel}</span>
                  <span className="font-medium">{levelLabels[risk.impact] ?? risk.impact}</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Assignment & Timeline */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t.assignmentTimeline}
              </h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t.owner}</span>
                  <span className="font-medium">{risk.owner_name || t.unassigned}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t.departmentLabel}</span>
                  <span className="font-medium">{risk.department || t.na}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t.reviewDateLabel}</span>
                  <span className="font-medium">
                    {risk.review_date ? formatDate(risk.review_date) : t.notSet}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t.createdLabel}</span>
                  <span className="font-medium">{formatDate(risk.created_at)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t.updatedLabel}</span>
                  <span className="font-medium">{formatDate(risk.updated_at)}</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Treatment Plan */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t.treatmentPlanTitle}
              </h3>
              <p className="text-sm text-foreground leading-relaxed">
                {risk.treatment_plan || t.noTreatmentPlan}
              </p>
            </div>

            {/* Controls */}
            {risk.controls.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    {t.controlsTitle}
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {risk.controls.map((control) => (
                      <Badge key={control} variant="secondary" className="text-xs">
                        <Shield className="me-1 h-3 w-3" />
                        {control}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Business Services */}
            {risk.business_services.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    {t.businessServicesTitle}
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {risk.business_services.map((service) => (
                      <Badge key={service} variant="outline" className="text-xs">
                        <FileText className="me-1 h-3 w-3" />
                        {service}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Tags */}
            {risk.tags.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    {t.tags}
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {risk.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        <Tag className="me-1 h-3 w-3" />
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Acceptance Info */}
            {risk.status === 'accepted' && risk.acceptance_rationale && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    {t.riskAcceptance}
                  </h3>
                  <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-primary" />
                      <span className="font-medium text-primary">{t.riskAccepted}</span>
                    </div>
                    <p className="text-sm text-primary">{risk.acceptance_rationale}</p>
                    {risk.acceptance_approved_by_name && (
                      <p className="text-xs text-primary">
                        {t.approvedByPrefix(risk.acceptance_approved_by_name)}
                      </p>
                    )}
                    {risk.acceptance_expiry && (
                      <p className="text-xs text-primary">
                        {t.expiresPrefix(formatDate(risk.acceptance_expiry))}
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </DetailPanel>
  );
}
