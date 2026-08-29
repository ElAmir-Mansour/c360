'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
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
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useLocaleOrDefault, useT } from '@/components/providers/locale-provider';
import { versionStatusLabel } from '../_lib/enum-labels';

interface PromoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: AIRegisteredModel | null;
  version: AIModelVersion | null;
  onSaved: () => void;
}

export function PromoteDialog({ open, onOpenChange, model, version, onSaved }: PromoteDialogProps) {
  const t = useT('admin');
  const { locale } = useLocaleOrDefault();
  const { user } = useAuth();
  const [override, setOverride] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setOverride(false);
    }
  }, [open]);

  const submit = async () => {
    if (!model || !version) {
      return;
    }
    try {
      setSaving(true);
      await enterpriseApi.ai.promote(model.id, version.id, {
        approved_by: user?.id,
        override,
      });
      showSuccess(t('pmd.toastPromoted'), t('pmd.toastPromotedDetail', { slug: model.slug, version: version.version_number }));
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
          <DialogTitle>{t('pmd.title')}</DialogTitle>
          <DialogDescription>
            {t('pmd.desc')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-muted/30 p-4 text-sm">
            <div className="font-medium">{model?.name}</div>
            <div className="mt-1 text-muted-foreground">
              {t('pmd.info', {
                slug: model?.slug ?? '',
                version: version?.version_number ?? '',
                status: versionStatusLabel(version?.status, locale),
              })}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/70 p-4">
            <div>
              <Label htmlFor="promotion-override">{t('pmd.manualOverride')}</Label>
              <p className="text-sm text-muted-foreground">
                {t('pmd.manualHint')}
              </p>
            </div>
            <Switch id="promotion-override" checked={override} onCheckedChange={setOverride} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('pmd.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? t('pmd.promoting') : t('pmd.promote')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
