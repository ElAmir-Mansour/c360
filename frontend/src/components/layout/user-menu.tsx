'use client';

import { User, Bell, Lock, MailWarning, Compass } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { DASHBOARD_TOUR_ID, launchTour } from '@/components/shared/tour';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getEmailVerificationUrl, needsEmailVerification } from '@/lib/email-verification';
import { useLocale } from '@/components/providers/locale-provider';
import Link from 'next/link';

function getInitials(firstName: string, lastName: string): string {
  return `${firstName?.charAt(0) ?? ''}${lastName?.charAt(0) ?? ''}`.toUpperCase() || 'U';
}

function getAvatarColor(userId: string): string {
  // -700 shades so white initials meet WCAG AA contrast (>= 4.5:1).
  const colors = [
    'bg-blue-700',
    'bg-purple-700',
    'bg-primary',
    'bg-orange-700',
    'bg-pink-700',
    'bg-teal-700',
    'bg-indigo-700',
    'bg-red-700',
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return colors[hash % colors.length];
}

export function UserMenu() {
  const { locale, t } = useLocale();
  const router = useRouter();
  const { user, tenant, logout } = useAuth();

  if (!user) return null;

  const initials = getInitials(user.first_name, user.last_name);
  const avatarColor = getAvatarColor(user.id);
  const primaryRole = user.roles?.[0]?.name ?? 'Viewer';
  const fullName = `${user.first_name} ${user.last_name}`.trim() || user.email;
  const verificationPending = needsEmailVerification(user);
  const verificationUrl = getEmailVerificationUrl({
    email: user.email,
    tenantId: user.tenant_id ?? tenant?.id ?? null,
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-lg border border-primary/15 bg-card px-1.5 py-1 shadow-sm transition-all hover:border-primary/30 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label="Open user menu"
        >
          <div
            className={cn(
              'relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md text-[11px] font-semibold text-white shadow-sm ring-1 ring-inset ring-white/10',
              avatarColor,
            )}
          >
            {user.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatar_url}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              initials
            )}
            {verificationPending ? (
              <span
                className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-warning-500"
                aria-hidden
              />
            ) : null}
          </div>
          <div className="hidden md:block pr-1.5 text-left">
            <p className="text-[12px] font-semibold leading-tight tracking-[-0.01em] text-foreground">{fullName}</p>
            <p className="text-overline uppercase leading-tight tracking-[0.1em] text-foreground/80 rtl:normal-case rtl:tracking-normal">
              {verificationPending ? t('shell.emailVerificationPending') : primaryRole}
            </p>
          </div>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-semibold">{fullName}</p>
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          <p className="text-xs text-muted-foreground">{primaryRole}</p>
          {verificationPending ? (
            <Badge variant="warning" className="mt-2 gap-1.5 text-[11px]">
              <MailWarning className="h-3 w-3" aria-hidden />
              {t('shell.emailVerificationPending')}
            </Badge>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {verificationPending ? (
          <>
            <DropdownMenuItem asChild>
              <Link href={verificationUrl} className="flex items-center gap-2">
                <MailWarning className="h-4 w-4" />
                {t('shell.emailVerificationVerify')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href="/settings" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Profile Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/notifications" className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Notification Preferences
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings" className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Security (MFA)
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="flex items-center gap-2"
          onClick={() => {
            // Records a one-shot launch request + fires the live event; if we
            // are not on the dashboard hub, navigate there so the tour host
            // consumes the request on mount.
            launchTour(DASHBOARD_TOUR_ID);
            router.push('/dashboard');
          }}
        >
          <Compass className="h-4 w-4" />
          {locale === 'ar' ? 'عرض الجولة التعريفية' : 'Show tour'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={logout}
          className="text-destructive focus:text-destructive"
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
