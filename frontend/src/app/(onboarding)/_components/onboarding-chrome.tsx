'use client';

import type { ReactNode } from 'react';

import { Logo } from '@/components/brand/logo';
import { useT } from '@/components/providers/locale-provider';

import '../_lib/onboarding-i18n';

const WIZARD_STEP_KEYS = [
  { number: 1, key: 'organization' },
  { number: 2, key: 'branding' },
  { number: 3, key: 'team' },
  { number: 4, key: 'suites' },
  { number: 5, key: 'ready' },
] as const;

/**
 * Client visual shell for the tenant onboarding routes. Split out of the server
 * `layout.tsx` (which keeps `metadata`) so the header/footer copy can localize
 * through `useT('onboarding')`.
 */
export function OnboardingChrome({ children }: { children: ReactNode }) {
  const t = useT('onboarding');

  return (
    <div className="auth-clario relative isolate flex min-h-screen flex-col overflow-hidden bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(circle at 16% 12%, hsl(var(--primary) / 0.14), transparent 30%), radial-gradient(circle at 85% 8%, hsl(var(--accent) / 0.16), transparent 28%), radial-gradient(circle at 80% 86%, hsl(var(--primary) / 0.1), transparent 30%), linear-gradient(180deg, hsl(var(--background)) 0%, hsl(var(--secondary)) 52%, hsl(var(--background)) 100%)',
        }}
      />

      <header className="sticky top-0 z-30 border-b border-primary/10 bg-card/[0.82] px-4 py-3 shadow-elevation-1 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Logo variant="wordmark" tone="auto" className="h-6 w-auto" title="Clario360" />
            <p className="truncate text-overline font-medium uppercase tracking-caps-xwide text-primary/70">{t('chrome.eyebrow')}</p>
          </div>

          <nav
            className="hidden min-w-0 items-center justify-end gap-2 lg:flex"
            aria-label={t('chrome.stepsAria')}
          >
            {WIZARD_STEP_KEYS.map((step, idx) => (
              <div key={step.number} className="flex min-w-0 items-center">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/[0.12] bg-background/[0.72] px-3 py-2 shadow-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                    {step.number}
                  </span>
                  <span className="text-[11px] font-medium uppercase tracking-caps text-foreground/[0.62]">
                    {t(`chrome.steps.${step.key}`)}
                  </span>
                </div>
                {idx < WIZARD_STEP_KEYS.length - 1 && (
                  <div className="mx-1 h-px w-6 bg-primary/[0.14] xl:w-9" />
                )}
              </div>
            ))}
          </nav>

          <nav
            className="flex gap-2 overflow-x-auto pb-1 lg:hidden"
            aria-label={t('chrome.stepsAria')}
          >
            {WIZARD_STEP_KEYS.map((step) => (
              <span
                key={step.number}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-primary/[0.12] bg-background/75 px-3 py-1.5 text-[11px] font-medium text-foreground/70"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-overline font-semibold text-primary">
                  {step.number}
                </span>
                {t(`chrome.steps.${step.key}`)}
              </span>
            ))}
          </nav>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto w-full max-w-7xl min-w-0">
          {children}
        </div>
      </main>

      <footer className="px-4 pb-6 text-center text-sm text-foreground/55">
        {t('chrome.needHelp')}{' '}
        <a href="mailto:support@clario360.com" className="font-medium text-primary hover:underline">support@clario360.com</a>
      </footer>
    </div>
  );
}
