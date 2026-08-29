'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  Mail,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Workflow,
} from 'lucide-react';

import {
  AuthCallout,
  AuthFormSurface,
  AuthGuardGrid,
  AuthInsightGrid,
  AuthLoadingState,
  AuthPageIntro,
  type AuthInsightItem,
} from '@/components/auth/auth-page-primitives';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { setAccessToken } from '@/lib/auth';
import { apiPost } from '@/lib/api';
import { API_ENDPOINTS, ROUTES } from '@/lib/constants';
import { isApiError } from '@/types/api';
import { useAuthStore } from '@/stores/auth-store';
import { useT } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import {
  DEFAULT_PLAN_KEY,
  saveDraft,
  type WizardDraft,
} from '@/app/(onboarding)/setup/_components/shared';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;
const SELF_SERVE_SUITES = new Set(['cyber', 'data', 'siem', 'datastream', 'acta', 'lex', 'visus']);

function VerifyInsightTiles({ items }: { items: AuthInsightItem[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
      {items.map(({ icon: Icon, label, value, detail }) => (
        <article
          key={`${label}-${value}`}
          className="rounded-xl border border-primary/[0.12] bg-card/[0.82] p-4 shadow-elevation-3 backdrop-blur"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-overline font-semibold uppercase tracking-caps-wide text-primary/70">
              {label}
            </p>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08] text-primary">
              <Icon className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-3 text-base font-semibold tracking-tight text-foreground">{value}</p>
          <p className="mt-1.5 text-[13px] leading-6 text-foreground/60">{detail}</p>
        </article>
      ))}
    </div>
  );
}

