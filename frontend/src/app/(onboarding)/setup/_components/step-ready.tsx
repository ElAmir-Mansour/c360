'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, ChevronLeft, Loader2, Sparkles } from 'lucide-react';

import { useT } from '@/components/providers/locale-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiGet, apiPost } from '@/lib/api';
import { API_ENDPOINTS, ROUTES } from '@/lib/constants';
import { isApiError } from '@/types/api';

import { clearDraft, type ProvisioningStatus, type WizardProgress } from './shared';
import { ProvisioningProgress } from './provisioning-progress';
import '../../_lib/onboarding-i18n';

export function StepReady({
  tenantID,
  initialStatus,
  onBack,
}: {
  tenantID: string;
  initialStatus: WizardProgress['provisioning_status'];
  onBack: () => void;
}) {
  const router = useRouter();
  const t = useT('onboarding');
  const [status, setStatus] = useState<ProvisioningStatus | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(true);
  const [currentStatus, setCurrentStatus] = useState(initialStatus);

  useEffect(() => {
    // Skip calling CompleteWizard when provisioning is already running or done
    // (e.g. user navigated back and returned to step 5, or page was refreshed).
    if (initialStatus === 'provisioning' || initialStatus === 'completed') {
      setIsCompleting(false);
      return;
    }

    // Session-level deduplication: guard against a second CompleteWizard call
    // even when initialStatus is 'pending' (e.g. provisioning job externally reset).
    const sessionKey = `clario360:wizard-completed:${tenantID}`;
    if (sessionStorage.getItem(sessionKey) === '1') {
      setIsCompleting(false);
      return;
    }

    let active = true;

    const completeWizard = async () => {
      try {
        await apiPost(API_ENDPOINTS.ONBOARDING_COMPLETE, {});
        // Mark as completed for this browser session so re-entry never re-fires.
        sessionStorage.setItem(sessionKey, '1');
      } catch (error) {
        if (active) {
          setCompleteError(isApiError(error) ? error.message : t('ready.finalizeFailed'));
        }
      } finally {
        if (active) {
          setIsCompleting(false);
        }
      }
    };

    void completeWizard();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tenantID) {
      return undefined;
    }

    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const nextStatus = await apiGet<ProvisioningStatus>(`${API_ENDPOINTS.ONBOARDING_STATUS}/${tenantID}`);
        if (!active) {
          return;
        }
        setStatus(nextStatus);
        setCurrentStatus(nextStatus.status);

        if (nextStatus.status === 'completed') {
          clearDraft();
          if (timer) {
            clearInterval(timer);
          }
        }
        if (nextStatus.status === 'failed' && timer) {
          clearInterval(timer);
        }
      } catch {
        // keep polling through transient network failures
      }
    };

    void poll();
    timer = setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      active = false;
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [tenantID]);

  return (
    <div className="space-y-6">
      {completeError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{completeError}</AlertDescription>
        </Alert>
      ) : null}

      {currentStatus === 'completed' ? (
        <div className="space-y-6 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle2 className="h-10 w-10 text-primary" />
          </div>
          <div>
            <h2 className="text-h2 font-semibold text-foreground">{t('ready.completedTitle')}</h2>
            <p className="mt-2 text-sm text-foreground/55">{t('ready.completedSubtitle')}</p>
          </div>
          <Button size="lg" className="w-full" onClick={() => router.push(ROUTES.DASHBOARD)}>
            {t('ready.goToDashboard')}
          </Button>
          <div className="grid gap-3 md:grid-cols-3">
            <button type="button" className="rounded-2xl border border-primary/15 bg-card p-4 text-left" onClick={() => router.push('/data/sources?create=true')}>
              <p className="font-medium text-foreground">{t('ready.connectDataTitle')}</p>
              <p className="mt-1 text-sm text-foreground/55">{t('ready.connectDataDesc')}</p>
            </button>
            <button type="button" className="rounded-2xl border border-primary/15 bg-card p-4 text-left" onClick={() => router.push('/cyber/assets?scan=true')}>
              <p className="font-medium text-foreground">{t('ready.assetScanTitle')}</p>
              <p className="mt-1 text-sm text-foreground/55">{t('ready.assetScanDesc')}</p>
            </button>
            <button type="button" className="rounded-2xl border border-primary/15 bg-card p-4 text-left" onClick={() => router.push('/acta/meetings?create=true')}>
              <p className="font-medium text-foreground">{t('ready.boardMeetingTitle')}</p>
              <p className="mt-1 text-sm text-foreground/55">{t('ready.boardMeetingDesc')}</p>
            </button>
          </div>
          <a href="https://docs.clario360.com" className="text-sm font-medium text-primary hover:underline">
            {t('ready.exploreDocs')}
          </a>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              {isCompleting ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Sparkles className="h-8 w-8 text-primary" />}
            </div>
            <h2 className="mt-4 text-h2 font-semibold text-foreground">{t('ready.provisioningTitle')}</h2>
            <p className="mt-2 text-sm text-foreground/55">{t('ready.provisioningSubtitle')}</p>
          </div>

          <ProvisioningProgress status={status} fallbackStatus={currentStatus} />

          {currentStatus === 'failed' ? (
            <div className="flex justify-between">
              <Button variant="outline" onClick={onBack}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                {t('actions.back')}
              </Button>
              <Button onClick={() => router.push(ROUTES.DASHBOARD)}>{t('ready.goToDashboard')}</Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
