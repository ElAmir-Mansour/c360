'use client';

/**
 * ApprovalChainEditor — reusable inspector control for the backend
 * `approval_chain` step type.
 *
 * It edits the exact config the Go executor parses
 * (internal/workflow/executor/approval_chain.go → ParseApprovalConfig):
 *   - approvers ([]{type:"user"|"role", ref}) — ordered approver list
 *   - mode      ("sequential" | "parallel")
 *   - quorum    ("all" | "any" | "n_of_m")
 *   - quorum_n  (required when quorum === "n_of_m"; 1..approvers.length)
 *   - sla_hours (optional per-approver SLA)
 *
 * Pure value/onChange — no canvas or definition coupling — so Phase C can remount
 * it unchanged inside the React Flow node inspector.
 */

import { useEffect, useState } from 'react';
import { Braces, GripVertical, Plus, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AsyncRecordPicker, type RecordPickerOption } from '@/components/shared/forms/async-record-picker';
import { TenantUserPicker } from '@/components/shared/forms/tenant-user-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { getDefinitionLabels } from '../../../definition-i18n';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { ApprovalChainApprover, Role, WorkflowStepConfig } from '@/types/models';

export interface ApprovalChainValue {
  approvers: ApprovalChainApprover[];
  mode: 'sequential' | 'parallel';
  quorum: 'all' | 'any' | 'n_of_m';
  quorum_n?: number;
  sla_hours?: number;
}

interface ApprovalChainEditorProps {
  /** Current approval_chain config slice (typically `step.config`). */
  value: Pick<WorkflowStepConfig, 'approvers' | 'mode' | 'quorum' | 'quorum_n' | 'sla_hours'>;
  /** Emits a partial config patch to merge into the step config. */
  onChange: (patch: Partial<WorkflowStepConfig>) => void;
  readOnly?: boolean;
}

const T = {
  en: {
    title: 'Approval Chain',
    approvers: 'Approvers',
    addApprover: 'Add approver',
    noApprovers: 'No approvers yet — add at least one.',
    user: 'User',
    role: 'Role',
    selectUser: 'Select a user',
    searchUsers: 'Search by name or email…',
    noUsers: 'No matching users.',
    selectRole: 'Select a role',
    searchRoles: 'Search roles…',
    noRoles: 'No matching roles.',
    useVariable: 'Use workflow variable',
    chooseUser: 'Choose a user',
    userRef: '${variables.user_id}',
    mode: 'Order',
    sequential: 'Sequential (one at a time)',
    parallel: 'Parallel (all at once)',
    quorum: 'Quorum',
    qAll: 'All must approve',
    qAny: 'Any one approves',
    qNofM: 'N of M approve',
    quorumN: 'Required approvals (N)',
    sla: 'Per-approver SLA (hours)',
    noSla: 'No deadline',
  },
  ar: {
    title: 'سلسلة الموافقات',
    approvers: 'المعتمدون',
    addApprover: 'إضافة معتمد',
    noApprovers: 'لا يوجد معتمدون بعد — أضف واحدًا على الأقل.',
    user: 'مستخدم',
    role: 'دور',
    selectUser: 'اختر مستخدمًا',
    searchUsers: 'ابحث بالاسم أو البريد الإلكتروني…',
    noUsers: 'لا يوجد مستخدمون مطابقون.',
    selectRole: 'اختر دورًا',
    searchRoles: 'ابحث في الأدوار…',
    noRoles: 'لا توجد أدوار مطابقة.',
    useVariable: 'استخدام متغير سير العمل',
    chooseUser: 'اختيار مستخدم',
    userRef: '${variables.user_id}',
    mode: 'الترتيب',
    sequential: 'تسلسلي (واحد تلو الآخر)',
    parallel: 'متوازٍ (الكل دفعة واحدة)',
    quorum: 'النصاب',
    qAll: 'موافقة الجميع',
    qAny: 'موافقة أي واحد',
    qNofM: 'موافقة N من M',
    quorumN: 'عدد الموافقات المطلوبة (N)',
    sla: 'مهلة كل معتمد (ساعات)',
    noSla: 'بدون مهلة',
  },
} as const;

