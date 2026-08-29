'use client';

/**
 * Contract Approval-Policy Governance admin surface (Watheeq legal suite).
 *
 * Exposes the previously UI-less governance routes for the contract approval
 * policies (`/api/v1/lex/workflow-policies/approval/**`): per-policy immutable
 * version history + restore, append-only audit trail, scope conflict-check, and
 * a reusable-template catalog (sub-page). The live policy editor (create / edit
 * / archive / recommend / analytics) already ships at `/lex/workflow-policies`;
 * this surface is the governance complement. Gated under the granular
 * `lex:approval:*` permissions (read to view, admin to restore).
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileStack, History, ScrollText, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { LexAccessGuard } from '@/components/lex/access/lex-access-guard';
import type { PermissionRequirement } from '@/lib/permissions';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RelativeTime } from '@/components/shared/relative-time';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { enterpriseApi } from '@/lib/enterprise/api';
import type { LexApprovalPolicy } from '@/types/suites';
import {
  type ContractApprovalPolicyLabels,
  useContractApprovalPolicyLabels,
} from './_labels';
import { PolicyVersionsDialog } from './_components/policy-versions-dialog';
import { PolicyAuditDialog } from './_components/policy-audit-dialog';
import { ConflictCheckPanel } from './_components/conflict-check-panel';

const GOVERNANCE_REQUIREMENT: PermissionRequirement = {
  anyOf: ['lex:approval:read', 'lex:approval:admin'],
};
const TEMPLATES_HREF = '/lex/admin/contract-approval-policies/templates';
const EDITOR_HREF = '/lex/workflow-policies';
const POLICIES_KEY = ['lex-contract-approval-policies-governance'];
const EMPTY_POLICIES: LexApprovalPolicy[] = [];

export default function ContractApprovalPolicyGovernancePage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const labels = useContractApprovalPolicyLabels();

  const canRestore = hasPermission('lex:approval:admin');

  const [versionsFor, setVersionsFor] = useState<LexApprovalPolicy | null>(null);
  const [auditFor, setAuditFor] = useState<LexApprovalPolicy | null>(null);

  const policiesQuery = useQuery({
    queryKey: POLICIES_KEY,
    queryFn: () => enterpriseApi.lex.listApprovalPolicies(),
  });

  const policies = policiesQuery.data ?? EMPTY_POLICIES;

  const refreshPolicies = async () => {
    await queryClient.invalidateQueries({ queryKey: POLICIES_KEY });
  };

  const showEmpty =
    !policiesQuery.isLoading && !policiesQuery.isError && policies.length === 0;

  return (
    <LexAccessGuard requirement={GOVERNANCE_REQUIREMENT} resourceName={labels.pageTitle}>
      <div dir={direction} lang={locale} className="space-y-6">
        <PageHeader
          title={labels.pageTitle}
          description={labels.pageDescription}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" asChild>
                <Link href={EDITOR_HREF} className="inline-flex items-center gap-1.5">
                  <SlidersHorizontal className="h-4 w-4" />
                  {labels.links.editor}
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={TEMPLATES_HREF} className="inline-flex items-center gap-1.5">
                  <FileStack className="h-4 w-4" />
                  {labels.links.templates}
                </Link>
              </Button>
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.5fr_1fr]">
          <SectionCard title={labels.table.columns.policy} description={labels.pageDescription}>
            {policiesQuery.isLoading ? (
              <LoadingSkeleton variant="table-row" count={5} />
            ) : policiesQuery.isError ? (
              <ErrorState
                message={labels.table.loadError}
                onRetry={() => void policiesQuery.refetch()}
              />
            ) : showEmpty ? (
              <div className="rounded-lg border border-dashed px-4 py-10 text-center">
                <ShieldCheck className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
                <p className="mt-2 text-sm font-medium">{labels.table.emptyTitle}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {labels.table.emptyDescription}
                </p>
                <Button className="mt-4" variant="outline" asChild>
                  <Link href={EDITOR_HREF}>{labels.links.editor}</Link>
                </Button>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <Table className="table-premium">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{labels.table.columns.policy}</TableHead>
                      <TableHead>{labels.table.columns.status}</TableHead>
                      <TableHead>{labels.table.columns.scope}</TableHead>
                      <TableHead>{labels.table.columns.route}</TableHead>
                      <TableHead>{labels.table.columns.updated}</TableHead>
                      <TableHead className="text-end">{labels.table.columns.actions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {policies.map((policy) => (
                      <TableRow key={policy.id}>
                        <TableCell className="min-w-[200px]">
                          <div className="space-y-1">
                            <span className="font-medium">{policy.name}</span>
                            {policy.description ? (
                              <p className="line-clamp-2 text-xs text-muted-foreground">
                                {policy.description}
                              </p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {labels.statusLabels[policy.status] ?? policy.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {formatScope(policy, labels)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            <Badge variant="outline">
                              {labels.modeLabels[policy.mode] ?? policy.mode}
                            </Badge>
                            <Badge variant="outline">{formatQuorum(policy, labels)}</Badge>
                          </div>
                        </TableCell>
                        <TableCell>
                          <RelativeTime date={policy.updated_at} />
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setVersionsFor(policy)}
                              aria-label={labels.actions.versionsAria(policy.name)}
                            >
                              <History className="me-1 h-3.5 w-3.5" />
                              {labels.actions.versions}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setAuditFor(policy)}
                              aria-label={labels.actions.auditAria(policy.name)}
                            >
                              <ScrollText className="me-1 h-3.5 w-3.5" />
                              {labels.actions.audit}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>

          <ConflictCheckPanel labels={labels} policies={policies} />
        </div>

        <PolicyVersionsDialog
          labels={labels}
          policy={versionsFor}
          open={versionsFor != null}
          onOpenChange={(o) => !o && setVersionsFor(null)}
          canRestore={canRestore}
          onRestored={refreshPolicies}
        />

        <PolicyAuditDialog
          labels={labels}
          policy={auditFor}
          open={auditFor != null}
          onOpenChange={(o) => !o && setAuditFor(null)}
        />
      </div>
    </LexAccessGuard>
  );
}

/* ------------------------------ formatting ------------------------------ */

function formatScope(policy: LexApprovalPolicy, labels: ContractApprovalPolicyLabels): string {
  const pieces = [
    policy.contract_type ? formatToken(policy.contract_type) : labels.scope.anyType,
    policy.department?.trim() || labels.scope.anyDepartment,
    formatValueRange(policy, labels),
  ];
  return pieces.join(labels.scope.separator);
}

function formatValueRange(policy: LexApprovalPolicy, labels: ContractApprovalPolicyLabels): string {
  const currency = policy.currency || 'SAR';
  if (policy.min_value != null && policy.max_value != null) {
    return labels.scope.rangeValue(
      currency,
      policy.min_value.toLocaleString(),
      policy.max_value.toLocaleString(),
    );
  }
  if (policy.min_value != null) {
    return labels.scope.fromValue(currency, policy.min_value.toLocaleString());
  }
  if (policy.max_value != null) {
    return labels.scope.upToValue(currency, policy.max_value.toLocaleString());
  }
  return labels.scope.anyValue;
}

function formatQuorum(policy: LexApprovalPolicy, labels: ContractApprovalPolicyLabels): string {
  if (policy.quorum === 'n_of_m') {
    return labels.quorumFormat.nOfM(policy.quorum_n ?? 1, policy.approvers.length);
  }
  return labels.quorumLabels[policy.quorum] ?? policy.quorum;
}

function formatToken(value: string): string {
  return value.replace(/_/g, ' ');
}
