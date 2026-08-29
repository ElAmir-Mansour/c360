'use client';

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { Loader2, PencilLine, Plus, Trash2, Users } from 'lucide-react';
import { z } from 'zod';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  casesApi,
  CASE_PARTY_ROLE_OPTIONS,
  formatCaseToken,
  type CaseParty,
  type CasePartyRole,
} from '@/lib/lex/cases';
import { useCaseLabels } from '../labels';

interface PartiesTabProps {
  caseId: string;
  parties: CaseParty[];
  canWrite: boolean;
  onChanged: () => Promise<void> | void;
}

function buildPartySchema(nameRequired: string) {
  return z.object({
    role: z.enum(CASE_PARTY_ROLE_OPTIONS as unknown as [CasePartyRole, ...CasePartyRole[]]),
    name: z.string().trim().min(1, nameRequired),
    identifier: z.string().trim().optional().default(''),
    contact: z.string().trim().optional().default(''),
  });
}
type PartyValues = z.infer<ReturnType<typeof buildPartySchema>>;

export function PartiesTab({ caseId, parties, canWrite, onChanged }: PartiesTabProps) {
  const labels = useCaseLabels();
  const t = labels.parties;
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CaseParty | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CaseParty | null>(null);

  const schema = useMemo(
    () => buildPartySchema(labels.partyForm.errors.nameRequired),
    [labels.partyForm.errors.nameRequired],
  );
  const form = useForm<PartyValues>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'plaintiff', name: '', identifier: '', contact: '' },
  });
  const editForm = useForm<PartyValues>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'plaintiff', name: '', identifier: '', contact: '' },
  });

  useEffect(() => {
    if (addOpen) form.reset({ role: 'plaintiff', name: '', identifier: '', contact: '' });
  }, [addOpen, form]);

  useEffect(() => {
    if (!editTarget) return;
    editForm.reset({
      role: editTarget.role,
      name: editTarget.name,
      identifier: editTarget.identifier ?? '',
      contact: editTarget.contact ?? '',
    });
  }, [editForm, editTarget]);

  const refresh = async () => {
    await Promise.all([
      onChanged(),
      queryClient.invalidateQueries({ queryKey: ['lex-case', caseId] }),
    ]);
  };

  const addMutation = useMutation({
    mutationFn: (values: PartyValues) =>
      casesApi.addParty(caseId, {
        role: values.role,
        name: values.name,
        identifier: values.identifier || null,
        contact: values.contact || null,
      }),
    onSuccess: async () => {
      showSuccess(labels.toast.partyAdded);
      setAddOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const removeMutation = useMutation({
    mutationFn: (partyId: string) => casesApi.deleteParty(caseId, partyId),
    onSuccess: async () => {
      showSuccess(labels.toast.partyRemoved);
      setRemoveTarget(null);
      await refresh();
    },
    onError: showApiError,
  });

  const editMutation = useMutation({
    mutationFn: (values: PartyValues) => {
      if (!editTarget) throw new Error('No party selected');
      return casesApi.updateParty(caseId, editTarget.id, {
        role: values.role,
        name: values.name,
        identifier: values.identifier || null,
        contact: values.contact || null,
      });
    },
    onSuccess: async () => {
      showSuccess(labels.toast.updated);
      setEditTarget(null);
      await refresh();
    },
    onError: showApiError,
  });

  const roleValue = form.watch('role');
  const editRoleValue = editForm.watch('role');

  return (
    <SectionCard
      title={t.title}
      description={t.description}
      actions={
        canWrite ? (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="me-1.5 h-3.5 w-3.5" />
            {t.add}
          </Button>
        ) : undefined
      }
    >
      {parties.length === 0 ? (
        <EmptyState icon={Users} title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <div className="space-y-3">
          {parties.map((party) => (
            <div key={party.id} className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5">
              <span className="absolute inset-y-0 start-0 w-1 bg-sky-400/70" aria-hidden />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{party.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {party.identifier || t.noIdentifier} • {party.contact || t.noContact}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {labels.filters.partyRoleOptions[party.role] ?? formatCaseToken(party.role)}
                  </Badge>
                  {canWrite ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setEditTarget(party)}>
                        <PencilLine className="me-1.5 h-3.5 w-3.5" />
                        {labels.detail.edit}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRemoveTarget(party)}>
                        <Trash2 className="me-1.5 h-3.5 w-3.5" />
                        {t.remove}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {canWrite ? (
        <>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{labels.partyForm.addTitle}</DialogTitle>
                <DialogDescription>{labels.partyForm.description}</DialogDescription>
              </DialogHeader>
              <FormProvider {...form}>
                <form className="space-y-4" onSubmit={form.handleSubmit((v) => addMutation.mutate(v))}>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField name="role" label={labels.partyForm.role} required>
                      <Select
                        value={roleValue}
                        onValueChange={(v) => form.setValue('role', v as CasePartyRole, { shouldValidate: true })}
                      >
                        <SelectTrigger id="role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CASE_PARTY_ROLE_OPTIONS.map((o) => (
                            <SelectItem key={o} value={o}>
                              {labels.filters.partyRoleOptions[o]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField name="name" label={labels.partyForm.name} required>
                      <Input id="name" {...form.register('name')} placeholder={labels.partyForm.namePlaceholder} />
                    </FormField>
                    <FormField name="identifier" label={labels.partyForm.identifier}>
                      <Input id="identifier" {...form.register('identifier')} placeholder={labels.partyForm.identifierPlaceholder} />
                    </FormField>
                    <FormField name="contact" label={labels.partyForm.contact}>
                      <Input id="contact" {...form.register('contact')} placeholder={labels.partyForm.contactPlaceholder} />
                    </FormField>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                      {labels.partyForm.cancel}
                    </Button>
                    <Button type="submit" disabled={addMutation.isPending}>
                      {addMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                      {labels.partyForm.submit}
                    </Button>
                  </DialogFooter>
                </form>
              </FormProvider>
            </DialogContent>
          </Dialog>

          <Dialog
            open={Boolean(editTarget)}
            onOpenChange={(open) => {
              if (!open) setEditTarget(null);
            }}
          >
            <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{labels.detail.edit}</DialogTitle>
                <DialogDescription>{labels.partyForm.description}</DialogDescription>
              </DialogHeader>
              <FormProvider {...editForm}>
                <form className="space-y-4" onSubmit={editForm.handleSubmit((v) => editMutation.mutate(v))}>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField name="role" label={labels.partyForm.role} required>
                      <Select
                        value={editRoleValue}
                        onValueChange={(v) => editForm.setValue('role', v as CasePartyRole, { shouldValidate: true })}
                      >
                        <SelectTrigger id="edit-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CASE_PARTY_ROLE_OPTIONS.map((o) => (
                            <SelectItem key={o} value={o}>
                              {labels.filters.partyRoleOptions[o]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField name="name" label={labels.partyForm.name} required>
                      <Input id="edit-name" {...editForm.register('name')} placeholder={labels.partyForm.namePlaceholder} />
                    </FormField>
                    <FormField name="identifier" label={labels.partyForm.identifier}>
                      <Input
                        id="edit-identifier"
                        {...editForm.register('identifier')}
                        placeholder={labels.partyForm.identifierPlaceholder}
                      />
                    </FormField>
                    <FormField name="contact" label={labels.partyForm.contact}>
                      <Input id="edit-contact" {...editForm.register('contact')} placeholder={labels.partyForm.contactPlaceholder} />
                    </FormField>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
                      {labels.partyForm.cancel}
                    </Button>
                    <Button type="submit" disabled={editMutation.isPending}>
                      {editMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                      {labels.form.save}
                    </Button>
                  </DialogFooter>
                </form>
              </FormProvider>
            </DialogContent>
          </Dialog>

          <ConfirmDialog
            open={Boolean(removeTarget)}
            onOpenChange={(open) => {
              if (!open) setRemoveTarget(null);
            }}
            title={labels.confirm.removePartyTitle}
            description={labels.confirm.removePartyDescription(removeTarget?.name ?? '')}
            confirmLabel={t.remove}
            variant="destructive"
            loading={removeMutation.isPending}
            onConfirm={async () => {
              if (removeTarget) await removeMutation.mutateAsync(removeTarget.id);
            }}
          />
        </>
      ) : null}
    </SectionCard>
  );
}
