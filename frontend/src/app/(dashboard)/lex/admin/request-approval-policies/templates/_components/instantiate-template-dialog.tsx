'use client';

/**
 * Instantiate a concrete request-approval policy from a template.
 *
 * Calls `instantiateTemplate(id, { overrides })` where `overrides` is an optional
 * partial `UpdateRequestApprovalPolicyPayload`. The admin may override name,
 * status, request_type and department before the policy is materialised; blank
 * fields inherit the template definition.
 *
 * Before confirming, the admin can preview conflicts: the template definition +
 * overrides are resolved into a concrete policy payload (`resolvePolicyPayload-
 * ForConflictCheck`) and sent to `conflictCheck`. The `has_identical` /
 * `has_conflicts` result plus conflicting policy names are surfaced as a
 * NON-blocking warning (instantiate is still allowed), mirroring the live policy
 * editor's conflict preview.
 */

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  lexRequestApprovalPoliciesApi,
  type RequestApprovalPolicy,
  type RequestApprovalPolicyConflictCheckResult,
  type RequestApprovalPolicyTemplate,
  type UpdateRequestApprovalPolicyPayload,
} from '@/lib/lex/request-approval-policies';
import type { TemplateLabels } from '../_labels';
import {
  buildInstantiateOverrides,
  resolvePolicyPayloadForConflictCheck,
} from '../_lib/template-definition';

const POLICIES_HREF = '/lex/admin/request-approval-policies';
const STATUS_OPTIONS = ['', 'draft', 'active', 'archived'] as const;

type StatusOption = (typeof STATUS_OPTIONS)[number];

export function InstantiateTemplateDialog({
  labels,
  open,
  onOpenChange,
  template,
}: {
  labels: TemplateLabels;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: RequestApprovalPolicyTemplate | null;
}) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState<StatusOption>('');
  const [requestType, setRequestType] = useState('');
  const [department, setDepartment] = useState('');
  const [created, setCreated] = useState<RequestApprovalPolicy | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setStatus('');
      setRequestType('');
      setDepartment('');
      setCreated(null);
    }
  }, [open]);

  const overrides = useMemo<UpdateRequestApprovalPolicyPayload | undefined>(
    () => buildInstantiateOverrides({ name, status, requestType, department }),
    [name, status, requestType, department],
  );

  const conflictMutation = useMutation({
    mutationFn: () => {
      if (!template) {
        throw new Error('missing template');
      }
      const payload = resolvePolicyPayloadForConflictCheck(template.definition, overrides);
      return lexRequestApprovalPoliciesApi.conflictCheck(payload);
    },
    onError: showApiError,
  });

  const instantiateMutation = useMutation({
    mutationFn: (patch: UpdateRequestApprovalPolicyPayload | undefined) => {
      if (!template) {
        throw new Error('missing template');
      }
      return lexRequestApprovalPoliciesApi.instantiateTemplate(template.id, { overrides: patch });
    },
    onSuccess: (policy) => {
      setCreated(policy);
      showSuccess(labels.toast.instantiated, labels.instantiate.successWithId(policy.id));
    },
    onError: showApiError,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    instantiateMutation.mutate(overrides);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{labels.instantiate.title}</DialogTitle>
          <DialogDescription>
            {template
              ? labels.instantiate.description(template.name)
              : labels.instantiate.title}
          </DialogDescription>
        </DialogHeader>

        {!created ? <LexCreationGuidance workflow="policy" /> : null}

        {created ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
              <p className="font-medium text-primary">{labels.instantiate.successTitle}</p>
              <p className="mt-1 text-muted-foreground">{created.name}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">
                {created.id}
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {labels.instantiate.cancel}
              </Button>
              <Button asChild>
                <Link href={POLICIES_HREF}>
                  {labels.instantiate.openPolicies}
                  <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:-scale-x-100" />
                </Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="instantiate-name">{labels.instantiate.overrideName}</Label>
              <Input
                id="instantiate-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={labels.instantiate.overrideNamePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label>{labels.instantiate.status}</Label>
              <Select
                value={status || 'keep'}
                onValueChange={(value) => setStatus(value === 'keep' ? '' : (value as StatusOption))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option || 'keep'} value={option || 'keep'}>
                      {option
                        ? labels.statusLabels[option] ?? option
                        : labels.instantiate.statusKeep}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="instantiate-request-type">{labels.instantiate.requestType}</Label>
              <Input
                id="instantiate-request-type"
                value={requestType}
                onChange={(event) => setRequestType(event.target.value)}
                placeholder={labels.instantiate.requestTypePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="instantiate-department">{labels.instantiate.department}</Label>
              <Input
                id="instantiate-department"
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
                placeholder={labels.instantiate.departmentPlaceholder}
              />
            </div>

            <p className="text-xs text-muted-foreground">{labels.instantiate.hint}</p>

            {conflictMutation.data ? (
              <ConflictPreview labels={labels} result={conflictMutation.data} />
            ) : null}

            <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => conflictMutation.mutate()}
                disabled={!template || conflictMutation.isPending}
              >
                {conflictMutation.isPending ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                ) : null}
                {labels.conflict.checkConflicts}
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {labels.instantiate.cancel}
                </Button>
                <Button type="submit" disabled={instantiateMutation.isPending}>
                  {instantiateMutation.isPending ? (
                    <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                  ) : null}
                  {labels.instantiate.confirm}
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConflictPreview({
  labels,
  result,
}: {
  labels: TemplateLabels;
  result: RequestApprovalPolicyConflictCheckResult;
}) {
  if (!result.has_conflicts && !result.has_identical) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-primary">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {labels.conflict.noneTitle}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{labels.conflict.noneDescription}</p>
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
          ? labels.conflict.identicalHeader
          : labels.conflict.conflictsHeader(result.conflicts.length)}
      </p>
      {result.conflicts.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {result.conflicts.map((conflict) => (
            <Badge key={conflict.id} variant="warning">
              {conflict.name}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
