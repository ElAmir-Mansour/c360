'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Shield,
  Calendar,
  User,
  Mail,
  Database,
  Server,
  AlertTriangle,
  CheckCircle,
  Clock,
  Edit,
  Save,
  X,
} from 'lucide-react';
import { DetailPanel } from '@/components/shared/detail-panel';
import { StatusBadge } from '@/components/shared/status-badge';
import { SeverityIndicator, type Severity } from '@/components/shared/severity-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
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
import { vendorStatusConfig } from '@/lib/status-configs';
import type { VCISOVendor, VendorRiskTier, VendorStatus } from '@/types/cyber';
import { useVcisoOpsLabels } from '../../_lib/vciso-i18n';

interface VendorDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor: VCISOVendor;
  onUpdated: () => void;
}

const RISK_TIER_VALUES: VendorRiskTier[] = ['critical', 'high', 'medium', 'low'];
const STATUS_VALUES: VendorStatus[] = ['active', 'onboarding', 'under_review', 'offboarding', 'terminated'];

function riskScoreColor(score: number): string {
  if (score >= 80) return 'text-status-error';
  if (score >= 60) return 'text-severity-high';
  if (score >= 40) return 'text-warning-700 dark:text-warning-300';
  return 'text-primary';
}

export function VendorDetailPanel({
  open,
  onOpenChange,
  vendor,
  onUpdated,
}: VendorDetailPanelProps) {
  const labels = useVcisoOpsLabels().thirdParty.vendor;
  const t = labels.detail;
  const riskTierLabels = labels.riskTiers as Record<string, string>;
  const statusLabels = labels.statuses as Record<string, string>;

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: vendor.name,
    category: vendor.category,
    risk_tier: vendor.risk_tier,
    status: vendor.status,
    contact_name: vendor.contact_name ?? '',
    contact_email: vendor.contact_email ?? '',
    services_provided: vendor.services_provided.join(', '),
    data_shared: vendor.data_shared.join(', '),
    next_review_date: vendor.next_review_date ? vendor.next_review_date.split('T')[0] : '',
  });

  const updateMutation = useApiMutation<VCISOVendor, Record<string, unknown>>(
    'put',
    `${API_ENDPOINTS.CYBER_VCISO_VENDORS}/${vendor.id}`,
    {
      successMessage: t.updatedToast,
      invalidateKeys: ['vciso-vendors'],
      onSuccess: () => {
        setIsEditing(false);
        onUpdated();
      },
    },
  );

  const handleSave = () => {
    if (!editForm.name.trim()) {
      toast.error(t.nameRequired);
      return;
    }

    updateMutation.mutate({
      name: editForm.name.trim(),
      category: editForm.category.trim(),
      risk_tier: editForm.risk_tier,
      status: editForm.status,
      contact_name: editForm.contact_name.trim() || undefined,
      contact_email: editForm.contact_email.trim() || undefined,
      services_provided: editForm.services_provided
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      data_shared: editForm.data_shared
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      next_review_date: editForm.next_review_date || undefined,
    });
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditForm({
      name: vendor.name,
      category: vendor.category,
      risk_tier: vendor.risk_tier,
      status: vendor.status,
      contact_name: vendor.contact_name ?? '',
      contact_email: vendor.contact_email ?? '',
      services_provided: vendor.services_provided.join(', '),
      data_shared: vendor.data_shared.join(', '),
      next_review_date: vendor.next_review_date ? vendor.next_review_date.split('T')[0] : '',
    });
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) setIsEditing(false);
    onOpenChange(o);
  };

  const controlsPercent =
    vendor.controls_total > 0
      ? Math.round((vendor.controls_met / vendor.controls_total) * 100)
      : 0;

  return (
    <DetailPanel
      open={open}
      onOpenChange={handleOpenChange}
      title={isEditing ? t.editTitle : vendor.name}
      description={isEditing ? t.editDescription : vendor.category}
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
              <Label htmlFor="edit-vendor-name">{t.name}</Label>
              <Input
                id="edit-vendor-name"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t.namePlaceholder}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-vendor-category">{t.category}</Label>
              <Input
                id="edit-vendor-category"
                value={editForm.category}
                onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                placeholder={t.categoryPlaceholder}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t.riskTier}</Label>
                <Select
                  value={editForm.risk_tier}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, risk_tier: v as VendorRiskTier }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RISK_TIER_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {riskTierLabels[value] ?? value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t.status}</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, status: v as VendorStatus }))}
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
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-contact-name">{t.contactName}</Label>
                <Input
                  id="edit-contact-name"
                  value={editForm.contact_name}
                  onChange={(e) => setEditForm((f) => ({ ...f, contact_name: e.target.value }))}
                  placeholder={t.contactNamePlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-contact-email">{t.contactEmail}</Label>
                <Input
                  id="edit-contact-email"
                  type="email"
                  value={editForm.contact_email}
                  onChange={(e) => setEditForm((f) => ({ ...f, contact_email: e.target.value }))}
                  placeholder="vendor@example.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-next-review">{t.nextReviewDate}</Label>
              <Input
                id="edit-next-review"
                type="date"
                value={editForm.next_review_date}
                onChange={(e) => setEditForm((f) => ({ ...f, next_review_date: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-services">{t.servicesProvided}</Label>
              <Input
                id="edit-services"
                value={editForm.services_provided}
                onChange={(e) => setEditForm((f) => ({ ...f, services_provided: e.target.value }))}
                placeholder={t.servicesPlaceholder}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-data">{t.dataShared}</Label>
              <Input
                id="edit-data"
                value={editForm.data_shared}
                onChange={(e) => setEditForm((f) => ({ ...f, data_shared: e.target.value }))}
                placeholder={t.dataPlaceholder}
              />
            </div>
          </div>
        ) : (
          /* ── Read-only view ───────────────────────────────────── */
          <>
            {/* Overview */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t.overview}
              </h3>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={vendor.status} config={vendorStatusConfig} />
                <SeverityIndicator severity={vendor.risk_tier as Severity} showLabel />
                <Badge variant="outline">{vendor.category}</Badge>
              </div>
            </div>

            <Separator />

            {/* Risk Score & Controls */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t.riskAssessment}
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">{t.riskScore}</p>
                  <p className={cn('text-2xl font-bold', riskScoreColor(vendor.risk_score))}>
                    {vendor.risk_score}
                  </p>
                </div>
                <div className="rounded-xl border p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">{t.openFindings}</p>
                  <p className={cn('text-2xl font-bold', vendor.open_findings > 0 ? 'text-status-error' : 'text-primary')}>
                    {vendor.open_findings}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t.controlsCoverage}</span>
                  <span className="font-medium">
                    {vendor.controls_met}/{vendor.controls_total} ({controlsPercent}%)
                  </span>
                </div>
                <Progress value={controlsPercent} className="h-2" />
              </div>
            </div>

            <Separator />

            {/* Contact Details */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t.contactDetails}
              </h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t.contact}</span>
                  <span className="font-medium">{vendor.contact_name || t.notProvided}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t.email}</span>
                  <span className="font-medium">{vendor.contact_email || t.notProvided}</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Timeline */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t.timeline}
              </h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t.lastAssessment}</span>
                  <span className="font-medium">
                    {vendor.last_assessment_date ? formatDate(vendor.last_assessment_date) : t.never}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t.nextReview}</span>
                  <span className="font-medium">{formatDate(vendor.next_review_date)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t.created}</span>
                  <span className="font-medium">{formatDate(vendor.created_at)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t.updated}</span>
                  <span className="font-medium">{formatDate(vendor.updated_at)}</span>
                </div>
              </div>
            </div>

            {/* Services Provided */}
            {vendor.services_provided.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    {t.servicesTitle}
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {vendor.services_provided.map((service) => (
                      <Badge key={service} variant="secondary" className="text-xs">
                        <Server className="me-1 h-3 w-3" />
                        {service}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Data Shared */}
            {vendor.data_shared.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    {t.dataTitle}
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {vendor.data_shared.map((data) => (
                      <Badge key={data} variant="outline" className="text-xs">
                        <Database className="me-1 h-3 w-3" />
                        {data}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Compliance Frameworks */}
            {vendor.compliance_frameworks.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    {t.complianceFrameworks}
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {vendor.compliance_frameworks.map((framework) => (
                      <Badge key={framework} variant="secondary" className="text-xs">
                        <Shield className="me-1 h-3 w-3" />
                        {framework}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Open findings warning */}
            {vendor.open_findings > 0 && (
              <>
                <Separator />
                <div className="rounded-xl border border-error-100 bg-error-50 dark:border-error-700 dark:bg-error-700/30 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4 text-status-error" />
                    <span className="font-medium text-error-700 dark:text-error-100">
                      {t.openFindingsCount(vendor.open_findings)}
                    </span>
                  </div>
                  <p className="text-sm text-error-600 dark:text-error-300">
                    {t.openFindingsWarning}
                  </p>
                </div>
              </>
            )}

            {/* All clear indicator */}
            {vendor.open_findings === 0 && controlsPercent === 100 && (
              <>
                <Separator />
                <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    <span className="font-medium text-primary">{t.fullyCompliant}</span>
                  </div>
                  <p className="text-sm text-primary mt-1">
                    {t.fullyCompliantNote}
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </DetailPanel>
  );
}
