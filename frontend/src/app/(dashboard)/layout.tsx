'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { MobileSidebar } from '@/components/layout/mobile-sidebar';
import { MobileQuickNav } from '@/components/layout/mobile-quick-nav';
import { CommandPalette } from '@/components/layout/command-palette';
import { ConnectionBanner } from '@/components/layout/connection-banner';
import { EmailVerificationReminder } from '@/components/layout/email-verification-reminder';
import { LexTopBar } from '@/components/lex/shell/lex-top-bar';
import { WebSocketProvider } from '@/components/providers/websocket-provider';
import { TenantBrandingProvider } from '@/components/providers/tenant-branding-provider';
import { useT } from '@/components/providers/locale-provider';
import { AuthRuntime } from '@/components/providers/auth-runtime';
import { PageTransition } from '@/components/shared/motion';
import { useAuth } from '@/hooks/use-auth';
import { useStickySuiteSegment } from '@/components/layout/use-sticky-suite';
import { SUITES, isWatheeqNavContext } from '@/config/navigation';
import { canAccessWith } from '@/lib/permissions';
import { useAuthStore } from '@/stores/auth-store';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const { hasPermission } = useAuth();

  // The Watheeq / Lex surface is SIDEBARLESS and single-bar: in Watheeq mode the
  // persistent desktop rail AND the standard header are BOTH replaced by one
  // unified deep-teal `LexTopBar` (brand + flat nav + language + user) — no more
  // double-decker header/nav stack. Every other suite keeps the standard
  // `Sidebar` + header. The mobile drawer (`MobileSidebar`) + shared ⌘K palette
  // remain in both modes, so small-screen navigation is unaffected.
  //
  // The shell is gated on the active SUITE, not the raw URL prefix: we reuse the
  // sidebar's `useStickySuiteSegment` + `isWatheeqNavContext` computation so the
  // sidebarless shell persists on shared routes (workflows, admin/*) launched
  // from within Watheeq — instead of flipping back to the old sidebar the moment
  // the path leaves `/lex`. Watheeq-only tenants stay sidebarless everywhere.
  const effectiveSegment = useStickySuiteSegment(pathname);
  // `hasPermission` is a STABLE store-selector ref, so the memo below would never
  // re-run when permissions hydrate asynchronously (roles from the session, then
  // granular lex perms via /lex/me) — a Watheeq-only user would be stuck on the
  // sidebar because `watheeqMode` was computed before their perms loaded.
  // Subscribing to `user` (roles load) + `permissionsVersion` (external-perm
  // hydration) re-renders + re-evaluates the moment access resolves.
  const user = useAuthStore((s) => s.user);
  const permissionsVersion = useAuthStore((s) => s.permissionsVersion);
  const watheeqMode = useMemo(() => {
    const accessible = SUITES.filter((suite) => canAccessWith(hasPermission, suite.permission));
    return isWatheeqNavContext(effectiveSegment, accessible);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- user + permissionsVersion are the reactive perm signals; hasPermission itself is a stable ref.
  }, [hasPermission, effectiveSegment, user, permissionsVersion]);

  return (
    <AuthRuntime>
      <WebSocketProvider>
        <TenantBrandingProvider />
        <a
          href="#main"
          className="sr-only z-[100] rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground shadow-lg focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:outline-none focus:ring-2 focus:ring-ring rtl:focus:left-auto rtl:focus:right-4"
        >
          {t('shell.skipToMain')}
        </a>
        <div
          className="relative flex h-[100dvh] min-h-[100svh] overflow-hidden bg-background"
          data-watheeq-app={watheeqMode ? 'true' : undefined}
        >
          {!watheeqMode && <Sidebar />}
          <MobileSidebar />
          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            <ConnectionBanner />
            <EmailVerificationReminder />
            {/* Watheeq surface = ONE unified deep-teal bar (brand + flat nav +
                language + user); every other suite keeps the standard header. */}
            {watheeqMode ? <LexTopBar /> : <Header />}
            <main id="main" tabIndex={-1} className="flex-1 overflow-auto focus:outline-none">
              {/* Route transition: token-bound fade + 2px rise, keyed on the
                  pathname inside PageTransition (replaces the previous keyed
                  animate-fade-in div); static under prefers-reduced-motion. */}
              <PageTransition className="mx-auto w-full min-w-0 max-w-[1440px] px-4 py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 md:pb-6 lg:px-8 xl:px-10 min-[1800px]:max-w-[1600px]">
                {children}
              </PageTransition>
            </main>
          </div>
          <MobileQuickNav />
          <CommandPalette />
        </div>
      </WebSocketProvider>
    </AuthRuntime>
  );
}
