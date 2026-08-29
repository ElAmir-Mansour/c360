'use client';

import Link from 'next/link';
import { ClipboardCopy, Home, Mail } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { ROUTES } from '@/lib/constants';
import { showError, showSuccess } from '@/lib/toast';
import { cn, copyToClipboard } from '@/lib/utils';

/**
 * Bilingual copy for the designed 403 experience, resolved via the
 * `useLocaleOrDefault` pattern (falls back to the configured default locale
 * when rendered outside a LocaleProvider, e.g. isolated unit tests).
 */
const COPY = {
  en: {
    code: 'Error 403',
    title: 'Access restricted',
    message:
      'You don’t have permission to view this page. If you believe you need access, send a request to your administrator.',
    requiredPermission: 'Required permission',
    requestAccess: 'Request access',
    copyDetails: 'Copy request details',
    copied: 'Request details copied',
    copiedDescription: 'Paste them into a message to your administrator.',
    copyFailed: 'Could not copy the request details',
    backToHome: 'Back to home',
    mailSubject: 'Access request — Clario360',
    detailHeading: 'Access request',
    detailRequestedBy: 'Requested by',
    detailPage: 'Page',
    detailPermission: 'Required permission',
    detailReason: 'Reason (please describe why you need access):',
  },
  ar: {
    code: 'خطأ 403',
    title: 'الوصول مقيّد',
    message:
      'ليست لديك الصلاحية اللازمة لعرض هذه الصفحة. إذا كنت بحاجة إلى الوصول، أرسل طلباً إلى مسؤول النظام.',
    requiredPermission: 'الصلاحية المطلوبة',
    requestAccess: 'طلب الوصول',
    copyDetails: 'نسخ تفاصيل الطلب',
    copied: 'تم نسخ تفاصيل الطلب',
    copiedDescription: 'ألصقها في رسالة إلى مسؤول النظام.',
    copyFailed: 'تعذّر نسخ تفاصيل الطلب',
    backToHome: 'العودة إلى الرئيسية',
    mailSubject: 'طلب وصول — Clario360',
    detailHeading: 'طلب وصول',
    detailRequestedBy: 'مقدّم الطلب',
    detailPage: 'الصفحة',
    detailPermission: 'الصلاحية المطلوبة',
    detailReason: 'السبب (يرجى وصف سبب حاجتك إلى الوصول):',
  },
} as const;

export interface ForbiddenStateProps {
  /** Permission slug that gated the resource (shown + included in the request). */
  permission?: string;
  /** Override the localized heading. */
  title?: string;
  /** Override the localized explanation. */
  message?: string;
  /** Where "Back to home" navigates (defaults to the dashboard). */
  backHref?: string;
  /**
   * `page` renders the full designed 403 (route-level); `compact` tightens
   * spacing for embedding inside cards/panels (e.g. via ErrorState).
   */
  size?: 'page' | 'compact';
  className?: string;
}

/**
 * Designed 403 experience: lock illustration, bilingual copy, a
 * "Request access" CTA (mailto compose + copy-request-details fallback —
 * there is no self-serve access-request API, and notification creation is
 * admin-gated) and a way back home. Reused by the /forbidden route,
 * PermissionRedirect and ErrorState's permission variant.
 */
export function ForbiddenState({
  permission,
  title,
  message,
  backHref,
  size = 'page',
  className,
}: ForbiddenStateProps) {
  const { locale } = useLocaleOrDefault();
  const copy = locale === 'ar' ? COPY.ar : COPY.en;
  const { user } = useAuth();
  const compact = size === 'compact';

  const buildRequestDetails = (): string => {
    const page =
      typeof window !== 'undefined' ? window.location.href : '';
    const displayName =
      user?.full_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ');
    const requestedBy = user ? `${displayName} <${user.email}>`.trim() : '';
    const lines = [
      copy.detailHeading,
      `${copy.detailRequestedBy}: ${requestedBy}`,
      `${copy.detailPage}: ${page}`,
    ];
    if (permission) {
      lines.push(`${copy.detailPermission}: ${permission}`);
    }
    lines.push('', copy.detailReason, '');
    return lines.join('\n');
  };

  const handleRequestAccess = () => {
    const mailto = `mailto:?subject=${encodeURIComponent(copy.mailSubject)}&body=${encodeURIComponent(buildRequestDetails())}`;
    window.location.href = mailto;
  };

  const handleCopyDetails = async () => {
    const ok = await copyToClipboard(buildRequestDetails());
    if (ok) {
      showSuccess(copy.copied, copy.copiedDescription);
    } else {
      showError(copy.copyFailed);
    }
  };

  return (
    <div
      role={compact ? 'alert' : undefined}
      className={cn(
        'flex flex-col items-center justify-center text-center motion-safe:animate-fade-up',
        compact ? 'py-10' : 'min-h-[60vh] py-16',
        className,
      )}
    >
      <div
        className={cn(
          'mb-5 grid place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20',
          compact ? 'h-16 w-16' : 'h-24 w-24',
        )}
      >
        <LockIllustration
          className={compact ? 'h-9 w-9' : 'h-14 w-14'}
        />
      </div>

      <p className="mb-1 font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {copy.code}
      </p>
      <h2 className={cn('mb-2 font-semibold', compact ? 'text-base' : 'text-h3')}>
        {title ?? copy.title}
      </h2>
      <p className="mb-4 max-w-md text-sm leading-relaxed text-muted-foreground">
        {message || copy.message}
      </p>

      {permission && (
        <p className="mb-6 inline-flex max-w-full items-center gap-2 rounded-md border border-border/70 bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
          <span>{copy.requiredPermission}:</span>
          <code className="truncate font-mono text-foreground" dir="ltr">
            {permission}
          </code>
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button size="sm" onClick={handleRequestAccess}>
          <Mail className="me-1.5 h-3.5 w-3.5" aria-hidden />
          {copy.requestAccess}
        </Button>
        <Button size="sm" variant="outline" onClick={handleCopyDetails}>
          <ClipboardCopy className="me-1.5 h-3.5 w-3.5" aria-hidden />
          {copy.copyDetails}
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link href={backHref ?? ROUTES.DASHBOARD}>
            <Home className="me-1.5 h-3.5 w-3.5" aria-hidden />
            {copy.backToHome}
          </Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * Inline lock illustration. Strokes use `currentColor` so it inherits the
 * token-bound tint from its wrapper (light + dark safe); decorative rings are
 * drawn at reduced opacity for depth without extra colors.
 */
function LockIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      {/* Decorative orbit rings */}
      <circle cx="32" cy="34" r="27" stroke="currentColor" strokeWidth="1" opacity="0.15" />
      <circle
        cx="32"
        cy="34"
        r="21.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="3 5"
        opacity="0.3"
      />
      {/* Shackle */}
      <path
        d="M23 30v-6.5a9 9 0 0 1 18 0V30"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Body */}
      <rect
        x="18.5"
        y="30"
        width="27"
        height="20"
        rx="4.5"
        stroke="currentColor"
        strokeWidth="2.5"
        fill="currentColor"
        fillOpacity="0.08"
      />
      {/* Keyhole */}
      <circle cx="32" cy="38.5" r="2.75" fill="currentColor" />
      <path
        d="M32 40.5v4"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