async function loadRoleSlugOptions(search: string): Promise<RecordPickerOption[]> {
  const roles = await apiGet<Role[]>(API_ENDPOINTS.ROLES);
  const needle = search.toLocaleLowerCase();
  return roles
    .filter((role) =>
      !needle || [role.name, role.slug, role.description].some((value) => value?.toLocaleLowerCase().includes(needle)),
    )
    .map((role) => ({
      // Workflow task claiming is matched against JWT role slugs, not role UUIDs.
      value: role.slug,
      label: role.name,
      description: role.slug,
      keywords: [role.slug, role.description],
    }));
}

function isVariableReference(value: string): boolean {
  return value.trim().startsWith('${');
}

interface ApprovalUserReferencePickerProps {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  ariaLabel: string;
  copy: {
    selectUser: string;
    searchUsers: string;
    noUsers: string;
    useVariable: string;
    chooseUser: string;
    userRef: string;
  };
}

function ApprovalUserReferencePicker({
  value,
  onChange,
  readOnly,
  ariaLabel,
  copy,
}: ApprovalUserReferencePickerProps) {
  const [variableMode, setVariableMode] = useState(() => isVariableReference(value));

  useEffect(() => {
    if (isVariableReference(value)) setVariableMode(true);
  }, [value]);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {variableMode ? (
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={copy.userRef}
          disabled={readOnly}
          className="h-7 min-w-0 flex-1 text-xs"
          aria-label={ariaLabel}
        />
      ) : (
        <TenantUserPicker
          ariaLabel={ariaLabel}
          value={value}
          onChange={onChange}
          disabled={readOnly}
          allowClear={!readOnly}
          labels={{
            select: copy.selectUser,
            search: copy.searchUsers,
            empty: copy.noUsers,
          }}
          className="min-w-0 flex-1 [&_button]:h-7 [&_button]:text-xs"
        />
      )}
      {!readOnly ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          title={variableMode ? copy.chooseUser : copy.useVariable}
          aria-label={variableMode ? copy.chooseUser : copy.useVariable}
          onClick={() => {
            setVariableMode(!variableMode);
            onChange('');
          }}
        >
          {variableMode ? (
            <Users className="h-3.5 w-3.5" />
          ) : (
            <Braces className="h-3.5 w-3.5" />
          )}
        </Button>
      ) : null}
    </div>
  );
}

