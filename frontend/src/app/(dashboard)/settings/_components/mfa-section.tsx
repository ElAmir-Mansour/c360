'use client';

import { useState } from 'react';
import { Shield, ShieldOff, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { MFASetupDialog } from '@/components/auth/mfa-setup-dialog';
import { MFADisableDialog } from '@/components/auth/mfa-disable-dialog';
import { useAuth } from '@/hooks/use-auth';
import { useSettingsT } from '../_lib/settings-i18n';

export function MFASection() {
  const t = useSettingsT();
  const { user, tenant, refreshSession } = useAuth();
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);

  if (!user) return null;

  const mfaRequired = tenant?.settings.mfa_required ?? false;

  const handleMFAChange = async () => {
    await refreshSession();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.twoFactorAuth}</CardTitle>
        <CardDescription>
          {t.twoFactorAuthDesc}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mfaRequired && !user.mfa_enabled && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {t.mfaRequiredWarning}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {user.mfa_enabled ? (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 dark:bg-primary/30">
                <Shield className="h-5 w-5 text-primary dark:text-primary" />
              </div>
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                <ShieldOff className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div>
              <p className="text-sm font-medium">
                {user.mfa_enabled ? t.twoFAEnabled : t.twoFANotEnabled}
              </p>
              <Badge
                variant={user.mfa_enabled ? 'default' : 'outline'}
                className="text-xs mt-0.5"
              >
                {user.mfa_enabled ? t.enabled : t.disabled}
              </Badge>
            </div>
          </div>

          <div className="flex gap-2">
            {user.mfa_enabled ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDisableOpen(true)}
              >
                {t.disable2FA}
              </Button>
            ) : (
              <Button size="sm" onClick={() => setSetupOpen(true)}>
                {t.enable2FA}
              </Button>
            )}
          </div>
        </div>
      </CardContent>

      <MFASetupDialog
        open={setupOpen}
        onOpenChange={(o) => {
          setSetupOpen(o);
          if (!o) handleMFAChange();
        }}
      />

      <MFADisableDialog
        open={disableOpen}
        onOpenChange={(o) => {
          setDisableOpen(o);
          if (!o) handleMFAChange();
        }}
      />
    </Card>
  );
}
