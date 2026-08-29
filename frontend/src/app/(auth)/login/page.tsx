import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthFormSkeleton } from '@/components/auth/auth-form-skeleton';
import { LoginForm } from '@/components/auth/login-form';
import { getRequestLocaleAttributes } from '@/lib/i18n.server';
import { getMessages } from '@/lib/i18n/messages';

export async function generateMetadata(): Promise<Metadata> {
  const { lang } = await getRequestLocaleAttributes();
  return { title: getMessages(lang).auth.titles.signIn };
}

export default async function LoginPage() {
  const { lang } = await getRequestLocaleAttributes();
  return (
    <Suspense
      fallback={
        <AuthFormSkeleton loadingLabel={getMessages(lang).auth.loadingForm} />
      }
    >
      <LoginForm />
    </Suspense>
  );
}
