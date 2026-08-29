/**
 * Per-requirement satisfy controls (Execution panel, Feature #10).
 *
 * Replaces the old single boolean toggle with a kind-aware control set:
 *   • attachment requirements → an Upload control (reusing the enterprise files
 *     upload idiom with progress), a "View file" link via a presigned download
 *     URL when a file is already attached, plus the mark-pending fallback.
 *   • data requirements → an inline Input + Save, showing the stored value.
 *   • both kinds keep the existing mark-satisfied / mark-pending toggle as a
 *     fallback, and render the "Satisfied by … · …" attribution line.
 *
 * Each row owns its OWN pending state (upload / save / toggle spinners) so one
 * row never blocks another. All write paths funnel through `onChanged()` so the
 * parent re-reads the execution state.
 */

'use client';

import { useRef, useState } from 'react';
import { Loader2, Paperclip, Save, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@/lib/format';
import { showApiError, showError, showSuccess } from '@/lib/toast';
import { enterpriseApi } from '@/lib/enterprise';
import { lexRequestsApi, type RequirementItem } from '@/lib/lex/requests';
import type { ServiceDeskLabels } from './labels';
import { useExecutionExtraLabels } from './execution-extra-labels';

interface Props {
  requestId: string;
  item: RequirementItem;
  /** The unchanged suite-wide execution labels (markSatisfied/markUnsatisfied/toast…). */
  execLabels: ServiceDeskLabels['execution'];
  /** Request owners may supply evidence but cannot reverse or rewrite legal controls. */
  mode?: 'manage' | 'fulfill';
  onChanged: () => void | Promise<void>;
}

export function RequirementSatisfyControls({
  requestId,
  item,
  execLabels,
  mode = 'manage',
  onChanged,
}: Props) {
  const extra = useExecutionExtraLabels();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [savingData, setSavingData] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [openingFile, setOpeningFile] = useState(false);
  const [dataValue, setDataValue] = useState(item.data_value ?? '');

  const busy = uploadPct !== null || savingData || toggling || openingFile;

  const handleUpload = async (file: File) => {
    setUploadPct(0);
    try {
      const uploaded = await enterpriseApi.files.upload(
        file,
        { suite: 'lex', entity_type: 'requirement', lifecycle_policy: 'standard' },
        (progress) => setUploadPct(Math.round(progress)),
      );
      await lexRequestsApi.updateRequirement(requestId, item.id, {
        file_id: uploaded.id,
        satisfied: true,
      });
      showSuccess(extra.satisfy.toast.uploaded);
      await onChanged();
    } catch (error) {
      showApiError(error);
    } finally {
      setUploadPct(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleViewFile = async () => {
    if (!item.file_id) return;
    setOpeningFile(true);
    try {
      const presigned = await enterpriseApi.files.getPresignedDownload(item.file_id);
      window.open(presigned.url, '_blank', 'noopener,noreferrer');
    } catch {
      showError(extra.satisfy.toast.uploadFailed);
    } finally {
      setOpeningFile(false);
    }
  };

  const handleSaveData = async () => {
    const value = dataValue.trim();
    if (!value) return;
    setSavingData(true);
    try {
      await lexRequestsApi.updateRequirement(requestId, item.id, {
        data_value: value,
        satisfied: true,
      });
      showSuccess(extra.satisfy.toast.dataSaved);
      await onChanged();
    } catch (error) {
      showApiError(error);
    } finally {
      setSavingData(false);
    }
  };

  const handleToggle = async () => {
    setToggling(true);
    try {
      await lexRequestsApi.updateRequirement(requestId, item.id, { satisfied: !item.satisfied });
      showSuccess(execLabels.toast.requirementUpdated);
      await onChanged();
    } catch (error) {
      showApiError(error);
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {item.kind === 'attachment' ? (
          <>
            {item.file_id ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleViewFile}
                disabled={busy}
                title={extra.satisfy.viewFile}
              >
                {openingFile ? (
                  <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Paperclip className="me-1.5 h-3.5 w-3.5" />
                )}
                {extra.satisfy.viewFile}
              </Button>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              {uploadPct !== null ? (
                <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="me-1.5 h-3.5 w-3.5" />
              )}
              {uploadPct !== null
                ? extra.satisfy.uploading(uploadPct)
                : item.file_id
                  ? extra.satisfy.reupload
                  : extra.satisfy.upload}
            </Button>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              value={dataValue}
              onChange={(e) => setDataValue(e.target.value)}
              placeholder={extra.satisfy.dataPlaceholder}
              disabled={busy}
              className="h-9 w-44"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSaveData();
                }
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleSaveData()}
              disabled={busy || !dataValue.trim()}
            >
              {savingData ? (
                <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="me-1.5 h-3.5 w-3.5" />
              )}
              {extra.satisfy.saveData}
            </Button>
          </div>
        )}

        {mode === 'manage' ? (
          <Button size="sm" variant="outline" onClick={() => void handleToggle()} disabled={busy}>
            {toggling ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {item.satisfied ? execLabels.markUnsatisfied : execLabels.markSatisfied}
          </Button>
        ) : null}
      </div>

      {item.kind === 'data' && item.data_value ? (
        <Badge variant="outline" className="font-normal">
          {extra.satisfy.storedValuePrefix} {item.data_value}
        </Badge>
      ) : null}

      {item.satisfied && item.satisfied_at ? (
        <p className="text-end text-xs text-muted-foreground">
          {extra.satisfy.satisfiedBy(
            item.satisfied_by || extra.satisfy.unknownActor,
            formatDateTime(item.satisfied_at),
          )}
        </p>
      ) : null}
    </div>
  );
}
