'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import type { UserDirectoryEntry } from '@/types/suites';
import { MATTER_STATUS_OPTIONS, type MatterLabels } from './labels';

interface BulkStatusDialogProps {
  open: boolean;
  count: number;
  loading: boolean;
  labels: MatterLabels;
  onOpenChange: (open: boolean) => void;
  onSubmit: (status: string) => void;
}

export function MatterBulkStatusDialog({
  open,
  count,
  loading,
  labels,
  onOpenChange,
  onSubmit,
}: BulkStatusDialogProps) {
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open) {
      setStatus('');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.bulk.changeStatusTitle}</DialogTitle>
          <DialogDescription>{labels.bulk.changeStatusDescription(count)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="matter-bulk-status">{labels.statusDialog.nextStatus}</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="matter-bulk-status">
              <SelectValue placeholder={labels.statusDialog.selectStatus} />
            </SelectTrigger>
            <SelectContent>
              {MATTER_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {labels.filters.statusOptions[option] ?? option.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.bulk.cancel}
          </Button>
          <Button
            type="button"
            disabled={!status || loading}
            onClick={() => status && onSubmit(status)}
          >
            {labels.bulk.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BulkReassignDialogProps {
  open: boolean;
  count: number;
  loading: boolean;
  labels: MatterLabels;
  onOpenChange: (open: boolean) => void;
  onSubmit: (owner: { ownerUserId: string; ownerName: string }) => void;
}

export function MatterBulkReassignDialog({
  open,
  count,
  loading,
  labels,
  onOpenChange,
  onSubmit,
}: BulkReassignDialogProps) {
  const [ownerUserId, setOwnerUserId] = useState('');

  useEffect(() => {
    if (!open) {
      setOwnerUserId('');
    }
  }, [open]);

  const usersQuery = useQuery({
    queryKey: ['lex-matter-bulk-users'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200, order: 'asc' }),
    enabled: open,
  });

  const users: UserDirectoryEntry[] = usersQuery.data?.data ?? [];
  const selected = users.find((entry) => entry.id === ownerUserId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.bulk.reassignOwnerTitle}</DialogTitle>
          <DialogDescription>{labels.bulk.reassignOwnerDescription(count)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="matter-bulk-owner">{labels.bulk.owner}</Label>
          {usersQuery.isError ? (
            <p className="text-sm text-destructive">{labels.bulk.usersError}</p>
          ) : (
            <Select
              value={ownerUserId}
              onValueChange={setOwnerUserId}
              disabled={usersQuery.isLoading}
            >
              <SelectTrigger id="matter-bulk-owner">
                <SelectValue placeholder={labels.bulk.ownerPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {users.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {userDisplayName(entry)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.bulk.cancel}
          </Button>
          <Button
            type="button"
            disabled={!selected || loading}
            onClick={() =>
              selected &&
              onSubmit({ ownerUserId: selected.id, ownerName: userDisplayName(selected) })
            }
          >
            {labels.bulk.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
