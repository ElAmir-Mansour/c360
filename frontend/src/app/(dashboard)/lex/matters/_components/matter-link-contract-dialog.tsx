'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorState } from '@/components/common/error-state';
import { enterpriseApi } from '@/lib/enterprise';
import type { LexLinkMatterContractPayload, LexMatterContract } from '@/types/suites';
import {
  MATTER_CONTRACT_RELATIONSHIPS,
  matterRelationshipLabels,
  useMatterLabels,
} from './labels';
import { resolveLexBilingual } from '../../_lib/lex-i18n';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

interface MatterLinkContractDialogProps {
  open: boolean;
  loading: boolean;
  linkedContracts: LexMatterContract[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: LexLinkMatterContractPayload) => void;
}

export function MatterLinkContractDialog({
  open,
  loading,
  linkedContracts,
  onOpenChange,
  onSubmit,
}: MatterLinkContractDialogProps) {
  const { locale } = useLocaleOrDefault();
  const matterLabels = useMatterLabels();
  const labels = matterLabels.linkDialog;
  const relationshipLabels = resolveLexBilingual(matterRelationshipLabels, locale);
  const [contractId, setContractId] = useState('');
  const [relationship, setRelationship] = useState<string>(MATTER_CONTRACT_RELATIONSHIPS[0]);

  const contractsQuery = useQuery({
    queryKey: ['lex-contracts', 'matter-link-picker'],
    queryFn: () => enterpriseApi.lex.listContracts({ page: 1, per_page: 200, order: 'asc' }),
    enabled: open,
  });

  const linkedIds = useMemo(
    () => new Set(linkedContracts.map((entry) => entry.contract_id)),
    [linkedContracts],
  );

  const availableContracts = useMemo(
    () => (contractsQuery.data?.data ?? []).filter((contract) => !linkedIds.has(contract.id)),
    [contractsQuery.data, linkedIds],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setContractId('');
    setRelationship(MATTER_CONTRACT_RELATIONSHIPS[0]);
  }, [open]);

  const submit = () => {
    if (!contractId) {
      return;
    }
    onSubmit({ contract_id: contractId, relationship });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        {contractsQuery.isError ? (
          <ErrorState
            message={labels.loadError}
            onRetry={() => void contractsQuery.refetch()}
          />
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="matter-link-contract">{labels.contract}</Label>
              <Select
                value={contractId}
                onValueChange={setContractId}
                disabled={contractsQuery.isLoading || availableContracts.length === 0}
              >
                <SelectTrigger id="matter-link-contract">
                  <SelectValue
                    placeholder={contractsQuery.isLoading ? labels.loadingContracts : labels.contractPlaceholder}
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableContracts.map((contract) => (
                    <SelectItem key={contract.id} value={contract.id}>
                      {contract.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!contractsQuery.isLoading && availableContracts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{labels.noContracts}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="matter-link-relationship">{labels.relationship}</Label>
              <Select value={relationship} onValueChange={setRelationship}>
                <SelectTrigger id="matter-link-relationship">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATTER_CONTRACT_RELATIONSHIPS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {relationshipLabels[option] ?? option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button
            type="button"
            disabled={!contractId || loading || contractsQuery.isLoading}
            onClick={submit}
          >
            {loading ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {labels.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
