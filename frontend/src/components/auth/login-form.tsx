'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { MFACodeInput } from './mfa-code-input';
import { OAuthProviders } from './oauth-providers';
import { MagicLinkForm } from './magic-link-form';
import { PasskeyButton } from './passkey-button';
import { SsoRedirectNotice } from './sso-redirect-notice';
import { BotChallenge, useBotChallenge } from './bot-challenge';
import { AuthTransition } from './auth-transition';
import { AuthPageIntro } from './auth-page-primitives';
import { createLoginSchema, type LoginFormData } from '@/lib/validators';
import { useAuth } from '@/hooks/use-auth';
import { useCountdown } from '@/hooks/use-countdown';
import { useCapsLock, CapsLockWarning } from '@/hooks/use-caps-lock';
import { useSsoDiscovery } from '@/hooks/use-sso-discovery';
import { useDeviceTrust } from '@/hooks/use-device-trust';
import { suggestEmail } from '@/lib/email-suggest';
import { isPendingEmailVerificationError } from '@/lib/email-verification';
import { safePostAuthRedirect } from '@/lib/safe-redirect';
import { buildOAuthState, withOAuthState } from '@/lib/oauth-state';
import { resolvePostLoginLanding } from '@/lib/lex/post-login-landing';
import { useAuthStore } from '@/stores/auth-store';
import { SUITES, isWatheeqOnlyAccess } from '@/config/navigation';
import { canAccessWith } from '@/lib/permissions';
import { isApiError, type ApiError } from '@/types/api';
import { cn } from '@/lib/utils';
import { useLocale } from '@/components/providers/locale-provider';

type LoginStep = 'credentials' | 'mfa';
type MFAMode = 'totp' | 'recovery';

/**
 * (A3 #2) Extract the lockout/rate-limit window (seconds) from an ApiError's
 * details. The backend writes `details.retry_after` as a NUMBER of seconds
 * (matching the Retry-After header), but the ApiError type declares details as
 * string[] maps — so this accepts number, numeric string, or [numeric string].
 */
