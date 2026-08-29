'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { apiPut, apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { useUebaLabels, uebaAlertStatusLabel } from '../_lib/ueba-i18n';
import type { UebaAlert, UebaAlertStatus } from './types';

function statusVariant(status: string) {
  if (status === 'resolved' || status === 'false_positive') return 'secondary' as const;
  if (status === 'investigating') return 'warning' as const;
  if (status === 'acknowledged') return 'default' as const;
  return 'outline' as const;
}

export function AlertActions({ alert }: { alert: UebaAlert }) {
  const t = useUebaLabels();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [fpDialogOpen, setFpDialogOpen] = useState(false);
  const [fpNotes, setFpNotes] = useState('');

  async function updateStatus(newStatus: UebaAlertStatus, notes?: string) {
    setLoading(true);
    try {
      await apiPut(`${API_ENDPOINTS.CYBER_UEBA_ALERTS}/${alert.id}/status`, {
        status: newStatus,
        notes: notes ?? '',
      });
      toast.success(t.statusUpdatedToast(uebaAlertStatusLabel(newStatus, t)));
      await queryClient.invalidateQueries({ queryKey: ['cyber-ueba-alerts'] });
      await queryClient.invalidateQueries({ queryKey: ['cyber-ueba-entity-alerts'] });
      await queryClient.invalidateQueries({ queryKey: ['cyber-ueba-dashboard'] });
    } catch {
      toast.error(t.statusUpdateFailed);
    } finally {
      setLoading(false);
    }
  }

  async function markFalsePositive() {
    setLoading(true);
    try {
      await apiPost(`${API_ENDPOINTS.CYBER_UEBA_ALERTS}/${alert.id}/false-positive`, {
        notes: fpNotes,
      });
      toast.success(t.falsePositiveToast);
      setFpDialogOpen(false);
      setFpNotes('');
      await queryClient.invalidateQueries({ queryKey: ['cyber-ueba-alerts'] });
      await queryClient.invalidateQueries({ queryKey: ['cyber-ueba-entity-alerts'] });
      await queryClient.invalidateQueries({ queryKey: ['cyber-ueba-dashboard'] });
      await queryClient.invalidateQueries({ queryKey: ['cyber-ueba-profile'] });
    } catch {
      toast.error(t.falsePositiveFailed);
    } finally {
      setLoading(false);
    }
  }

  const isTerminal = alert.status === 'resolved' || alert.status === 'false_positive';

  const transitions: UebaAlertStatus[] = [];
  if (!isTerminal) {
    if (alert.status === 'new') transitions.push('acknowledged');
    if (alert.status !== 'investigating') transitions.push('investigating');
    transitions.push('resolved');
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Badge variant={statusVariant(alert.status)}>{uebaAlertStatusLabel(alert.status, t)}</Badge>
        {!isTerminal && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={loading}>
                {t.actionsButton}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {transitions.map((status) => (
                <DropdownMenuItem key={status} onClick={() => void updateStatus(status)}>
                  {uebaAlertStatusLabel(status, t)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setFpDialogOpen(true)}
              >
                {t.markFalsePositive}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <Dialog open={fpDialogOpen} onOpenChange={setFpDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.falsePositiveDialogTitle}</DialogTitle>
            <DialogDescription>
              {t.falsePositiveDialogDescription}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={t.falsePositivePlaceholder}
            value={fpNotes}
            onChange={(e) => setFpNotes(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFpDialogOpen(false)}>
              {t.cancel}
            </Button>
            <Button variant="destructive" onClick={() => void markFalsePositive()} disabled={loading}>
              {loading ? t.processing : t.confirmFalsePositive}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
