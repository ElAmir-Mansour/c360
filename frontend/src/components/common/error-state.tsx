'use client';

import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  Lock,
  RefreshCw,
  SearchX,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ForbiddenState } from '@/components/common/forbidden-state';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';

export type ErrorStateVariant =
  | 'network'
  | 'permission'
  | 'notFound'
  | 'generic';

interface ErrorStateProps {
  /** Override the variant-derived heading. */
  title?: string;
  /** Required human-readable detail. Falls back to variant copy if empty. */
  message?: string;
  onRetry?: () => void;
  /**
   * Visual/semantic variant. When omitted and an `error` is supplied, the
   * variant is inferred via {@link detectVariant}; otherwise defaults to
   * `generic`.
   */
  variant?: ErrorStateVariant;
  /**
   * Raw error used both for `detectVariant` inference (when `variant` is not
   * given) and to surface a status code in the copy.
   */
  error?: unknown;
  className?: string;
}

interface VariantConfig {
  icon: LucideIcon;
  title: string;
  message: string;
  tone: string;
  /** Whether a retry affordance is meaningful for this class of error. */
  retryable: boolean;
}

const VARIANTS: Record<ErrorStateVariant, VariantConfig> = {
  network: {
    icon: WifiOff,
    title: 'Connection problem',
    message:
      'We couldn’t reach the server. Check your connection and try again.',
    tone: 'bg-warning-500/10 text-warning-700 dark:text-warning-300',
    retryable: true,
  },
  permission: {
    icon: Lock,
    title: 'Access denied',
    message: 'You don’t have permission to view this resource.',
    tone: 'bg-destructive/10 text-destructive',
    retryable: false,
  },
  notFound: {
    icon: SearchX,
    title: 'Not found',
    message: 'The resource you’re looking for doesn’t exist or was removed.',
    tone: 'bg-muted text-muted-foreground',
    retryable: false,
  },
  generic: {
    icon: AlertCircle,
    title: 'Something went wrong',
    message: 'An unexpected error occurred. Please try again.',
    tone: 'bg-destructive/10 text-destructive',
    retryable: true,
  },
};

/**
 * Arabic (Saudi administrative register) copy, keyed by variant. Only the
 * human-readable title/message are localized — icon/tone/retryable stay in
 * {@link VARIANTS}. The `permission` variant is rendered via the already
 * bilingual {@link ForbiddenState}, so its copy here is only a fallback.
 */
const VARIANT_COPY_AR: Record<ErrorStateVariant, { title: string; message: string }> = {
  network: {
    title: 'مشكلة في الاتصال',
    message: 'تعذّر الوصول إلى الخادم. تحقّق من اتصالك وحاول مرة أخرى.',
  },
  permission: {
    title: 'تم رفض الوصول',
    message: 'ليست لديك صلاحية للاطلاع على هذا المورد.',
  },
  notFound: {
    title: 'غير موجود',
    message: 'المورد الذي تبحث عنه غير موجود أو تمت إزالته.',
  },
  generic: {
    title: 'حدث خطأ ما',
    message: 'وقع خطأ غير متوقع. يُرجى المحاولة مرة أخرى.',
  },
};

/** Extract an HTTP-ish status code from an error of unknown shape. */
function statusFromError(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as Record<string, unknown>;
  const direct = e.status ?? e.statusCode ?? e.code;
  if (typeof direct === 'number') return direct;
  const response = e.response as Record<string, unknown> | undefined;
  if (response && typeof response.status === 'number') return response.status;
  return undefined;
}

/**
 * Best-effort extraction of the missing permission slug from an arbitrary
 * error shape (top-level, `details`, or an axios-style `response.data`).
 */
function permissionFromError(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidates: unknown[] = [error];
  const e = error as Record<string, unknown>;
  if (e.details && typeof e.details === 'object') candidates.push(e.details);
  const response = e.response as Record<string, unknown> | undefined;
  if (response?.data && typeof response.data === 'object') {
    candidates.push(response.data);
  }
  for (const candidate of candidates) {
    const c = candidate as Record<string, unknown>;
    if (typeof c.required_permission === 'string') return c.required_permission;
    if (
      Array.isArray(c.required_permissions) &&
      typeof c.required_permissions[0] === 'string'
    ) {
      return c.required_permissions[0];
    }
  }
  return undefined;
}

/**
 * Best-effort classification of an arbitrary error into an {@link ErrorStateVariant}.
 * Inspects HTTP status codes first (401/403 → permission, 404 → notFound,
 * network/timeout names → network), then message heuristics, defaulting to
 * `generic`.
 */
export function detectVariant(error: unknown): ErrorStateVariant {
  const status = statusFromError(error);
  if (status === 401 || status === 403) return 'permission';
  if (status === 404) return 'notFound';

  const name =
    error && typeof error === 'object'
      ? String((error as Record<string, unknown>).name ?? '')
      : '';
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error && typeof error === 'object'
          ? String((error as Record<string, unknown>).message ?? '')
          : '';
  const haystack = `${name} ${message}`.toLowerCase();

  if (
    name === 'TypeError' &&
    (haystack.includes('fetch') || haystack.includes('network'))
  ) {
    return 'network';
  }
  if (
    /network|timeout|timed out|econnrefused|enotfound|offline|failed to fetch/.test(
      haystack,
    )
  ) {
    return 'network';
  }
  if (/forbidden|unauthor|permission|access denied/.test(haystack)) {
    return 'permission';
  }
  if (/not found|404|missing|does not exist/.test(haystack)) {
    return 'notFound';
  }
  return 'generic';
}

export function ErrorState({
  title,
  message,
  onRetry,
  variant,
  error,
  className,
}: ErrorStateProps) {
  const { locale } = useLocaleOrDefault();
  const isAr = locale === 'ar';
  const resolvedVariant: ErrorStateVariant =
    variant ?? (error !== undefined ? detectVariant(error) : 'generic');

  // 401/403 render the designed forbidden experience (lock illustration,
  // bilingual copy, request-access CTA) instead of the generic error block.
  if (resolvedVariant === 'permission') {
    return (
      <ForbiddenState
        title={title}
        message={message}
        permission={permissionFromError(error)}
        size="compact"
        className={className}
      />
    );
  }

  const config = VARIANTS[resolvedVariant];
  const copyAr = VARIANT_COPY_AR[resolvedVariant];
  const Icon = config.icon;

  const status = statusFromError(error);
  const resolvedTitle = title ?? (isAr ? copyAr.title : config.title);
  const resolvedMessage = message || (isAr ? copyAr.message : config.message);

  // Only offer retry when the caller wired it AND the class of error is one a
  // retry can plausibly fix (e.g. not a 403).
  const showRetry = Boolean(onRetry) && config.retryable;

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center py-12 text-center',
        className,
      )}
    >
      <div className={cn('mb-4 rounded-full p-4', config.tone)}>
        <Icon className="h-8 w-8" aria-hidden />
      </div>
      <h3 className="mb-1 text-base font-medium">{resolvedTitle}</h3>
      <p className="mb-4 max-w-sm text-sm text-muted-foreground">
        {resolvedMessage}
        {status ? (
          <span className="ms-1 font-mono text-xs opacity-70">({status})</span>
        ) : null}
      </p>
      {showRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden />
          {isAr ? 'إعادة المحاولة' : 'Try again'}
        </Button>
      )}
    </div>
  );
}
