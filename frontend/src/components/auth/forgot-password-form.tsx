'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, KeyRound, Mail, ShieldCheck, TimerReset, Workflow } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { apiPost } from '@/lib/api';
import { API_ENDPOINTS, ROUTES } from '@/lib/constants';
import { createForgotPasswordSchema, type ForgotPasswordFormData } from '@/lib/validators';
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

export function ForgotPasswordForm() {
  const { t, locale } = useLocale();
  const forgotPasswordSchema = useMemo(() => createForgotPasswordSchema(locale), [locale]);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const recoveryInsights: AuthInsightItem[] = [
    {
      icon: KeyRound,
      label: t('auth.forgot.insightRecoveryPathLabel'),
      value: t('auth.forgot.insightRecoveryPathValue'),
      detail: t('auth.forgot.insightRecoveryPathDetail'),
    },
    {
      icon: ShieldCheck,
      label: t('auth.forgot.insightLookupLabel'),
      value: t('auth.forgot.insightLookupValue'),
      detail: t('auth.forgot.insightLookupDetail'),
    },
    {
      icon: Workflow,
      label: t('auth.forgot.insightNextLabel'),
      value: t('auth.forgot.insightNextValue'),
      detail: t('auth.forgot.insightNextDetail'),
    },
  ];

  const recoveryGuards = [
    t('auth.forgot.guardEnumeration'),
    t('auth.forgot.guardTimeBound'),
    t('auth.forgot.guardReturn'),
  ] as const;

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setIsSubmitting(true);
    try {
      await apiPost(API_ENDPOINTS.AUTH_FORGOT_PASSWORD, { email: data.email });
    } catch {
      // Always show success to prevent email enumeration
    } finally {
      setIsSubmitting(false);
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div className="space-y-8">
        <AuthPageIntro
          badge={t('auth.forgot.sentBadge')}
          badgeIcon={TimerReset}
          title={t('auth.forgot.sentTitle')}
          description={t('auth.forgot.sentDescription')}
          statusLabel={t('auth.forgot.sentStatusLabel')}
          statusValue={t('auth.forgot.sentStatusValue')}
        />

        <AuthInsightGrid items={recoveryInsights} />

        <AuthCenteredState
          icon={Mail}
          title={t('auth.forgot.sentMessageTitle')}
          description={
            <>
              {t('auth.forgot.sentMessageBodyPrefix')}{' '}
              <span className="font-semibold text-foreground">{getValues('email')}</span>
              {t('auth.forgot.sentMessageBodySuffix')}
            </>
          }
          secondary={t('auth.forgot.sentSecondary')}
        >
          <Link
            href={ROUTES.LOGIN}
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('auth.forgot.backToSignIn')}
          </Link>
        </AuthCenteredState>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <AuthPageIntro
        badge={t('auth.forgot.badge')}
        badgeIcon={KeyRound}
        title={t('auth.forgot.title')}
        description={t('auth.forgot.description')}
        statusLabel={t('auth.forgot.statusLabel')}
        statusValue={t('auth.forgot.statusValue')}
      />

      <AuthInsightGrid items={recoveryInsights} />

      <AuthFormSurface>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium text-foreground">
              {t('auth.forgot.workEmail')}
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              aria-describedby={errors.email ? 'email-error' : undefined}
              aria-invalid={!!errors.email}
              className={`${AUTH_INPUT_CLASSNAME} rounded-2xl`}
              {...register('email')}
            />
            {errors.email ? (
              <p id="email-error" className="text-sm text-destructive" role="alert">
                {errors.email.message}
              </p>
            ) : null}
          </div>

          <AuthCallout icon={ShieldCheck} title={t('auth.forgot.calloutTitle')}>
            {t('auth.forgot.calloutBody')}
          </AuthCallout>

          <Button
            type="submit"
            className="h-12 w-full rounded-2xl text-base font-semibold shadow-sm"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Spinner size="sm" className="mr-2" />
                {t('auth.forgot.sending')}
              </>
            ) : (
              t('auth.forgot.sendResetLink')
            )}
          </Button>
        </form>

        <AuthGuardGrid items={recoveryGuards} />
      </AuthFormSurface>

      <AuthActionStrip
        description={t('auth.forgot.actionStripDescription')}
        href={ROUTES.LOGIN}
        cta={t('auth.forgot.actionStripCta')}
      />
    </div>
  );
}
