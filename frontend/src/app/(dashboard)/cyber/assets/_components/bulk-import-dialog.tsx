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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import { Upload, AlertCircle } from 'lucide-react';
import type { CyberAsset } from '@/types/cyber';
import { useAssetLabels } from '../_lib/assets-i18n';

interface BulkImportResult {
  count: number;
  created: number;
  updated: number;
  failed: number;
  errors?: string[];
  ids: string[];
}

interface BulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (result: BulkImportResult) => void;
}

const EXAMPLE = JSON.stringify([
  { name: 'web-prod-01', type: 'server', criticality: 'high', ip_address: '10.0.1.10', hostname: 'web-prod-01.example.com', os: 'Ubuntu 22.04', owner: 'Infra Team' },
  { name: 'db-prod-01', type: 'database', criticality: 'critical', ip_address: '10.0.2.10', owner: 'DBA Team' },
], null, 2);

export function BulkImportDialog({ open, onOpenChange, onSuccess }: BulkImportDialogProps) {
  const t = useAssetLabels();
  const [raw, setRaw] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Partial<CyberAsset>[] | null>(null);

  const { mutate, isPending } = useApiMutation<BulkImportResult, { assets: Partial<CyberAsset>[] }>(
    'post',
    API_ENDPOINTS.CYBER_ASSETS_BULK,
    {
      successMessage: t.importDialog.completeToast,
      invalidateKeys: ['cyber-assets', 'cyber-assets-stats'],
      onSuccess: (result) => {
        setRaw('');
        setPreview(null);
        onOpenChange(false);
        onSuccess?.(result);
      },
    },
  );

  const handleParse = () => {
    setParseError(null);
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        setParseError(t.importDialog.invalidArray);
        return;
      }
      setPreview(parsed as Partial<CyberAsset>[]);
    } catch (e) {
      setParseError(t.importDialog.invalidJson((e as Error).message));
    }
  };

  const handleImport = () => {
    if (!preview) return;
    mutate({ assets: preview });
  };

  const handleClose = () => {
    setRaw('');
    setPreview(null);
    setParseError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.importDialog.title}</DialogTitle>
          <DialogDescription>
            {t.importDialog.descriptionPrefix}<code className="text-xs">name</code>, <code className="text-xs">type</code>, <code className="text-xs">criticality</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!preview ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="bulk-json">{t.importDialog.jsonInput}</Label>
                <Textarea
                  id="bulk-json"
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  placeholder={EXAMPLE}
                  className="h-48 font-mono text-xs"
                />
              </div>

              {parseError && (
                <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {parseError}
                </div>
              )}

              <Button type="button" variant="outline" onClick={handleParse} disabled={!raw.trim()}>
                {t.importDialog.validatePreview}
              </Button>
            </>
          ) : (
            <>
              <div className="rounded-md border">
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <p className="text-sm font-medium">{t.importDialog.previewTitle(preview.length)}</p>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPreview(null)}>
                    {t.importDialog.edit}
                  </Button>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-start">{t.importDialog.colName}</th>
                        <th className="px-3 py-2 text-start">{t.importDialog.colType}</th>
                        <th className="px-3 py-2 text-start">{t.importDialog.colCriticality}</th>
                        <th className="px-3 py-2 text-start">{t.importDialog.colIp}</th>
                        <th className="px-3 py-2 text-start">{t.importDialog.colOwner}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((a, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1.5">{a.name ?? '—'}</td>
                          <td className="px-3 py-1.5">{a.type ?? '—'}</td>
                          <td className="px-3 py-1.5">{a.criticality ?? '—'}</td>
                          <td className="px-3 py-1.5">{a.ip_address ?? '—'}</td>
                          <td className="px-3 py-1.5">{a.owner ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            {t.importDialog.cancel}
          </Button>
          {preview && (
            <Button type="button" onClick={handleImport} disabled={isPending}>
              <Upload className="me-1.5 h-4 w-4" />
              {isPending ? t.importDialog.importing : t.importDialog.importSubmit(preview.length)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
