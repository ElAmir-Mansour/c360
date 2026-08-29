'use client';

import {
  Lock,
  Sparkles,
  KeyRound,
  Eye,
  Pencil,
  Trash2,
  ChevronRight,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Role } from '@/types/models';
import { useAdminT } from '../../_lib/admin-i18n';
import { getRoleVisual } from '../_lib/role-meta';

interface RoleCardProps {
  role: Role;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
}

export function RoleCard({
  role,
  onView,
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = true,
}: RoleCardProps) {
  const labels = useAdminT();
  const { Icon, accent } = getRoleVisual(role);
  const wildcard = role.permissions.includes('*');

  return (
    <Card interactive className="group relative flex h-full flex-col gap-4 p-5">
      {/* Full-card "view" trigger. Stretched over the card as a sibling (not a
          wrapper) so the explicit edit/delete buttons below are NOT nested
          inside it — keeps the markup free of nested-interactive a11y
          violations while letting the whole surface open the detail dialog. */}
      <button
        type="button"
        aria-label={labels.roles.viewRoleAria(role.name)}
        onClick={onView}
        className="absolute inset-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      />

      {/* Header — decorative; clicks fall through to the stretched trigger. */}
      <div className="pointer-events-none flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'grid h-11 w-11 shrink-0 place-items-center rounded-xl',
              accent.tile,
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-body font-semibold leading-tight tracking-[-0.01em] text-foreground">
              {role.name}
            </h3>
            <span
              className={cn(
                'mt-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-overline font-medium',
                role.is_system
                  ? 'border-border/60 bg-muted/50 text-muted-foreground'
                  : 'border-brand-primary-500/20 bg-brand-primary-500/10 text-brand-primary-600 dark:text-brand-primary-300',
              )}
            >
              {role.is_system ? (
                <Lock className="h-3 w-3" aria-hidden />
              ) : (
                <Sparkles className="h-3 w-3" aria-hidden />
              )}
              {role.is_system ? labels.roles.system : labels.roles.custom}
            </span>
          </div>
        </div>
        <ChevronRight
          className="h-4 w-4 shrink-0 -translate-x-1 rtl:translate-x-1 text-muted-foreground/40 opacity-0 transition-[transform,opacity] duration-fast ease-standard group-hover:translate-x-0 group-hover:opacity-100 rtl:rotate-180"
          aria-hidden
        />
      </div>

      {/* Description */}
      <p className="pointer-events-none line-clamp-2 min-h-[2.5rem] text-sm leading-relaxed text-muted-foreground">
        {role.description || labels.roles.noDescription}
      </p>

      {/* Footer — perm count + actions */}
      <div className="pointer-events-none mt-auto flex items-center justify-between gap-2 border-t border-border/50 pt-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {wildcard ? (
            <Sparkles className="h-3.5 w-3.5 text-brand-gold-600 dark:text-brand-gold-300" aria-hidden />
          ) : (
            <KeyRound className="h-3.5 w-3.5" aria-hidden />
          )}
          {wildcard ? labels.roles.fullAccess : labels.roles.permissionsCount(role.permissions.length)}
        </span>

        <div className="pointer-events-auto relative z-10 flex items-center gap-0.5">
          {role.is_system ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={onView}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden />
              {labels.roles.view}
            </Button>
          ) : (
            <>
              {canEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  aria-label={labels.roles.editAria(role.name)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Pencil className="h-4 w-4" aria-hidden />
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  aria-label={labels.roles.deleteAria(role.name)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-error-500/10 hover:text-error-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-error-300"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

export function RoleCardSkeleton() {
  return (
    <Card className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-11 w-11 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-20 rounded-full" />
        </div>
      </div>
      <Skeleton className="h-9 w-full" />
      <div className="mt-auto flex items-center justify-between border-t border-border/50 pt-3">
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-8 w-16" />
      </div>
    </Card>
  );
}
