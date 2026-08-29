'use client';

/**
 * Scope conflict-check tester for contract approval policies.
 *
 * Select an existing policy → the panel resolves its scope + routing into a
 * candidate `LexApprovalPolicyConflictCheckPayload` (excluding itself via
 * `exclude_id`) and calls `enterpriseApi.lex.conflictCheckApprovalPolicy`. The
 * `has_identical` / `has_conflicts` result is surfaced as an advisory panel —
 * the conflict-check route sits on the write tier.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { showApiError } from '@/lib/toast';
import {
  enterpriseApi,
  type LexApprovalPolicyConflictCheckPayload,
  type LexApprovalPolicyConflictCheckResult,
} from '@/lib/enterprise/api';
import type { LexApprovalPolicy } from '@/types/suites';
import type { ContractApprovalPolicyLabels } from '../_labels';

export function ConflictCheckPanel({
  labels,
  policies,
}: {
  labels: ContractApprovalPolicyLabels;
  policies: LexApprovalPolicy[];
}) {
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    if (selectedId === '' && policies.length > 0) {
      setSelectedId(policies[0].id);
    }
  }, [policies, selectedId]);

  const selected = useMemo(
    () => policies.find((policy) => policy.id === selectedId) ?? null,
    [policies, selectedId],
  );

  const conflictMutation = useMutation({
    mutationFn: () => {
      if (!selected) {
        throw new Error('missing policy');
      }
      return enterpriseApi.lex.conflictCheckApprovalPolicy(candidateFromPolicy(selected));
    },
    onError: showApiError,
  });

  return (
    <SectionCard title={labels.conflictTester.title} description={labels.conflictTester.description}>
      {policies.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.conflictTester.noPolicies}</p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="conflict-policy">{labels.conflictTester.selectPolicy}</Label>
            <Select
              value={selectedId}
              onValueChange={(value) => {
                setSelectedId(value);
                conflictMutation.reset();
              }}
            >
              <SelectTrigger id="conflict-policy">
                <SelectValue placeholder={labels.conflictTester.selectPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {policies.map((policy) => (
                  <SelectItem key={policy.id} value={policy.id}>
                    {policy.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            className="w-full"
            onClick={() => conflictMutation.mutate()}
            disabled={!selected || conflictMutation.isPending}
          >
            {conflictMutation.isPending ? (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
            ) : null}
            {conflictMutation.isPending ? labels.conflictTester.running : labels.conflictTester.run}
          </Button>

          {conflictMutation.data ? (
            <ConflictResult labels={labels} result={conflictMutation.data} />
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

function ConflictResult({
  labels,
  result,
}: {
  labels: ContractApprovalPolicyLabels;
  result: LexApprovalPolicyConflictCheckResult;
}) {
  if (!result.has_conflicts && !result.has_identical) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-primary">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {labels.conflictTester.noneTitle}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {labels.conflictTester.noneDescription}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-warning-300 bg-warning-50 px-4 py-3 text-sm dark:bg-warning-800/20">
      <p className="flex items-center gap-2 font-medium text-warning-700 dark:text-warning-300">
        {result.has_identical ? (
          <ShieldAlert className="h-4 w-4" aria-hidden />
        ) : (
          <AlertTriangle className="h-4 w-4" aria-hidden />
        )}
        {result.has_identical
          ? labels.conflictTester.identicalHeader
          : labels.conflictTester.conflictsHeader(result.conflicts.length)}
      </p>
      {result.conflicts.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {result.conflicts.map((conflict) => (
            <Badge key={conflict.policy_id} variant="warning">
              {conflict.name}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Resolve a saved policy into a conflict-check candidate, excluding itself so a
 * policy never conflicts with its own row.
 */
function candidateFromPolicy(policy: LexApprovalPolicy): LexApprovalPolicyConflictCheckPayload {
  return {
    name: policy.name,
    description: policy.description,
    status: policy.status,
    priority: policy.priority,
    contract_type: policy.contract_type ?? null,
    department: policy.department ?? null,
    min_value: policy.min_value ?? null,
    max_value: policy.max_value ?? null,
    currency: policy.currency,
    mode: policy.mode,
    quorum: policy.quorum,
    quorum_n: policy.quorum_n ?? null,
    approvers: policy.approvers,
    form_fields: policy.form_fields,
    require_authority_evidence: policy.require_authority_evidence,
    required_role: policy.required_role ?? null,
    required_authority_amount: policy.required_authority_amount ?? null,
    metadata: policy.metadata,
    exclude_id: policy.id,
  };
}
