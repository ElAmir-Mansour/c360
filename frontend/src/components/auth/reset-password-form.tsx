'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  TimerReset,
  Workflow,
} from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { apiPost } from '@/lib/api';
import { API_ENDPOINTS, ROUTES } from '@/lib/constants';
import { createResetPasswordSchema, type ResetPasswordFormData } from '@/lib/validators';
import { isApiError } from '@/types/api';
import {
  checkBreachedPassword,
  isBreachResolved,
} from '@/lib/breached-password';
import { useCapsLock, CapsLockWarning } from '@/hooks/use-caps-lock';
import { useLocale } from '@/components/providers/locale-provider';

import {
  AUTH_INPUT_CLASSNAME,
  AuthActionStrip,
  AuthCallout,
  AuthCenteredState,
  AuthFormSurface,
  AuthGuardGrid,
  AuthInsightGrid,
  AuthPageIntro,
  type AuthInsightItem,
} from './auth-page-primitives';
import { PasswordStrengthMeter } from './password-strength-meter';

// Mirrors the password-strength-meter requirements so the breached-password
// check only runs once the strength meter would consider the password viable.
// Complements (does not duplicate) the meter.
function meetsStrengthFloor(password: string): boolean {
  return (
    password.length >= 12 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^a-zA-Z0-9]/.test(password)
  );
}

