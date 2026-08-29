import type { Metadata } from 'next';
import { AuthRuntime } from '@/components/providers/auth-runtime';

import { OnboardingChrome } from './_components/onboarding-chrome';

export const metadata: Metadata = {
  title: 'Setup — Clario360',
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthRuntime>
      <OnboardingChrome>{children}</OnboardingChrome>
    </AuthRuntime>
  );
}
