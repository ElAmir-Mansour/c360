/**
 * RuleLibrary — the Watheeq compliance Regulation Library list with an inline
 * enable/disable toggle, name/description/type search, and group-by (rule type
 * or severity).
 *
 * This component replaces the inline rule list previously rendered in
 * `compliance/page.tsx` (the `rules.map(...)` block inside the "Rule Library"
 * SectionCard). It preserves the prior visual treatment exactly — severity
 * accent bar (rose for critical/high, amber for medium, muted otherwise), name,
 * rule_type label, description, "Disabled" badge, the `SeverityIndicator`, and
 * the Edit/Delete dropdown for writers — and adds:
 *
 *   - an inline `<Switch>` per rule that toggles `enabled` with an OPTIMISTIC
 *     react-query mutation (rollback + `showApiError` on failure, invalidate
 *     ['lex-compliance-rules'] + ['lex-compliance-dashboard'] + ['lex-overview']
 *     + ['lex-command'] on settle), and
 *   - a search `Input` plus a group-by toggle (rule type / severity) with an
 *     accessible, RTL-correct grouped layout.
 *
 * Bilingual: this module owns its own `LexBilingual<RuleLibraryLabels>` bundle
 * + `useRuleLibraryLabels()` hook, following the canonical lex i18n contract
 * (`../../_lib/lex-i18n.ts`). The integrator wires it in by replacing the inline
 * list with `<RuleLibrary ... />` inside the existing SectionCard.
 */

'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Layers, MoreHorizontal, Pencil, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { SeverityIndicator, type Severity } from '@/components/shared/severity-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { shapeDigits } from '@/lib/lex/ksa';
import type { AppLocale } from '@/lib/i18n';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type { PaginatedResponse } from '@/types/api';
import type {
  LexComplianceRule,
  LexComplianceRuleType,
  LexComplianceSeverity,
} from '@/types/suites';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

// ---------------------------------------------------------------------------
// Bilingual labels (self-contained — see lex-i18n.ts contract)
// ---------------------------------------------------------------------------

interface RuleLibraryLabels {
  searchPlaceholder: string;
  searchAria: string;
  groupByLabel: string;
  groupByType: string;
  groupBySeverity: string;
  disabledBadge: string;
  enableAria: (name: string) => string;
  ruleMenuAria: (name: string) => string;
  edit: string;
  delete: string;
  groupCount: (count: number) => string;
  noMatches: string;
  ruleTypes: Record<string, string>;
  severities: Record<string, string>;
  toggleEnabledTitle: string;
  toggleDisabledTitle: string;
  toggleSavedDescription: (name: string) => string;
}

const ruleLibraryLabels: LexBilingual<RuleLibraryLabels> = {
  en: {
    searchPlaceholder: 'Search rules by name, description, or type…',
    searchAria: 'Search compliance rules',
    groupByLabel: 'Group by',
    groupByType: 'Type',
    groupBySeverity: 'Severity',
    disabledBadge: 'Disabled',
    enableAria: (name) => `Enable or disable rule ${name}`,
    ruleMenuAria: (name) => `Actions for rule ${name}`,
    edit: 'Edit',
    delete: 'Delete',
    groupCount: (count) => `${count} rule${count === 1 ? '' : 's'}`,
    noMatches: 'No rules match your search.',
    ruleTypes: {
      expiry_warning: 'expiry warning',
      missing_clause: 'missing clause',
      risk_threshold: 'risk threshold',
      review_overdue: 'review overdue',
      unsigned_contract: 'unsigned contract',
      value_threshold: 'value threshold',
      jurisdiction_check: 'jurisdiction check',
      data_protection_required: 'data protection required',
      custom: 'custom',
    },
    severities: {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    },
    toggleEnabledTitle: 'Rule enabled.',
    toggleDisabledTitle: 'Rule disabled.',
    toggleSavedDescription: (name) => `"${name}" has been saved.`,
  },
  ar: {
    searchPlaceholder: 'ابحث في القواعد بالاسم أو الوصف أو النوع…',
    searchAria: 'البحث في قواعد الامتثال',
    groupByLabel: 'التجميع حسب',
    groupByType: 'النوع',
    groupBySeverity: 'الخطورة',
    disabledBadge: 'مُعطَّلة',
    enableAria: (name) => `تفعيل أو تعطيل القاعدة ${name}`,
    ruleMenuAria: (name) => `إجراءات القاعدة ${name}`,
    edit: 'تعديل',
    delete: 'حذف',
    groupCount: (count) => `${count} قاعدة`,
    noMatches: 'لا توجد قواعد مطابقة لبحثك.',
    ruleTypes: {
      expiry_warning: 'تنبيه انتهاء',
      missing_clause: 'بند مفقود',
      risk_threshold: 'حدّ المخاطر',
      review_overdue: 'مراجعة متأخرة',
      unsigned_contract: 'عقد غير موقّع',
      value_threshold: 'حدّ القيمة',
      jurisdiction_check: 'فحص الاختصاص',
      data_protection_required: 'حماية البيانات مطلوبة',
      custom: 'مخصّص',
    },
    severities: {
      critical: 'حرج',
      high: 'مرتفع',
      medium: 'متوسط',
      low: 'منخفض',
    },
    toggleEnabledTitle: 'تم تفعيل القاعدة.',
    toggleDisabledTitle: 'تم تعطيل القاعدة.',
    toggleSavedDescription: (name) => `تم حفظ "${name}".`,
  },
};

