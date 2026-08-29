'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { Toaster } from '@/components/ui/sonner';
import { ENTITLEMENT_REQUIRED_EVENT, PERMISSION_DENIED_EVENT } from '@/lib/api';
import type { AppLocale } from '@/lib/i18n';
import type {
  EntitlementRequiredEventDetail,
  PermissionDeniedEventDetail,
} from '@/types/api';

/**
 * Bilingual copy for the global API-failure toasts. Resolved through the
 * mounted LocaleProvider (falls back to the configured default locale when
 * rendered in isolation, matching `useLocaleOrDefault`).
 */
const COPY = {
  en: {
    upgradeTitle: 'Upgrade required',
    upgradeFallback: 'Your current plan does not include this feature.',
    review: 'Review',
    permissionTitle: 'Permission required',
    permissionFallback: "You don't have permission to perform this action.",
    permissionHead: (capability: string) =>
      `You don't have permission to ${capability}.`,
    contactAdmin:
      'Please contact your administrator or a colleague with the required role.',
  },
  ar: {
    upgradeTitle: 'الترقية مطلوبة',
    upgradeFallback: 'باقتك الحالية لا تتضمن هذه الميزة.',
    review: 'مراجعة',
    permissionTitle: 'صلاحية مطلوبة',
    permissionFallback: 'ليست لديك الصلاحية اللازمة لتنفيذ هذا الإجراء.',
    permissionHead: (capability: string) =>
      `ليست لديك الصلاحية اللازمة (${capability}).`,
    contactAdmin: 'يرجى التواصل مع مسؤول النظام أو زميل لديه الدور المطلوب.',
  },
} as const;

/**
 * ToastProvider mounts the app-wide sonner Toaster (the single toast outlet
 * for every `toast()` call across the app — dashboard and auth surfaces both
 * live under it in the root layout) and wires the global API-failure events
 * (402 entitlement / 403 permission) to actionable toasts.
 *
 * The stack anchors bottom-end: bottom-right in LTR, bottom-left in RTL, with
 * sonner's `dir` matched to the active document direction so swipe-to-dismiss
 * and layout mirror correctly for Arabic.
 */
export function ToastProvider() {
  const { locale, direction } = useLocaleOrDefault();

  useEffect(() => {
    const copy = COPY[locale] ?? COPY.en;

    const handleEntitlementRequired = (event: Event) => {
      const detail = (event as CustomEvent<EntitlementRequiredEventDetail>).detail;
      if (!detail) {
        return;
      }

      const upgradeURL = normalizeUpgradeURL(detail.upgrade_url);
      toast.warning(copy.upgradeTitle, {
        description: detail.message || copy.upgradeFallback,
        action: upgradeURL
          ? {
              label: copy.review,
              onClick: () => {
                window.location.href = upgradeURL;
              },
            }
          : undefined,
      });
    };

    // De-dupe identical permission denials within a short window (e.g. a button
    // clicked several times) so the user sees one clear toast, not a stack.
    let lastDenied = '';
    let lastDeniedAt = 0;
    const handlePermissionDenied = (event: Event) => {
      const detail = (event as CustomEvent<PermissionDeniedEventDetail>).detail;
      if (!detail) {
        return;
      }
      const perm = detail.required_permission ?? detail.required_permissions?.[0] ?? detail.message;
      const now = Date.now();
      if (perm === lastDenied && now - lastDeniedAt < 4000) {
        return;
      }
      lastDenied = perm;
      lastDeniedAt = now;

      toast.error(copy.permissionTitle, {
        description: describePermissionDenied(detail, locale),
      });
    };

    window.addEventListener(ENTITLEMENT_REQUIRED_EVENT, handleEntitlementRequired);
    window.addEventListener(PERMISSION_DENIED_EVENT, handlePermissionDenied);
    return () => {
      window.removeEventListener(ENTITLEMENT_REQUIRED_EVENT, handleEntitlementRequired);
      window.removeEventListener(PERMISSION_DENIED_EVENT, handlePermissionDenied);
    };
  }, [locale]);

  return (
    <Toaster
      dir={direction}
      position={direction === 'rtl' ? 'bottom-left' : 'bottom-right'}
      closeButton
    />
  );
}

// describePermissionDenied turns a 403 into an actionable sentence: what
// capability is missing + who to ask. Falls back to the server message.
function describePermissionDenied(
  detail: PermissionDeniedEventDetail,
  locale: AppLocale,
): string {
  const copy = COPY[locale] ?? COPY.en;
  const perm = detail.required_permission ?? detail.required_permissions?.[0];
  // Arabic: the humanized capability phrases are English-only, so surface the
  // raw slug (a stable identifier the admin recognizes) inside Arabic copy.
  const capability =
    locale === 'ar' ? (perm ?? null) : perm ? humanizePermission(perm) : null;
  const head = capability
    ? copy.permissionHead(capability)
    : detail.message || copy.permissionFallback;
  return `${head} ${copy.contactAdmin}`;
}

// humanizePermission maps a permission slug to a plain-language action. Known
// slugs get a hand-written phrase; anything else is prettified from the slug.
function humanizePermission(perm: string): string {
  const KNOWN: Record<string, string> = {
    'workflow:read': 'view workflows',
    'workflow:write': 'create or run workflows',
    'workflow:admin': 'administer workflow definitions',
    'workflow:task': 'act on workflow tasks',
    'audit:read': 'view audit logs',
    'admin:console': 'access the admin console',
  };
  if (KNOWN[perm]) {
    return KNOWN[perm];
  }
  // Generic: "lex:contract:approve" -> "approve contract (lex)"
  const parts = perm.split(':');
  if (parts.length >= 2) {
    const verb = parts[parts.length - 1].replace(/[-_]/g, ' ');
    const subject = parts.slice(1, -1).join(' ').replace(/[-_]/g, ' ');
    const ns = parts[0];
    return subject ? `${verb} ${subject} (${ns})` : `${verb} (${ns})`;
  }
  return `perform this action (${perm})`;
}

function normalizeUpgradeURL(upgradeURL: string | undefined): string | null {
  if (!upgradeURL) {
    return null;
  }

  try {
    const parsed = new URL(upgradeURL, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