export function ApprovalChainEditor({ value, onChange, readOnly = false }: ApprovalChainEditorProps) {
  const { locale, direction } = useLocaleOrDefault();
  const t = locale === 'ar' ? T.ar : T.en;
  const localLabels = getDefinitionLabels(locale);

  const approvers = value.approvers ?? [];
  const mode = value.mode ?? 'sequential';
  const quorum = value.quorum ?? 'all';

  const setApprovers = (next: ApprovalChainApprover[]) => onChange({ approvers: next });

  const addApprover = () =>
    setApprovers([...approvers, { type: 'role', ref: '' }]);

  const updateApprover = (index: number, patch: Partial<ApprovalChainApprover>) =>
    setApprovers(approvers.map((a, i) => (i === index ? { ...a, ...patch } : a)));

  const removeApprover = (index: number) =>
    setApprovers(approvers.filter((_, i) => i !== index));

  return (
    <div className="space-y-3 rounded-md border border-success-300/60 bg-success-50/40 p-2 dark:border-success-700/50 dark:bg-success-700/10" dir={direction}>
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold text-success-700 dark:text-success-300">{t.title}</Label>
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[11px]"
            onClick={addApprover}
          >
            <Plus className="me-1 h-3 w-3" />
            {t.addApprover}
          </Button>
        )}
      </div>

      {/* Approver rows */}
      <div className="space-y-1.5">
        <Label className="text-overline uppercase text-muted-foreground">{t.approvers}</Label>
        {approvers.length === 0 ? (
          <p className="text-[11px] text-destructive">{t.noApprovers}</p>
        ) : (
          approvers.map((approver, index) => (
            <div key={index} className="flex items-center gap-1">
              <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="w-4 shrink-0 text-center text-overline text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <Select
                value={approver.type}
                onValueChange={(v) =>
                  updateApprover(index, { type: v as 'user' | 'role', ref: '' })
                }
                disabled={readOnly}
              >
                <SelectTrigger className="h-7 w-24 shrink-0 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="role">{t.role}</SelectItem>
                  <SelectItem value="user">{t.user}</SelectItem>
                </SelectContent>
              </Select>
              {approver.type === 'user' ? (
                <ApprovalUserReferencePicker
                  value={approver.ref}
                  onChange={(userId) => updateApprover(index, { ref: userId })}
                  readOnly={readOnly}
                  ariaLabel={`${t.approvers} ${index + 1}`}
                  copy={t}
                />
              ) : (
                <AsyncRecordPicker
                  ariaLabel={`${t.approvers} ${index + 1}`}
                  queryKey={['approval-chain-role-picker']}
                  loadOptions={loadRoleSlugOptions}
                  value={approver.ref}
                  onChange={(roleSlug) => updateApprover(index, { ref: roleSlug })}
                  disabled={readOnly}
                  allowClear={!readOnly}
                  labels={{
                    select: t.selectRole,
                    search: t.searchRoles,
                    empty: t.noRoles,
                  }}
                  className="min-w-0 flex-1 [&_button]:h-7 [&_button]:text-xs"
                />
              )}
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeApprover(index)}
                  aria-label={localLabels.aria.removeApprover(index + 1)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Mode */}
      <div className="space-y-1">
        <Label className="text-overline uppercase text-muted-foreground">{t.mode}</Label>
        <Select
          value={mode}
          onValueChange={(v) => onChange({ mode: v as 'sequential' | 'parallel' })}
          disabled={readOnly}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sequential">{t.sequential}</SelectItem>
            <SelectItem value="parallel">{t.parallel}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Quorum */}
      <div className="space-y-1">
        <Label className="text-overline uppercase text-muted-foreground">{t.quorum}</Label>
        <Select
          value={quorum}
          onValueChange={(v) => {
            const next = v as 'all' | 'any' | 'n_of_m';
            // Seed a valid quorum_n when switching to n_of_m; drop it otherwise so
            // the persisted config matches what ParseApprovalConfig expects.
            if (next === 'n_of_m') {
              const seeded = value.quorum_n && value.quorum_n > 0 ? value.quorum_n : 1;
              onChange({ quorum: next, quorum_n: Math.min(seeded, Math.max(approvers.length, 1)) });
            } else {
              onChange({ quorum: next, quorum_n: undefined });
            }
          }}
          disabled={readOnly}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.qAll}</SelectItem>
            <SelectItem value="any">{t.qAny}</SelectItem>
            <SelectItem value="n_of_m">{t.qNofM}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Quorum N (only for n_of_m) */}
      {quorum === 'n_of_m' && (
        <div className="space-y-1">
          <Label className="text-overline uppercase text-muted-foreground">{t.quorumN}</Label>
          <Input
            type="number"
            min={1}
            max={Math.max(approvers.length, 1)}
            value={value.quorum_n ?? 1}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              onChange({ quorum_n: Number.isFinite(n) && n > 0 ? n : 1 });
            }}
            disabled={readOnly}
            className="h-7 text-xs"
          />
          <p className="text-overline text-muted-foreground">
            {locale === 'ar'
              ? `من ${approvers.length} معتمدين`
              : `of ${approvers.length} approver${approvers.length === 1 ? '' : 's'}`}
          </p>
        </div>
      )}

      {/* SLA hours */}
      <div className="space-y-1">
        <Label className="text-overline uppercase text-muted-foreground">{t.sla}</Label>
        <Input
          type="number"
          min={0}
          value={value.sla_hours ?? ''}
          onChange={(e) => {
            const h = parseFloat(e.target.value);
            onChange({ sla_hours: Number.isFinite(h) && h > 0 ? h : undefined });
          }}
          placeholder={t.noSla}
          disabled={readOnly}
          className="h-7 text-xs"
        />
      </div>
    </div>
  );
}
