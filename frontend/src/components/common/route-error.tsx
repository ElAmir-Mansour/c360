'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

interface RouteErrorProps {
  /** The error thrown by a child segment (Next.js error boundary contract). */
  error: Error & { digest?: string };
  /** Re-render the segment (Next.js error boundary contract). */
  reset: () => void;
  /** Human label for the area that failed, e.g. "Cyber". */
  segment?: string;
}

/**
 * Shared App Router `error.tsx` body. Drop into any segment:
 *
 *   'use client';
 *   import { RouteError } from '@/components/common/route-error';
 *   export default function Error(props) {
 *     return <RouteError {...props} segment="Cyber" />;
 *   }
 */
export function RouteError({ error, reset, segment }: RouteErrorProps) {
  const { locale } = useLocaleOrDefault();
  const isAr = locale === 'ar';

  useEffect(() => {
    // Surface to the console / any wired error reporter.
    console.error(`[route-error]${segment ? ` [${segment}]` : ''}`, error);
  }, [error, segment]);

  const heading = segment
    ? isAr
      ? `تعذّر تحميل ${segment}`
      : `Couldn’t load ${segment}`
    : isAr
      ? 'حدث خطأ ما'
      : 'Something went wrong';

  return (
    <div
      role="alert"
      className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center animate-fade-in"
    >
      <div className="mb-5 rounded-full bg-destructive/10 p-4">
        <AlertTriangle className="h-9 w-9 text-destructive" />
      </div>
      <h2 className="text-h3 font-semibold">{heading}</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {isAr
          ? 'وقع خطأ غير متوقع أثناء عرض هذه الصفحة. يمكنك إعادة المحاولة أو الانتقال إلى مكان آخر والعودة.'
          : 'An unexpected error occurred while rendering this page. You can retry, or navigate elsewhere and come back.'}
      </p>
      {error?.digest && (
        <p className="mt-2 font-mono text-xs text-muted-foreground/70">
          {isAr ? 'المرجع:' : 'Reference:'} {error.digest}
        </p>
      )}
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={reset}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {isAr ? 'إعادة المحاولة' : 'Try again'}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard">
            {isAr ? 'الانتقال إلى لوحة المعلومات' : 'Go to dashboard'}
          </Link>
        </Button>
      </div>
    </div>
  );
}
