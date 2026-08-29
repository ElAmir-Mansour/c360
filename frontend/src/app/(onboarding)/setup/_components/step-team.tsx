'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, Loader2 } from 'lucide-react';

import { useT } from '@/components/providers/locale-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { isApiError } from '@/types/api';

import { InviteRow } from './invite-row';
import type { InvitationDraft, RoleRecord } from './shared';
import '../../_lib/onboarding-i18n';

export function StepTeam({
  roles,
  initialRows,
  onBack,
  onSaved,
  onPersist,
}: {
  roles: RoleRecord[];
  initialRows: InvitationDraft[];
  onBack: () => void;
  onSaved: () => Promise<void>;
  onPersist: (rows: InvitationDraft[]) => void;
}) {
  const [rows, setRows] = useState<InvitationDraft[]>(
    initialRows.length > 0 ? initialRows : [{ email: '', role_slug: roles[0]?.slug ?? 'viewer', message: '' }],
  );
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sentCount, setSentCount] = useState<number | null>(null);
  const t = useT('onboarding');

  useEffect(() => {
    onPersist(rows);
  }, [rows, onPersist]);

  const updateRow = (index: number, field: keyof InvitationDraft, value: string) => {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  };

  const addRow = () => {
    setRows((current) =>
      current.length >= 10 ? current : [...current, { email: '', role_slug: roles[0]?.slug ?? 'viewer', message: '' }],
    );
  };

  const removeRow = (index: number) => {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  };

  const submit = async (skip = false) => {
    setApiError(null);
    setSentCount(null);
    setIsSubmitting(true);
    try {
      const invitations = skip
        ? []
        : rows
            .filter((row) => row.email.trim() !== '')
            .map((row) => ({
              email: row.email.trim(),
              role_slug: row.role_slug,
              message: row.message?.trim() || undefined,
            }));

      const response = await apiPost<{ invitations_sent?: number; data?: unknown[]; count?: number }>(
        API_ENDPOINTS.ONBOARDING_TEAM,
        { invitations },
      );
      const sent = response.invitations_sent ?? response.count ?? invitations.length;
      setSentCount(sent);
      // Give the user a moment to read the confirmation before navigating away.
      if (sent > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1200));
      }
      await onSaved();
    } catch (error) {
      setApiError(isApiError(error) ? error.message : t('team.sendFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {apiError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{apiError}</AlertDescription>
        </Alert>
      ) : null}
      {sentCount !== null ? (
        <Alert className="border-primary/20 bg-primary/5 text-primary">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            {sentCount === 1 ? t('team.sentOne', { count: sentCount }) : t('team.sentMany', { count: sentCount })}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-3">
        {rows.map((row, index) => (
          <InviteRow
            key={index}
            index={index}
            row={row}
            roles={roles}
            canRemove={rows.length > 1}
            onChange={updateRow}
            onRemove={removeRow}
          />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={addRow} disabled={rows.length >= 10}>
          {t('team.addAnother')}
        </Button>
        <span className="text-sm text-foreground/55">{t('team.rowsCount', { count: rows.length })}</span>
      </div>

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          {t('actions.back')}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" disabled={isSubmitting} onClick={() => void submit(true)}>
            {t('actions.skip')}
          </Button>
          <Button type="button" disabled={isSubmitting} onClick={() => void submit(false)}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('actions.continue')}
          </Button>
        </div>
      </div>
    </div>
  );
}