function parseRetryAfterSeconds(details: ApiError['details']): number | null {
  const raw = (details as Record<string, unknown> | undefined)?.['retry_after'];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const seconds =
    typeof candidate === 'number'
      ? candidate
      : typeof candidate === 'string'
        ? Number.parseInt(candidate, 10)
        : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

// #8 Remember-me: the shared `loginSchema` only validates email + password, so
// we extend the RHF value shape locally with the (un-validated) remember flag.
// The resolver still only checks email/password; `remember` is a pass-through.
type LoginFormValues = LoginFormData & { remember: boolean };

export function LoginForm() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawRedirect = searchParams?.get('redirect') ?? searchParams?.get('return_to') ?? '/dashboard';
  const redirectTo = safePostAuthRedirect(rawRedirect === '/' ? '/dashboard' : rawRedirect);
  const registeredBanner = searchParams?.get('registered') === 'true';
  // Set by the API client when a token refresh fails mid-session, so the
  // bounce back to /login is explained instead of looking like a silent logout.
  const sessionExpiredNotice = searchParams?.get('reason') === 'session_expired';

  const { login, verifyMFA } = useAuth();
  const { seconds: countdownSeconds, isRunning: isCountingDown, start: startCountdown } =
    useCountdown();
  // #12 Device trust — register the device after a successful login so the
  // device registry is exercised (best-effort, never blocks navigation).
  const { registerDevice } = useDeviceTrust();

  const [step, setStep] = useState<LoginStep>('credentials');
  const [mode, setMode] = useState<'password' | 'magic-link'>('password');
  const [mfaToken, setMfaToken] = useState('');
  const [mfaMode, setMfaMode] = useState<MFAMode>('totp');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Keeps the submit controls disabled after auth succeeds, while the
  // post-login navigation is still in flight — closes the double-submit
  // window that opened when `finally { setIsSubmitting(false) }` ran first.
  const [redirecting, setRedirecting] = useState(false);
  // Live 429 rate-limit: while counting down, the alert interpolates the
  // ticking seconds instead of a frozen snapshot, and clears itself at zero.
  const [rateLimited, setRateLimited] = useState(false);
  // (A3 #2) Honest ACCOUNT_LOCKED state — distinct from a plain rate-limit so
  // the user is told the account is locked, with the backend's real window
  // (details.retry_after) ticking down in minutes-aware format.
  const [lockedOut, setLockedOut] = useState(false);
  const [mfaShake, setMfaShake] = useState(false);

  // #5 Passkey availability — hidden when the platform/endpoint is unavailable.
  const [passkeyHidden, setPasskeyHidden] = useState(false);
  // #6 Magic-link availability — if the backend reports it unavailable, snap
  // back to the password form and hide the toggle.
  const [magicLinkHidden, setMagicLinkHidden] = useState(false);
  // #13 Email typo suggestion ("Did you mean ...?").
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);
  // #10 Bot challenge gating + pass state.
  const { required: botChallengeRequired, markFailure: markBotFailure, reset: resetBotChallenge } =
    useBotChallenge();
  const [botChallengePassed, setBotChallengePassed] = useState(false);
  // #10 — capture the token emitted by the challenge so it can be forwarded to
  // the backend (as `bot_challenge_token`) via the login() opts.
  const [botChallengeToken, setBotChallengeToken] = useState<string | null>(null);

  // #11 Caps Lock detection on the password field.
  const { capsLockOn, handlers: capsLockHandlers } = useCapsLock();
  // #7 SSO discovery by email domain.
  const { discover: discoverSso, discovery: ssoDiscovery, isDiscovering: isDiscoveringSso } =
    useSsoDiscovery();

  // Build the resolver schema against the *active* locale so validation copy
  // matches the UI language (the module-level `loginSchema` is frozen to the
  // default locale, which surfaced Arabic errors on an English form).
  const loginSchema = useMemo(() => createLoginSchema(locale), [locale]);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    watch,
    formState: { errors },
    setFocus,
  } = useForm<LoginFormValues>({
    // The resolver validates the LoginFormData subset (email/password); the
    // extra `remember` field is carried through untouched.
    resolver: zodResolver(loginSchema) as never,
    // Validate on submit (then re-validate as the user fixes fields) so a
    // "required" error never appears before the user has tried to sign in —
    // e.g. when focus simply leaves the auto-focused, still-empty email field.
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: { email: '', password: '', remember: false },
  });

  const passwordField = register('password');
  const emailField = register('email');
  // (A3 #1) Live remember-me value — forwarded to the passkey flow so "keep me
  // signed in" also applies to passkey logins (persistent vs session cookies).
  const rememberValue = watch('remember');
  const emailValue = watch('email');
  const passwordValue = watch('password');
  const credentialsReady = emailValue.trim().length > 0 && passwordValue.length > 0;

  // Dismiss the rate-limit / lockout alert the moment the countdown reaches
  // zero — the button re-enables at the same instant, so they can't contradict.
  useEffect(() => {
    if ((rateLimited || lockedOut) && !isCountingDown) {
      setRateLimited(false);
      setLockedOut(false);
    }
  }, [rateLimited, lockedOut, isCountingDown]);

  // (A3 #2) Minutes-aware countdown formatting for the lockout alert, e.g.
  // "14 min 32 sec" / "١٤ دقيقة و٣٢ ثانية"-style copy from the i18n catalog.
  const formatLockoutRemaining = (totalSeconds: number): string => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
      return t('auth.lockout.remainingMinutes')
        .replace('{minutes}', String(minutes))
        .replace('{seconds}', String(seconds));
    }
    return t('auth.lockout.remainingSeconds').replace('{seconds}', String(seconds));
  };

  const triggerMFAShake = () => {
    setMfaShake(true);
    setTimeout(() => setMfaShake(false), 600);
  };

  const navigateAfterAuth = (target: string) => {
    // Auth has succeeded — keep the controls disabled until this component
    // unmounts with the route change (prevents a second submit mid-redirect).
    setRedirecting(true);
    // #12 — auth has succeeded by the time we navigate, so exercise the device
    // registry. Best-effort: registerDevice() never throws, and we still ignore
    // any rejection so a registry hiccup can never block navigation.
    void Promise.resolve()
      .then(() => registerDevice())
      .catch(() => undefined);
    // #9 — never forward a caller-supplied target verbatim. Auth pages are also
    // rejected here so a stale `/login?redirect=/login` link cannot keep a user
    // on the login screen after successful authentication.
    const safeTarget = safePostAuthRedirect(target);
    // Watheeq-only users (lex is their ONLY accessible suite) land on their
    // sidebarless /lex home instead of the all-suites dashboard. Read FRESH
    // store state via getState() — auth just succeeded, so the render-captured
    // `hasPermission` from the store selector may still be the pre-login one.
    const accessible = SUITES.filter((suite) =>
      canAccessWith(useAuthStore.getState().hasPermission, suite.permission),
    );
    const isWatheeqOnly = isWatheeqOnlyAccess(accessible);
    // Persona-aware landing (§6): when the user is heading to the bare default
    // dashboard (no explicit redirect), upgrade to their legal persona landing
    // if they hold a legal role — or their /lex home if Watheeq-only. Non-legal
    // users — and any failure — fall back to `safeTarget` unchanged.
    // resolvePostLoginLanding never rejects; the .catch() is belt-and-braces.
    void resolvePostLoginLanding({ redirectTo: safeTarget, isWatheeqOnly })
      .then((destination) => router.push(destination))
      .catch(() => router.push(safeTarget));
  };

  // #13 — evaluate a "Did you mean ...?" suggestion when the email field blurs.
  const handleEmailBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    void emailField.onBlur(event);
    const value = event.target.value;
    const suggestion = suggestEmail(value);
    setEmailSuggestion(suggestion && suggestion !== value.trim().toLowerCase() ? suggestion : null);
  };

  // #7 — run SSO discovery as the email changes; clear suggestion noise too.
  const handleEmailChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    void emailField.onChange(event);
    if (emailSuggestion) setEmailSuggestion(null);
    discoverSso(event.target.value);
  };

  const applyEmailSuggestion = () => {
    if (!emailSuggestion) return;
    setValue('email', emailSuggestion, { shouldValidate: true, shouldDirty: true });
    discoverSso(emailSuggestion);
    setEmailSuggestion(null);
    setFocus('password');
  };

  const onSubmit = async (data: LoginFormValues) => {
    setApiError(null);
    setRateLimited(false);
    setLockedOut(false);
    setIsSubmitting(true);
    try {
      const result = await login(data.email, data.password, {
        remember: Boolean(data.remember),
        // #10 — forward the bot-challenge token (when one was emitted) so the
        // backend can verify it (sent as `bot_challenge_token`).
        ...(botChallengeToken ? { botToken: botChallengeToken } : {}),
      });
      if (result.requiresMFA && result.mfaToken) {
        setMfaToken(result.mfaToken);
        setStep('mfa');
      } else {
        resetBotChallenge();
        navigateAfterAuth(redirectTo);
      }
    } catch (err) {
      if (isApiError(err)) {
        // #10 — feed the bot-challenge gate; a 429 forces the challenge on.
        markBotFailure(err.status);
        setBotChallengePassed(false);
        setBotChallengeToken(null);
        if (isPendingEmailVerificationError(err)) {
          setApiError(t('auth.errors.emailVerificationPending'));
        } else if (err.code === 'ACCOUNT_LOCKED') {
          // (A3 #2) The backend answers 429 + ACCOUNT_LOCKED with the real
          // window in details.retry_after (and a Retry-After header), so this
          // branch MUST come before the generic 429 one — a lockout is an
          // honest "account locked, back in N minutes", not a rate-limit.
          // Fallback mirrors the iam service's 15-minute lockout TTL.
          const seconds = parseRetryAfterSeconds(err.details) ?? 15 * 60;
          startCountdown(seconds);
          // The alert renders the LIVE countdown (see lockedOut below) with
          // minutes-aware formatting; it clears itself at zero.
          setLockedOut(true);
        } else if (err.status === 429) {
          const seconds = parseRetryAfterSeconds(err.details) ?? 60;
          startCountdown(seconds);
          // The alert renders the LIVE countdown (see rateLimited below) so the
          // message can never contradict the re-enabled button at zero.
          setRateLimited(true);
        } else if (err.status === 401) {
          setApiError(t('auth.errors.invalidCredentials'));
        } else if (err.code === 'ACCOUNT_SUSPENDED') {
          setApiError(t('auth.errors.accountSuspended'));
        } else if (err.status === 0) {
          setApiError(t('auth.errors.cannotConnect'));
        } else {
          setApiError(err.message ?? t('auth.errors.unexpected'));
        }
      } else {
        markBotFailure();
        setBotChallengePassed(false);
        setBotChallengeToken(null);
        setApiError(t('auth.errors.unexpected'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // #5 — passkey success reuses the same post-auth navigation as password login.
  const handlePasskeySuccess = (result: { requiresMFA: boolean; mfaToken?: string }) => {
    if (result.requiresMFA && result.mfaToken) {
      setMfaToken(result.mfaToken);
      setStep('mfa');
      return;
    }
    resetBotChallenge();
    navigateAfterAuth(redirectTo);
  };

  const handleSsoOption = () => {
    if (ssoDiscovery) {
      // Same state payload as the OAuth buttons: sanitized post-login target +
      // trusted-device id, so SSO logins keep deep links and device trust.
      window.location.href = withOAuthState(
        ssoDiscovery.authorizeUrl,
        buildOAuthState(ssoDiscovery.provider, redirectTo),
      );
      return;
    }

    setFocus('email');
  };

  const handleMFAComplete = async (code: string) => {
    setMfaError(null);
    setIsSubmitting(true);
    try {
      await verifyMFA(mfaToken, code);
      resetBotChallenge();
      navigateAfterAuth(redirectTo);
    } catch (err) {
      triggerMFAShake();
      if (isApiError(err)) {
        if (err.code === 'TOKEN_EXPIRED') {
          // The user lands back on the credentials step, which renders
          // apiError — mfaError would unmount with the MFA view and the
          // explanation would be lost.
          setApiError(t('auth.errors.sessionExpired'));
          setMfaError(null);
          setMfaToken('');
          setStep('credentials');
        } else {
          setMfaError(t('auth.errors.invalidCode'));
        }
      } else {
        setMfaError(t('auth.errors.invalidCode'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryCode.trim()) return;
    await handleMFAComplete(recoveryCode.trim());
  };

  // #10 — when a challenge is required, submit stays blocked until it passes.
  const submitBlockedByBot = botChallengeRequired && !botChallengePassed;

  // ── Credentials step ──────────────────────────────────────────────────────

  const credentialsView =
    mode === 'magic-link' && !magicLinkHidden ? (
      <MagicLinkForm
        onBack={() => setMode('password')}
        defaultEmail={getValues('email')}
        onUnavailable={() => {
          setMagicLinkHidden(true);
          setMode('password');
        }}
      />
    ) : (
      <div className="space-y-5">
        {/* Shared intro primitive — same badge/headline/description scale as
            forgot-password / reset-password, so the H1 no longer jumps size
            when navigating between auth pages. */}
        <AuthPageIntro
          badge={t('auth.login.secureBadge')}
          badgeIcon={ShieldCheck}
          showBadge={false}
          title={t('auth.login.title')}
          description={t('auth.login.subtitle')}
          className="space-y-2"
          titleClassName="text-[30px] font-bold leading-[1.2] tracking-normal"
          descriptionClassName="text-[14px] leading-[1.2]"
        />

        {registeredBanner && (
          <Alert
            variant="success"
            className="border-primary/30 bg-primary/10 py-2.5 text-primary [&>svg]:text-primary"
          >
            <AlertDescription>{t('auth.login.registeredBanner')}</AlertDescription>
          </Alert>
        )}

        {/* Informational (non-destructive) explanation for the mid-session
            bounce the API client performs on refresh failure. */}
        {sessionExpiredNotice && !apiError && !rateLimited && !lockedOut && (
          <Alert
            role="status"
            className="border-brand-gold/50 bg-brand-gold/15 py-2.5 text-brand-gold-dark [&>svg]:text-brand-gold-dark"
          >
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{t('auth.errors.sessionExpired')}</AlertDescription>
          </Alert>
        )}

        {(apiError || rateLimited || lockedOut) && (
          <Alert
            variant="destructive"
            role="alert"
            aria-live="assertive"
            className="border-error-100 bg-error-50 py-2.5 text-error-700 [&>svg]:text-error-500"
          >
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {lockedOut
                ? // (A3 #2) Honest lockout message with a live, minutes-aware
                  // countdown of the backend-supplied window.
                  t('auth.lockout.message').replace(
                    '{time}',
                    formatLockoutRemaining(countdownSeconds),
                  )
                : rateLimited
                  ? t('auth.errors.tooManyAttempts').replace(
                      '{seconds}',
                      String(countdownSeconds),
                    )
                  : apiError}
            </AlertDescription>
          </Alert>
        )}

        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          role="form"
          aria-label={t('auth.login.formLabel')}
          className="!mt-8 space-y-[15px]"
        >
          <div className="space-y-2">
            <Label htmlFor="email" className="block text-[14px] font-medium leading-[1.2] text-foreground">
              {t('auth.login.workEmail')}
            </Label>
            <div dir="ltr" className="relative">
              <span className="pointer-events-none absolute inset-y-0 start-0 flex w-10 items-center justify-center text-muted-foreground">
                <Mail className="h-4 w-4" aria-hidden />
              </span>
              <Input
                id="email"
                type="email"
                withIcon="leading"
                // dir="auto": the VALUE's own script decides direction — an
                // Arabic-typed value renders RTL, a Latin email renders as a
                // clean LTR run — while the Arabic placeholder (first strong
                // char Arabic) keeps the empty field right-aligned on ar.
                dir="auto"
                autoComplete="email"
                aria-describedby={errors.email ? 'email-error' : undefined}
                aria-invalid={!!errors.email}
                className="h-12 rounded-lg border border-primary/20 bg-white pe-4 text-[14px] text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-ring/25 dark:bg-card dark:focus-visible:bg-card"
                placeholder={t('auth.login.emailPlaceholder')}
                {...emailField}
                onChange={handleEmailChange}
                onBlur={handleEmailBlur}
              />
            </div>
            {errors.email && (
              <p id="email-error" className="text-xs text-destructive" role="alert">
                {errors.email.message}
              </p>
            )}
            {/* #13 Email typo suggestion — dismissible, fills the field on click. */}
            {emailSuggestion && !errors.email && (
              <div
                className="flex items-center justify-between gap-2 rounded-lg border border-primary/15 bg-primary/[0.05] px-2.5 py-1.5 text-[12px] text-foreground/70"
                role="status"
              >
                <span className="flex items-center gap-1.5">
                  <Wand2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                  {t('auth.login.didYouMean')}{' '}
                  <button
                    type="button"
                    onClick={applyEmailSuggestion}
                    className="font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    {/* bdi pins the Latin email's bidi run so it can't scramble
                        the surrounding Arabic sentence. */}
                    <bdi dir="ltr">{emailSuggestion}</bdi>
                  </button>
                  {t('auth.login.didYouMeanSuffix')}
                </span>
                <button
                  type="button"
                  onClick={() => setEmailSuggestion(null)}
                  className="-m-1.5 shrink-0 rounded p-1.5 text-muted-foreground hover:text-foreground"
                  aria-label={t('auth.login.dismissSuggestion')}
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* #7 SSO discovery CTA — surfaces above the password field. */}
          <SsoRedirectNotice discovery={ssoDiscovery} />

          <div className="space-y-2">
            <Label
              htmlFor="password"
              className="block text-[14px] font-medium leading-[1.2] text-foreground"
            >
              {t('auth.login.password')}
            </Label>
            <div dir="ltr" className="relative">
              <span className="pointer-events-none absolute inset-y-0 start-0 flex w-10 items-center justify-center text-muted-foreground">
                <Lock className="h-4 w-4" aria-hidden />
              </span>
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                withIcon="both"
                dir="auto"
                autoComplete="current-password"
                aria-describedby={errors.password ? 'password-error' : undefined}
                aria-invalid={!!errors.password}
                className="h-12 rounded-lg border border-primary/20 bg-white text-[14px] text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-ring/25 dark:bg-card dark:focus-visible:bg-card"
                placeholder={t('auth.login.passwordPlaceholder')}
                {...passwordField}
                onKeyUp={(e) => {
                  capsLockHandlers.onKeyUp(e);
                }}
                onKeyDown={(e) => {
                  capsLockHandlers.onKeyDown(e);
                }}
              />
              <button
                type="button"
                className="absolute end-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-primary/[0.08] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/[0.35]"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? t('auth.login.hidePassword') : t('auth.login.showPassword')}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {/* #11 Caps Lock warning — renders only while CapsLock is engaged. */}
            <CapsLockWarning capsLockOn={capsLockOn} />
            {errors.password && (
              <p id="password-error" className="text-xs text-destructive" role="alert">
                {errors.password.message}
              </p>
            )}
          </div>

          <div dir="ltr" className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {/* #8 Remember-me — bound to react-hook-form, forwarded to login(). */}
              <Controller
                control={control}
                name="remember"
                render={({ field }) => (
                  <Checkbox
                    id="remember"
                    checked={Boolean(field.value)}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                    onBlur={field.onBlur}
                    className="h-4 w-4 rounded border-primary/[0.35] focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=checked]:border-primary data-[state=checked]:bg-primary"
                  />
                )}
              />
              <Label
                htmlFor="remember"
                dir="auto"
                className="cursor-pointer truncate text-[13px] font-normal text-muted-foreground"
              >
                {t('auth.login.keepSignedIn')}
              </Label>
            </div>
            <Link
              href="/forgot-password"
              dir="auto"
              className="shrink-0 text-[13px] font-semibold text-brand-accent-800 hover:text-brand-accent-900 hover:underline dark:text-brand-accent-300"
            >
              {t('auth.login.forgotPassword')}
            </Link>
          </div>

          {/* #10 Bot challenge — required after repeated failures or a 429. */}
          {submitBlockedByBot && (
            <BotChallenge
              disabled={isSubmitting}
              label={t('auth.bot.slideLabel')}
              successLabel={t('auth.bot.slideSuccess')}
              onPass={(token) => {
                // #10 — keep the submit-gate open AND capture the emitted token
                // so onSubmit can forward it to the backend.
                setBotChallengePassed(true);
                setBotChallengeToken(token);
              }}
              onReset={() => {
                setBotChallengePassed(false);
                setBotChallengeToken(null);
              }}
            />
          )}

          <Button
            type="submit"
            className="!mt-5 h-12 w-full rounded-lg bg-brand-accent-500 text-[16px] font-bold text-foreground shadow-none hover:bg-brand-accent-600 focus-visible:ring-4 focus-visible:ring-brand-accent-500/30 disabled:bg-brand-accent-500 disabled:text-white disabled:opacity-30"
            disabled={
              !credentialsReady ||
              isSubmitting ||
              redirecting ||
              isCountingDown ||
              submitBlockedByBot
            }
            aria-busy={isSubmitting || redirecting}
          >
            {isSubmitting || redirecting ? (
              <>
                <Spinner size="sm" className="me-2" />
                {t('auth.login.signingIn')}
              </>
            ) : (
              t('auth.login.signIn')
            )}
          </Button>
        </form>

        {/* Alternative sign-in methods stay visually secondary to password auth.
            Only the decorative rules are aria-hidden — the label itself stays in
            the accessibility tree so AT users get the grouping context. */}
        {(!passkeyHidden || !magicLinkHidden || !ssoDiscovery || isDiscoveringSso) && (
          <div className="flex items-center gap-4">
            <span aria-hidden className="h-px flex-1 bg-foreground/10" />
            <span className="text-[12px] font-normal leading-[1.2] text-muted-foreground">
              {t('auth.security.moreOptions')}
            </span>
            <span aria-hidden className="h-px flex-1 bg-foreground/10" />
          </div>
        )}

        {(!passkeyHidden || !magicLinkHidden || !ssoDiscovery || isDiscoveringSso) && (
          <div dir="ltr" className="flex gap-2.5">
            {/* #5 Passkey — hidden when WebAuthn / the endpoint is unavailable. */}
            {!passkeyHidden && (
              <PasskeyButton
                density="compact"
                className="min-w-0 flex-1"
                email={getValues('email') || undefined}
                // (A3 #1) Remember-me applies to passkey logins too — the flag
                // rides through the store to the BFF verify cookie decision.
                remember={Boolean(rememberValue)}
                label={t('auth.login.methodPasskey')}
                onSuccess={handlePasskeySuccess}
                onUnavailable={() => setPasskeyHidden(true)}
              />
            )}

            {/* #6 Magic-link toggle — swaps to the passwordless form. */}
            {!magicLinkHidden && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setMode('magic-link')}
                className="group flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-primary/15 bg-white px-2 text-[14px] font-medium text-muted-foreground shadow-none transition-all hover:border-primary/[0.35] hover:bg-primary/[0.06] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/[0.35] dark:bg-card"
              >
                <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="text-center leading-4">{t('auth.login.methodMagicLink')}</span>
              </Button>
            )}

            {!ssoDiscovery && (
              <Button
                type="button"
                variant="outline"
                onClick={handleSsoOption}
                disabled={isDiscoveringSso}
                aria-label={t('auth.security.ssoTitle')}
                className="group flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-primary/15 bg-white px-2 text-[14px] font-medium text-muted-foreground shadow-none transition-all hover:border-primary/[0.35] hover:bg-primary/[0.06] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/[0.35] disabled:cursor-wait disabled:opacity-70 dark:bg-card"
              >
                {isDiscoveringSso ? (
                  <Spinner size="sm" className="shrink-0" />
                ) : (
                  <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
                <span className="text-center leading-4">{t('auth.login.methodSso')}</span>
              </Button>
            )}
          </div>
        )}

        <OAuthProviders />

        <div className="!mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-primary/10 pt-4 text-[13px] text-muted-foreground">
          <span>{t('auth.login.noAccount')}</span>
          <Link
            href="/register"
            className="inline-flex items-center gap-1.5 font-semibold text-primary hover:text-primary hover:underline"
          >
            {t('auth.login.createOne')}
            <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
          </Link>
        </div>
      </div>
    );

  // ── MFA step ──────────────────────────────────────────────────────────────

  const mfaView = (
    <div className="space-y-5">
      <AuthPageIntro
        badge={t('auth.login.mfaBadge')}
        badgeIcon={ShieldCheck}
        title={t('auth.login.mfaTitle')}
        description={t('auth.login.mfaSubtitle')}
      />

      {mfaError && (
        <Alert
          id="mfa-error"
          variant="destructive"
          role="alert"
          aria-live="assertive"
          className="border-error-100 bg-error-50 py-2.5 text-error-700 [&>svg]:text-error-500"
        >
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{mfaError}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-border bg-muted p-1">
        <button
          type="button"
          // (A3 #4) Segmented toggle: expose the selected state to AT.
          aria-pressed={mfaMode === 'totp'}
          className={cn(
            'rounded-2xl px-3 py-2.5 text-[13px] font-semibold transition-colors',
            mfaMode === 'totp'
              ? 'bg-primary text-white shadow-sm'
              : 'text-muted-foreground hover:bg-foreground/5 hover:text-primary',
          )}
          onClick={() => {
            setMfaMode('totp');
            setMfaError(null);
          }}
        >
          {t('auth.login.mfaTabAuthenticator')}
        </button>
        <button
          type="button"
          aria-pressed={mfaMode === 'recovery'}
          className={cn(
            'rounded-2xl px-3 py-2.5 text-[13px] font-semibold transition-colors',
            mfaMode === 'recovery'
              ? 'bg-primary text-white shadow-sm'
              : 'text-muted-foreground hover:bg-foreground/5 hover:text-primary',
          )}
          onClick={() => {
            setMfaMode('recovery');
            setMfaError(null);
          }}
        >
          {t('auth.login.mfaTabRecovery')}
        </button>
      </div>

      {mfaMode === 'totp' ? (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted-foreground">
            {t('auth.login.mfaEnterCode')}
          </p>
          <div
            className={cn(
              'flex justify-center transition-transform',
              mfaShake && 'motion-safe:animate-[shake_0.5s_ease-in-out]',
            )}
          >
            <MFACodeInput
              onComplete={handleMFAComplete}
              disabled={isSubmitting || redirecting}
              error={!!mfaError}
              className="justify-center"
            />
          </div>
          <p className="text-center text-xs text-muted-foreground">
            {t('auth.login.mfaCodeRefresh')}
          </p>
          {isSubmitting && (
            <div className="flex justify-center">
              <Spinner />
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={handleRecoverySubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="recovery-code" className="text-[13px] font-medium text-foreground">
              {t('auth.login.recoveryCodeLabel')}
            </Label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 start-0 flex w-10 items-center justify-center text-primary/60">
                <Lock className="h-4 w-4" aria-hidden />
              </span>
              <Input
                id="recovery-code"
                type="text"
                withIcon="leading"
                autoComplete="off"
                autoFocus
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                placeholder={t('auth.login.recoveryCodePlaceholder')}
                aria-describedby={mfaError ? 'mfa-error' : undefined}
                className="h-12 rounded-2xl border border-input bg-background pe-4 text-[15px] text-foreground placeholder:text-muted-foreground/80 focus-visible:border-primary/60 focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-ring/25"
              />
            </div>
          </div>
          <Button
            type="submit"
            className="h-12 w-full rounded-2xl text-[15px] font-semibold focus-visible:ring-4 focus-visible:ring-action/30"
            disabled={isSubmitting || redirecting || !recoveryCode.trim()}
            aria-busy={isSubmitting || redirecting}
          >
            {isSubmitting || redirecting ? <Spinner size="sm" className="me-2" /> : null}
            {t('auth.login.verifyRecoveryCode')}
          </Button>
        </form>
      )}

      <div className="border-t border-primary/10 pt-3 text-center">
        <button
          type="button"
          className="text-[13px] font-medium text-muted-foreground hover:text-primary hover:underline"
          onClick={() => {
            setStep('credentials');
            setMfaToken('');
            setMfaError(null);
          }}
        >
          {t('auth.login.backToSignIn')}
        </button>
      </div>
    </div>
  );

  // #16 Transitions — cross-fade/slide between the credentials and mfa steps.
  return (
    <AuthTransition stepKey={step}>
      {step === 'credentials' ? credentialsView : mfaView}
    </AuthTransition>
  );
}
