'use client';

import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, MailCheck, Mail, Send, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { forgotPasswordSchema, type ForgotPasswordFormData } from '@/lib/validators';
import { useMagicLink } from '@/hooks/use-magic-link';
import { useT } from '@/components/providers/locale-provider';

import { AUTH_INPUT_CLASSNAME, AuthPageIntro } from './auth-page-primitives';

interface MagicLinkFormProps {
  /** Return to the primary (password) sign-in step. */
  onBack: () => void;
  /**
   * Called once a magic link has been dispatched. Lets the parent surface its
   * own confirmation chrome if desired; the form also shows an inline
   * "check your email" state regardless.
   */
  onSuccess?: (email: string) => void;
  /**
   * Invoked when the backend reports the capability is unavailable (404/501).
   * The parent should hide the magic-link affordance entirely.
   */
  onUnavailable?: () => void;
  /** Optional default email (e.g. carried over from the credentials step). */
  defaultEmail?: string;
}

// The magic-link / email-OTP form is a sub-step of the login surface. It mirrors
// the compact styling of login-form.tsx (AUTH_INPUT_CLASSNAME, Mail icon,
// primary Button) rather than the full-page AuthPageIntro layout, since the
// parent supplies the surrounding chrome.
export function MagicLinkForm({
  onBack,
  onSuccess,
  onUnavailable,
  defaultEmail,
}: MagicLinkFormProps) {
  const t = useT();
  const { requestMagicLink, isLoading, isUnavailable, error } = useMagicLink();
  const [sentTo, setSentTo] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: 'onBlur',
    defaultValues: { email: defaultEmail ?? '' },
  });

  useEffect(() => {
    if (!sentTo) {
      setFocus('email');
    }
  }, [setFocus, sentTo]);

  // If the backend signals the feature is unavailable, bubble up so the parent
  // can remove the entry point. Done in an effect to avoid setState-in-render.
  useEffect(() => {
    if (isUnavailable) {
      onUnavailable?.();
    }
  }, [isUnavailable, onUnavailable]);

  const onSubmit = async (data: ForgotPasswordFormData) => {
    const result = await requestMagicLink(data.email);
    if (result.unavailable) {
      // onUnavailable fires via the effect above.
      return;
    }
    if (result.sent) {
      setSentTo(data.email);
      onSuccess?.(data.email);
    }
  };

  // ── Confirmation state ──────────────────────────────────────────────────────

  if (sentTo) {
    return (
      <div className="space-y-5">
        <AuthPageIntro
          badge={t('auth.magicLink.sentBadge')}
          badgeIcon={MailCheck}
          title={t('auth.magicLink.checkEmailTitle')}
          description={
            <>
              {t('auth.magicLink.checkEmailPrefix')}{' '}
              {/* bdi keeps the Latin email address from scrambling the Arabic
                  sentence's bidi run. */}
              <bdi dir="ltr" className="font-semibold text-foreground">
                {sentTo}
              </bdi>
              {t('auth.magicLink.checkEmailSuffix')}
            </>
          }
        />

        <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted px-3.5 py-3 text-[13px] leading-6 text-foreground/70">
          <div className="rounded-2xl bg-primary/12 p-1.5 text-primary shadow-sm">
            <Mail className="h-3.5 w-3.5" />
          </div>
          <p>
            {t('auth.magicLink.didNotGetIt')}
          </p>
        </div>

        <div className="grid gap-2">
          <Button
            type="button"
            onClick={() => setSentTo(null)}
            className="h-12 w-full rounded-2xl text-[15px] font-semibold"
          >
            {t('auth.magicLink.sendAnother')}
            <ArrowRight className="ms-2 h-4 w-4 rtl:-scale-x-100" />
          </Button>
        </div>

        <div className="border-t border-primary/10 pt-3 text-center">
          <button
            type="button"
            className="text-[13px] font-medium text-muted-foreground hover:text-primary hover:underline"
            onClick={onBack}
          >
            {t('auth.login.backToSignIn')}
          </button>
        </div>
      </div>
    );
  }

  // ── Request state ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      <AuthPageIntro
        badge={t('auth.magicLink.passwordlessBadge')}
        badgeIcon={Send}
        title={t('auth.magicLink.requestTitle')}
        description={t('auth.magicLink.requestSubtitle')}
      />

      {error && (
        <Alert
          variant="destructive"
          role="alert"
          aria-live="assertive"
          className="border-error-100 bg-error-50 py-2.5 text-error-700 [&>svg]:text-error-500"
        >
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        role="form"
        aria-label={t('auth.magicLink.formLabel')}
        className="space-y-4 rounded-2xl border border-border bg-foreground/5 p-3.5 sm:p-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="magic-link-email" className="text-[13px] font-semibold text-foreground/88">
            {t('auth.login.workEmail')}
          </Label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 start-0 flex w-10 items-center justify-center text-primary/60">
              <Mail className="h-4 w-4" aria-hidden />
            </span>
            <Input
              id="magic-link-email"
              type="email"
              withIcon="leading"
              // Value-driven direction — see the login email field.
              dir="auto"
              autoComplete="email"
              autoFocus
              aria-describedby={errors.email ? 'magic-link-email-error' : undefined}
              aria-invalid={!!errors.email}
              className={`${AUTH_INPUT_CLASSNAME} h-12 rounded-2xl border border-input bg-background pe-4 placeholder:text-muted-foreground/80 focus-visible:border-primary/60 focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-ring/25`}
              placeholder={t('auth.login.emailPlaceholder')}
              {...register('email')}
            />
          </div>
          {errors.email && (
            <p id="magic-link-email-error" className="text-xs text-destructive" role="alert">
              {errors.email.message}
            </p>
          )}
        </div>

        <Button
          type="submit"
          className="h-12 w-full rounded-2xl text-[15px] font-semibold"
          disabled={isLoading}
          aria-busy={isLoading}
        >
          {isLoading ? (
            <>
              <Spinner size="sm" className="me-2" />
              {t('auth.magicLink.sendingLink')}
            </>
          ) : (
            <>
              {t('auth.magicLink.sendMagicLink')}
              <ArrowRight className="ms-2 h-4 w-4 rtl:-scale-x-100" />
            </>
          )}
        </Button>
      </form>

      <div className="border-t border-primary/10 pt-3 text-center">
        <button
          type="button"
          className="text-[13px] font-medium text-muted-foreground hover:text-primary hover:underline"
          onClick={onBack}
        >
          {t('auth.login.backToSignIn')}
        </button>
      </div>
    </div>
  );
}
