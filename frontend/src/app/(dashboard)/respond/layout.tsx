'use client';

import { type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { PermissionRedirect } from '@/components/common/permission-redirect';

export default function RespondLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isStakeholderTokenRoute = (pathname ?? '').startsWith('/respond/stakeholder/');

  if (isStakeholderTokenRoute) {
    return <>{children}</>;
  }

  return (
    <PermissionRedirect permission="respond:incident:read">
      {children}
    </PermissionRedirect>
  );
}
