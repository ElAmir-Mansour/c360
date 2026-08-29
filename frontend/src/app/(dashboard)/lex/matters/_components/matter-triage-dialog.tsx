'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import type { LexMatter, LexTriageMatterPayload } from '@/types/suites';
import {
  MATTER_PRIORITY_OPTIONS,
  MATTER_STATUS_OPTIONS,
  useMatterLabels,
} from './labels';

interface MatterTriageDialogProps {
  matter: LexMatter;
  open: boolean;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: LexTriageMatterPayload) => void;
}

const KEEP_OWNER = 'keep';

export function MatterTriageDialog({
  matter,
  open,
  loading,
  onOpenChange,
  onSubmit,
}: MatterTriageDialogProps) {
  const matterLabels = useMatterLabels();
  const labels = matterLabels.triageDialog;
  const [status, setStatus] = useState(matter.status);
  const [priority, setPriority] = useState(matter.priority);
  const [ownerId, setOwnerId] = useState(KEEP_OWNER);
  const [dueDate, setDueDate] = useState(toDateInputValue(matter.due_date));
  const [notes, setNotes] = useState('');

  const usersQuery = useQuery({
    queryKey: ['enterprise-users', 'lex-matter-triage'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200, order: 'asc' }),
    enabled: open,
  });

  const users = useMemo(() => usersQuery.data?.data ?? [], [usersQuery.data]);
  const usersById = useMemo(() => new Map(users.map((entry) => [entry.id, entry])), [users]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setStatus(matter.status);
    setPriority(matter.priority);
    setOwnerId(KEEP_OWNER);
    setDueDate(toDateInputValue(matter.due_date));
    setNotes('');
  }, [open, matter]);

  const submit = () => {
    const payload: LexTriageMatterPayload = { status };
    if (priority) {
      payload.priority = priority;
    }
    if (ownerId !== KEEP_OWNER) {
      const directoryUser = usersById.get(ownerId);
      payload.owner_user_id = ownerId;
      payload.owner_name = directoryUser ? userDisplayName(directoryUser) : matter.owner_name;
    }
    payload.due_date = toOptionalDateTime(dueDate);
    const trimmedNotes = notes.trim();
    if (trimmedNotes) {
      payload.notes = trimmedNotes;
    }
    onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="triage-status">{labels.status}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="triage-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATTER_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {matterLabels.filters.statusOptions[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="triage-priority">{labels.priority}</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="triage-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATTER_PRIORITY_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {matterLabels.filters.priorityOptions[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="triage-owner">{labels.owner}</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger id="triage-owner">
                  <SelectValue placeholder={labels.ownerPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP_OWNER}>{labels.keepOwner}</SelectItem>
                  {users.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {userDisplayName(entry)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="triage-due-date">{labels.dueDate}</Label>
              <Input
                id="triage-due-date"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="triage-notes">{labels.notes}</Label>
            <Textarea
              id="triage-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={labels.notesPlaceholder}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button type="button" disabled={!status || loading} onClick={submit}>
            {labels.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toDateInputValue(value?: string | null): string {
  if (!value) {
    return '';
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? '' : parsed.toISOString().slice(0, 10);
}

function toOptionalDateTime(value: string): string | null {
  if (!value) {
    return null;
  }
  return new Date(`${value}T00:00:00Z`).toISOString();
}
