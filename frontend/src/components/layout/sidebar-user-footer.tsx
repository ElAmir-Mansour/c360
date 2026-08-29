'use client';

import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LogOut, Settings } from 'lucide-react';
import Link from 'next/link';

interface SidebarUserFooterProps {
  collapsed: boolean;
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName?.charAt(0) ?? ''}${lastName?.charAt(0) ?? ''}`.toUpperCase() || 'U';
}

function getAvatarColor(userId: string): string {
  const colors = [
    'bg-brand-primary-700',
    'bg-info-700',
    'bg-error-700',
    'bg-warning-800',
    'bg-success-700',
    'bg-brand-accent-800',
    'bg-neutral-700',
    'bg-brand-teal-800',
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return colors[hash % colors.length];
}

export function SidebarUserFooter({ collapsed }: SidebarUserFooterProps) {
  const { user, logout } = useAuth();

  if (!user) return null;

  const initials = getInitials(user.first_name, user.last_name);
  const avatarColor = getAvatarColor(user.id);
  const primaryRole = user.roles?.[0]?.name ?? 'Viewer';
  const fullName = `${user.first_name} ${user.last_name}`.trim() || user.email;

  const avatar = (
    <div
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white',
        avatarColor,
      )}
      aria-hidden="true"
    >
      {user.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </div>
  );

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-1">
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Link
              href="/settings"
              className="sidebar-user-card rounded-xl border border-white/10 bg-white/[0.04] p-1 transition-[transform,background-color,box-shadow,border-color] hover:bg-white/[0.08] motion-reduce:transition-none"
            >
              {avatar}
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" className="rounded-lg border border-primary/30 bg-auth-dark px-3 py-1.5 text-white shadow-lg">
            <div>
              <p className="text-[13px] font-medium">{fullName}</p>
              <p className="text-[11px] text-white/70">{primaryRole}</p>
            </div>
          </TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              onClick={logout}
              className="rounded-lg p-1.5 text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
              aria-label="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="rounded-lg border border-primary/30 bg-auth-dark px-3 py-1.5 text-[13px] text-white shadow-lg">
            Sign out
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="sidebar-user-card flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] p-2">
      <Link
        href="/settings"
        aria-label={fullName || 'Profile'}
        className="rounded-full ring-2 ring-brand-bright/25"
      >
        {avatar}
      </Link>
      <div className="flex-1 overflow-hidden">
        <p className="truncate text-[13px] font-semibold text-white">{fullName}</p>
        <p className="truncate text-[11px] text-white/70">{primaryRole}</p>
      </div>
      <div className="flex items-center">
        <Link
          href="/settings"
          className="rounded-lg p-1.5 text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
          aria-label="Settings"
        >
          <Settings className="h-3.5 w-3.5" />
        </Link>
        <button
          onClick={logout}
          className="rounded-lg p-1.5 text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
          aria-label="Sign out"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
