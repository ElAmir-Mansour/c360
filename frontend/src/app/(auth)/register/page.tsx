import { Suspense } from 'react';
import type { Metadata } from 'next';
import { RegisterForm } from '@/components/auth/register-form';
import { Spinner } from '@/components/ui/spinner';
import { getRequestLocaleAttributes } from '@/lib/i18n.server';
import { getMessages } from '@/lib/i18n/messages';

export async function generateMetadata(): Promise<Metadata> {
  const { lang } = await getRequestLocaleAttributes();
  return { title: getMessages(lang).auth.titles.register };
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-8"><Spinner /></div>}>
      <RegisterForm />
    </Suspense>
  );
}
