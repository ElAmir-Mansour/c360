'use client';

/**
 * Simulate-Inbound dialog (CAP-002/003).
 *
 * The demonstrable end of the inbound-email bridge: pick an intake mailbox, type a
 * from/subject/body, and the backend synthesizes an inbound email and drives the
 * full classify→route→legal_request pipeline with NO external mail provider. Gated
 * on the mailbox-admin permission (the same tier as mailbox CRUD); the trigger is
 * hidden for users who lack it. On success it invalidates the intake-messages query
 * so the routed message appears immediately.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MailPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
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
import { useLocale } from '@/components/providers/locale-provider';
import { showApiError, showSuccess } from '@/lib/toast';
import { lexRequestsApi } from '@/lib/lex/requests';
import { useIntakeLabels } from './_labels';

export function SimulateInboundDialog() {
  const { direction } = useLocale();
  const labels = useIntakeLabels();
  const t = labels.simulate;
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [mailboxId, setMailboxId] = useState('');
  const [from, setFrom] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const mailboxesQuery = useQuery({
    queryKey: ['lex-intake-mailboxes', 'simulate'],
    queryFn: () => lexRequestsApi.listIntakeMailboxes({ page: 1, per_page: 100 }),
    enabled: open,
  });
  const mailboxes = (mailboxesQuery.data?.data ?? []).filter((m) => m.active);

  const reset = () => {
    setMailboxId('');
    setFrom('');
    setSubject('');
    setBody('');
  };

  const mutation = useMutation({
    mutationFn: () =>
      lexRequestsApi.simulateInboundEmail(mailboxId, {
        from: from.trim() || undefined,
        subject: subject.trim() || undefined,
        body: body.trim() || undefined,
      }),
    onSuccess: () => {
      showSuccess(t.successTitle, t.successBody);
      void qc.invalidateQueries({ queryKey: ['lex-intake-messages'] });
      reset();
      setOpen(false);
    },
    onError: (error) => showApiError(error),
  });

  const handleOpenChange = (next: boolean) => {
    if (mutation.isPending) return;
    if (!next) reset();
    setOpen(next);
  };

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <MailPlus className="h-4 w-4" aria-hidden />
        {t.trigger}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent dir={direction} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{t.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <LexCreationGuidance workflow="service-request" />
            <div className="space-y-2">
              <Label htmlFor="simulate-mailbox">{t.mailbox}</Label>
              <Select value={mailboxId} onValueChange={setMailboxId} dir={direction}>
                <SelectTrigger id="simulate-mailbox">
                  <SelectValue placeholder={t.mailboxPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {mailboxes.map((mailbox) => (
                    <SelectItem key={mailbox.id} value={mailbox.id}>
                      {mailbox.address}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!mailboxesQuery.isLoading && mailboxes.length === 0 && (
                <p className="text-sm text-muted-foreground">{t.mailboxEmpty}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="simulate-from">{t.from}</Label>
              <Input
                id="simulate-from"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                placeholder={t.fromPlaceholder}
                dir="ltr"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="simulate-subject">{t.subject}</Label>
              <Input
                id="simulate-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder={t.subjectPlaceholder}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="simulate-body">{t.body}</Label>
              <Textarea
                id="simulate-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={t.bodyPlaceholder}
                rows={4}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t.cancel}
            </Button>
            <Button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={!mailboxId || mutation.isPending}
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {mutation.isPending ? t.submitting : t.submit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
