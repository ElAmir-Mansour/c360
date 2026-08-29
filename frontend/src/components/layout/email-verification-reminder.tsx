'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, MailCheck, RotateCcw, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ROUTES } from '@/lib/constants';
import {
  getEmailVerificationUrl,
  needsEmailVerification,
  requestEmailVerificationCode,
} from '@/lib/email-verification';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useT } from '@/components/providers/locale-provider';

const SNOOZE_MS = 24 * 60 * 60 * 1000;
const SNOOZE_KEY_PREFIX = 'clario360_email_verification_snoozed_until';

function snoozeKey(userId: string, tenantId: string): string {
  return `${SNOOZE_KEY_PREFIX}:${tenantId}:${userId}`;
}

export function EmailVerificationReminder() {
  const t = useT();
  const { user, tenant } = useAuth();
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const needsVerification = needsEmailVerification(user);
  const tenantId = user?.tenant_id ?? tenant?.id ?? null;
  const storageKey = user && tenantId ? snoozeKey(user.id, tenantId) : null;
  const verificationUrl = useMemo(
    () =>
      user
        ? getEmailVerificationUrl({ email: user.email, tenantId })
        : ROUTES.VERIFY_EMAIL,
    [tenantId, user],
  );

  useEffect(() => {
    if (!user || !storageKey || !needsVerification) {
      setVisible(false);
      return;
    }

    try {
      const snoozedUntil = Number(window.localStorage.getItem(storageKey) ?? '0');
      setVisible(!Number.isFinite(snoozedUntil) || snoozedUntil <= Date.now());
    } catch {
      setVisible(true);
    }
  }, [needsVerification, storageKey, user]);

  if (!user || !needsVerification || !visible) return null;

  const dismiss = () => {
    setVisible(false);
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, String(Date.now() + SNOOZE_MS));
    } catch {
      // Dismissal is cosmetic; storage failures should not block the UI.
    }
  };

  const resend = async () => {
    setStatus('sending');
    try {
      await requestEmailVerificationCode({ email: user.email, tenantId });
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-warning-300/30 bg-warning-50/95 px-4 py-3 text-warning-800 shadow-sm backdrop-blur dark:bg-warning-500/[0.12] dark:text-warning-50"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning-500/15 text-warning-700 ring-1 ring-inset ring-warning-500/25 dark:text-warning-300">
            {status === 'sent' ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            ) : (
              <MailCheck className="h-4 w-4" aria-hidden />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t('shell.emailVerificationReminderTitle')}</p>
            <p className="mt-0.5 text-sm leading-6 text-warning-800/75 dark:text-warning-50/75">
              {status === 'sent'
                ? t('shell.emailVerificationSent')
                : status === 'error'
                  ? t('shell.emailVerificationSendFailed')
                  : t('shell.emailVerificationReminderBody')}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <Button
            asChild
            size="sm"
            className="min-h-9 rounded-lg bg-warning-700 text-white shadow-sm hover:bg-warning-800 dark:bg-warning-300 dark:text-warning-800 dark:hover:bg-warning-100"
          >
            <Link href={verificationUrl}>{t('shell.emailVerificationVerify')}</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void resend()}
            disabled={status === 'sending'}
            className="min-h-9 rounded-lg border-warning-500/35 bg-white/70 text-warning-800 hover:bg-white dark:bg-warning-800/25 dark:text-warning-50 dark:hover:bg-warning-800/40"
          >
            <RotateCcw
              className={cn('mr-2 h-3.5 w-3.5', status === 'sending' && 'animate-spin')}
              aria-hidden
            />
            {status === 'sending'
              ? t('shell.emailVerificationSending')
              : t('shell.emailVerificationResend')}
          </Button>
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-warning-800/70 transition-colors hover:bg-warning-500/15 hover:text-warning-800 focus:outline-none focus:ring-2 focus:ring-warning-500/45 dark:text-warning-50/75 dark:hover:bg-warning-500/20 dark:hover:text-warning-50"
            aria-label={t('shell.emailVerificationDismiss')}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
