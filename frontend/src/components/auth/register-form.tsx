'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  ChevronDown,
  Eye,
  EyeOff,
  Globe,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { apiPost } from '@/lib/api';
import { API_ENDPOINTS, ROUTES } from '@/lib/constants';
import { createRegisterSchema, type RegisterFormData } from '@/lib/validators';
import { isApiError } from '@/types/api';
import { cn } from '@/lib/utils';
import {
  checkBreachedPassword,
  isBreachResolved,
} from '@/lib/breached-password';
import { suggestEmail } from '@/lib/email-suggest';
import { useCapsLock, CapsLockWarning } from '@/hooks/use-caps-lock';
import { useLocale } from '@/components/providers/locale-provider';

import { PasswordStrengthMeter } from './password-strength-meter';

const INPUT_CLASSNAME =
  'h-11 rounded-2xl border border-input bg-background ps-10 pe-3 text-[15px] text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring';
const PASSWORD_INPUT_CLASSNAME =
  'h-11 rounded-2xl border border-input bg-background ps-10 pe-10 text-[15px] text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring';
const ICON_CLASSNAME =
  'pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/55';
const LABEL_CLASSNAME = 'text-[13px] font-medium text-foreground';
const PRIMARY_BUTTON_BASE =
  'h-11 rounded-2xl bg-primary text-body-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90';
const PRIMARY_BUTTON_CLASSNAME = cn(PRIMARY_BUTTON_BASE, 'w-full');

type RegisterStep = 'organization' | 'account';

const SELF_SERVE_SUITES = new Set(['cyber', 'data', 'siem', 'datastream', 'acta', 'lex', 'visus']);

// Mirrors the password-strength-meter requirements so the breached-password
// check only runs once the strength meter would consider the password viable.
// Complements (does not duplicate) the meter: the meter validates structure,
// this gate avoids hammering the BFF on every early keystroke.
function meetsStrengthFloor(password: string): boolean {
  return (
    password.length >= 12 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^a-zA-Z0-9]/.test(password)
  );
}

