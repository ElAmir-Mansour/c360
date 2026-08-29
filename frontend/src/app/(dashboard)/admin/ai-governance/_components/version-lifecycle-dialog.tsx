'use client';

import { useEffect, useMemo, useState } from 'react';
import { showApiError, showSuccess } from '@/lib/toast';
import { enterpriseApi } from '@/lib/enterprise';
import type { AIModelVersion, AIRegisteredModel } from '@/types/ai-governance';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLocaleOrDefault, useT } from '@/components/providers/locale-provider';
import type { NamespacedTranslator } from '@/lib/i18n/registry';
import { versionStatusLabel } from '../_lib/enum-labels';

export type VersionLifecycleAction = 'retire' | 'fail' | 'stop_shadow';

interface VersionLifecycleDialogProps {
  action: VersionLifecycleAction | null;
  model: AIRegisteredModel | null;
  version: AIModelVersion | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function VersionLifecycleDialog({
  action,
  model,
  version,
  open,
  onOpenChange,
  onSaved,
}: VersionLifecycleDialogProps) {
  const t = useT('admin');
  const { locale } = useLocaleOrDefault();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setReason('');
    }
  }, [open]);

  const copy = useMemo(() => getActionCopy(action, t), [action, t]);

  const submit = async () => {
    if (!action || !model || !version || !reason.trim()) {
      return;
    }

    setSaving(true);
    try {
      switch (action) {
        case 'retire':
          await enterpriseApi.ai.retire(model.id, version.id, { reason: reason.trim() });
          showSuccess(t('vld.toastRetiredTitle'), t('vld.toastRetiredDetail', { slug: model.slug, version: version.version_number }));
          break;
        case 'fail':
          await enterpriseApi.ai.failVersion(model.id, version.id, { reason: reason.trim() });
          showSuccess(t('vld.toastFailedTitle'), t('vld.toastFailedDetail', { slug: model.slug, version: version.version_number }));
          break;
        case 'stop_shadow':
          await enterpriseApi.ai.stopShadow(model.id, { version_id: version.id, reason: reason.trim() });
          showSuccess(t('vld.toastShadowStoppedTitle'), t('vld.toastShadowStoppedDetail', { slug: model.slug, version: version.version_number }));
          break;
      }

      onOpenChange(false);
      onSaved();
    } catch (error) {
      showApiError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-muted/30 p-4 text-sm">
            <div className="font-medium">{model?.name}</div>
            <div className="mt-1 text-muted-foreground">
              {t('vld.info', {
                slug: model?.slug ?? '',
                version: version?.version_number ?? '',
                status: versionStatusLabel(version?.status, locale),
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-lifecycle-reason">{copy.reasonLabel}</Label>
            <Textarea
              id="ai-lifecycle-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={copy.placeholder}
              className="min-h-28"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('vld.cancel')}
          </Button>
          <Button variant={action === 'stop_shadow' ? 'default' : 'destructive'} onClick={() => void submit()} disabled={saving || !reason.trim()}>
            {saving ? copy.pendingLabel : copy.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getActionCopy(action: VersionLifecycleAction | null, t: NamespacedTranslator) {
  const ns =
    action === 'retire'
      ? 'vld.retire'
      : action === 'fail'
        ? 'vld.fail'
        : action === 'stop_shadow'
          ? 'vld.stopShadow'
          : 'vld.def';
  return {
    title: t(`${ns}.title`),
    description: t(`${ns}.description`),
    reasonLabel: t(`${ns}.reasonLabel`),
    placeholder: t(`${ns}.placeholder`),
    confirmLabel: t(`${ns}.confirmLabel`),
    pendingLabel: t(`${ns}.pendingLabel`),
  };
}
