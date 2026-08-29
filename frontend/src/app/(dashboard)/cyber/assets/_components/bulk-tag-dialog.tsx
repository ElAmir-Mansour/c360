'use client';

import { useState } from 'react';
import { toast } from 'sonner';
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
import { Badge } from '@/components/ui/badge';
import { apiPut } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { useAssetLabels } from '../_lib/assets-i18n';

interface BulkTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetIds: string[];
  onSuccess?: () => void;
}

export function BulkTagDialog({ open, onOpenChange, assetIds, onSuccess }: BulkTagDialogProps) {
  const t = useAssetLabels();
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleAddTag = () => {
    const value = tagInput.trim().toLowerCase();
    if (value && !tags.includes(value)) {
      setTags((prev) => [...prev, value]);
    }
    setTagInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const handleSubmit = async () => {
    if (tags.length === 0) {
      toast.error(t.bulkTagDialog.addAtLeastOne);
      return;
    }
    setLoading(true);
    try {
      await apiPut(API_ENDPOINTS.CYBER_ASSETS_BULK_TAGS, {
        asset_ids: assetIds,
        tags,
        action: 'add',
      });
      toast.success(t.bulkTagDialog.appliedToast(assetIds.length));
      setTags([]);
      setTagInput('');
      onOpenChange(false);
      onSuccess?.();
    } catch {
      toast.error(t.bulkTagDialog.failedToast);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.bulkTagDialog.title}</DialogTitle>
          <DialogDescription>
            {t.bulkTagDialog.description(assetIds.length)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>{t.bulkTagDialog.tagsToAdd}</Label>
            <div className="flex gap-2 mt-1">
              <Input
                placeholder={t.bulkTagDialog.inputPlaceholder}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <Button type="button" variant="outline" size="sm" onClick={handleAddTag}>
                {t.bulkTagDialog.add}
              </Button>
            </div>
          </div>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1">
                  {tag}
                  <button
                    type="button"
                    className="ms-1 text-muted-foreground hover:text-foreground"
                    onClick={() => handleRemoveTag(tag)}
                  >
                    &times;
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {t.bulkTagDialog.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={loading || tags.length === 0}>
            {loading ? t.bulkTagDialog.applying : t.bulkTagDialog.applySubmit(assetIds.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