export function ResetPasswordForm() {
  const { t, locale } = useLocale();
  const resetPasswordSchema = useMemo(() => createResetPasswordSchema(locale), [locale]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? '';

  const resetInsights: AuthInsightItem[] = [
    {
      icon: KeyRound,
      label: t('auth.reset.insightRotationLabel'),
      value: t('auth.reset.insightRotationValue'),
      detail: t('auth.reset.insightRotationDetail'),
    },
    {
      icon: ShieldCheck,
      label: t('auth.reset.insightTokenLabel'),
      value: t('auth.reset.insightTokenValue'),
      detail: t('auth.reset.insightTokenDetail'),
    },
    {
      icon: Workflow,
      label: t('auth.reset.insightReturnLabel'),
      value: t('auth.reset.insightReturnValue'),
      detail: t('auth.reset.insightReturnDetail'),
    },
  ];

  const resetGuards = [
    t('auth.reset.guardValidate'),
    t('auth.reset.guardConfirm'),
    t('auth.reset.guardReturn'),
  ] as const;

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [breachCount, setBreachCount] = useState<number | null>(null);

  const { capsLockOn, handlers: capsLockHandlers } = useCapsLock();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
  });

  const password = watch('password', '');

  // #14 Breached-password — runs only after the strength meter would pass,
  // debounced, and degrades silently when the BFF is unavailable.
  useEffect(() => {
    if (!meetsStrengthFloor(password)) {
      setBreachCount(null);
      return;
    }

    let cancelled = false;
    const handle = setTimeout(() => {
      void checkBreachedPassword(password).then((result) => {
        if (cancelled) return;
        if (isBreachResolved(result) && result.breached) {
          setBreachCount(result.count);
        } else {
          setBreachCount(null);
        }
      });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [password]);

  const onSubmit = async (data: ResetPasswordFormData) => {
    if (!token) {
      setApiError(t('auth.reset.invalidLink'));
      return;
    }
    setApiError(null);
    setIsSubmitting(true);
    try {
      await apiPost(API_ENDPOINTS.AUTH_RESET_PASSWORD, {
        token,
        new_password: data.password,
      });
      setSuccess(true);
      setTimeout(() => router.push(ROUTES.LOGIN), 3000);
    } catch (err) {
      if (isApiError(err)) {
        if (err.code === 'TOKEN_EXPIRED') {
          setApiError(t('auth.reset.linkExpired'));
        } else if (err.code === 'TOKEN_INVALID') {
          setApiError(t('auth.reset.linkInvalid'));
        } else {
          setApiError(err.message ?? t('auth.reset.failed'));
        }
      } else {
        setApiError(t('auth.errors.unexpected'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="space-y-8">
        <AuthPageIntro
          badge={t('auth.reset.missingBadge')}
          badgeIcon={TimerReset}
          title={t('auth.reset.missingTitle')}
          description={t('auth.reset.missingDescription')}
          statusLabel={t('auth.reset.missingStatusLabel')}
          statusValue={t('auth.reset.missingStatusValue')}
        />

        <AuthInsightGrid items={resetInsights} />

        <Alert
          variant="destructive"
          className="border-error-100 bg-error-50 text-error-700 [&>svg]:text-error-500"
        >
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {t('auth.reset.missingAlert')}
          </AlertDescription>
        </Alert>

        <AuthActionStrip
          description={t('auth.reset.missingActionDescription')}
          href={ROUTES.FORGOT_PASSWORD}
          cta={t('auth.reset.requestNewLink')}
        />
      </div>
    );
  }

  if (success) {
    return (
      <div className="space-y-8">
        <AuthPageIntro
          badge={t('auth.reset.successBadge')}
          badgeIcon={CheckCircle}
          title={t('auth.reset.successTitle')}
          description={t('auth.reset.successDescription')}
          statusLabel={t('auth.reset.successStatusLabel')}
          statusValue={t('auth.reset.successStatusValue')}
        />

        <AuthInsightGrid items={resetInsights} />

        <AuthCenteredState
          icon={CheckCircle}
          title={t('auth.reset.successStateTitle')}
          description={t('auth.reset.successStateDescription')}
          secondary={t('auth.reset.successStateSecondary')}
        >
          <Link
            href={ROUTES.LOGIN}
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            {t('auth.reset.signInNow')}
            <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
          </Link>
        </AuthCenteredState>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <AuthPageIntro
        badge={t('auth.reset.badge')}
        badgeIcon={Lock}
        title={t('auth.reset.title')}
        description={t('auth.reset.description')}
        statusLabel={t('auth.reset.statusLabel')}
        statusValue={t('auth.reset.statusValue')}
      />

      <AuthInsightGrid items={resetInsights} />

      {apiError ? (
        <Alert
          variant="destructive"
          role="alert"
          aria-live="assertive"
          className="border-error-100 bg-error-50 text-error-700 [&>svg]:text-error-500"
        >
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{apiError}</AlertDescription>
        </Alert>
      ) : null}

      <AuthFormSurface>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium text-foreground">
              {t('auth.reset.newPassword')}
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                autoFocus
                aria-describedby={errors.password ? 'password-error' : undefined}
                aria-invalid={!!errors.password}
                className={`${AUTH_INPUT_CLASSNAME} rounded-2xl pe-12`}
                {...register('password')}
                {...capsLockHandlers}
              />
              <button
                type="button"
                className="absolute end-4 top-1/2 -translate-y-1/2 text-foreground/45 transition-colors hover:text-foreground"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? t('auth.register.hidePassword') : t('auth.register.showPassword')}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password ? (
              <p id="password-error" className="text-sm text-destructive" role="alert">
                {errors.password.message}
              </p>
            ) : null}
            {/* #11 Caps-lock warning */}
            <CapsLockWarning capsLockOn={capsLockOn} />
            <PasswordStrengthMeter password={password} />
            {/* #14 Breached-password — non-blocking advisory below the meter. */}
            {breachCount !== null ? (
              <p
                className="flex items-start gap-1.5 text-xs text-warning-700 dark:text-warning-300"
                role="status"
                aria-live="polite"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {t('auth.breach.prefix')}
                  {breachCount > 0
                    ? `${t('auth.breach.timesPrefix')}${breachCount.toLocaleString()}${t('auth.breach.timesSuffix')}`
                    : ''}
                  {t('auth.breach.consider')}
                </span>
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm_password" className="text-sm font-medium text-foreground">
              {t('auth.reset.confirmNewPassword')}
            </Label>
            <div className="relative">
              <Input
                id="confirm_password"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                aria-describedby={errors.confirm_password ? 'confirm-error' : undefined}
                aria-invalid={!!errors.confirm_password}
                className={`${AUTH_INPUT_CLASSNAME} rounded-2xl pe-12`}
                {...register('confirm_password')}
                {...capsLockHandlers}
              />
              <button
                type="button"
                className="absolute end-4 top-1/2 -translate-y-1/2 text-foreground/45 transition-colors hover:text-foreground"
                onClick={() => setShowConfirm((prev) => !prev)}
                aria-label={showConfirm ? t('auth.register.hidePassword') : t('auth.register.showPassword')}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.confirm_password ? (
              <p id="confirm-error" className="text-sm text-destructive" role="alert">
                {errors.confirm_password.message}
              </p>
            ) : null}
          </div>

          <AuthCallout icon={ShieldCheck} title={t('auth.reset.calloutTitle')}>
            {t('auth.reset.calloutBody')}
          </AuthCallout>

          <Button
            type="submit"
            className="h-12 w-full rounded-2xl text-base font-semibold shadow-sm"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Spinner size="sm" className="me-2" />
                {t('auth.reset.resetting')}
              </>
            ) : (
              t('auth.reset.resetPassword')
            )}
          </Button>
        </form>

        <AuthGuardGrid items={resetGuards} />
      </AuthFormSurface>

      <AuthActionStrip
        description={t('auth.reset.actionStripDescription')}
        href={ROUTES.FORGOT_PASSWORD}
        cta={t('auth.reset.requestNewLink')}
      />
    </div>
  );
}
