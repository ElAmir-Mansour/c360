'use client';

import { useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { hexToHslTriplet } from '@/lib/branding';

/**
 * Applies the active tenant's branding primary color at runtime by overriding the
 * `--primary`/`--ring` CSS variables on <html>. Renders nothing. Tenants without a
 * branding.primary_color keep the default Clario palette (no-op). The override is
 * reverted on unmount / tenant change so it never leaks across sessions.
 */
export function TenantBrandingProvider() {
  const { tenant } = useAuth();
  const primaryColor = tenant?.settings?.branding?.primary_color;

  useEffect(() => {
    if (!primaryColor) return;
    const triplet = hexToHslTriplet(primaryColor);
    if (!triplet) return;

    const root = document.documentElement;
    const prevPrimary = root.style.getPropertyValue('--primary');
    const prevRing = root.style.getPropertyValue('--ring');

    root.style.setProperty('--primary', triplet);
    root.style.setProperty('--ring', triplet);

    return () => {
      if (prevPrimary) root.style.setProperty('--primary', prevPrimary);
      else root.style.removeProperty('--primary');
      if (prevRing) root.style.setProperty('--ring', prevRing);
      else root.style.removeProperty('--ring');
    };
  }, [primaryColor]);

  return null;
}
