'use client';

import { useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { FormField } from '@/components/ui/form-field';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { PasswordStrengthMeter } from '@/components/auth/password-strength-meter';
import { changePasswordSchema, type ChangePasswordFormData } from '@/lib/validators/settings-validators';
import { apiPut } from '@/lib/api';
import { isApiError } from '@/types/api';
import { showSuccess, showBackendError } from '@/lib/toast';
import { useSettingsT } from '../_lib/settings-i18n';

export function PasswordChangeForm() {
  const t = useSettingsT();
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const methods = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
  });
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
  } = methods;

  const newPassword = watch('new_password') ?? '';

  const onSubmit = async (data: ChangePasswordFormData) => {
    setLoading(true);
    setSuccessMsg(null);
    try {
      await apiPut('/api/v1/users/me/password', {
        current_password: data.current_password,
        new_password: data.new_password,
      });
      showSuccess(t.passwordChangedSuccess);
      setSuccessMsg(t.otherSessionsLoggedOut);
      reset();
    } catch (err) {
      if (isApiError(err)) {
        if (err.status === 401) {
          setError('current_password', { message: t.incorrectCurrentPassword });
        } else if (err.details) {
          Object.entries(err.details).forEach(([field, messages]) => {
            setError(field as keyof ChangePasswordFormData, {
              message: (messages as string[])[0] ?? t.invalidValue,
            });
          });
        } else {
          showBackendError(err);
        }
      } else {
        showBackendError(err, t.failedChangePassword);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.changePassword}</CardTitle>
        <CardDescription>
          {t.changePasswordDesc}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {successMsg && (
          <Alert className="mb-4">
            <AlertDescription className="text-sm">{successMsg}</AlertDescription>
          </Alert>
        )}
        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormErrorSummary
              fieldLabels={{
                current_password: t.currentPassword,
                new_password: t.newPassword,
                confirm_password: t.confirmNewPassword,
              }}
            />
            <FormField name="current_password" label={t.currentPassword} required>
              <Input type="password" {...register('current_password')} disabled={loading} />
            </FormField>

            <FormField name="new_password" label={t.newPassword} required>
              <Input type="password" {...register('new_password')} disabled={loading} />
            </FormField>
            <PasswordStrengthMeter password={newPassword} />

            <FormField name="confirm_password" label={t.confirmNewPassword} required>
              <Input type="password" {...register('confirm_password')} disabled={loading} />
            </FormField>

            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? <><Spinner className="me-2 h-4 w-4" />{t.updating}</> : t.updatePassword}
              </Button>
            </div>
          </form>
        </FormProvider>
      </CardContent>
    </Card>
  );
}
