'use client';

import React, { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import { Copy, Download, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { MFACodeInput } from './mfa-code-input';
import { apiPost } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { showSuccess } from '@/lib/toast';
import { copyToClipboard, downloadTextFile } from '@/lib/utils';
import { useT } from '@/components/providers/locale-provider';
import { API_ENDPOINTS } from '@/lib/constants';
import type { EnableMFAResponse } from '@/types/auth';
import type { ApiError } from '@/types/api';
import { isApiError } from '@/types/api';

type Step = 'qr' | 'verify' | 'recovery';

interface MFASetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MFASetupDialog({ open, onOpenChange }: MFASetupDialogProps) {
  const t = useT();
  const [step, setStep] = useState<Step>('qr');
  const [mfaData, setMfaData] = useState<EnableMFAResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualKeyOpen, setManualKeyOpen] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  const fetchMFASetup = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiPost<EnableMFAResponse>(API_ENDPOINTS.USERS_ME_MFA_ENABLE);
      setMfaData(data);
      const url = await QRCode.toDataURL(data.otp_url, {
        width: 200,
        margin: 2,
        type: 'image/png',
      });
      setQrDataUrl(url);
    } catch (err) {
      setError(isApiError(err) ? err.message : t('auth.mfaSetup.initFailed'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && step === 'qr') {
      void fetchMFASetup();
    }
  }, [open, step, fetchMFASetup]);

  const handleVerify = async (code: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await apiPost(API_ENDPOINTS.USERS_ME_MFA_VERIFY_SETUP, { code });
      setStep('recovery');
    } catch (err) {
      setError(isApiError(err) ? err.message : t('auth.mfaSetup.invalidCode'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyManualKey = async () => {
    if (!mfaData) return;
    const success = await copyToClipboard(mfaData.secret);
    if (success) showSuccess(t('auth.mfaSetup.copied'));
  };

  const handleCopyAllCodes = async () => {
    if (!mfaData) return;
    const text = mfaData.recovery_codes.join('\n');
    const success = await copyToClipboard(text);
    if (success) showSuccess(t('auth.mfaSetup.recoveryCopied'));
  };

  const handleDownloadCodes = () => {
    if (!mfaData) return;
    const content = [
      t('auth.mfaSetup.recoveryFileHeader'),
      '========================',
      '',
      t('auth.mfaSetup.recoveryFileNote'),
      '',
      ...mfaData.recovery_codes,
    ].join('\n');
    downloadTextFile(content, 'watheeqtech-recovery-codes.txt');
  };

  const handleDone = () => {
    // Update user MFA status in store
    useAuthStore.setState((s) => ({
      user: s.user ? { ...s.user, mfa_enabled: true } : s.user,
    }));
    onOpenChange(false);
    // Reset state for next time
    setTimeout(() => {
      setStep('qr');
      setMfaData(null);
      setQrDataUrl('');
      setSavedConfirmed(false);
    }, 300);
  };

  const handleClose = (open: boolean) => {
    if (!open && step !== 'recovery') {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {step === 'qr' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('auth.mfaSetup.qrTitle')}</DialogTitle>
              <DialogDescription>
                {t('auth.mfaSetup.qrDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {isLoading && (
                <div className="flex justify-center py-8">
                  <Spinner size="lg" />
                </div>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {qrDataUrl && (
                <div className="flex flex-col items-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrDataUrl}
                    alt={t('auth.mfaSetup.qrAlt')}
                    className="rounded-lg border p-2"
                    width={200}
                    height={200}
                  />
                  <button
                    type="button"
                    className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => setManualKeyOpen((prev) => !prev)}
                    aria-expanded={manualKeyOpen}
                  >
                    {t('auth.mfaSetup.cantScan')}
                  </button>
                  {manualKeyOpen && mfaData && (
                    <div className="w-full rounded-md bg-muted p-3">
                      <p className="mb-1 text-xs text-muted-foreground">
                        {t('auth.mfaSetup.enterKeyManually')}
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 break-all font-mono text-sm">
                          {mfaData.secret}
                        </code>
                        <button
                          type="button"
                          onClick={handleCopyManualKey}
                          aria-label={t('auth.mfaSetup.copyManualKey')}
                          className="shrink-0 rounded p-1 hover:bg-muted-foreground/20"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                onClick={() => setStep('verify')}
                disabled={!qrDataUrl || isLoading}
                className="w-full"
              >
                {t('auth.mfaSetup.next')}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'verify' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('auth.mfaSetup.verifyTitle')}</DialogTitle>
              <DialogDescription>
                {t('auth.mfaSetup.verifyDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="flex justify-center">
                <MFACodeInput
                  onComplete={handleVerify}
                  disabled={isLoading}
                  error={!!error}
                />
              </div>
              {isLoading && (
                <div className="flex justify-center">
                  <Spinner />
                </div>
              )}
            </div>
            <DialogFooter className="flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => { setStep('qr'); setError(null); }}
                className="flex-1"
              >
                {t('auth.mfaSetup.back')}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'recovery' && mfaData && (
          <>
            <DialogHeader>
              <DialogTitle>{t('auth.mfaSetup.recoveryTitle')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {t('auth.mfaSetup.recoveryWarningPrefix')}{' '}
                  <strong>{t('auth.mfaSetup.recoveryWarningStrong')}</strong>{' '}
                  {t('auth.mfaSetup.recoveryWarningSuffix')}
                </AlertDescription>
              </Alert>

              {/* Recovery codes grid */}
              <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-4">
                {mfaData.recovery_codes.map((code) => (
                  <code key={code} className="text-center font-mono text-sm">
                    {code}
                  </code>
                ))}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadCodes}
                  className="flex-1"
                >
                  <Download className="me-2 h-4 w-4" />
                  {t('auth.mfaSetup.download')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyAllCodes}
                  className="flex-1"
                >
                  <Copy className="me-2 h-4 w-4" />
                  {t('auth.mfaSetup.copyAll')}
                </Button>
              </div>

              {/* Confirmation checkbox */}
              <div className="flex items-start gap-3">
                <Checkbox
                  id="saved-confirmed"
                  checked={savedConfirmed}
                  onCheckedChange={(checked) => setSavedConfirmed(!!checked)}
                />
                <Label htmlFor="saved-confirmed" className="cursor-pointer text-sm leading-relaxed">
                  {t('auth.mfaSetup.savedConfirm')}
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleDone} disabled={!savedConfirmed} className="w-full">
                {t('auth.mfaSetup.done')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
