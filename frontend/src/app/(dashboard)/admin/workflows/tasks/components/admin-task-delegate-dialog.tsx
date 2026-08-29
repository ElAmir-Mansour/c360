'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { apiGet, apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { showError, showSuccess } from '@/lib/toast';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { HumanTask, User } from '@/types/models';
import type { PaginatedResponse } from '@/types/api';
import {
  fillAdminWorkflowLabel,
  getAdminWorkflowLabels,
} from '../_lib/admin-workflow-i18n';

interface AdminTaskDelegateDialogProps {
  task: HumanTask;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AdminTaskDelegateDialog({
  task,
  open,
  onOpenChange,
  onSuccess,
}: AdminTaskDelegateDialogProps) {
  const { locale } = useLocaleOrDefault();
  const labels = getAdminWorkflowLabels(locale);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useAuth();

  const { data: usersData } = useQuery({
    queryKey: ['role-users', task.assignee_role],
    queryFn: () =>
      apiGet<PaginatedResponse<User>>(
        `/api/v1/roles/${task.assignee_role}/users`,
        { per_page: 100, tenant_id: user?.tenant_id },
      ),
    enabled: open && !!task.assignee_role,
  });

  const userOptions = useMemo(
    () =>
      (usersData?.data ?? [])
        .filter((u) => u.id !== user?.id)
        .map((u) => ({
          label: `${u.first_name} ${u.last_name} (${u.email})`,
          value: u.id,
        })),
    [usersData?.data, user?.id],
  );

  const handleDelegate = async () => {
    if (!selectedUserId) return;
    setIsSubmitting(true);
    try {
      const selectedUser = usersData?.data.find((u) => u.id === selectedUserId);
      await apiPost(`/api/v1/workflows/tasks/${task.id}/delegate`, {
        delegate_to: selectedUserId,
        ...(reason && { reason }),
      });
      const name = selectedUser
        ? `${selectedUser.first_name} ${selectedUser.last_name}`
        : labels.delegate.userFallback;
      showSuccess(fillAdminWorkflowLabel(labels.delegate.success, { name }));
      onOpenChange(false);
      setSelectedUserId('');
      setReason('');
      onSuccess();
    } catch {
      showError(labels.delegate.failed);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedUserId('');
      setReason('');
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.delegate.title}</DialogTitle>
          <DialogDescription>{labels.delegate.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              {labels.delegate.delegateTo} <span className="text-destructive">*</span>
            </Label>
            <UserPicker
              options={userOptions}
              value={selectedUserId}
              onChange={setSelectedUserId}
              placeholder={labels.delegate.searchUsers}
              noResultsLabel={labels.common.noResults}
              searchLabel={labels.common.searchPlaceholder}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="delegate-reason">{labels.delegate.reason}</Label>
            <Textarea
              id="delegate-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={labels.delegate.reasonPlaceholder}
              className="min-h-[80px]"
              disabled={isSubmitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            {labels.common.cancel}
          </Button>
          <Button
            onClick={handleDelegate}
            disabled={!selectedUserId || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {labels.delegate.submitting}
              </>
            ) : (
              labels.delegate.confirm
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserPicker({
  options,
  value,
  onChange,
  placeholder,
  noResultsLabel,
  searchLabel,
}: {
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  noResultsLabel: string;
  searchLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          className="w-full justify-between font-normal"
        >
          {selected?.label ?? <span className="text-muted-foreground">{placeholder}</span>}
          <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="space-y-2 p-2"
        style={{ width: 'var(--radix-popover-trigger-width)' }}
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchLabel}
          className="h-8 text-sm"
        />
        <div className="max-h-56 overflow-y-auto" role="listbox">
          {filtered.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              {noResultsLabel}
            </div>
          ) : (
            filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={value === option.value}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                onClick={() => {
                  onChange(value === option.value ? '' : option.value);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <Check
                  className={cn('h-4 w-4', value === option.value ? 'opacity-100' : 'opacity-0')}
                  aria-hidden
                />
                <span className="truncate">{option.label}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
