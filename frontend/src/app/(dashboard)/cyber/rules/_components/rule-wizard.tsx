'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

import { useApiMutation } from '@/hooks/use-api-mutation';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import {
  defaultAnomalyContent,
  defaultCorrelationContent,
  defaultSigmaContent,
  defaultThresholdContent,
  DETECTION_RULE_TYPE_OPTIONS,
  getRuleTypeLabel,
  normalizeRule,
  parseSigmaYamlText,
  RULE_SEVERITY_OPTIONS,
  serializeRuleContent,
  stringifySigmaContent,
  validateAnomalyContent,
  validateCorrelationContent,
  validateThresholdContent,
} from '@/lib/cyber-rules';
import type {
  AnomalyRuleContent,
  CorrelationRuleContent,
  CyberSeverity,
  DetectionRule,
  DetectionRuleType,
  MITRETacticItem,
  MITRETechniqueItem,
  SigmaRuleContent,
  ThresholdRuleContent,
} from '@/types/cyber';
import { slugToTitle } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';

import { RuleAnomalyEditor } from './rule-anomaly-editor';
import { RuleCorrelationEditor } from './rule-correlation-editor';
import { RuleSigmaMonaco } from './rule-sigma-monaco';
import { RuleThresholdEditor } from './rule-threshold-editor';
import { useRulesLabels } from '../_lib/rules-i18n';

type WizardStep = 0 | 1 | 2 | 3;

interface RuleWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  rule?: DetectionRule | null;
  initialTechniqueId?: string | null;
}

const EMPTY_TACTICS: MITRETacticItem[] = [];
const EMPTY_TECHNIQUES: MITRETechniqueItem[] = [];

