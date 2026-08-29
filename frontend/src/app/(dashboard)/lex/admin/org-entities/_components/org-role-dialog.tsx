'use client';

import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import { showApiError, showSuccess } from '@/lib/toast';
import { ORG_ROLE_KEYS, lexAdminApi, type OrgEntity, type OrgRoleKey } from '@/lib/lex/admin';
import { writeSnapshot } from '../../_lib/admin-feature-utils';
import { useAdminCommonLabels, useOrgLabels } from '../../_lib/admin-labels';
import { OrgUserPicker } from './org-user-picker';

interface Props {
  entityId: string;
  entitySnapshot?: OrgEntity | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  /** Preselects the role when opened from a "missing escalation role" hint. */
  initialRoleKey?: OrgRoleKey;
}

function buildSchema(userIdRequired: string) {
  return z.object({
    role_key: z.enum(ORG_ROLE_KEYS as unknown as [OrgRoleKey, ...OrgRoleKey[]]),
    user_id: z.string().trim().min(1, userIdRequired),
    label_ar: z.string().trim(),
    label_en: z.string().trim(),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

type OrgEntitySnapshot = OrgEntity & { snapshot_at?: string; snapshot_reason?: string };

function writeOrgSnapshot(entity: OrgEntity | null | undefined, reason: string): void {
  if (!entity) return;
  try {
    writeSnapshot<OrgEntitySnapshot>('org-entities', entity.id, {
      ...entity,
      snapshot_at: new Date().toISOString(),
      snapshot_reason: reason,
    });
  } catch {
    // Local snapshots are best-effort and must not block role changes.
  }
}

export function OrgRoleDialog({
  entityId,
  entitySnapshot,
  open,
  onOpenChange,
  onSaved,
  initialRoleKey,
}: Props) {
  const qc = useQueryClient();
  const t = useOrgLabels();
  const common = useAdminCommonLabels();
  const schema = useMemo(() => buildSchema(t.roleDialog.errors.userRequired), [t.roleDialog.errors.userRequired]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { role_key: 'department_manager', user_id: '', label_ar: '', label_en: '' },
  });

  useEffect(() => {
    if (open) form.reset({ role_key: initialRoleKey ?? 'department_manager', user_id: '', label_ar: '', label_en: '' });
  }, [form, open, initialRoleKey]);

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      writeOrgSnapshot(entitySnapshot, 'before_role_assign');
      return lexAdminApi.assignOrgRole(entityId, {
        role_key: v.role_key,
        user_id: v.user_id,
        label: { ar: v.label_ar, en: v.label_en },
      });
    },
    onSuccess: async () => {
      showSuccess(t.roleDialog.toastAdded);
      await qc.invalidateQueries({ queryKey: ['lex-admin-org-entity', entityId] });
      await qc.invalidateQueries({ queryKey: ['lex-admin-org-escalation', entityId] });
      onOpenChange(false);
      onSaved?.();
    },
    onError: showApiError,
  });

  const roleKey = form.watch('role_key');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.roleDialog.title}</DialogTitle>
          <DialogDescription>{t.detail.rolesDescription}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            <LexCreationGuidance workflow="organization" />
            <FormField name="role_key" label={t.roleDialog.roleKey} required>
              <Select
                value={roleKey}
                onValueChange={(v) => form.setValue('role_key', v as OrgRoleKey, { shouldValidate: true })}
              >
                <SelectTrigger id="role_key">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORG_ROLE_KEYS.map((rk) => (
                    <SelectItem key={rk} value={rk}>
                      {t.roleKeys[rk]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField name="user_id" label={t.roleDialog.user} required>
              <OrgUserPicker
                id="user_id"
                enabled={open}
                value={form.watch('user_id')}
                onChange={(userId) =>
                  form.setValue('user_id', userId, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
                labels={{
                  user: t.roleDialog.user,
                  selectUser: t.roleDialog.selectUser,
                  searchUsers: t.roleDialog.searchUsers,
                  loadingUsers: t.roleDialog.loadingUsers,
                  noUsers: t.roleDialog.noUsers,
                  usersLoadError: t.roleDialog.usersLoadError,
                  retry: t.roleDialog.retryUsers,
                }}
                disabled={save.isPending}
              />
            </FormField>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField name="label_en" label={t.roleDialog.labelEn}>
                <Input id="label_en" {...form.register('label_en')} />
              </FormField>
              <FormField name="label_ar" label={t.roleDialog.labelAr}>
                <Input id="label_ar" dir="rtl" {...form.register('label_ar')} />
              </FormField>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {common.cancel}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {t.roleDialog.add}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
