import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface AuthFormSkeletonProps {
  className?: string;
  /** Localized screen-reader loading announcement (defaults to English). */
  loadingLabel?: string;
}

/**
 * Loading placeholder that mirrors the credentials step of `LoginForm`
 * (eyebrow pill, headline, description, two labeled fields, the "keep me signed
 * in" row, the submit button, the OAuth divider + provider buttons, and the
 * footer link). Intended as a Suspense fallback so the auth surface does not
 * collapse / shift while the interactive form streams in.
 *
 * Decorative only — the whole tree is hidden from assistive tech via
 * `aria-hidden` and exposes a single polite "loading" status for screen readers.
 */
export function AuthFormSkeleton({ className, loadingLabel }: AuthFormSkeletonProps) {
  return (
    <div className={cn('space-y-5', className)}>
      <span role="status" aria-live="polite" className="sr-only">
        {loadingLabel ?? 'Loading sign-in form'}
      </span>

      <div aria-hidden="true" className="space-y-5">
        {/* Intro: eyebrow pill, headline, description */}
        <div className="space-y-2.5">
          <Skeleton className="h-5 w-40 rounded-full" />
          <Skeleton className="h-8 w-3/4 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-5/6 rounded" />
          </div>
        </div>

        {/* Form fields — geometry mirrors the real controls (h-12/rounded-2xl
            inputs + submit, h-10/rounded-xl compact method row) so the
            skeleton→form swap causes no visible layout shift. */}
        <div className="space-y-4">
          {/* Work email */}
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-24 rounded" />
            <Skeleton className="h-12 w-full rounded-2xl" />
          </div>

          {/* Password (label row has the "forgot password?" link) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3.5 w-20 rounded" />
              <Skeleton className="h-3.5 w-28 rounded" />
            </div>
            <Skeleton className="h-12 w-full rounded-2xl" />
          </div>

          {/* Keep me signed in */}
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-3.5 w-52 rounded" />
          </div>

          {/* Submit */}
          <Skeleton className="h-12 w-full rounded-2xl" />
        </div>

        {/* "More sign-in options" divider + compact method row */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-px flex-1 rounded" />
            <Skeleton className="h-3 w-28 rounded" />
            <Skeleton className="h-px flex-1 rounded" />
          </div>
          <div className="grid gap-2 sm:grid-cols-[0.85fr_0.95fr_1.2fr]">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
        </div>

        {/* Footer link */}
        <div className="flex items-center justify-between border-t border-primary/10 pt-4">
          <Skeleton className="h-3.5 w-40 rounded" />
          <Skeleton className="h-3.5 w-24 rounded" />
        </div>
      </div>
    </div>
  );
}