export function RuleWizard({
  open,
  onOpenChange,
  onSuccess,
  rule,
  initialTechniqueId,
}: RuleWizardProps) {
  const t = useRulesLabels();
  const STEPS = [t.wizard.steps.basics, t.wizard.steps.logic, t.wizard.steps.mitre, t.wizard.steps.review] as const;
  const sourceRule = useMemo(() => (rule ? normalizeRule(rule) : null), [rule]);
  const editingRule = sourceRule?.id ? sourceRule : null;
  const [step, setStep] = useState<WizardStep>(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ruleType, setRuleType] = useState<DetectionRuleType>('sigma');
  const [severity, setSeverity] = useState<CyberSeverity>('medium');
  const [enabled, setEnabled] = useState(true);
  const [baseConfidence, setBaseConfidence] = useState(0.7);
  const [tagsInput, setTagsInput] = useState('');
  const [sigmaYaml, setSigmaYaml] = useState('');
  const [thresholdContent, setThresholdContent] = useState<ThresholdRuleContent>(defaultThresholdContent());
  const [correlationContent, setCorrelationContent] = useState<CorrelationRuleContent>(defaultCorrelationContent());
  const [anomalyContent, setAnomalyContent] = useState<AnomalyRuleContent>(defaultAnomalyContent());
  const [selectedTactics, setSelectedTactics] = useState<string[]>([]);
  const [selectedTechniques, setSelectedTechniques] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  const { data: tacticsEnvelope } = useQuery({
    queryKey: ['cyber-rule-mitre-tactics'],
    queryFn: () => apiGet<{ data: MITRETacticItem[] }>(API_ENDPOINTS.CYBER_MITRE_TACTICS),
    staleTime: 300_000,
  });

  const { data: techniquesEnvelope } = useQuery({
    queryKey: ['cyber-rule-mitre-techniques'],
    queryFn: () => apiGet<{ data: MITRETechniqueItem[] }>(API_ENDPOINTS.CYBER_MITRE_TECHNIQUES),
    staleTime: 300_000,
  });

  const tactics = tacticsEnvelope?.data ?? EMPTY_TACTICS;
  const techniques = techniquesEnvelope?.data ?? EMPTY_TECHNIQUES;

  const groupedTechniques = useMemo(() => {
    return tactics.map((tactic) => ({
      tactic,
      techniques: techniques.filter((technique) => technique.tactic_ids.includes(tactic.id)),
    }));
  }, [tactics, techniques]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setStep(0);
    setValidationError(null);
    setName(sourceRule?.name ?? '');
    setDescription(sourceRule?.description ?? '');
    setRuleType(sourceRule?.rule_type ?? 'sigma');
    setSeverity(sourceRule?.severity ?? 'medium');
    setEnabled(sourceRule?.enabled ?? true);
    setBaseConfidence(sourceRule?.base_confidence ?? 0.7);
    setTagsInput((sourceRule?.tags ?? []).join(', '));
    setThresholdContent((sourceRule?.rule_type === 'threshold' ? sourceRule.rule_content : defaultThresholdContent()) as ThresholdRuleContent);
    setCorrelationContent((sourceRule?.rule_type === 'correlation' ? sourceRule.rule_content : defaultCorrelationContent()) as CorrelationRuleContent);
    setAnomalyContent((sourceRule?.rule_type === 'anomaly' ? sourceRule.rule_content : defaultAnomalyContent()) as AnomalyRuleContent);

    const sigmaContent =
      sourceRule?.rule_type === 'sigma'
        ? serializeRuleContent('sigma', sourceRule.rule_content as SigmaRuleContent)
        : serializeRuleContent('sigma', defaultSigmaContent());
    setSigmaYaml(stringifySigmaContent(sigmaContent));

    const initialTechniques = sourceRule?.mitre_technique_ids ?? (initialTechniqueId ? [initialTechniqueId] : []);
    setSelectedTechniques(initialTechniques);

    const techniqueTactics = new Set<string>(sourceRule?.mitre_tactic_ids ?? []);
    initialTechniques.forEach((techniqueId) => {
      techniques.find((technique) => technique.id === techniqueId)?.tactic_ids.forEach((tacticId) => {
        techniqueTactics.add(tacticId);
      });
    });
    setSelectedTactics(Array.from(techniqueTactics));
  }, [initialTechniqueId, open, sourceRule, techniques]);

  useEffect(() => {
    setSelectedTechniques((current) => {
      const next = current.filter((techniqueId) => {
        const technique = techniques.find((item) => item.id === techniqueId);
        return !technique || technique.tactic_ids.some((tacticId) => selectedTactics.includes(tacticId));
      });
      return next.length === current.length ? current : next;
    });
  }, [selectedTactics, techniques]);

  const mutation = useApiMutation<DetectionRule, Record<string, unknown>>(
    editingRule ? 'put' : 'post',
    editingRule ? API_ENDPOINTS.CYBER_RULE_DETAIL(editingRule.id) : API_ENDPOINTS.CYBER_RULES,
    {
      successMessage: editingRule ? t.wizard.toastUpdated : t.wizard.toastCreated,
      invalidateKeys: ['cyber-rules', 'cyber-rules-stats', 'cyber-mitre-coverage', 'cyber-rule-detail'],
      onSuccess: () => {
        onOpenChange(false);
        onSuccess?.();
      },
    },
  );

  const currentLogic = useMemo(() => {
    if (ruleType === 'threshold') {
      return thresholdContent;
    }
    if (ruleType === 'correlation') {
      return correlationContent;
    }
    if (ruleType === 'anomaly') {
      return anomalyContent;
    }
    return null;
  }, [anomalyContent, correlationContent, ruleType, thresholdContent]);

  function validateCurrentStep(targetStep: WizardStep): boolean {
    if (targetStep === 0) {
      if (name.trim().length < 3) {
        setValidationError(t.wizard.errNameLength);
        return false;
      }
      setValidationError(null);
      return true;
    }

    if (targetStep === 1) {
      if (ruleType === 'sigma') {
        try {
          parseSigmaYamlText(sigmaYaml);
        } catch (error) {
          setValidationError(error instanceof Error ? error.message : t.wizard.errInvalidSigma);
          return false;
        }
      } else if (ruleType === 'threshold') {
        const err = validateThresholdContent(thresholdContent);
        if (err) {
          setValidationError(err);
          return false;
        }
      } else if (ruleType === 'correlation') {
        const err = validateCorrelationContent(correlationContent);
        if (err) {
          setValidationError(err);
          return false;
        }
      } else if (ruleType === 'anomaly') {
        const err = validateAnomalyContent(anomalyContent);
        if (err) {
          setValidationError(err);
          return false;
        }
      }

      setValidationError(null);
      return true;
    }

    setValidationError(null);
    return true;
  }

  function goNext() {
    if (!validateCurrentStep(step)) {
      return;
    }
    setStep((current) => (current >= 3 ? 3 : ((current + 1) as WizardStep)));
  }

  function toggleTactic(tacticId: string) {
    setSelectedTactics((current) =>
      current.includes(tacticId)
        ? current.filter((item) => item !== tacticId)
        : [...current, tacticId],
    );
  }

  function toggleTechnique(techniqueId: string, tacticIds: string[]) {
    setSelectedTechniques((current) =>
      current.includes(techniqueId)
        ? current.filter((item) => item !== techniqueId)
        : [...current, techniqueId],
    );
    setSelectedTactics((current) => Array.from(new Set([...current, ...tacticIds])));
  }

  function handleSave() {
    if (!validateCurrentStep(step)) {
      return;
    }

    try {
      const ruleContent =
        ruleType === 'sigma'
          ? parseSigmaYamlText(sigmaYaml)
          : serializeRuleContent(ruleType, currentLogic as ThresholdRuleContent | CorrelationRuleContent | AnomalyRuleContent);

      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        severity,
        enabled,
        base_confidence: baseConfidence,
        rule_content: ruleContent,
        mitre_tactic_ids: selectedTactics,
        mitre_technique_ids: selectedTechniques,
        tags: tagsInput
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      };

      // rule_type is only accepted during creation; the backend UpdateRuleRequest
      // does not include it (type cannot change after creation).
      if (!editingRule) {
        payload.rule_type = ruleType;
      }

      mutation.mutate(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : t.wizard.errBuildPayload;
      setValidationError(message);
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-5xl" aria-describedby={undefined}>
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>{editingRule ? t.wizard.editTitle : t.wizard.createTitle}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-6 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            {STEPS.map((label, index) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  if (index <= step || validateCurrentStep(step)) {
                    setStep(index as WizardStep);
                  }
                }}
                className={`rounded-soft border px-4 py-3 text-start transition ${
                  step === index ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground'
                }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-caps-xwide">{t.wizard.stepLabel(index + 1)}</p>
                <p className="mt-2 text-sm font-medium">{label}</p>
              </button>
            ))}
          </div>

          {step === 0 && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="rule-name">{t.wizard.ruleName}</Label>
                  <Input id="rule-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t.wizard.ruleNamePlaceholder} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rule-description">{t.wizard.description}</Label>
                  <Textarea
                    id="rule-description"
                    rows={5}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={t.wizard.descriptionPlaceholder}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rule-tags">{t.wizard.tags}</Label>
                  <Input
                    id="rule-tags"
                    value={tagsInput}
                    onChange={(event) => setTagsInput(event.target.value)}
                    placeholder={t.wizard.tagsPlaceholder}
                  />
                </div>
              </div>

              <div className="space-y-4 rounded-softer surface-card p-5">
                <div className="space-y-2">
                  <Label>{t.wizard.ruleType}</Label>
                  <Select value={ruleType} onValueChange={(value) => setRuleType(value as DetectionRuleType)} disabled={Boolean(editingRule)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DETECTION_RULE_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {editingRule ? (
                    <p className="text-xs text-muted-foreground">{t.wizard.ruleTypeLocked}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label>{t.wizard.severity}</Label>
                  <Select value={severity} onValueChange={(value) => setSeverity(value as CyberSeverity)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RULE_SEVERITY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rule-confidence">{t.wizard.baseConfidence}</Label>
                  <Input
                    id="rule-confidence"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={baseConfidence}
                    onChange={(event) => setBaseConfidence(Number(event.target.value) || 0)}
                  />
                </div>

                <div className="flex items-center justify-between rounded-2xl border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{t.wizard.ruleEnabled}</p>
                    <p className="text-xs text-muted-foreground">{t.wizard.ruleEnabledHint}</p>
                  </div>
                  <Switch checked={enabled} onCheckedChange={setEnabled} />
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              {ruleType === 'sigma' ? (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{t.wizard.sigmaYaml}</p>
                      <p className="text-sm text-muted-foreground">{t.wizard.sigmaHint}</p>
                    </div>
                    <Badge variant="outline">{t.wizard.monaco}</Badge>
                  </div>
                  <RuleSigmaMonaco value={sigmaYaml} onChange={setSigmaYaml} />
                </div>
              ) : null}

              {ruleType === 'threshold' ? (
                <RuleThresholdEditor value={thresholdContent} onChange={setThresholdContent} />
              ) : null}

              {ruleType === 'correlation' ? (
                <div className="space-y-4">
                  <RuleCorrelationEditor value={correlationContent} onChange={setCorrelationContent} />
                  <div className="space-y-2">
                    <Label htmlFor="min-failed-count">{t.wizard.minFirstEventMatches}</Label>
                    <Input
                      id="min-failed-count"
                      type="number"
                      min={0}
                      value={correlationContent.min_failed_count ?? 0}
                      onChange={(event) =>
                        setCorrelationContent((current) => ({
                          ...current,
                          min_failed_count: Number(event.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                </div>
              ) : null}

              {ruleType === 'anomaly' ? (
                <RuleAnomalyEditor value={anomalyContent} onChange={setAnomalyContent} />
              ) : null}
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
              <div className="rounded-softer surface-card p-4">
                <p className="text-sm font-medium">{t.wizard.tactics}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t.wizard.tacticsHint}</p>
                <div className="mt-4 space-y-2">
                  {tactics.map((tactic) => (
                    <label key={tactic.id} className="flex items-start gap-3 rounded-2xl border px-3 py-3">
                      <Checkbox
                        checked={selectedTactics.includes(tactic.id)}
                        onCheckedChange={() => toggleTactic(tactic.id)}
                      />
                      <div>
                        <p className="text-sm font-medium">{tactic.name}</p>
                        <p className="text-xs text-muted-foreground">{tactic.id}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-softer surface-card p-4">
                <p className="text-sm font-medium">{t.wizard.techniques}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t.wizard.techniquesHint}</p>
                <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {groupedTechniques
                    .filter((group) => selectedTactics.includes(group.tactic.id))
                    .map((group) => (
                      <div key={group.tactic.id} className="rounded-2xl border p-4">
                        <div className="mb-3">
                          <p className="text-sm font-medium">{group.tactic.name}</p>
                          <p className="text-xs text-muted-foreground">{group.tactic.id}</p>
                        </div>
                        <div className="space-y-2">
                          {group.techniques.map((technique) => (
                            <label key={technique.id} className="flex items-start gap-3 rounded-xl border px-3 py-3">
                              <Checkbox
                                checked={selectedTechniques.includes(technique.id)}
                                onCheckedChange={() => toggleTechnique(technique.id, technique.tactic_ids)}
                              />
                              <div>
                                <p className="text-sm font-medium">
                                  <span className="me-2 font-mono text-xs text-muted-foreground">{technique.id}</span>
                                  {technique.name}
                                </p>
                                <p className="text-xs text-muted-foreground">{technique.description}</p>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
              <div className="rounded-softer surface-card p-5">
                <p className="text-sm font-medium">{t.wizard.configSummary}</p>
                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.wizard.basics}</p>
                    <p className="mt-2 text-lg font-semibold">{name || t.wizard.untitledRule}</p>
                    <p className="text-sm text-muted-foreground">{description || t.wizard.noDescription}</p>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.wizard.type}</p>
                      <p className="mt-2 text-sm font-medium">{getRuleTypeLabel(ruleType)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.wizard.severityLabel}</p>
                      <p className="mt-2 text-sm font-medium">{slugToTitle(severity)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.wizard.confidenceLabel}</p>
                      <p className="mt-2 text-sm font-medium">{Math.round(baseConfidence * 100)}%</p>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">{t.wizard.mitreMapping}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedTechniques.length === 0 ? (
                        <span className="text-sm text-muted-foreground">{t.wizard.noTechniquesSelected}</span>
                      ) : (
                        selectedTechniques.map((techniqueId) => (
                          <Badge key={techniqueId} variant="outline" className="font-mono">
                            {techniqueId}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-softer surface-card p-5">
                <p className="text-sm font-medium">{t.wizard.logicPreview}</p>
                <pre className="mt-4 max-h-[420px] overflow-auto rounded-2xl bg-auth-dark/95 p-4 text-xs text-emerald-100">
                  {ruleType === 'sigma'
                    ? sigmaYaml
                    : JSON.stringify(
                        serializeRuleContent(ruleType, currentLogic as ThresholdRuleContent | CorrelationRuleContent | AnomalyRuleContent),
                        null,
                        2,
                      )}
                </pre>
              </div>
            </div>
          )}

          {validationError ? (
            <div className="rounded-2xl border border-error-100 bg-error-50 dark:border-error-700 dark:bg-error-700/30 px-4 py-3 text-sm text-error-600 dark:text-error-300">
              {validationError}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <div className="flex w-full items-center justify-between">
            <Button
              variant="outline"
              onClick={() =>
                step === 0
                  ? onOpenChange(false)
                  : setStep((current) => (current <= 0 ? 0 : ((current - 1) as WizardStep)))
              }
            >
              {step === 0 ? t.wizard.cancel : t.wizard.back}
            </Button>

            {step < 3 ? (
              <Button onClick={goNext}>
                {t.wizard.next}
                <ChevronRight className="ms-2 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={handleSave} disabled={mutation.isPending}>
                {mutation.isPending ? t.wizard.saving : editingRule ? t.wizard.updateRule : t.wizard.createRule}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
