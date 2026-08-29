'use client';

import React, { useState } from 'react';
import { ShieldOff, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MFACodeInput } from './mfa-code-input';
import { apiPost } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { showSuccess } from '@/lib/toast';
import { isApiError } from '@/types/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { useT } from '@/components/providers/locale-provider';

interface MFADisableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MFADisableDialog({ open, onOpenChange }: MFADisableDialogProps) {
  const t = useT();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDisable = async (code: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await apiPost(API_ENDPOINTS.USERS_ME_MFA_DISABLE, { code });
      useAuthStore.setState((s) => ({
        user: s.user ? { ...s.user, mfa_enabled: false } : s.user,
      }));
      showSuccess(
        t('auth.mfaDisable.disabledToastTitle'),
        t('auth.mfaDisable.disabledToastDescription'),
      );
      onOpenChange(false);
    } catch (err) {
      setError(
        isApiError(err) ? err.message : t('auth.mfaDisable.invalidCode'),
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <ShieldOff className="h-6 w-6 text-destructive" />
          </div>
          <DialogTitle className="text-center">{t('auth.mfaDisable.title')}</DialogTitle>
          <DialogDescription className="text-center">
            {t('auth.mfaDisable.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {t('auth.mfaDisable.warning')}
            </AlertDescription>
          </Alert>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <p className="text-center text-sm text-muted-foreground">
              {t('auth.mfaDisable.enterCode')}
            </p>
            <div className="flex justify-center">
              <MFACodeInput
                onComplete={handleDisable}
                disabled={isLoading}
                error={!!error}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            className="flex-1"
          >
            {t('auth.mfaDisable.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
