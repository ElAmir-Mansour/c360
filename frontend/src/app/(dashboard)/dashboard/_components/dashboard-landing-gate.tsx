'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { Skeleton } from '@/components/ui/skeleton';

import {
  resolveSuiteAwareDashboardLanding,
  WATHEEQ_HOME_PATH,
} from '../_lib/dashboard-landing';

interface DashboardLandingGateProps {
  children: React.ReactNode;
}

/**
 * Keeps `/dashboard` as the multi-suite hub while upgrading a Watheeq-only
 * tenant/user to the suite's role-aware home. The decision waits for auth
 * hydration so the generic widget board never flashes before the redirect.
 */
export function DashboardLandingGate({ children }: DashboardLandingGateProps) {
  const router = useRouter();
  const { tenant, isHydrated, hasPermission } = useAuth();

  const destination = isHydrated
    ? resolveSuiteAwareDashboardLanding(
        tenant?.settings?.enabled_suites,
        hasPermission,
      )
    : null;

  useEffect(() => {
    if (destination === WATHEEQ_HOME_PATH) {
      router.replace(WATHEEQ_HOME_PATH);
    }
  }, [destination, router]);

  if (!isHydrated || destination === WATHEEQ_HOME_PATH) {
    return <DashboardLandingSkeleton />;
  }

  return children;
}

function DashboardLandingSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Opening your workspace"
      className="space-y-6"
      data-testid="dashboard-landing-skeleton"
    >
      <Skeleton className="h-44 w-full rounded-softest" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-softest" />
        ))}
      </div>
    </div>
  );
}
