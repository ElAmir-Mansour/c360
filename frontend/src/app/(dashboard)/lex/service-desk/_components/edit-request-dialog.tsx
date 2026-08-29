'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { showApiError, showSuccess } from '@/lib/toast';
import { lexRequestsApi, type LegalRequest } from '@/lib/lex/requests';
import { useServiceDeskLabels } from './labels';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: LegalRequest;
  onSaved?: () => void;
}

export function EditRequestDialog({ open, onOpenChange, request, onSaved }: Props) {
  const labels = useServiceDeskLabels();
  const t = labels.editDialog;
  const qc = useQueryClient();

  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [description, setDescription] = useState('');
  const [requesterName, setRequesterName] = useState('');
  const [department, setDepartment] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setTitleEn(request.title?.en ?? '');
      setTitleAr(request.title?.ar ?? '');
      setDescription(request.description ?? '');
      setRequesterName(request.requester_name ?? '');
      setDepartment(request.department ?? '');
      setError('');
    }
  }, [open, request]);

  const saveMutation = useMutation({
    mutationFn: () =>
      lexRequestsApi.updateRequest(request.id, {
        title: { en: titleEn.trim(), ar: titleAr.trim() },
        description: description.trim(),
        requester_name: requesterName.trim(),
        department: department.trim() || undefined,
      }),
    onSuccess: async () => {
      showSuccess(t.toast.updated);
      await qc.invalidateQueries({ queryKey: ['lex-legal-request', request.id] });
      await qc.invalidateQueries({ queryKey: ['lex-legal-requests'] });
      onOpenChange(false);
      onSaved?.();
    },
    onError: showApiError,
  });

  const submit = () => {
    if (!titleEn.trim() && !titleAr.trim()) {
      setError(t.errors.titleRequired);
      return;
    }
    setError('');
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-title-ar">{t.titleAr}</Label>
              <Input
                id="edit-title-ar"
                value={titleAr}
                onChange={(e) => setTitleAr(e.target.value)}
                dir="rtl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-title-en">{t.titleEn}</Label>
              <Input
                id="edit-title-en"
                value={titleEn}
                onChange={(e) => setTitleEn(e.target.value)}
                dir="ltr"
              />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="space-y-1.5">
            <Label htmlFor="edit-description">{t.requestDescription}</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-requester">{t.requesterName}</Label>
              <Input
                id="edit-requester"
                value={requesterName}
                onChange={(e) => setRequesterName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-department">{t.department}</Label>
              <Input
                id="edit-department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button type="button" onClick={submit} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
