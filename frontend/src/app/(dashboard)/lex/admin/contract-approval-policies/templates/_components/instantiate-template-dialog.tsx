'use client';

/**
 * Instantiate a concrete contract approval policy from a template.
 *
 * Calls `enterpriseApi.lex.instantiateApprovalPolicyTemplate(id, { overrides })`
 * where `overrides` is an optional partial policy patch. The admin may override
 * the policy name and status before materialisation; blank fields inherit the
 * template definition.
 */

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
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
  enterpriseApi,
  type LexApprovalPolicyTemplate,
  type LexInstantiateApprovalPolicyTemplatePayload,
} from '@/lib/enterprise/api';
import type { LexApprovalPolicy } from '@/types/suites';
import type { ContractApprovalPolicyLabels } from '../../_labels';

const GOVERNANCE_HREF = '/lex/admin/contract-approval-policies';
const STATUS_OPTIONS = ['', 'draft', 'active', 'archived'] as const;

type StatusOption = (typeof STATUS_OPTIONS)[number];

export function InstantiateTemplateDialog({
  labels,
  open,
  onOpenChange,
  template,
}: {
  labels: ContractApprovalPolicyLabels;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: LexApprovalPolicyTemplate | null;
}) {
  const t = labels.templates;
  const [name, setName] = useState('');
  const [status, setStatus] = useState<StatusOption>('');
  const [created, setCreated] = useState<LexApprovalPolicy | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setStatus('');
      setCreated(null);
    }
  }, [open]);

  const overrides = useMemo<
    LexInstantiateApprovalPolicyTemplatePayload['overrides'] | undefined
  >(() => {
    const patch: NonNullable<LexInstantiateApprovalPolicyTemplatePayload['overrides']> = {};
    const trimmedName = name.trim();
    if (trimmedName !== '') {
      patch.name = trimmedName;
    }
    if (status !== '') {
      patch.status = status;
    }
    return Object.keys(patch).length > 0 ? patch : undefined;
  }, [name, status]);

  const instantiateMutation = useMutation({
    mutationFn: () => {
      if (!template) {
        throw new Error('missing template');
      }
      return enterpriseApi.lex.instantiateApprovalPolicyTemplate(template.id, { overrides });
    },
    onSuccess: (policy) => {
      setCreated(policy);
      showSuccess(t.instantiateToast, t.instantiate.successWithId(policy.id));
    },
    onError: showApiError,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    instantiateMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.instantiate.title}</DialogTitle>
          <DialogDescription>
            {template ? t.instantiate.description(template.name) : t.instantiate.title}
          </DialogDescription>
        </DialogHeader>

        {!created ? <LexCreationGuidance workflow="policy" /> : null}

        {created ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
              <p className="font-medium text-primary">{t.instantiate.successTitle}</p>
              <p className="mt-1 text-muted-foreground">{created.name}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">
                {created.id}
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.instantiate.cancel}
              </Button>
              <Button asChild>
                <Link href={GOVERNANCE_HREF}>
                  {t.instantiate.openPolicies}
                  <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:-scale-x-100" />
                </Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="instantiate-name">{t.instantiate.overrideName}</Label>
              <Input
                id="instantiate-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t.instantiate.overrideNamePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label>{t.instantiate.status}</Label>
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
                      {option ? labels.statusLabels[option] ?? option : t.instantiate.statusKeep}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-xs text-muted-foreground">{t.instantiate.hint}</p>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.instantiate.cancel}
              </Button>
              <Button type="submit" disabled={!template || instantiateMutation.isPending}>
                {instantiateMutation.isPending ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                ) : null}
                {t.instantiate.confirm}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
