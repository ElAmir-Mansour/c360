import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { getRequestLocaleAttributes } from '@/lib/i18n.server';
import { getMessages } from '@/lib/i18n/messages';

export async function generateMetadata(): Promise<Metadata> {
  const { lang } = await getRequestLocaleAttributes();
  return { title: getMessages(lang).auth.titles.forgotPassword };
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
