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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiPost, apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { CyberAsset } from '@/types/cyber';
import type { PaginatedResponse } from '@/types/api';
import { useAssetLabels, type AssetLabels } from '../_lib/assets-i18n';

function buildRelationshipTypes(t: AssetLabels) {
  return [
    { label: t.relationshipDialog.types.hosts, value: 'hosts' },
    { label: t.relationshipDialog.types.runsOn, value: 'runs_on' },
    { label: t.relationshipDialog.types.connectsTo, value: 'connects_to' },
    { label: t.relationshipDialog.types.dependsOn, value: 'depends_on' },
    { label: t.relationshipDialog.types.managedBy, value: 'managed_by' },
    { label: t.relationshipDialog.types.backsUp, value: 'backs_up' },
    { label: t.relationshipDialog.types.loadBalances, value: 'load_balances' },
  ];
}

interface AddRelationshipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: CyberAsset;
  onSuccess?: () => void;
}

export function AddRelationshipDialog({ open, onOpenChange, asset, onSuccess }: AddRelationshipDialogProps) {
  const t = useAssetLabels();
  const relationshipTypes = buildRelationshipTypes(t);
  const [relationshipType, setRelationshipType] = useState('connects_to');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CyberAsset[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<CyberAsset | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSearch = async () => {
    if (searchQuery.trim().length < 2) return;
    setSearching(true);
    try {
      const result = await apiGet<PaginatedResponse<CyberAsset>>(API_ENDPOINTS.CYBER_ASSETS, {
        search: searchQuery.trim(),
        per_page: 10,
        page: 1,
      });
      // Exclude the source asset itself
      setSearchResults(result.data.filter((a) => a.id !== asset.id));
    } catch {
      toast.error(t.relationshipDialog.searchFailedToast);
    } finally {
      setSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSearch();
    }
  };

  const handleSubmit = async () => {
    if (!selectedTarget) {
      toast.error(t.relationshipDialog.selectTarget);
      return;
    }
    setSubmitting(true);
    try {
      await apiPost(`${API_ENDPOINTS.CYBER_ASSETS}/${asset.id}/relationships`, {
        target_asset_id: selectedTarget.id,
        relationship_type: relationshipType,
      });
      toast.success(t.relationshipDialog.createdToast(asset.name, selectedTarget.name));
      setSearchQuery('');
      setSearchResults([]);
      setSelectedTarget(null);
      onOpenChange(false);
      onSuccess?.();
    } catch {
      toast.error(t.relationshipDialog.createFailedToast);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.relationshipDialog.title}</DialogTitle>
          <DialogDescription>
            {t.relationshipDialog.description(asset.name)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>{t.relationshipDialog.relationshipType}</Label>
            <Select value={relationshipType} onValueChange={setRelationshipType}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {relationshipTypes.map((rt) => (
                  <SelectItem key={rt.value} value={rt.value}>
                    {rt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>{t.relationshipDialog.targetAsset}</Label>
            <div className="flex gap-2 mt-1">
              <Input
                placeholder={t.relationshipDialog.searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <Button type="button" variant="outline" size="sm" onClick={handleSearch} disabled={searching}>
                {searching ? t.relationshipDialog.searching : t.relationshipDialog.search}
              </Button>
            </div>
          </div>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-md border">
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  className={`flex w-full items-center gap-3 px-3 py-2 text-start text-sm hover:bg-muted ${
                    selectedTarget?.id === result.id ? 'bg-muted ring-1 ring-primary' : ''
                  }`}
                  onClick={() => setSelectedTarget(result)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{result.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {result.type} · {result.ip_address ?? result.hostname ?? t.relationshipDialog.noAddress}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedTarget && (
            <div className="rounded-md border bg-muted/50 p-3 text-sm">
              <p className="font-medium">{asset.name}</p>
              <p className="text-xs text-muted-foreground">
                — {relationshipTypes.find((r) => r.value === relationshipType)?.label ?? relationshipType} →
              </p>
              <p className="font-medium">{selectedTarget.name}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t.relationshipDialog.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !selectedTarget}>
            {submitting ? t.relationshipDialog.creating : t.relationshipDialog.createSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