function VerifyGuardList({ items }: { items: readonly string[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
      {items.map((item) => (
        <div
          key={item}
          className="flex items-start gap-2 rounded-xl border border-primary/[0.10] bg-background/[0.68] px-3 py-2.5 text-[12px] leading-5 text-foreground/[0.65]"
        >
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function VerifyEmailForm() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const isOnboardingFlow = pathname === '/verify';

  const verifyInsights: AuthInsightItem[] = [
    {
      icon: Mail,
      label: t('auth.verify.insightProofLabel'),
      value: t('auth.verify.insightProofValue'),
      detail: t('auth.verify.insightProofDetail'),
    },
    {
      icon: ShieldCheck,
      label: t('auth.verify.insightSessionLabel'),
      value: t('auth.verify.insightSessionValue'),
      detail: t('auth.verify.insightSessionDetail'),
    },
    {
      icon: Workflow,
      label: t('auth.verify.insightNextLabel'),
      value: t('auth.verify.insightNextValue'),
      detail: t('auth.verify.insightNextDetail'),
    },
  ];

  const verifyGuards = [
    t('auth.verify.guardExpires'),
    t('auth.verify.guardThrottle'),
    t('auth.verify.guardSession'),
  ] as const;
  const searchParams = useSearchParams();
  const email = searchParams?.get('email') ?? '';
  const verificationTTL = Number(searchParams?.get('ttl') ?? '600');

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [expiresInSeconds, setExpiresInSeconds] = useState(
    Number.isFinite(verificationTTL) && verificationTTL > 0 ? verificationTTL : 600,
  );
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const refreshSession = useAuthStore((s) => s.refreshSession);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (expiresInSeconds <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setExpiresInSeconds((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [expiresInSeconds]);

  useEffect(() => {
    if (resendCooldown <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setResendCooldown((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  const handleChange = (idx: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[idx] = digit;
    setOtp(next);
    if (digit && idx < OTP_LENGTH - 1) {
      inputRefs.current[idx + 1]?.focus();
    }
    if (digit && idx === OTP_LENGTH - 1 && next.every((entry) => entry !== '')) {
      void submitOtp(next.join(''));
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (text.length === 0) return;
    const next = [...otp];
    for (let index = 0; index < text.length; index += 1) {
      next[index] = text[index];
    }
    setOtp(next);
    const lastFilledIdx = Math.min(text.length - 1, OTP_LENGTH - 1);
    inputRefs.current[lastFilledIdx]?.focus();
    if (next.every((entry) => entry !== '')) {
      void submitOtp(next.join(''));
    }
  };

  const submitOtp = async (code: string) => {
    if (!email) {
      setApiError(t('auth.verify.emailMissing'));
      return;
    }
    setApiError(null);
    setIsSubmitting(true);
    try {
      const resp = await apiPost<{
        access_token: string;
        refresh_token: string;
        tenant_id: string;
        message: string;
      }>(API_ENDPOINTS.ONBOARDING_VERIFY_EMAIL, { email, otp: code });

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

      const signupDraft = getSignupWizardDraft(searchParams);
      if (signupDraft) {
        saveDraft(signupDraft);
      }

      const setupParams = new URLSearchParams({ step: '1' });
      if (signupDraft?.plan_key) {
        setupParams.set('plan', signupDraft.plan_key);
      }
      if (signupDraft?.suites?.length) {
        setupParams.set('suites', signupDraft.suites.join(','));
      }
      router.push(`${ROUTES.SETUP}?${setupParams.toString()}`);
    } catch (err) {
      setApiError(isApiError(err) ? err.message : t('auth.verify.failed'));
      setOtp(Array(OTP_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.join('');
    if (code.length < OTP_LENGTH) {
      setApiError(t('auth.errors.enterAllDigits'));
      return;
    }
    void submitOtp(code);
  };

  const handleResend = async () => {
    if (!email) return;
    setApiError(null);
    setSuccessMessage(null);
    setIsResending(true);
    try {
      await apiPost(API_ENDPOINTS.ONBOARDING_RESEND_OTP, { email });
      setSuccessMessage(t('auth.verify.newCodeSent'));
      setExpiresInSeconds(
        Number.isFinite(verificationTTL) && verificationTTL > 0 ? verificationTTL : 600,
      );
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setOtp(Array(OTP_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
    } catch (err) {
      setApiError(isApiError(err) ? err.message : t('auth.verify.resendFailed'));
    } finally {
      setIsResending(false);
    }
  };

  const countdown = `${Math.floor(expiresInSeconds / 60)
    .toString()
    .padStart(2, '0')}:${(expiresInSeconds % 60).toString().padStart(2, '0')}`;
  const otpCode = otp.join('');

  const alerts = (
    <>
      {apiError ? (
        <Alert
          variant="destructive"
          role="alert"
          className="border-error-100 bg-error-50 text-error-700 shadow-sm [&>svg]:text-error-500"
        >
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{apiError}</AlertDescription>
        </Alert>
      ) : null}

      {successMessage ? (
        <Alert
          role="status"
          className="border-primary/30 bg-primary/10 text-primary shadow-sm [&>svg]:text-primary"
        >
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );

  const otpInputs = (
    <div
      className={cn(
        'mt-6 grid grid-cols-6 justify-center gap-2',
        isOnboardingFlow ? 'mx-auto max-w-[420px]' : 'mx-auto max-w-[344px]',
      )}
    >
      {otp.map((digit, idx) => (
        <input
          key={idx}
          ref={(el) => {
            inputRefs.current[idx] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="\d"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(idx, e.target.value)}
          onKeyDown={(e) => handleKeyDown(idx, e)}
          onPaste={idx === 0 ? handlePaste : undefined}
          aria-label={t('auth.verify.digitLabel')
            .replace('{index}', String(idx + 1))
            .replace('{total}', String(OTP_LENGTH))}
          className={cn(
            'auth-otp-input min-w-0 rounded-xl border border-primary/[0.16] bg-background text-center font-semibold shadow-sm transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/25 disabled:opacity-50',
            isOnboardingFlow ? 'h-14 text-xl' : 'h-12 text-lg',
          )}
        />
      ))}
    </div>
  );

  const verificationForm = (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <fieldset disabled={isSubmitting} className="space-y-4">
        <legend className="sr-only">{t('auth.verify.codeLegend')}</legend>
        <div
          className={cn(
            'border border-primary/[0.12] bg-card/[0.96] p-5 text-center shadow-elevation-4',
            isOnboardingFlow ? 'rounded-2xl sm:p-6' : 'rounded-xl',
          )}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:text-start">
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/[0.08] text-primary ring-1 ring-inset ring-primary/[0.12]">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold tracking-tight text-foreground">
                  {t('auth.verify.codeLegend')}
                </p>
                <p className="mt-1 text-sm leading-6 text-foreground/[0.62]">
                  {t('auth.verify.sentCodePrefix')}{' '}
                  {email ? (
                    <span className="font-semibold text-foreground">{email}</span>
                  ) : (
                    t('auth.verify.yourEmailAddress')
                  )}
                  .
                </p>
              </div>
            </div>

            <div className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-primary/[0.14] bg-primary/[0.08] px-3 py-1.5 text-xs font-semibold text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {countdown}
            </div>
          </div>

          {otpInputs}
        </div>
      </fieldset>

      <Button
        type="submit"
        className={cn(
          'w-full rounded-xl text-base font-semibold',
          isOnboardingFlow ? 'h-12' : 'h-11',
        )}
        disabled={isSubmitting || otpCode.length < OTP_LENGTH}
        aria-busy={isSubmitting}
      >
        {isSubmitting ? (
          <>
            <Spinner size="sm" className="me-2" />
            {t('auth.verify.verifying')}
          </>
        ) : (
          t('auth.verify.verifyEmail')
        )}
      </Button>
    </form>
  );

  const resendControl = (
    <div className="rounded-xl border border-primary/[0.12] bg-card/[0.82] p-4 shadow-sm backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-primary ring-1 ring-inset ring-primary/[0.10]">
            <TimerReset className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">{t('auth.verify.didNotReceive')}</p>
            <p className="mt-1 text-sm leading-6 text-foreground/55">
              {t('auth.verify.didNotReceiveBody')}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleResend}
          disabled={isResending || resendCooldown > 0}
          className="shrink-0 gap-2 rounded-xl border-primary/[0.14] bg-card px-4"
        >
          {isResending ? <Spinner size="sm" /> : <RotateCcw className="h-4 w-4" />}
          {resendCooldown > 0
            ? `${t('auth.verify.resendInPrefix')} ${resendCooldown}s`
            : t('auth.verify.resendCode')}
        </Button>
      </div>
    </div>
  );

  if (isOnboardingFlow) {
    return (
      <div className="mx-auto grid w-full max-w-7xl items-start gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.78fr)] xl:gap-10">
        <section className="min-w-0 space-y-6 pt-1">
          <div className="max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/[0.14] bg-card/[0.72] px-3 py-1 text-[11px] font-semibold uppercase tracking-caps-wide text-primary shadow-sm backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              {t('auth.verify.badge')}
            </div>
            <div className="space-y-3">
              <h1 className="max-w-2xl text-h1 font-semibold text-foreground">
                {t('auth.verify.title')}
              </h1>
              <p className="max-w-2xl text-base leading-7 text-foreground/[0.65]">
                {t('auth.verify.description')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/[0.16] bg-primary/[0.08] px-3 py-1.5 text-xs font-semibold text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {t('auth.verify.statusLabel')}: {t('auth.verify.statusValuePrefix')} {countdown}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/[0.10] bg-card/[0.72] px-3 py-1.5 text-xs font-medium text-foreground/[0.65]">
                <LockKeyhole className="h-3.5 w-3.5 text-primary" />
                {email || t('auth.verify.yourEmailAddress')}
              </span>
            </div>
          </div>

          <VerifyInsightTiles items={verifyInsights} />
          <VerifyGuardList items={verifyGuards} />
        </section>

        <section className="min-w-0 space-y-4 lg:sticky lg:top-28">
          {alerts}
          <AuthFormSurface className="w-full">
            {verificationForm}

            <AuthCallout
              icon={ShieldCheck}
              title={t('auth.verify.calloutTitle')}
              className="rounded-xl border-primary/[0.12] bg-background/[0.68]"
            >
              {t('auth.verify.calloutBody')}
            </AuthCallout>

            {resendControl}
          </AuthFormSurface>
        </section>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-7">
      <div className="max-w-3xl">
        <AuthPageIntro
          badge={t('auth.verify.badge')}
          badgeIcon={Sparkles}
          title={t('auth.verify.title')}
          description={t('auth.verify.description')}
          statusLabel={t('auth.verify.statusLabel')}
          statusValue={`${t('auth.verify.statusValuePrefix')} ${countdown}`}
        />
      </div>

      <AuthInsightGrid items={verifyInsights} />

      {alerts}

      <AuthFormSurface className="mx-auto w-full max-w-3xl">
        {verificationForm}

        <AuthCallout icon={TimerReset} title={t('auth.verify.calloutTitle')}>
          {t('auth.verify.calloutBody')}
        </AuthCallout>

        {resendControl}

        <AuthGuardGrid items={verifyGuards} />
      </AuthFormSurface>
    </div>
  );
}

function VerifyEmailFallback() {
  const t = useT();
  return (
    <AuthLoadingState
      label={t('auth.verify.loadingLabel')}
      detail={t('auth.verify.loadingDetail')}
    />
  );
}

export function getSignupWizardDraft(
  params: { get(name: string): string | null } | null,
): WizardDraft | null {
  if (!params) {
    return null;
  }

  const draft: WizardDraft = {};
  const plan = params.get('plan')?.trim().toLowerCase();
  if (plan === DEFAULT_PLAN_KEY) {
    draft.plan_key = DEFAULT_PLAN_KEY;
  }

  const suites = params
    .get('suites')
    ?.split(',')
    .map((suite) => suite.trim().toLowerCase())
    .filter((suite, index, all) => SELF_SERVE_SUITES.has(suite) && all.indexOf(suite) === index);
  if (suites?.length) {
    draft.suites = suites;
  }

  return Object.keys(draft).length > 0 ? draft : null;
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailFallback />}>
      <VerifyEmailForm />
    </Suspense>
  );
}
