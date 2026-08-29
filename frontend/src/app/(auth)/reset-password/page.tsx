import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthLoadingState } from '@/components/auth/auth-page-primitives';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { getRequestLocaleAttributes } from '@/lib/i18n.server';
import { getMessages } from '@/lib/i18n/messages';

export async function generateMetadata(): Promise<Metadata> {
  const { lang } = await getRequestLocaleAttributes();
  return { title: getMessages(lang).auth.titles.resetPassword };
}

export default async function ResetPasswordPage() {
  const { lang } = await getRequestLocaleAttributes();
  const m = getMessages(lang).auth.reset;
  return (
    <Suspense
      fallback={
        <AuthLoadingState
          label={m.loadingLabel}
          detail={m.loadingDetail}
        />
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
