'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDspmLabels } from '../_lib/dspm-i18n';
import type { DSPMDataPolicy, DSPMPolicyCategory, DSPMPolicyEnforcement, CyberSeverity } from '@/types/cyber';

type CreatePolicyPayload = {
  name: string;
  description: string;
  category: DSPMPolicyCategory;
  enforcement: DSPMPolicyEnforcement;
  severity: CyberSeverity;
  rule: Record<string, unknown>;
  scope_classification: string[];
  scope_asset_types: string[];
  enabled: boolean;
  compliance_frameworks: string[];
};

interface PolicyEditorFormProps {
  policy?: DSPMDataPolicy;
  onSubmit: (data: CreatePolicyPayload) => void;
  onCancel: () => void;
}

const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'];
const ASSET_TYPES = ['database', 'cloud_storage', 'file_server', 'api_endpoint', 'data_warehouse', 'object_store'];
const COMPLIANCE_FRAMEWORKS = ['GDPR', 'HIPAA', 'SOC2', 'PCI-DSS', 'Saudi PDPL'];

export function PolicyEditorForm({ policy, onSubmit, onCancel }: PolicyEditorFormProps) {
  const t = useDspmLabels().policyForm;
  const CATEGORIES: { value: DSPMPolicyCategory; label: string }[] = [
    { value: 'encryption', label: t.catEncryption },
    { value: 'classification', label: t.catClassification },
    { value: 'retention', label: t.catRetention },
    { value: 'exposure', label: t.catExposure },
    { value: 'pii_protection', label: t.catPiiProtection },
    { value: 'access_review', label: t.catAccessReview },
    { value: 'backup', label: t.catBackup() },
    { value: 'audit_logging', label: t.catAuditLogging },
  ];
  const ENFORCEMENTS: { value: DSPMPolicyEnforcement; label: string }[] = [
    { value: 'alert', label: t.enfAlertOnly },
    { value: 'auto_remediate', label: t.enfAutoRemediate },
    { value: 'block', label: t.enfBlock },
  ];
  const SEVERITIES: { value: CyberSeverity; label: string }[] = [
    { value: 'critical', label: t.sevCritical },
    { value: 'high', label: t.sevHigh },
    { value: 'medium', label: t.sevMedium },
    { value: 'low', label: t.sevLow },
  ];
  const [name, setName] = useState(policy?.name ?? '');
  const [description, setDescription] = useState(policy?.description ?? '');
  const [category, setCategory] = useState<DSPMPolicyCategory>(policy?.category ?? 'encryption');
  const [enforcement, setEnforcement] = useState<DSPMPolicyEnforcement>(policy?.enforcement ?? 'alert');
  const [severity, setSeverity] = useState<CyberSeverity>(policy?.severity ?? 'medium');
  const [enabled, setEnabled] = useState(policy?.enabled ?? true);
  const [rule, setRule] = useState<Record<string, unknown>>(policy?.rule ?? {});
  const [scopeClassification, setScopeClassification] = useState<string[]>(policy?.scope_classification ?? []);
  const [scopeAssetTypes, setScopeAssetTypes] = useState<string[]>(policy?.scope_asset_types ?? []);
  const [complianceFrameworks, setComplianceFrameworks] = useState<string[]>(policy?.compliance_frameworks ?? []);

  const toggleArray = (arr: string[], value: string): string[] =>
    arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];

  const updateRule = (key: string, value: unknown) => {
    setRule((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      description,
      category,
      enforcement,
      severity,
      rule,
      scope_classification: scopeClassification,
      scope_asset_types: scopeAssetTypes,
      enabled,
      compliance_frameworks: complianceFrameworks,
    });
  };

  const renderRuleFields = () => {
    switch (category) {
      case 'encryption':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="require_at_rest"
                checked={!!rule.require_at_rest}
                onCheckedChange={(v) => updateRule('require_at_rest', !!v)}
              />
              <Label htmlFor="require_at_rest" className="cursor-pointer">{t.requireAtRest}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="require_in_transit"
                checked={!!rule.require_in_transit}
                onCheckedChange={(v) => updateRule('require_in_transit', !!v)}
              />
              <Label htmlFor="require_in_transit" className="cursor-pointer">{t.requireInTransit}</Label>
            </div>
          </div>
        );
      case 'classification':
        return (
          <div className="space-y-3">
            <div>
              <Label>{t.requiredClassLevel}</Label>
              <Select
                value={(rule.required_level as string) ?? ''}
                onValueChange={(v) => updateRule('required_level', v)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={t.selectLevel} />
                </SelectTrigger>
                <SelectContent>
                  {CLASSIFICATIONS.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t.minClassLevel}</Label>
              <Select
                value={(rule.min_level as string) ?? ''}
                onValueChange={(v) => updateRule('min_level', v)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={t.selectMinLevel} />
                </SelectTrigger>
                <SelectContent>
                  {CLASSIFICATIONS.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      case 'retention':
        return (
          <div>
            <Label htmlFor="max_retention_days">{t.maxRetentionDays}</Label>
            <Input
              id="max_retention_days"
              type="number"
              min={1}
              className="mt-1"
              value={(rule.max_retention_days as number) ?? ''}
              onChange={(e) => updateRule('max_retention_days', e.target.value ? Number(e.target.value) : undefined)}
            />
          </div>
        );
      case 'exposure':
        return (
          <div>
            <Label>{t.maxAllowedExposure}</Label>
            <Select
              value={(rule.max_exposure as string) ?? ''}
              onValueChange={(v) => updateRule('max_exposure', v)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={t.selectMaxExposure} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">{t.expPrivate}</SelectItem>
                <SelectItem value="internal">{t.expInternal}</SelectItem>
                <SelectItem value="dmz">{t.expDmz}</SelectItem>
                <SelectItem value="internet_facing">{t.expInternetFacing}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        );
      case 'pii_protection':
        return (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="require_encryption_pii"
                checked={!!rule.require_encryption}
                onCheckedChange={(v) => updateRule('require_encryption', !!v)}
              />
              <Label htmlFor="require_encryption_pii" className="cursor-pointer">{t.requireEncryptionPii}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="require_masking"
                checked={!!rule.require_masking}
                onCheckedChange={(v) => updateRule('require_masking', !!v)}
              />
              <Label htmlFor="require_masking" className="cursor-pointer">{t.requireMasking}</Label>
            </div>
            <div>
              <Label htmlFor="allowed_pii_types">{t.allowedPiiTypes}</Label>
              <Input
                id="allowed_pii_types"
                className="mt-1"
                placeholder={t.allowedPiiTypesPlaceholder}
                value={Array.isArray(rule.allowed_pii_types) ? (rule.allowed_pii_types as string[]).join(', ') : ''}
                onChange={(e) =>
                  updateRule(
                    'allowed_pii_types',
                    e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
              />
            </div>
          </div>
        );
      case 'access_review':
        return (
          <div>
            <Label htmlFor="max_days_since_review">{t.maxDaysSinceReview}</Label>
            <Input
              id="max_days_since_review"
              type="number"
              min={1}
              className="mt-1"
              value={(rule.max_days_since_review as number) ?? ''}
              onChange={(e) => updateRule('max_days_since_review', e.target.value ? Number(e.target.value) : undefined)}
            />
          </div>
        );
      case 'backup':
        return (
          <div className="flex items-center gap-2">
            <Checkbox
              id="require_backup"
              checked={!!rule.require_backup}
              onCheckedChange={(v) => updateRule('require_backup', !!v)}
            />
            <Label htmlFor="require_backup" className="cursor-pointer">{t.requireBackup()}</Label>
          </div>
        );
      case 'audit_logging':
        return (
          <div className="flex items-center gap-2">
            <Checkbox
              id="require_audit"
              checked={!!rule.require_audit}
              onCheckedChange={(v) => updateRule('require_audit', !!v)}
            />
            <Label htmlFor="require_audit" className="cursor-pointer">{t.requireAudit}</Label>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{policy ? t.editPolicy : t.createPolicy}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="policy-name">{t.policyName}</Label>
            <Input
              id="policy-name"
              className="mt-1"
              placeholder={t.policyNamePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="policy-description">{t.description}</Label>
            <Textarea
              id="policy-description"
              className="mt-1"
              placeholder={t.descriptionPlaceholder}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label>{t.category}</Label>
              <Select value={category} onValueChange={(v) => { setCategory(v as DSPMPolicyCategory); setRule({}); }}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t.enforcement}</Label>
              <Select value={enforcement} onValueChange={(v) => setEnforcement(v as DSPMPolicyEnforcement)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENFORCEMENTS.map((e) => (
                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t.severity}</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as CyberSeverity)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="policy-enabled"
              checked={enabled}
              onCheckedChange={(v) => setEnabled(!!v)}
            />
            <Label htmlFor="policy-enabled" className="cursor-pointer">{t.policyEnabled}</Label>
          </div>
        </CardContent>
      </Card>

      {/* Rule Builder */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.ruleConfiguration}</CardTitle>
        </CardHeader>
        <CardContent>{renderRuleFields()}</CardContent>
      </Card>

      {/* Scope */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.scope}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">{t.classificationFilter}</p>
            <div className="flex flex-wrap gap-3">
              {CLASSIFICATIONS.map((cls) => (
                <div key={cls} className="flex items-center gap-2">
                  <Checkbox
                    id={`scope-cls-${cls}`}
                    checked={scopeClassification.includes(cls)}
                    onCheckedChange={() => setScopeClassification(toggleArray(scopeClassification, cls))}
                  />
                  <Label htmlFor={`scope-cls-${cls}`} className="cursor-pointer capitalize">{cls}</Label>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">{t.assetTypeFilter}</p>
            <div className="flex flex-wrap gap-3">
              {ASSET_TYPES.map((at) => (
                <div key={at} className="flex items-center gap-2">
                  <Checkbox
                    id={`scope-at-${at}`}
                    checked={scopeAssetTypes.includes(at)}
                    onCheckedChange={() => setScopeAssetTypes(toggleArray(scopeAssetTypes, at))}
                  />
                  <Label htmlFor={`scope-at-${at}`} className="cursor-pointer capitalize">
                    {at.replace(/_/g, ' ')}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Compliance Frameworks */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.complianceFrameworks}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {COMPLIANCE_FRAMEWORKS.map((fw) => (
              <div key={fw} className="flex items-center gap-2">
                <Checkbox
                  id={`fw-${fw}`}
                  checked={complianceFrameworks.includes(fw)}
                  onCheckedChange={() => setComplianceFrameworks(toggleArray(complianceFrameworks, fw))}
                />
                <Label htmlFor={`fw-${fw}`} className="cursor-pointer">{fw}</Label>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="submit">
          {policy ? t.updatePolicy : t.createPolicy}
        </Button>
      </div>
    </form>
  );
}
