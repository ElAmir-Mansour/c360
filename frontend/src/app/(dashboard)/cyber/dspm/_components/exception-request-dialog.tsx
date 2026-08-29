'use client';

import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { AsyncRecordPicker, type RecordPickerOption } from '@/components/shared/forms/async-record-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { useDspmLabels } from '../_lib/dspm-i18n';
import type { PaginatedResponse } from '@/types/api';
import type { DataAsset, DSPMDataPolicy, DSPMExceptionType, DSPMRemediation } from '@/types/cyber';

const PICKER_PAGE_SIZE = 25;

export async function loadDspmRemediationOptions(search: string): Promise<RecordPickerOption[]> {
  const response = await apiGet<PaginatedResponse<DSPMRemediation>>(API_ENDPOINTS.CYBER_DSPM_REMEDIATIONS, {
    page: 1, per_page: PICKER_PAGE_SIZE, search: search || undefined, sort: 'created_at', order: 'desc',
  });
  return response.data.map((remediation) => ({
    value: remediation.id,
    label: remediation.title,
    description: [remediation.finding_type.replace(/_/g, ' '), remediation.data_asset_name, remediation.severity, remediation.status]
      .filter(Boolean).join(' • '),
    keywords: [remediation.finding_type, remediation.data_asset_name ?? '', remediation.severity, remediation.status],
  }));
}

export async function loadDspmDataAssetOptions(search: string): Promise<RecordPickerOption[]> {
  const response = await apiGet<PaginatedResponse<DataAsset>>(API_ENDPOINTS.CYBER_DSPM_DATA_ASSETS, {
    page: 1, per_page: PICKER_PAGE_SIZE, search: search || undefined, sort: 'asset_name', order: 'asc',
  });
  return response.data.map((asset) => ({
    value: asset.id,
    label: asset.asset_name,
    description: [asset.asset_type, asset.data_classification, `Risk ${Math.round(asset.risk_score)}`].join(' • '),
    keywords: [asset.asset_id, asset.asset_type, asset.data_classification, ...(asset.pii_types ?? [])],
  }));
}

export async function loadDspmPolicyOptions(search: string): Promise<RecordPickerOption[]> {
  const response = await apiGet<PaginatedResponse<DSPMDataPolicy>>(API_ENDPOINTS.CYBER_DSPM_DATA_POLICIES, {
    page: 1, per_page: PICKER_PAGE_SIZE, search: search || undefined,
  });
  return response.data.map((policy) => ({
    value: policy.id,
    label: policy.name,
    description: [policy.category.replace(/_/g, ' '), policy.enforcement.replace(/_/g, ' ')].join(' • '),
    keywords: [policy.category, policy.enforcement, ...(policy.compliance_frameworks ?? [])],
  }));
}

type ExceptionRequestPayload = {
  exception_type: DSPMExceptionType;
  remediation_id?: string;
  data_asset_id?: string;
  policy_id?: string;
  justification: string;
  business_reason?: string;
  compensating_controls?: string;
  risk_score: number;
  expires_at: string;
  review_interval_days: number;
};

interface ExceptionRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ExceptionRequestPayload) => void;
  isSubmitting?: boolean;
}

