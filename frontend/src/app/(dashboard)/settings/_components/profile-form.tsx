'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Lock, MailWarning, RotateCcw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { FormField } from '@/components/ui/form-field';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { AvatarUpload } from './avatar-upload';
import { profileFormSchema, type ProfileFormData } from '@/lib/validators/settings-validators';
import { useBackendErrors } from '@/hooks/use-backend-errors';
import { showSuccess, showBackendError } from '@/lib/toast';
import { useAuth } from '@/hooks/use-auth';
import {
  getEmailVerificationUrl,
  needsEmailVerification,
  requestEmailVerificationCode,
} from '@/lib/email-verification';
import { useSettingsT } from '../_lib/settings-i18n';

export function ProfileForm() {
  const t = useSettingsT();
  const { user, tenant, updateProfile, isLoading } = useAuth();
  const applyBackendErrors = useBackendErrors<ProfileFormData>();
  const [verificationState, setVerificationState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const methods = useForm<ProfileFormData>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      first_name: user?.first_name ?? '',
      last_name: user?.last_name ?? '',
    },
  });
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { isDirty },
  } = methods;

  if (!user) return null;

  const tenantId = user.tenant_id ?? tenant?.id ?? null;
  const verificationPending = needsEmailVerification(user);
  const verificationUrl = getEmailVerificationUrl({ email: user.email, tenantId });
  const verifiedAt = user.email_verified_at
    ? new Date(user.email_verified_at).toLocaleDateString()
    : null;

  const handleResendVerification = async () => {
    setVerificationState('sending');
    try {
      await requestEmailVerificationCode({ email: user.email, tenantId });
      setVerificationState('sent');
    } catch {
      setVerificationState('error');
    }
  };

  // updateProfile calls PUT /api/v1/users/me and updates the Zustand user state.
  // Do NOT call apiPut separately — that would be a double write.
  const onSubmit = async (data: ProfileFormData) => {
    try {
      await updateProfile(data);
      showSuccess(t.profileUpdated);
    } catch (err) {
      // Map any 422 field errors onto the form; the FormErrorSummary links each
      // message to its control. Fall back to a toast for general failures.
      const { summary } = applyBackendErrors(err, setError, setFocus);
      if (summary) showBackendError(err, t.failedUpdateProfile);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.profileInformation}</CardTitle>
        <CardDescription>{t.profileInformationDesc}</CardDescription>
      </CardHeader>
      <CardContent>
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormErrorSummary />
            <AvatarUpload />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField name="first_name" label={t.firstName} showSuccess>
                <Input {...register('first_name')} disabled={isLoading} />
              </FormField>
              <FormField name="last_name" label={t.lastName} showSuccess>
                <Input {...register('last_name')} disabled={isLoading} />
              </FormField>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">{t.email}</Label>
              <div className="relative">
                <Input id="email" value={user.email} disabled className="pe-8" />
                <Lock className="absolute end-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">
                {t.emailChangeNote}
              </p>
            </div>

            <div
              className="rounded-xl border border-border/70 bg-muted/30 p-4"
              aria-label={t.emailVerificationStatus}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-primary ring-1 ring-inset ring-border">
                    {verificationPending ? (
                      <MailWarning className="h-4 w-4 text-warning-600" aria-hidden />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-success-600" aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{t.emailVerificationStatus}</p>
                      <Badge variant={verificationPending ? 'warning' : 'success'} className="text-overline">
                        {verificationPending ? t.emailVerificationPending : t.emailVerified}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {verificationPending
                        ? t.emailVerificationPendingDesc
                        : verifiedAt
                          ? t.emailVerifiedOn(verifiedAt)
                          : t.emailVerified}
                    </p>
                    {verificationState === 'sent' ? (
                      <p className="mt-2 text-xs font-medium text-success-700 dark:text-success-300">
                        {t.verificationCodeSent}
                      </p>
                    ) : null}
                    {verificationState === 'error' ? (
                      <p className="mt-2 text-xs font-medium text-destructive">
                        {t.verificationCodeSendFailed}
                      </p>
                    ) : null}
                  </div>
                </div>

                {verificationPending ? (
                  <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                    <Button asChild size="sm">
                      <Link href={verificationUrl}>{t.verifyEmail}</Link>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleResendVerification()}
                      disabled={verificationState === 'sending'}
                    >
                      {verificationState === 'sending' ? (
                        <Spinner className="me-2 h-4 w-4" />
                      ) : (
                        <RotateCcw className="me-2 h-4 w-4" aria-hidden />
                      )}
                      {verificationState === 'sending'
                        ? t.sendingVerificationCode
                        : t.resendVerificationCode}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={isLoading || !isDirty}>
                {isLoading ? <><Spinner className="me-2 h-4 w-4" />{t.saving}</> : t.saveChanges}
              </Button>
            </div>
          </form>
        </FormProvider>
      </CardContent>
    </Card>
  );
}