function useRuleLibraryLabels(): RuleLibraryLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(ruleLibraryLabels, locale), [locale]);
}

/** Pure resolver for non-React callers / tests. */
export function resolveRuleLibraryLabels(locale: AppLocale = 'en'): RuleLibraryLabels {
  return resolveLexBilingual(ruleLibraryLabels, locale === 'ar' ? 'ar' : 'en');
}

// ---------------------------------------------------------------------------
// Local severity helpers (kept self-contained to mirror page.tsx)
// ---------------------------------------------------------------------------

/**
 * ruleSeverityAccent is the semantic leading-accent bar for a rule's severity:
 * critical/high → rose (risk), medium → amber (caution), low/other → neutral.
 * The `SeverityIndicator` already carries the precise label; this bar is a
 * decorative reinforcement only. Mirrors the helper formerly in page.tsx.
 */
function ruleSeverityAccent(severity: string): string {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'bg-destructive/70';
    case 'medium':
      return 'bg-warning-300/70';
    default:
      return 'bg-muted-foreground/30';
  }
}

/** normalizeSeverity maps a raw backend severity to a `SeverityIndicator` value. */
function normalizeSeverity(value: string): Severity {
  switch (value) {
    case 'critical':
    case 'high':
    case 'medium':
    case 'low':
      return value;
    default:
      return 'info';
  }
}

// Stable presentation orderings so groups render deterministically regardless
// of the order rules arrive in.
const RULE_TYPE_ORDER: readonly LexComplianceRuleType[] = [
  'expiry_warning',
  'missing_clause',
  'risk_threshold',
  'review_overdue',
  'unsigned_contract',
  'value_threshold',
  'jurisdiction_check',
  'data_protection_required',
  'custom',
];
const SEVERITY_ORDER: readonly LexComplianceSeverity[] = ['critical', 'high', 'medium', 'low'];

type GroupBy = 'rule_type' | 'severity';

const RULES_QUERY_KEY = ['lex-compliance-rules'] as const;
const DASHBOARD_QUERY_KEY = ['lex-compliance-dashboard'] as const;
const OVERVIEW_QUERY_KEY = ['lex-overview'] as const;
const COMMAND_QUERY_KEY = ['lex-command'] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface RuleLibraryProps {
  rules: LexComplianceRule[];
  /** Whether the current user may toggle / edit / delete rules (`lex:write`). */
  canWrite: boolean;
  /** Open the edit dialog for `rule` (owned by the page). */
  onEdit: (rule: LexComplianceRule) => void;
  /** Open the delete confirmation for `rule` (owned by the page). */
  onDelete: (rule: LexComplianceRule) => void;
  /**
   * Rendered when `rules` is empty (the integrator passes the
   * RuleTemplateGallery here). When omitted, nothing is rendered for the empty
   * state so the caller stays in control of the empty surface.
   */
  emptyState?: ReactNode;
}