export function ExceptionRequestDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false,
}: ExceptionRequestDialogProps) {
  const t = useDspmLabels().exceptionDialog;
  const EXCEPTION_TYPES: { value: DSPMExceptionType; label: string }[] = [
    { value: 'posture_finding', label: t.typePostureFinding },
    { value: 'policy_violation', label: t.typePolicyViolation },
    { value: 'overprivileged_access', label: t.typeOverprivilegedAccess },
    { value: 'exposure_risk', label: t.typeExposureRisk },
    { value: 'encryption_gap', label: t.typeEncryptionGap },
  ];
  const REVIEW_INTERVALS = [
    { value: '30', label: t.reviewDaysOption('30') },
    { value: '60', label: t.reviewDaysOption('60') },
    { value: '90', label: t.reviewDaysOption('90') },
    { value: '180', label: t.reviewDaysOption('180') },
  ];
  const [exceptionType, setExceptionType] = useState<DSPMExceptionType>('posture_finding');
  const [justification, setJustification] = useState('');
  const [businessReason, setBusinessReason] = useState('');
  const [compensatingControls, setCompensatingControls] = useState('');
  const [riskScore, setRiskScore] = useState<number>(50);
  const [expiresAt, setExpiresAt] = useState('');
  const [reviewIntervalDays, setReviewIntervalDays] = useState(90);
  const [remediationId, setRemediationId] = useState('');
  const [dataAssetId, setDataAssetId] = useState('');
  const [policyId, setPolicyId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const maxDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 365);
    return d.toISOString().split('T')[0];
  }, []);

  const today = useMemo(() => new Date().toISOString().split('T')[0], []);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!justification || justification.trim().length < 20) {
      newErrors.justification = t.justificationError;
    }

    if (!expiresAt) {
      newErrors.expires_at = t.expiresRequired;
    } else {
      const expDate = new Date(expiresAt);
      const maxExpDate = new Date();
      maxExpDate.setDate(maxExpDate.getDate() + 365);
      if (expDate > maxExpDate) {
        newErrors.expires_at = t.expiresMaxError;
      }
    }

    if (!riskScore || riskScore < 1 || riskScore > 100) {
      newErrors.risk_score = t.riskScoreError;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const payload: ExceptionRequestPayload = {
      exception_type: exceptionType,
      justification: justification.trim(),
      risk_score: riskScore,
      expires_at: new Date(expiresAt).toISOString(),
      review_interval_days: reviewIntervalDays,
    };

    if (businessReason.trim()) payload.business_reason = businessReason.trim();
    if (compensatingControls.trim()) payload.compensating_controls = compensatingControls.trim();
    if (remediationId.trim()) payload.remediation_id = remediationId.trim();
    if (dataAssetId.trim()) payload.data_asset_id = dataAssetId.trim();
    if (policyId.trim()) payload.policy_id = policyId.trim();

    onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Exception Type */}
          <div>
            <Label>{t.exceptionType}</Label>
            <Select value={exceptionType} onValueChange={(v) => setExceptionType(v as DSPMExceptionType)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXCEPTION_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Justification */}
          <div>
            <Label htmlFor="exc-justification">
              {t.justification} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="exc-justification"
              className="mt-1"
              placeholder={t.justificationPlaceholder}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={3}
            />
            {errors.justification && (
              <p className="mt-1 text-xs text-destructive">{errors.justification}</p>
            )}
          </div>

          {/* Business Reason */}
          <div>
            <Label htmlFor="exc-business-reason">{t.businessReason}</Label>
            <Textarea
              id="exc-business-reason"
              className="mt-1"
              placeholder={t.businessReasonPlaceholder}
              value={businessReason}
              onChange={(e) => setBusinessReason(e.target.value)}
              rows={2}
            />
          </div>

          {/* Compensating Controls */}
          <div>
            <Label htmlFor="exc-compensating">{t.compensatingControls}</Label>
            <Textarea
              id="exc-compensating"
              className="mt-1"
              placeholder={t.compensatingControlsPlaceholder}
              value={compensatingControls}
              onChange={(e) => setCompensatingControls(e.target.value)}
              rows={2}
            />
          </div>

          {/* Risk Score and Dates */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="exc-risk-score">
                {t.riskScore} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="exc-risk-score"
                type="number"
                min={1}
                max={100}
                className="mt-1"
                value={riskScore}
                onChange={(e) => setRiskScore(Number(e.target.value))}
              />
              {errors.risk_score && (
                <p className="mt-1 text-xs text-destructive">{errors.risk_score}</p>
              )}
            </div>
            <div>
              <Label htmlFor="exc-expires">
                {t.expiresAt} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="exc-expires"
                type="date"
                className="mt-1"
                min={today}
                max={maxDate}
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
              {errors.expires_at && (
                <p className="mt-1 text-xs text-destructive">{errors.expires_at}</p>
              )}
            </div>
          </div>

          {/* Review Interval */}
          <div>
            <Label>{t.reviewInterval}</Label>
            <Select value={String(reviewIntervalDays)} onValueChange={(v) => setReviewIntervalDays(Number(v))}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REVIEW_INTERVALS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Optional IDs */}
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground">{t.optionalReferences}</p>
            <div>
              <Label htmlFor="exc-remediation-id" className="text-xs">{t.remediationId}</Label>
              <AsyncRecordPicker
                id="exc-remediation-id"
                className="mt-1"
                ariaLabel={t.remediationId}
                queryKey={['cyber-dspm-exception-remediation-picker']}
                loadOptions={loadDspmRemediationOptions}
                value={remediationId}
                onChange={setRemediationId}
                allowClear
                labels={{ select: t.remediationIdPlaceholder }}
              />
            </div>
            <div>
              <Label htmlFor="exc-asset-id" className="text-xs">{t.dataAssetId}</Label>
              <AsyncRecordPicker
                id="exc-asset-id"
                className="mt-1"
                ariaLabel={t.dataAssetId}
                queryKey={['cyber-dspm-exception-data-asset-picker']}
                loadOptions={loadDspmDataAssetOptions}
                value={dataAssetId}
                onChange={setDataAssetId}
                allowClear
                labels={{ select: t.dataAssetIdPlaceholder }}
              />
            </div>
            <div>
              <Label htmlFor="exc-policy-id" className="text-xs">{t.policyId}</Label>
              <AsyncRecordPicker
                id="exc-policy-id"
                className="mt-1"
                ariaLabel={t.policyId}
                queryKey={['cyber-dspm-exception-policy-picker']}
                loadOptions={loadDspmPolicyOptions}
                value={policyId}
                onChange={setPolicyId}
                allowClear
                labels={{ select: t.policyIdPlaceholder }}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t.submitting : t.submit}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
