'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AlertCircle,
  BadgeCheck,
  Building2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Quote,
  UserPlus,
  Workflow,
} from 'lucide-react';

import {
  AUTH_INPUT_CLASSNAME,
  AuthActionStrip,
  AuthCallout,
  AuthFormSurface,
  AuthGuardGrid,
  AuthInsightGrid,
  AuthLoadingState,
  AuthPageIntro,
  type AuthInsightItem,
} from '@/components/auth/auth-page-primitives';
import { PasswordStrengthMeter } from '@/components/auth/password-strength-meter';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setAccessToken } from '@/lib/auth';
import { apiGet, apiPost } from '@/lib/api';
import { API_ENDPOINTS, ROUTES } from '@/lib/constants';
import { isApiError } from '@/types/api';
import { useAuthStore } from '@/stores/auth-store';
import { useT } from '@/components/providers/locale-provider';

const acceptSchema = z
  .object({
    first_name: z.string().min(1, 'First name is required').max(100),
    last_name: z.string().min(1, 'Last name is required').max(100),
    password: z
      .string()
      .min(12, 'Password must be at least 12 characters')
      .max(128, 'Password must be at most 128 characters'),
    confirm_password: z.string(),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

type AcceptFormData = z.infer<typeof acceptSchema>;

interface InviteDetails {
  invitation_id: string;
  tenant_id: string;
  email: string;
  role_name: string;
  organization_name: string;
  inviter_name: string;
  expires_at: string;
  message?: string;
}

function InviteForm() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? '';

  const inviteInsights: AuthInsightItem[] = [
    {
      icon: UserPlus,
      label: t('auth.invite.insightSourceLabel'),
      value: t('auth.invite.insightSourceValue'),
      detail: t('auth.invite.insightSourceDetail'),
    },
    {
      icon: BadgeCheck,
      label: t('auth.invite.insightRoleLabel'),
      value: t('auth.invite.insightRoleValue'),
      detail: t('auth.invite.insightRoleDetail'),
    },
    {
      icon: Workflow,
      label: t('auth.invite.insightLandingLabel'),
      value: t('auth.invite.insightLandingValue'),
      detail: t('auth.invite.insightLandingDetail'),
    },
  ];

  const inviteGuards = [
    t('auth.invite.guardValidity'),
    t('auth.invite.guardScope'),
    t('auth.invite.guardSession'),
  ] as const;

  const [details, setDetails] = useState<InviteDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const refreshSession = useAuthStore((state) => state.refreshSession);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AcceptFormData>({
    resolver: zodResolver(acceptSchema),
    mode: 'onBlur',
  });

  const password = watch('password', '');

  useEffect(() => {
    if (!token) {
      setLoadError(t('auth.invite.noToken'));
      setLoadingDetails(false);
      return;
    }

    const load = async () => {
      try {
        const data = await apiGet<InviteDetails>(
          `${API_ENDPOINTS.ONBOARDING_INVITATIONS_VALIDATE}?token=${encodeURIComponent(token)}`,
        );
        setDetails(data);
      } catch (err) {
        if (isApiError(err)) {
          if (err.status === 401 || err.status === 410) {
            setLoadError(t('auth.invite.expiredOrInvalid'));
          } else {
            setLoadError(err.message || t('auth.invite.loadFailed'));
          }
        } else {
          setLoadError(t('auth.invite.loadFailedRetry'));
        }
      } finally {
        setLoadingDetails(false);
      }
    };

    void load();
  }, [token]);

  const onSubmit = async (data: AcceptFormData) => {
    setApiError(null);
    try {
      const resp = await apiPost<{
        access_token: string;
        refresh_token: string;
        tenant_id: string;
        message: string;
      }>(API_ENDPOINTS.ONBOARDING_INVITATIONS_ACCEPT, {
        token,
        first_name: data.first_name,
        last_name: data.last_name,
        password: data.password,
      });

      setAccessToken(resp.access_token);

      await fetch(API_ENDPOINTS.BFF_SESSION, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: resp.access_token,
          refresh_token: resp.refresh_token,
        }),
      });

      try {
        await refreshSession();
      } catch {
        // Best effort only
      }

      router.push(ROUTES.DASHBOARD);
    } catch (err) {
      setApiError(
        isApiError(err) ? err.message : t('auth.invite.acceptFailed'),
      );
    }
  };

  if (loadingDetails) {
    return (
      <div className="space-y-8">
        <AuthPageIntro
          badge={t('auth.invite.loadingBadge')}
          badgeIcon={UserPlus}
          title={t('auth.invite.loadingTitle')}
          description={t('auth.invite.loadingDescription')}
          statusLabel={t('auth.invite.loadingStatusLabel')}
          statusValue={t('auth.invite.loadingStatusValue')}
        />
        <AuthInsightGrid items={inviteInsights} />
        <AuthLoadingState
          label={t('auth.invite.loadingStateLabel')}
          detail={t('auth.invite.loadingStateDetail')}
        />
      </div>
    );
  }

  if (loadError || !details) {
    return (
      <div className="space-y-8">
        <AuthPageIntro
          badge={t('auth.invite.loadingBadge')}
          badgeIcon={AlertCircle}
          title={t('auth.invite.unavailableTitle')}
          description={t('auth.invite.unavailableDescription')}
          statusLabel={t('auth.invite.loadingStatusLabel')}
          statusValue={t('auth.invite.unavailableStatusValue')}
        />

        <AuthInsightGrid items={inviteInsights} />

        <Alert
          variant="destructive"
          className="border-error-100 bg-error-50 text-error-700 [&>svg]:text-error-500"
        >
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{loadError ?? t('auth.invite.invalidInvitation')}</AlertDescription>
        </Alert>

        <AuthActionStrip
          description={t('auth.invite.unavailableActionDescription')}
          href={ROUTES.LOGIN}
          cta={t('auth.invite.backToSignIn')}
        />
      </div>
    );
  }

  const expiresDate = new Date(details.expires_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="space-y-8">
      <AuthPageIntro
        badge={t('auth.invite.badge')}
        badgeIcon={UserPlus}
        title={t('auth.invite.title')}
        description={t('auth.invite.description')}
        statusLabel={t('auth.invite.assignedRoleLabel')}
        statusValue={details.role_name}
      />

      <AuthInsightGrid items={inviteInsights} />

      <AuthCallout icon={Building2} title={t('auth.invite.summaryTitle')}>
        <div className="space-y-1">
          <p>
            <span className="font-semibold text-foreground">{details.inviter_name}</span>{' '}
            {t('auth.invite.invitedYouToJoin')}{' '}
            <span className="font-semibold text-foreground">{details.organization_name}</span>.
          </p>
          <p>
            {t('auth.invite.tiedToPrefix')}{' '}
            <span className="font-semibold text-foreground">{details.email}</span>{' '}
            {t('auth.invite.expiresOnPrefix')}{' '}
            <span className="font-semibold text-foreground">{expiresDate}</span>.
          </p>
        </div>
      </AuthCallout>

      {details.message ? (
        <AuthCallout icon={Quote} title={t('auth.invite.inviterNoteTitle')} tone="warning">
          &ldquo;{details.message}&rdquo;
        </AuthCallout>
      ) : null}

      {apiError ? (
        <Alert
          variant="destructive"
          role="alert"
          className="border-error-100 bg-error-50 text-error-700 [&>svg]:text-error-500"
        >
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{apiError}</AlertDescription>
        </Alert>
      ) : null}

      <AuthFormSurface>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="first_name" className="text-sm font-medium text-foreground">
                {t('auth.invite.firstName')}
              </Label>
              <Input
                id="first_name"
                type="text"
                autoComplete="given-name"
                aria-invalid={!!errors.first_name}
                className={AUTH_INPUT_CLASSNAME}
                {...register('first_name')}
              />
              {errors.first_name ? (
                <p className="text-sm text-destructive">{errors.first_name.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name" className="text-sm font-medium text-foreground">
                {t('auth.invite.lastName')}
              </Label>
              <Input
                id="last_name"
                type="text"
                autoComplete="family-name"
                aria-invalid={!!errors.last_name}
                className={AUTH_INPUT_CLASSNAME}
                {...register('last_name')}
              />
              {errors.last_name ? (
                <p className="text-sm text-destructive">{errors.last_name.message}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium text-foreground">
              {t('auth.invite.password')}
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                aria-invalid={!!errors.password}
                className={`${AUTH_INPUT_CLASSNAME} pe-12`}
                {...register('password')}
              />
              <button
                type="button"
                className="absolute end-4 top-1/2 -translate-y-1/2 text-foreground/45 transition-colors hover:text-foreground"
                onClick={() => setShowPassword((show) => !show)}
                aria-label={showPassword ? t('auth.invite.hidePassword') : t('auth.invite.showPassword')}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password ? (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            ) : null}
            <PasswordStrengthMeter password={password} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm_password" className="text-sm font-medium text-foreground">
              {t('auth.invite.confirmPassword')}
            </Label>
            <div className="relative">
              <Input
                id="confirm_password"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                aria-invalid={!!errors.confirm_password}
                className={`${AUTH_INPUT_CLASSNAME} pe-12`}
                {...register('confirm_password')}
              />
              <button
                type="button"
                className="absolute end-4 top-1/2 -translate-y-1/2 text-foreground/45 transition-colors hover:text-foreground"
                onClick={() => setShowConfirm((show) => !show)}
                aria-label={showConfirm ? t('auth.invite.hidePassword') : t('auth.invite.showPassword')}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.confirm_password ? (
              <p className="text-sm text-destructive">{errors.confirm_password.message}</p>
            ) : null}
          </div>

          <AuthCallout icon={Mail} title={t('auth.invite.routingTitle')}>
            {t('auth.invite.routingBody')}
          </AuthCallout>

          <Button
            type="submit"
            className="h-12 w-full rounded-2xl text-base font-semibold shadow-sm"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {t('auth.invite.creatingAccount')}
              </>
            ) : (
              t('auth.invite.acceptInvitation')
            )}
          </Button>
        </form>

        <AuthGuardGrid items={inviteGuards} />
      </AuthFormSurface>

      <AuthActionStrip
        description={t('auth.invite.actionStripDescription')}
        href={ROUTES.LOGIN}
        cta={t('auth.invite.backToSignIn')}
      />
    </div>
  );
}

function InviteFallback() {
  const t = useT();
  return (
    <AuthLoadingState
      label={t('auth.invite.pageLoadingLabel')}
      detail={t('auth.invite.pageLoadingDetail')}
    />
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<InviteFallback />}>
      <InviteForm />
    </Suspense>
  );
}