export function RuleLibrary({ rules, canWrite, onEdit, onDelete, emptyState }: RuleLibraryProps) {
  const labels = useRuleLibraryLabels();
  const { locale } = useLocaleOrDefault();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('rule_type');

  // Optimistic enable/disable toggle. Targets the cached PaginatedResponse under
  // ['lex-compliance-rules'], rolls back on error, and invalidates rules +
  // dashboard + overview + command-center on settle so derived counts/score
  // reconcile with the server everywhere they surface.
  const toggleMutation = useMutation<
    LexComplianceRule,
    unknown,
    { rule: LexComplianceRule; enabled: boolean },
    { previous: PaginatedResponse<LexComplianceRule> | undefined }
  >({
    mutationFn: ({ rule, enabled }) =>
      enterpriseApi.lex.updateComplianceRule(rule.id, { ...rule, enabled }),
    onMutate: async ({ rule, enabled }) => {
      await queryClient.cancelQueries({ queryKey: RULES_QUERY_KEY });
      const previous = queryClient.getQueryData<PaginatedResponse<LexComplianceRule>>(RULES_QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<PaginatedResponse<LexComplianceRule>>(RULES_QUERY_KEY, {
          ...previous,
          data: previous.data.map((r) => (r.id === rule.id ? { ...r, enabled } : r)),
        });
      }
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(RULES_QUERY_KEY, context.previous);
      }
      showApiError(error);
    },
    onSuccess: (_data, { rule, enabled }) => {
      showSuccess(
        enabled ? labels.toggleEnabledTitle : labels.toggleDisabledTitle,
        labels.toggleSavedDescription(rule.name),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: RULES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: OVERVIEW_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: COMMAND_QUERY_KEY });
    },
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rules;
    return rules.filter((rule) => {
      const typeLabel = labels.ruleTypes[rule.rule_type] ?? rule.rule_type.replace(/_/g, ' ');
      return (
        rule.name.toLowerCase().includes(query) ||
        rule.description.toLowerCase().includes(query) ||
        rule.rule_type.replace(/_/g, ' ').toLowerCase().includes(query) ||
        typeLabel.toLowerCase().includes(query)
      );
    });
  }, [rules, search, labels.ruleTypes]);

  const groups = useMemo(() => {
    const order: readonly string[] = groupBy === 'rule_type' ? RULE_TYPE_ORDER : SEVERITY_ORDER;
    const lookup = groupBy === 'rule_type' ? labels.ruleTypes : labels.severities;
    const buckets = new Map<string, LexComplianceRule[]>();
    for (const rule of filtered) {
      const key = groupBy === 'rule_type' ? rule.rule_type : rule.severity;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(rule);
      else buckets.set(key, [rule]);
    }
    const keys = [...buckets.keys()].sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
    });
    return keys.map((key) => ({
      key,
      label: lookup[key] ?? key.replace(/_/g, ' '),
      rules: buckets.get(key) ?? [],
    }));
  }, [filtered, groupBy, labels.ruleTypes, labels.severities]);

  // Empty data set — let the caller own the empty surface (template gallery).
  if (rules.length === 0) {
    return <>{emptyState ?? null}</>;
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: search + group-by toggle */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={labels.searchPlaceholder}
            aria-label={labels.searchAria}
            className="ps-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">{labels.groupByLabel}</span>
          <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label={labels.groupByLabel}>
            <Button
              type="button"
              size="sm"
              variant={groupBy === 'rule_type' ? 'secondary' : 'ghost'}
              className="h-7 gap-1.5 px-2.5"
              aria-pressed={groupBy === 'rule_type'}
              onClick={() => setGroupBy('rule_type')}
            >
              <Layers className="h-3.5 w-3.5" aria-hidden />
              {labels.groupByType}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={groupBy === 'severity' ? 'secondary' : 'ghost'}
              className="h-7 gap-1.5 px-2.5"
              aria-pressed={groupBy === 'severity'}
              onClick={() => setGroupBy('severity')}
            >
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
              {labels.groupBySeverity}
            </Button>
          </div>
        </div>
      </div>

      {/* Grouped rule list */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.noMatches}</p>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.key} className="space-y-2" aria-label={group.label}>
              <div className="flex items-center justify-between gap-2 px-0.5">
                <h3 className="text-sm font-semibold capitalize text-foreground">{group.label}</h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {shapeDigits(labels.groupCount(group.rules.length), locale)}
                </span>
              </div>
              <div className="space-y-2">
                {group.rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="relative flex items-start justify-between gap-3 overflow-hidden rounded-lg border px-4 py-3 ps-5"
                  >
                    <span
                      className={`absolute inset-y-0 start-0 w-1 ${ruleSeverityAccent(rule.severity)}`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{rule.name}</p>
                        {!rule.enabled && (
                          <Badge variant="secondary" className="text-xs">
                            {labels.disabledBadge}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {labels.ruleTypes[rule.rule_type] ?? rule.rule_type.replace(/_/g, ' ')}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{rule.description}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <SeverityIndicator severity={normalizeSeverity(rule.severity)} size="sm" />
                      {canWrite ? (
                        <>
                          <Switch
                            checked={rule.enabled}
                            disabled={toggleMutation.isPending}
                            aria-label={labels.enableAria(rule.name)}
                            onCheckedChange={(enabled) => toggleMutation.mutate({ rule, enabled })}
                          />
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={labels.ruleMenuAria(rule.name)}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => onEdit(rule)}>
                                <Pencil className="me-2 h-4 w-4" />
                                {labels.edit}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => onDelete(rule)}
                              >
                                <Trash2 className="me-2 h-4 w-4" />
                                {labels.delete}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
