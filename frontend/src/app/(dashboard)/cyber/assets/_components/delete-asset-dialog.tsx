'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import { AlertTriangle } from 'lucide-react';
import type { CyberAsset } from '@/types/cyber';
import { useAssetLabels } from '../_lib/assets-i18n';

interface DeleteAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: CyberAsset;
  onSuccess?: () => void;
}

export function DeleteAssetDialog({ open, onOpenChange, asset, onSuccess }: DeleteAssetDialogProps) {
  const t = useAssetLabels();
  const [confirmation, setConfirmation] = useState('');

  const { mutate, isPending } = useApiMutation<void, void>(
    'delete',
    `${API_ENDPOINTS.CYBER_ASSETS}/${asset.id}`,
    {
      successMessage: t.deleteDialog.deletedToast,
      invalidateKeys: ['cyber-assets', 'cyber-assets-stats'],
      onSuccess: () => {
        setConfirmation('');
        onOpenChange(false);
        onSuccess?.();
      },
    },
  );

  const handleClose = () => {
    setConfirmation('');
    onOpenChange(false);
  };

  const confirmed = confirmation === 'DELETE';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {t.deleteDialog.title}
          </DialogTitle>
          <DialogDescription>
            {t.deleteDialog.irreversiblePrefix}<strong>{t.deleteDialog.irreversibleWord}</strong>{t.deleteDialog.irreversibleSuffix(asset.name)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <div className="text-sm">
            <span className="font-medium">{t.deleteDialog.assetLabel}</span> {asset.name}
          </div>
          <div className="text-sm">
            <span className="font-medium">{t.deleteDialog.typeLabel}</span> {asset.type}
          </div>
          <div className="text-sm">
            <span className="font-medium">{t.deleteDialog.criticalityLabel}</span> {asset.criticality}
          </div>
          {(asset.vulnerability_count ?? 0) > 0 && (
            <div className="text-sm text-destructive">
              <span className="font-medium">{t.deleteDialog.warningLabel}</span> {t.deleteDialog.warningBody(asset.vulnerability_count ?? 0)}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm-delete">
            {t.deleteDialog.confirmPromptPrefix}<strong>{t.deleteDialog.confirmPromptWord}</strong>{t.deleteDialog.confirmPromptSuffix}
          </Label>
          <Input
            id="confirm-delete"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={t.deleteDialog.confirmPlaceholder}
            className="font-mono"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            {t.deleteDialog.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!confirmed || isPending}
            onClick={() => mutate(undefined as unknown as void)}
          >
            {isPending ? t.deleteDialog.deleting : t.deleteDialog.deleteSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