export function RegisterForm() {
  const { t, locale } = useLocale();
  const registerSchema = useMemo(() => createRegisterSchema(locale), [locale]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<RegisterStep>('organization');
  const signupBridgeParams = useMemo(
    () => getSignupBridgeParams(searchParams),
    [searchParams],
  );

  const industries = [
    { value: 'financial', label: t('auth.register.industryFinancial') },
    { value: 'government', label: t('auth.register.industryGovernment') },
    { value: 'healthcare', label: t('auth.register.industryHealthcare') },
    { value: 'technology', label: t('auth.register.industryTechnology') },
    { value: 'energy', label: t('auth.register.industryEnergy') },
    { value: 'telecom', label: t('auth.register.industryTelecom') },
    { value: 'education', label: t('auth.register.industryEducation') },
    { value: 'retail', label: t('auth.register.industryRetail') },
    { value: 'manufacturing', label: t('auth.register.industryManufacturing') },
    { value: 'other', label: t('auth.register.industryOther') },
  ] as const;
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [breachCount, setBreachCount] = useState<number | null>(null);
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);

  const { capsLockOn, handlers: capsLockHandlers } = useCapsLock();

  const {
    register,
    handleSubmit,
    watch,
    trigger,
    setValue,
    setFocus,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    mode: 'onBlur',
    defaultValues: {
      country: 'SA',
      industry: 'financial',
    },
  });

  const password = watch('password', '');
  const email = watch('email', '');

  useEffect(() => {
    if (step === 'organization') {
      setFocus('organization_name');
    } else {
      setFocus('first_name');
    }
  }, [step, setFocus]);

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
          // Resolved-not-breached, or unavailable → hide the warning.
          setBreachCount(null);
        }
      });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [password]);

  const handleNext = async () => {
    const ok = await trigger(['organization_name', 'industry', 'country']);
    if (ok) {
      setStep('account');
    }
  };

  const onSubmit = async (data: RegisterFormData) => {
    setApiError(null);
    setIsSubmitting(true);

    try {
      const response = await apiPost<{
        tenant_id: string;
        email: string;
        message: string;
        verification_ttl_seconds: number;
      }>(API_ENDPOINTS.ONBOARDING_REGISTER, {
        organization_name: data.organization_name,
        admin_email: data.email,
        admin_first_name: data.first_name,
        admin_last_name: data.last_name,
        admin_password: data.password,
        country: data.country.toUpperCase(),
        industry: data.industry,
      });

      const params = new URLSearchParams({
        email: data.email,
        tenantId: response.tenant_id,
        ttl: String(response.verification_ttl_seconds),
      });
      signupBridgeParams.forEach((value, key) => {
        params.set(key, value);
      });
      router.push(`${ROUTES.VERIFY_EMAIL}?${params.toString()}`);
    } catch (err) {
      setApiError(
        isApiError(err) ? err.message : t('auth.register.failed'),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const onFormSubmit = (e: React.FormEvent) => {
    if (step === 'organization') {
      e.preventDefault();
      void handleNext();
      return;
    }
    void handleSubmit(onSubmit)(e);
  };

  return (
    <div className="space-y-5">
      {/* Progress block */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-caps-xwide">
          <span
            className={cn(step === 'organization' ? 'text-primary' : 'text-foreground/50')}
            aria-current={step === 'organization' ? 'step' : undefined}
          >
            {t('auth.register.stepOrganization')}
          </span>
          <ArrowRight className="h-3 w-3 text-foreground/30 rtl:-scale-x-100" />
          <span
            className={cn(step === 'account' ? 'text-primary' : 'text-foreground/40')}
            aria-current={step === 'account' ? 'step' : undefined}
          >
            {t('auth.register.stepAdmin')}
          </span>
        </div>
        <div className="flex gap-1.5">
          <div className="h-1.5 flex-1 rounded-full bg-primary transition-all duration-300" />
          <div
            className={cn(
              'h-1.5 flex-1 rounded-full transition-all duration-300',
              step === 'account' ? 'bg-primary' : 'bg-primary/15',
            )}
          />
        </div>
      </div>

      {/* Header block (per step) */}
      {step === 'organization' ? (
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[0.06] px-2.5 py-0.5 text-overline font-medium uppercase tracking-caps-xwide text-primary">
            <Sparkles className="h-3 w-3 text-primary" />
            {t('auth.register.orgBadge')}
          </div>
          <h1 className="text-h2 font-semibold text-foreground">
            {t('auth.register.orgTitle')}
          </h1>
          <p className="text-sm leading-6 text-foreground/65">
            {t('auth.register.orgSubtitle')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[0.06] px-2.5 py-0.5 text-overline font-medium uppercase tracking-caps-xwide text-primary">
            <ShieldCheck className="h-3 w-3 text-primary" />
            {t('auth.register.adminBadge')}
          </div>
          <h1 className="text-h2 font-semibold text-foreground">
            {t('auth.register.adminTitle')}
          </h1>
          <p className="text-sm leading-6 text-foreground/65">
            {t('auth.register.adminSubtitle')}
          </p>
        </div>
      )}

      {/* Top-level error */}
      {apiError && (
        <Alert
          variant="destructive"
          role="alert"
          aria-live="assertive"
          className="border-error-100 bg-error-50 py-2.5 text-error-700 [&>svg]:text-error-500"
        >
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{apiError}</AlertDescription>
        </Alert>
      )}

      <form
        noValidate
        role="form"
        aria-label={t('auth.register.formLabel')}
        className="space-y-4"
        onSubmit={onFormSubmit}
      >
        {step === 'organization' ? (
          <div
            key={step}
            className="space-y-4 motion-safe:animate-in motion-safe:fade-in-50 ltr:motion-safe:slide-in-from-right-2 rtl:motion-safe:slide-in-from-left-2 motion-safe:duration-300"
          >
            <div className="space-y-1.5">
              <Label htmlFor="organization_name" className={LABEL_CLASSNAME}>
                {t('auth.register.organizationName')}
              </Label>
              <div className="relative">
                <Building2 className={ICON_CLASSNAME} />
                <Input
                  id="organization_name"
                  type="text"
                  autoComplete="organization"
                  autoFocus
                  placeholder={t('auth.register.organizationPlaceholder')}
                  aria-invalid={!!errors.organization_name}
                  aria-describedby={
                    errors.organization_name ? 'organization_name-error' : undefined
                  }
                  className={INPUT_CLASSNAME}
                  {...register('organization_name')}
                />
              </div>
              {errors.organization_name && (
                <p
                  id="organization_name-error"
                  className="text-xs text-destructive"
                  role="alert"
                >
                  {errors.organization_name.message}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="industry" className={LABEL_CLASSNAME}>
                  {t('auth.register.industry')}
                </Label>
                <div className="relative">
                  <Briefcase className={ICON_CLASSNAME} />
                  <select
                    id="industry"
                    aria-invalid={!!errors.industry}
                    aria-describedby={errors.industry ? 'industry-error' : undefined}
                    className="h-11 w-full appearance-none rounded-2xl border border-input bg-background ps-10 pe-9 text-[15px] text-foreground shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 aria-[invalid=true]:border-destructive"
                    {...register('industry')}
                  >
                    {industries.map((industry) => (
                      <option key={industry.value} value={industry.value}>
                        {industry.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" />
                </div>
                {errors.industry && (
                  <p id="industry-error" className="text-xs text-destructive" role="alert">
                    {errors.industry.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="country" className={LABEL_CLASSNAME}>
                  {t('auth.register.countryCode')}
                </Label>
                <div className="relative">
                  <Globe className={ICON_CLASSNAME} />
                  <Input
                    id="country"
                    type="text"
                    maxLength={2}
                    inputMode="text"
                    autoComplete="country"
                    placeholder={t('auth.register.countryPlaceholder')}
                    aria-invalid={!!errors.country}
                    aria-describedby={errors.country ? 'country-error' : undefined}
                    className={cn(INPUT_CLASSNAME, 'uppercase')}
                    {...register('country')}
                  />
                </div>
                {errors.country ? (
                  <p id="country-error" className="text-xs text-destructive" role="alert">
                    {errors.country.message}
                  </p>
                ) : (
                  <p className="text-[11px] text-foreground/45">
                    {t('auth.register.countryHint')}
                  </p>
                )}
              </div>
            </div>

            <Button type="button" className={PRIMARY_BUTTON_CLASSNAME} onClick={() => void handleNext()}>
              {t('auth.register.continue')}
              <ArrowRight className="ms-2 h-4 w-4 rtl:-scale-x-100" />
            </Button>
          </div>
        ) : (
          <div
            key={step}
            className="space-y-4 motion-safe:animate-in motion-safe:fade-in-50 ltr:motion-safe:slide-in-from-right-2 rtl:motion-safe:slide-in-from-left-2 motion-safe:duration-300"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="first_name" className={LABEL_CLASSNAME}>
                  {t('auth.register.firstName')}
                </Label>
                <div className="relative">
                  <User className={ICON_CLASSNAME} />
                  <Input
                    id="first_name"
                    type="text"
                    autoComplete="given-name"
                    placeholder={t('auth.register.firstNamePlaceholder')}
                    aria-invalid={!!errors.first_name}
                    aria-describedby={errors.first_name ? 'first_name-error' : undefined}
                    className={INPUT_CLASSNAME}
                    {...register('first_name')}
                  />
                </div>
                {errors.first_name && (
                  <p id="first_name-error" className="text-xs text-destructive" role="alert">
                    {errors.first_name.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="last_name" className={LABEL_CLASSNAME}>
                  {t('auth.register.lastName')}
                </Label>
                <div className="relative">
                  <User className={ICON_CLASSNAME} />
                  <Input
                    id="last_name"
                    type="text"
                    autoComplete="family-name"
                    placeholder={t('auth.register.lastNamePlaceholder')}
                    aria-invalid={!!errors.last_name}
                    aria-describedby={errors.last_name ? 'last_name-error' : undefined}
                    className={INPUT_CLASSNAME}
                    {...register('last_name')}
                  />
                </div>
                {errors.last_name && (
                  <p id="last_name-error" className="text-xs text-destructive" role="alert">
                    {errors.last_name.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email" className={LABEL_CLASSNAME}>
                {t('auth.register.workEmail')}
              </Label>
              <div className="relative">
                <Mail className={ICON_CLASSNAME} />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder={t('auth.register.emailPlaceholder')}
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                  className={INPUT_CLASSNAME}
                  {...register('email', {
                    onChange: () => {
                      if (emailSuggestion) setEmailSuggestion(null);
                    },
                    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
                      setEmailSuggestion(suggestEmail(e.target.value));
                    },
                  })}
                />
              </div>
              {errors.email && (
                <p id="email-error" className="text-xs text-destructive" role="alert">
                  {errors.email.message}
                </p>
              )}
              {/* #13 Email typo suggestion — inline, dismissible, non-blocking. */}
              {emailSuggestion && emailSuggestion !== email.trim().toLowerCase() && (
                <p className="text-xs text-foreground/65" aria-live="polite">
                  {t('auth.register.didYouMean')}{' '}
                  <button
                    type="button"
                    className="font-semibold text-primary underline-offset-2 hover:underline"
                    onClick={() => {
                      setValue('email', emailSuggestion, {
                        shouldValidate: true,
                        shouldDirty: true,
                      });
                      setEmailSuggestion(null);
                    }}
                  >
                    {emailSuggestion}
                  </button>
                  ?
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className={LABEL_CLASSNAME}>
                {t('auth.register.password')}
              </Label>
              <div className="relative">
                <Lock className={ICON_CLASSNAME} />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder={t('auth.register.passwordPlaceholder')}
                  aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  className={PASSWORD_INPUT_CLASSNAME}
                  {...register('password')}
                  {...capsLockHandlers}
                />
                <button
                  type="button"
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-foreground/45 transition-colors hover:text-primary"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? t('auth.register.hidePassword') : t('auth.register.showPassword')}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && (
                <p id="password-error" className="text-xs text-destructive" role="alert">
                  {errors.password.message}
                </p>
              )}
              {/* #11 Caps-lock warning */}
              <CapsLockWarning capsLockOn={capsLockOn} />
              <PasswordStrengthMeter password={password} />
              {/* #14 Breached-password — non-blocking advisory below the meter. */}
              {breachCount !== null && (
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
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm_password" className={LABEL_CLASSNAME}>
                {t('auth.register.confirmPassword')}
              </Label>
              <div className="relative">
                <Lock className={ICON_CLASSNAME} />
                <Input
                  id="confirm_password"
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder={t('auth.register.confirmPasswordPlaceholder')}
                  aria-invalid={!!errors.confirm_password}
                  aria-describedby={errors.confirm_password ? 'confirm_password-error' : undefined}
                  className={PASSWORD_INPUT_CLASSNAME}
                  {...register('confirm_password')}
                  {...capsLockHandlers}
                />
                <button
                  type="button"
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-foreground/45 transition-colors hover:text-primary"
                  onClick={() => setShowConfirm((prev) => !prev)}
                  aria-label={showConfirm ? t('auth.register.hidePassword') : t('auth.register.showPassword')}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.confirm_password && (
                <p
                  id="confirm_password-error"
                  className="text-xs text-destructive"
                  role="alert"
                >
                  {errors.confirm_password.message}
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => {
                  setApiError(null);
                  setStep('organization');
                }}
                className="h-11 rounded-2xl border-primary/20 px-4 text-[15px] font-medium text-foreground/70 hover:text-primary"
              >
                <ArrowLeft className="me-1.5 h-4 w-4 rtl:-scale-x-100" />
                {t('auth.register.back')}
              </Button>
              <Button
                type="submit"
                className={cn(PRIMARY_BUTTON_BASE, 'flex-1')}
                disabled={isSubmitting}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Spinner size="sm" className="me-2" />
                    {t('auth.register.creating')}
                  </>
                ) : (
                  <>
                    {t('auth.register.createWorkspace')}
                    <ArrowRight className="ms-2 h-4 w-4 rtl:-scale-x-100" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </form>

      {/* Footer cross-link */}
      <div className="flex items-center justify-between border-t border-primary/10 pt-4 text-[13px] text-foreground/65">
        <span>{t('auth.register.haveAccount')}</span>
        <Link
          href={ROUTES.LOGIN}
          className="inline-flex items-center gap-1.5 font-semibold text-primary hover:text-primary hover:underline"
        >
          {t('auth.register.signIn')}
          <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
        </Link>
      </div>
    </div>
  );
}

function getSignupBridgeParams(searchParams: { get(name: string): string | null } | null): URLSearchParams {
  const params = new URLSearchParams();
  if (!searchParams) {
    return params;
  }

  const plan = searchParams.get('plan')?.trim().toLowerCase();
  if (plan === 'trial') {
    params.set('plan', plan);
  }

  const suites = searchParams
    .get('suites')
    ?.split(',')
    .map((suite) => suite.trim().toLowerCase())
    .filter((suite, index, all) => SELF_SERVE_SUITES.has(suite) && all.indexOf(suite) === index);

  if (suites?.length) {
    params.set('suites', suites.join(','));
  }

  return params;
}
